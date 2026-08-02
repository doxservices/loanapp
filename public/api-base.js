// The Loan It Financing backend (Cloud Functions + Firestore) lives on a
// different origin than this page (doxservices.com). All fetch() calls to
// /api/*, /standing-orders, etc. must be absolute against this base.
window.LOANIT_API_BASE = 'https://doxservices-loanapp.web.app';
