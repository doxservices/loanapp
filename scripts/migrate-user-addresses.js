// One-off migration: backfills addressLine1/addressLine2/parish onto the
// dummy user docs seeded before those fields existed (seed-dummy-data.js
// skips collections that are already non-empty, so re-running it won't
// pick up this data — this patches the existing docs by email instead).
// Run with: GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json node scripts/migrate-user-addresses.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

const addressByEmail = {
  'alex.j@example.com': { addressLine1: '42 Hope Road', addressLine2: 'Kingston 10', parish: 'kingston' },
  'jane.doe@example.com': { addressLine1: '8 Constant Spring Road', addressLine2: '', parish: 'st-andrew' },
  'michael.s@company.com': { addressLine1: '15 Manchester Avenue', addressLine2: '', parish: 'manchester' },
  'robert.j@finance.com': { addressLine1: '3 Independence Drive', addressLine2: '', parish: 'st-catherine' },
  'emma.w@business.com': { addressLine1: '21 Ocean View', addressLine2: '', parish: 'st-james' },
  'david.b@enterprise.com': { addressLine1: '9 Ridgemount Road', addressLine2: '', parish: 'st-andrew' },
  'sarah.g@loans.com': { addressLine1: '54 Main Street', addressLine2: '', parish: 'clarendon' },
  'thomas.p@financial.com': { addressLine1: '6 Palm Avenue', addressLine2: '', parish: 'westmoreland' }
};

(async () => {
  const snap = await db.collection('users').get();
  let updated = 0;
  for (const doc of snap.docs) {
    const email = doc.data().email;
    const address = addressByEmail[email];
    if (!address) { console.log('skip (no match):', email); continue; }
    await doc.ref.update(address);
    updated++;
    console.log('updated', email, address);
  }
  console.log(`done. ${updated} user(s) updated.`);
})().catch(err => { console.error(err); process.exit(1); });
