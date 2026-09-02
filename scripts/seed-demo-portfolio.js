// Rebuilds the demo dataset: one loan application per promotion, each with a
// matching loan and a few payments, so the admin tables show realistic rows
// with the promotion filled in. Applicants use @example.com addresses and
// every record carries isDummy: true.
//
// Run with: GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json node scripts/seed-demo-portfolio.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

// One applicant per promotion, keyed by promotion name.
const APPLICANTS = {
  'Starter 30': {
    firstName: 'Andre', lastName: 'Palmer', term: 6, status: 'Approved',
    phone: '(876) 351-2204', trn: '114-238-905', addressLine1: '12 Hope Road', addressLine2: 'Kingston 6',
    parish: 'Kingston', createdAt: '2026-08-04', paid: 2
  },
  // This applicant carries the demo profile identity used by
  // user-profile / my-active-loans / loan-statement / make-a-payment.
  'Premium Promotion': {
    firstName: 'Alexandra', lastName: 'Johnson', email: 'alex.j@example.com', term: 12, status: 'Approved',
    phone: '(876) 442-7719', trn: '227-905-114', addressLine1: '8 Barbican Close', addressLine2: '',
    parish: 'Saint Andrew', createdAt: '2026-08-07', paid: 3
  },
  'Back to School 2025': {
    firstName: 'Kemar', lastName: 'Douglas', term: 3, status: 'Completed',
    phone: '(876) 618-3340', trn: '338-114-227', addressLine1: '45 Manchester Avenue', addressLine2: '',
    parish: 'Manchester', createdAt: '2026-07-19', paid: 3
  },
  'Payday Loan': {
    firstName: 'Tanya', lastName: 'Ellis', term: 1, status: 'Pending',
    phone: '(876) 274-8862', trn: '441-227-338', addressLine1: '3 Ocean View Drive', addressLine2: 'Apt 2B',
    parish: 'Saint James', createdAt: '2026-08-24', paid: 0
  },
  'Home Improvement Loan': {
    firstName: 'Devon', lastName: 'Clarke', term: 18, status: 'Submitted',
    phone: '(876) 509-1176', trn: '552-338-441', addressLine1: '77 Independence Drive', addressLine2: '',
    parish: 'Saint Catherine', createdAt: '2026-08-28', paid: 0
  },
  '6M Starter Loan': {
    firstName: 'Nicola', lastName: 'Reid', term: 6, status: 'Rejected',
    phone: '(876) 833-2095', trn: '663-441-552', addressLine1: '21 Cherry Lane', addressLine2: '',
    parish: 'Portland', createdAt: '2026-08-12', paid: 0
  },
  'Starter': {
    firstName: 'Omar', lastName: 'Grant', term: 12, status: 'Approved',
    phone: '(876) 190-4438', trn: '774-552-663', addressLine1: '5 Constant Spring Road', addressLine2: 'Unit 9',
    parish: 'Saint Andrew', createdAt: '2026-08-18', paid: 1
  }
};

const email = a => a.email || `${a.firstName}.${a.lastName}`.toLowerCase() + '@example.com';
const addMonths = (iso, n) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + n);
  return d;
};

(async () => {
  const promos = await db.collection('promotions').orderBy('createdAt', 'asc').get();
  if (promos.empty) { console.error('No promotions to build from.'); process.exit(1); }

  let seq = 0;
  for (const promoDoc of promos.docs) {
    const promo = promoDoc.data();
    const a = APPLICANTS[promo.name];
    if (!a) { console.log('no applicant mapped for promotion', promo.name, '- skipped'); continue; }

    seq++;
    const applicationCode = 'APP-2026-' + String(1000 + seq);
    const promoSnapshot = {
      name: promo.name, currency: promo.currency, principal: promo.principal,
      monthlyInterestPct: promo.monthlyInterestPct, termMode: promo.termMode,
      fixedTermMonths: promo.fixedTermMonths ?? null, allowedTerms: promo.allowedTerms || []
    };

    const appRef = await db.collection('applications').add({
      applicationCode,
      promotionId: promoDoc.id,
      selectedTermMonths: a.term,
      promoSnapshot,
      applicant: {
        firstName: a.firstName, lastName: a.lastName, email: email(a), phone: a.phone, trn: a.trn,
        addressLine1: a.addressLine1, addressLine2: a.addressLine2, parish: a.parish
      },
      status: a.status, reason: '', reviewFlags: {}, attachments: {}, messages: [],
      isDummy: true,
      createdAt: Timestamp.fromDate(new Date(a.createdAt))
    });

    const total = promo.principal + promo.principal * (promo.monthlyInterestPct / 100) * a.term;
    const monthly = Math.round((total / a.term) * 100) / 100;

    const loanRef = await db.collection('loans').add({
      applicationCode,
      applicationId: appRef.id,
      promotionId: promoDoc.id,
      userEmail: email(a), userName: `${a.firstName} ${a.lastName}`,
      loanType: promo.name,
      principal: promo.principal,
      termMonths: a.term,
      monthlyInterestPct: promo.monthlyInterestPct,
      status: a.status,
      isDummy: true,
      createdAt: Timestamp.fromDate(new Date(a.createdAt))
    });

    for (let i = 0; i < a.paid; i++) {
      await db.collection('payments').add({
        loanId: loanRef.id, applicationCode,
        userEmail: email(a), userName: `${a.firstName} ${a.lastName}`,
        amount: monthly,
        method: i % 2 ? 'card' : 'bank-transfer',
        reference: 'PAY-2026-' + String(20000 + seq * 10 + i),
        note: `Installment ${i + 1}`,
        isDummy: true,
        createdAt: Timestamp.fromDate(addMonths(a.createdAt, i + 1))
      });
    }

    console.log(`${applicationCode}  ${promo.name.padEnd(22)} ${(a.firstName + ' ' + a.lastName).padEnd(16)} ${a.status.padEnd(10)} ${a.term}mo  ${a.paid} payment(s)`);
  }
  console.log('done.');
})().catch(err => { console.error(err); process.exit(1); });
