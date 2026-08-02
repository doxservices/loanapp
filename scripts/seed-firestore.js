// One-off seed: populates the `promotions` collection in Firestore with the
// promotion set that was previously in variants/loanit/storage/data/promotions.json.
// Run with: GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json node scripts/seed-firestore.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

const promotions = [
  { name: 'Starter 30', description: 'Basic loan promotion', currency: 'JMD', principal: 30000, monthlyInterestPct: 10, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [3, 6, 12] },
  { name: 'Premium Promotion', description: 'Higher value loan at lower rate', currency: 'JMD', principal: 250000, monthlyInterestPct: 8, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [6, 12, 18] },
  { name: 'Back to School 2025', description: 'Special promotion for back-to-school expenses', currency: 'JMD', principal: 50000, monthlyInterestPct: 12, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [3] },
  { name: 'Payday Loan', description: 'Short-term payday loan', currency: 'JMD', principal: 100000, monthlyInterestPct: 20, termMode: 'fixed', fixedTermMonths: 1, allowedTerms: [] },
  { name: 'Home Improvement Loan', description: 'Finance your home improvements', currency: 'JMD', principal: 150000, monthlyInterestPct: 9, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [6, 12, 18] },
  { name: '6M Starter Loan', description: 'Basic loan promotion', currency: 'JMD', principal: 30000, monthlyInterestPct: 10, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [6, 12] },
  { name: 'Starter', description: 'Basic loan promotion', currency: 'JMD', principal: 30000, monthlyInterestPct: 10, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [1, 3, 6, 12] }
];

(async () => {
  const existing = await db.collection('promotions').limit(1).get();
  if (!existing.empty) {
    console.log('promotions collection is not empty — skipping seed (delete the collection first if you want to reseed).');
    process.exit(0);
  }
  for (const p of promotions) {
    const ref = await db.collection('promotions').add({ ...p, createdAt: FieldValue.serverTimestamp() });
    console.log('seeded promotion', ref.id, p.name);
  }
  console.log('done.');
})().catch(err => { console.error(err); process.exit(1); });
