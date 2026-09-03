// Replaces structured application references (APP-YYYY-NNNN, APP-00123) with
// opaque random ones, matching what the API now issues.
//
// The reference is stamped on the application AND on every loan and payment
// raised against it, so all three have to move together or the statement and
// payment pages lose their link back to the application. Each application and
// its dependants are written in one atomic batch.
//
// Nothing is ever deleted, and an application that already has an opaque code
// is left untouched. A full before/after record is written to the backup file
// so a rename can be traced or reversed.
//
//   node scripts/migrate-application-codes.js            # dry run, prints the plan
//   node scripts/migrate-application-codes.js --apply    # performs the rename
//
// with GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json set.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

const APPLY = process.argv.includes('--apply');
const BACKUP = process.argv[process.argv.indexOf('--backup') + 1] ||
  path.join(__dirname, '..', 'application-code-migration.json');

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const OPAQUE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

// Codes are unique across the collection, so a fresh one has to miss both the
// existing codes and the ones minted earlier in this same run.
async function freshCode(taken) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode(12);
    if (taken.has(code)) continue;
    const clash = await db.collection('applications').where('applicationCode', '==', code).limit(1).get();
    if (clash.empty) { taken.add(code); return code; }
  }
  throw new Error('could not mint an unused application code');
}

async function docsWithCode(collection, code) {
  const snap = await db.collection(collection).where('applicationCode', '==', code).get();
  return snap.docs;
}

(async () => {
  const apps = await db.collection('applications').get();
  const taken = new Set(apps.docs.map(d => d.data().applicationCode).filter(Boolean));
  const plan = [];

  for (const doc of apps.docs) {
    const oldCode = doc.data().applicationCode || '';
    if (OPAQUE.test(oldCode)) {
      console.log(`  skip    ${oldCode} — already opaque`);
      continue;
    }
    if (!oldCode) {
      console.log(`  skip    ${doc.id} — no reference to migrate`);
      continue;
    }

    const newCode = await freshCode(taken);
    const loans = await docsWithCode('loans', oldCode);
    const payments = await docsWithCode('payments', oldCode);
    plan.push({ appId: doc.id, oldCode, newCode, loans, payments });

    console.log(`  rename  ${oldCode} -> ${newCode}   (${loans.length} loan(s), ${payments.length} payment(s))`);
  }

  if (!plan.length) { console.log('\nNothing to migrate.'); process.exit(0); }

  if (!APPLY) {
    console.log(`\n${plan.length} application(s) would be renamed. Re-run with --apply to perform it.`);
    process.exit(0);
  }

  // Capture the full prior state before touching anything.
  fs.writeFileSync(BACKUP, JSON.stringify(plan.map(p => ({
    applicationId: p.appId, oldCode: p.oldCode, newCode: p.newCode,
    loans: p.loans.map(d => ({ id: d.id, ...d.data() })),
    payments: p.payments.map(d => ({ id: d.id, ...d.data() }))
  })), null, 2));
  console.log(`\nBackup written to ${BACKUP}`);

  for (const p of plan) {
    const batch = db.batch();
    batch.update(db.collection('applications').doc(p.appId), { applicationCode: p.newCode });
    for (const d of p.loans) batch.update(d.ref, { applicationCode: p.newCode });
    for (const d of p.payments) batch.update(d.ref, { applicationCode: p.newCode });
    await batch.commit();
    console.log(`  done    ${p.oldCode} -> ${p.newCode}`);
  }

  // Confirm nothing still carries a structured reference.
  const leftovers = [];
  for (const collection of ['applications', 'loans', 'payments']) {
    const snap = await db.collection(collection).get();
    snap.docs.forEach(d => {
      const c = d.data().applicationCode;
      if (c && !OPAQUE.test(c)) leftovers.push(`${collection}/${d.id} = ${c}`);
    });
  }
  console.log(leftovers.length
    ? `\nStill structured:\n  ${leftovers.join('\n  ')}`
    : '\nEvery application, loan and payment now carries an opaque reference.');
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
