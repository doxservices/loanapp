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

// A standing order and a salary deduction can seed a contract too, so they
// carry the same token.
const COLLECTIONS = ['applications', 'standingOrders', 'salaryDeductions'];

(async () => {
  let issued = 0, kept = 0, total = 0;

  for (const collection of COLLECTIONS) {
    const snap = await db.collection(collection).get();
    total += snap.size;
    console.log(`\n${collection} (${snap.size} record(s))`);
    for (const doc of snap.docs) {
      const d = doc.data();
      const name = d.applicationCode || d.borrowerName || doc.id;
      if (d.contractToken) {
        kept++;
        console.log(`  keep   ${name} — already has a token`);
        continue;
      }
      const token = crypto.randomBytes(24).toString('base64url');
      await doc.ref.update({ contractToken: token });
      issued++;
      console.log(`  issue  ${name} — ${token}`);
    }
  }

  console.log(`\n${issued} token(s) issued, ${kept} left untouched, ${total} record(s) total.`);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
