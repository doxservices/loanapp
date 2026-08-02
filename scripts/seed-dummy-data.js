// One-off seed: populates `users` and `loans` collections with dummy data,
// each record tagged isDummy: true. Reuses the exact records that were
// previously hardcoded in user-management.html and user-profile.html, so
// wiring those pages up to the real API doesn't change what's on screen —
// it just makes the data real (and clearly marked as a placeholder) instead
// of baked into the JS.
// Run with: GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json node scripts/seed-dummy-data.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

const users = [
  { firstName: 'Alexandra', lastName: 'Johnson', email: 'alex.j@example.com', phone: '(876) 555-1234', role: 'Applicant', status: 'active', lastLogin: 'Today, 07:50 AM', createdAt: '2024-08-01', addressLine1: '42 Hope Road', addressLine2: 'Kingston 10', parish: 'kingston' },
  { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', phone: '', role: 'Administrator', status: 'active', lastLogin: 'Today, 09:42 AM', createdAt: '2023-01-15', addressLine1: '8 Constant Spring Road', addressLine2: '', parish: 'st-andrew' },
  { firstName: 'Michael', lastName: 'Smith', email: 'michael.s@company.com', phone: '', role: 'Loan Officer', status: 'active', lastLogin: 'Today, 08:15 AM', createdAt: '2024-03-22', addressLine1: '15 Manchester Avenue', addressLine2: '', parish: 'manchester' },
  { firstName: 'Robert', lastName: 'Johnson', email: 'robert.j@finance.com', phone: '', role: 'Underwriter', status: 'active', lastLogin: 'Yesterday, 04:30 PM', createdAt: '2024-02-10', addressLine1: '3 Independence Drive', addressLine2: '', parish: 'st-catherine' },
  { firstName: 'Emma', lastName: 'Wilson', email: 'emma.w@business.com', phone: '', role: 'Loan Officer', status: 'inactive', lastLogin: '3 days ago', createdAt: '2023-05-05', addressLine1: '21 Ocean View', addressLine2: '', parish: 'st-james' },
  { firstName: 'David', lastName: 'Brown', email: 'david.b@enterprise.com', phone: '', role: 'Administrator', status: 'active', lastLogin: 'Today, 10:20 AM', createdAt: '2023-11-30', addressLine1: '9 Ridgemount Road', addressLine2: '', parish: 'st-andrew' },
  { firstName: 'Sarah', lastName: 'Green', email: 'sarah.g@loans.com', phone: '', role: 'Customer Support', status: 'pending', lastLogin: 'Never', createdAt: '2026-08-02', addressLine1: '54 Main Street', addressLine2: '', parish: 'clarendon' },
  { firstName: 'Thomas', lastName: 'Parker', email: 'thomas.p@financial.com', phone: '', role: 'Underwriter', status: 'active', lastLogin: 'Yesterday, 06:45 PM', createdAt: '2024-01-18', addressLine1: '6 Palm Avenue', addressLine2: '', parish: 'westmoreland' }
];

const loans = [
  { applicationCode: 'APP-2025-1872', userEmail: 'alex.j@example.com', userName: 'Alexandra Johnson', loanType: 'Homeowner Advantage', principal: 45000, termMonths: 36, status: 'Approved', createdAt: '2025-08-15' },
  { applicationCode: 'APP-2025-1645', userEmail: 'alex.j@example.com', userName: 'Alexandra Johnson', loanType: 'Business Growth', principal: 25000, termMonths: 24, status: 'Completed', createdAt: '2025-07-28' },
  { applicationCode: 'APP-2025-1423', userEmail: 'alex.j@example.com', userName: 'Alexandra Johnson', loanType: 'Medical Assistance', principal: 12500, termMonths: 18, status: 'Pending', createdAt: '2025-06-10' },
  { applicationCode: 'APP-2024-9871', userEmail: 'alex.j@example.com', userName: 'Alexandra Johnson', loanType: 'Education Support', principal: 8000, termMonths: 24, status: 'Completed', createdAt: '2024-12-03' }
];

(async () => {
  const existingUsers = await db.collection('users').limit(1).get();
  if (existingUsers.empty) {
    for (const u of users) {
      const ref = await db.collection('users').add({ ...u, createdAt: Timestamp.fromDate(new Date(u.createdAt)), isDummy: true });
      console.log('seeded user', ref.id, u.firstName, u.lastName);
    }
  } else {
    console.log('users collection is not empty — skipping (delete it first to reseed).');
  }

  const existingLoans = await db.collection('loans').limit(1).get();
  if (existingLoans.empty) {
    for (const l of loans) {
      const ref = await db.collection('loans').add({ ...l, createdAt: Timestamp.fromDate(new Date(l.createdAt)), isDummy: true });
      console.log('seeded loan', ref.id, l.applicationCode);
    }
  } else {
    console.log('loans collection is not empty — skipping (delete it first to reseed).');
  }

  console.log('done.');
})().catch(err => { console.error(err); process.exit(1); });
