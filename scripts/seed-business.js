// Creates the businesses collection and puts every existing record under a
// business — the additive first half of the move to multi-tenancy. Nothing
// starts filtering by businessId until this has run and been checked.
//
// The business is seeded with the details the app already uses on its own
// printed documents. The BOJ licence is recorded as CLAIMED, not verified:
// TAJ does not license lenders, the Bank of Jamaica does, and no Loan It
// entity appears on BOJ's public register of licensed microcredit
// institutions, so MCA-016-2025 needs confirming from the licence itself.
//
//   GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json \
//     node scripts/seed-business.js [--apply]
const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const APPLY = process.argv.includes('--apply');

// Same opaque public id as application references.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function pid(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

const BUSINESS = {
  pid: pid(),
  tradingName: 'Loan It Financing',
  legalName: 'Loan It Limited',
  trn: '',                       // not known; TAJ publishes no lender register
  regulator: 'Bank of Jamaica',
  regulatoryAct: 'Microcredit Act, 2021',
  licenceNumber: 'MCA-016-2025', // as printed on the loan agreement
  licenceVerified: false,        // not found on BOJ's public register
  addressLine1: 'Lot 537, 2 East 56 Place',
  town: 'Greater Portmore',
  parish: 'St. Catherine',
  country: 'Jamaica',
  phone: '876-456-2833',
  email: 'loanit1876@gmail.com',
  status: 'active'
};

// Every collection whose records belong to a lending business.
const SCOPED = ['applications', 'loans', 'payments', 'promotions',
  'contracts', 'standingOrders', 'salaryDeductions', 'users'];

(async () => {
  const existing = await db.collection('businesses').where('tradingName', '==', BUSINESS.tradingName).limit(1).get();
  let businessId = existing.empty ? null : existing.docs[0].id;

  if (businessId) {
    console.log(`business already exists: ${businessId} (${BUSINESS.tradingName})`);
  } else if (!APPLY) {
    console.log(`would create business "${BUSINESS.tradingName}" (pid ${BUSINESS.pid})`);
    businessId = '<new business id>';
  } else {
    const ref = await db.collection('businesses').add({ ...BUSINESS, createdAt: FieldValue.serverTimestamp() });
    businessId = ref.id;
    console.log(`created business ${businessId} (pid ${BUSINESS.pid})`);
  }

  let total = 0;
  for (const collection of SCOPED) {
    const snap = await db.collection(collection).get();
    const missing = snap.docs.filter(d => !d.data().businessId);
    console.log(`  ${collection.padEnd(18)} ${snap.size} record(s), ${missing.length} without a business`);
    if (!missing.length) continue;
    total += missing.length;
    if (!APPLY) continue;
    // Batched in case a collection grows; 500 is the Firestore limit.
    for (let i = 0; i < missing.length; i += 400) {
      const batch = db.batch();
      missing.slice(i, i + 400).forEach(d => batch.update(d.ref, { businessId }));
      await batch.commit();
    }
  }

  console.log(APPLY
    ? `\n${total} record(s) placed under ${businessId}.`
    : `\n${total} record(s) would be placed under the business. Re-run with --apply.`);
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
