// Issues a contract token to any application that predates them.
//
// The contract link used to carry the APP-YYYY-NNNN reference, which is short
// and sequential enough to be guessed and walked; the token replaces it. This
// only ever ADDS a field to documents that lack one — it never overwrites an
// existing token (that would break links already sent out) and never deletes.
//
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json \
//     node scripts/backfill-contract-tokens.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

(async () => {
  const snap = await db.collection('applications').get();
  let issued = 0, kept = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.contractToken) {
      kept++;
      console.log(`  keep   ${d.applicationCode || doc.id} — already has a token`);
      continue;
    }
    const token = crypto.randomBytes(24).toString('base64url');
    await doc.ref.update({ contractToken: token });
    issued++;
    console.log(`  issue  ${d.applicationCode || doc.id} — ${token}`);
  }

  console.log(`\n${issued} token(s) issued, ${kept} left untouched, ${snap.size} application(s) total.`);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
