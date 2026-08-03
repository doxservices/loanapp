// One-off seed: populates `applications` with the sample rows that were
// previously hardcoded in applications-list.html, and `payments` with a few
// records against Alexandra's dummy loans so Loan Statements / Make a Payment
// have real Firestore data behind them. Also backfills monthlyInterestPct on
// any loan docs that predate that field. Every record carries isDummy: true.
// Run with: GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json node scripts/seed-applications-payments.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

const applications = [
  { applicationCode: 'APP-00125', firstName: 'John', lastName: 'Smith', email: 'john.smith@example.com', phone: '(876) 123-4567', addressLine1: '123 Main Street', addressLine2: 'Kingston 10', parish: 'Kingston', termMonths: 12, amount: 150000, status: 'pending', createdAt: '2025-08-18T10:30:00Z' },
  { applicationCode: 'APP-00124', firstName: 'Sarah', lastName: 'Johnson', email: 'sarahj@example.com', phone: '(876) 234-5678', addressLine1: '45 Oak Avenue', addressLine2: '', parish: 'Saint Andrew', termMonths: 18, amount: 250000, status: 'approved', createdAt: '2025-08-17T14:22:00Z' },
  { applicationCode: 'APP-00123', firstName: 'Michael', lastName: 'Brown', email: 'm.brown@example.com', phone: '(876) 345-6789', addressLine1: '78 Pine Road', addressLine2: 'Apartment 5B', parish: 'Saint Catherine', termMonths: 6, amount: 100000, status: 'pending', createdAt: '2025-08-16T09:15:00Z' },
  { applicationCode: 'APP-00122', firstName: 'Emily', lastName: 'Davis', email: 'emilyd@example.com', phone: '(876) 456-7890', addressLine1: '22 Cherry Lane', addressLine2: '', parish: 'Portland', termMonths: 12, amount: 75000, status: 'rejected', createdAt: '2025-08-15T16:45:00Z' },
  { applicationCode: 'APP-00121', firstName: 'Robert', lastName: 'Wilson', email: 'rwilson@example.com', phone: '(876) 567-8901', addressLine1: '90 Maple Street', addressLine2: '', parish: 'Saint James', termMonths: 24, amount: 200000, status: 'approved', createdAt: '2025-08-14T11:20:00Z' }
];

// applicationCode -> payments made against that loan
const paymentsByLoan = {
  'APP-2025-1872': [
    { amount: 5750, method: 'bank-transfer', reference: 'PAY-2025-30411', note: 'September installment', createdAt: '2025-09-30' },
    { amount: 5750, method: 'card', reference: 'PAY-2025-31288', note: 'October installment', createdAt: '2025-10-31' },
    { amount: 5750, method: 'bank-transfer', reference: 'PAY-2025-32105', note: 'November installment', createdAt: '2025-11-30' }
  ],
  'APP-2025-1645': [
    { amount: 13541.67, method: 'bank-transfer', reference: 'PAY-2025-28950', note: 'Final settlement', createdAt: '2025-12-15' }
  ]
};

(async () => {
  const existingApps = await db.collection('applications').limit(1).get();
  if (existingApps.empty) {
    for (const a of applications) {
      const ref = await db.collection('applications').add({
        applicationCode: a.applicationCode,
        promotionId: null,
        selectedTermMonths: a.termMonths,
        promoSnapshot: { name: 'Seeded Application', currency: 'JMD', principal: a.amount, monthlyInterestPct: 10, termMode: 'selectable', fixedTermMonths: null, allowedTerms: [] },
        applicant: { firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phone, addressLine1: a.addressLine1, addressLine2: a.addressLine2, parish: a.parish },
        status: a.status, reason: '', reviewFlags: {}, attachments: {}, messages: [],
        isDummy: true,
        createdAt: Timestamp.fromDate(new Date(a.createdAt))
      });
      console.log('seeded application', ref.id, a.applicationCode);
    }
  } else {
    console.log('applications collection is not empty — skipping (delete it first to reseed).');
  }

  // Backfill interest rate on loans that don't have one yet.
  const loansSnap = await db.collection('loans').get();
  for (const doc of loansSnap.docs) {
    if (doc.data().monthlyInterestPct === undefined) {
      await doc.ref.update({ monthlyInterestPct: 10 });
      console.log('backfilled monthlyInterestPct on loan', doc.id, doc.data().applicationCode);
    }
  }

  const existingPayments = await db.collection('payments').limit(1).get();
  if (existingPayments.empty) {
    for (const [code, payments] of Object.entries(paymentsByLoan)) {
      const loanSnap = await db.collection('loans').where('applicationCode', '==', code).limit(1).get();
      if (loanSnap.empty) { console.log('no loan found for', code, '— skipping its payments'); continue; }
      const loan = loanSnap.docs[0];
      const l = loan.data();
      for (const p of payments) {
        const ref = await db.collection('payments').add({
          loanId: loan.id, applicationCode: code, userEmail: l.userEmail, userName: l.userName,
          amount: p.amount, method: p.method, reference: p.reference, note: p.note,
          isDummy: true, createdAt: Timestamp.fromDate(new Date(p.createdAt))
        });
        console.log('seeded payment', ref.id, p.reference, 'for', code);
      }
    }
  } else {
    console.log('payments collection is not empty — skipping (delete it first to reseed).');
  }

  console.log('done.');
})().catch(err => { console.error(err); process.exit(1); });
