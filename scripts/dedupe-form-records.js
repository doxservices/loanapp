// Collapses duplicate form records — records that hold the same information
// and differ only in when, or in which session, they were saved.
//
//   - Every printed record is kept.
//   - An autosave that says the same as a printed record is removed.
//   - Among autosaves that say the same thing, only the latest is kept.
//
// "The same information" is the API's own rule (contentSignature in
// functions/index.js): timing, session, flag and token fields are ignored and
// an absent field counts as empty. Nothing else is normalised, so a difference
// in spacing or number formatting keeps both records.
//
// Dry run by default — prints the plan and changes nothing. With --apply it
// writes a full JSON backup of every record it is about to remove, then
// removes them. Each delete is conditional on the record being unchanged
// since it was read, so a record edited mid-run is left alone.
//
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json \
//     node scripts/dedupe-form-records.js [--apply] [--backup <file>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const backupArg = process.argv.indexOf('--backup');
// Outside the repo by default: the backup holds borrowers' personal details.
const BACKUP = backupArg > -1 ? process.argv[backupArg + 1]
  : path.join(os.tmpdir(), 'form-dedupe-backup-' + Date.now() + '.json');
const COLLECTIONS = ['contracts', 'salaryDeductions', 'standingOrders'];

// Must match functions/index.js.
const META_KEYS = new Set(['autosaved', 'submittedAt', 'updatedAt', 'printedAt', 'draftId', 'editedByAdmin', 'contractToken']);
function contentSignature(rec) {
  return JSON.stringify(
    Object.keys(rec)
      .filter(k => !META_KEYS.has(k))
      .filter(k => rec[k] != null && String(rec[k]) !== '')
      .sort()
      .map(k => [k, String(rec[k])])
  );
}

const savedAt = d => { const t = d.updatedAt || d.submittedAt; return t && t.toMillis ? t.toMillis() : 0; };
const stamp = ms => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '?');
const kind = d => (d.autosaved === true ? 'autosaved' : 'printed');

function plan(docs) {
  const groups = new Map();
  docs.forEach(doc => {
    const key = contentSignature(doc.data());
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  });
  const remove = [];
  const kept = new Map();   // removed id -> the record that makes it redundant
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const printed = members.filter(d => d.data().autosaved !== true)
      .sort((a, b) => savedAt(b.data()) - savedAt(a.data()));
    const autos = members.filter(d => d.data().autosaved === true)
      .sort((a, b) => savedAt(b.data()) - savedAt(a.data()));
    const survivor = printed[0] || autos[0];
    const doomed = printed.length ? autos : autos.slice(1);
    doomed.forEach(d => kept.set(d.id, survivor));
    remove.push(...doomed);
  }
  return { groups, remove, kept };
}

(async () => {
  const backup = {};
  let totalRemoved = 0;

  for (const collection of COLLECTIONS) {
    const snap = await db.collection(collection).get();
    const { groups, remove, kept } = plan(snap.docs);
    console.log(`\n${collection}: ${snap.size} record(s), ${groups.size} distinct, ${remove.length} to remove`);
    if (!remove.length) continue;

    for (const doc of remove) {
      const survivor = kept.get(doc.id);
      console.log(`  remove ${doc.id} (${kind(doc.data())}, ${stamp(savedAt(doc.data()))})` +
        `  — same as ${survivor.id} (${kind(survivor.data())}, ${stamp(savedAt(survivor.data()))})`);
      console.log('    ' + JSON.stringify({ id: doc.id, ...doc.data() }));
    }
    backup[collection] = remove.map(doc => ({ id: doc.id, ...doc.data() }));
    totalRemoved += remove.length;
  }

  if (!totalRemoved) { console.log('\nNothing to remove.'); process.exit(0); }
  if (!APPLY) {
    console.log(`\n${totalRemoved} record(s) would be removed. Re-run with --apply to remove them.`);
    process.exit(0);
  }

  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
  console.log(`\nBackup of all ${totalRemoved} record(s) written to ${BACKUP}`);

  for (const collection of COLLECTIONS) {
    const snap = await db.collection(collection).get();
    const { remove } = plan(snap.docs);
    if (!remove.length) continue;
    const batch = db.batch();
    remove.forEach(doc => batch.delete(doc.ref, { lastUpdateTime: doc.updateTime }));
    await batch.commit();
    console.log(`  ${collection}: removed ${remove.length}`);
  }

  for (const collection of COLLECTIONS) {
    const snap = await db.collection(collection).get();
    console.log(`  ${collection}: ${snap.size} left, ${plan(snap.docs).remove.length} duplicate(s) remaining`);
  }
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
