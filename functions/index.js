const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const express = require('express');
const crypto = require('crypto');

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();
const db = getFirestore();
const firebaseAuth = getAuth();
const bucket = getStorage().bucket(process.env.STORAGE_BUCKET || 'doxservices-loanapp-uploads');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false }));

// =========================================================================
// CORS — the frontend now lives on a different origin (doxservices.com),
// so every request is cross-origin. No cookies are used (see auth below),
// so this is plain CORS, not credentialed CORS.
// =========================================================================
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  'https://www.doxservices.com,https://doxservices.com,https://doxservices-loanapp.web.app,http://localhost:5000,http://127.0.0.1:5000'
).split(',').map(s => s.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// =========================================================================
// Google Sign-In — Bearer token, verified fresh on every request.
// Two roles, each allow-listed by email address:
//   system   — the doxservices account: every admin surface, read and write.
//   business — the lender's own account: read-only, and only the three form
//              collections (contracts, standing orders, salary deductions).
// =========================================================================
const SYSTEM_ADMIN_EMAIL = (process.env.ALLOWED_ADMIN_EMAIL || '').toLowerCase();
const BUSINESS_ADMIN_EMAILS = new Set(
  (process.env.BUSINESS_ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
);

// Who this email is. The users collection is the register; the two
// environment variables stay only as a bootstrap, so an empty or broken users
// table can never lock everyone out of the admin.
async function identify(email) {
  if (!email) return null;
  if (SYSTEM_ADMIN_EMAIL && email === SYSTEM_ADMIN_EMAIL) {
    return { role: 'superAdmin', businessId: null, userId: null, profileComplete: true };
  }

  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    const u = snap.docs[0].data();
    // 'pending' is someone who has not set their profile up yet, so they still
    // sign in — the profile step is what greets them. Only a deliberately
    // closed account is refused.
    if (u.status === 'inactive' || u.status === 'suspended') return null;
    if (u.role) {
      return {
        role: u.role,
        businessId: u.businessId || null,
        userId: snap.docs[0].id,
        profileComplete: !!u.profileCompletedAt
      };
    }
  }

  if (BUSINESS_ADMIN_EMAILS.has(email)) {
    return { role: 'businessAdmin', businessId: null, userId: null, profileComplete: false };
  }
  return null;
}

// Signing in is the only reliable record of when someone was last here.
// Written at most every ten minutes, so a page load does not cost a write.
async function touchLastLogin(userId) {
  if (!userId) return;
  try {
    const ref = db.collection('users').doc(userId);
    const doc = await ref.get();
    const last = doc.exists && doc.data().lastLoginAt;
    const ms = last && last.toMillis ? last.toMillis() : 0;
    if (Date.now() - ms < 10 * 60 * 1000) return;
    await ref.update({ lastLoginAt: FieldValue.serverTimestamp() });
  } catch (e) { console.error('[auth] lastLoginAt update failed:', e.message); }
}

// Every guarded route names the roles it accepts, so a route added later
// without a thought for the business account denies it by default.
function requireRole(...roles) {
  return async function (req, res, next) {
    const hdr = req.get('authorization') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });
    try {
      const decoded = await firebaseAuth.verifyIdToken(token);
      const email = (decoded.email || '').toLowerCase();
      const who = decoded.email_verified ? await identify(email) : null;
      if (!who) {
        return res.status(403).json({ ok: false, error: 'This Google account is not authorized for admin access.' });
      }
      if (!roles.includes(who.role)) {
        return res.status(403).json({ ok: false, error: 'This account is not allowed to use this feature.' });
      }
      req.adminEmail = email;
      req.adminRole = who.role;
      req.adminBusinessId = who.businessId;
      req.adminUserId = who.userId;
      req.adminProfileComplete = who.profileComplete;
      next();
    } catch (e) {
      console.error('[auth] verifyIdToken failed:', e.message);
      res.status(401).json({ ok: false, error: 'Invalid or expired sign-in token.' });
    }
  };
}

// What each role may do, by permission id. This is the single place the
// answer lives: the API enforces with it, and the UI is drawn from the same
// list, so a button can never offer something the server will refuse.
const PERMISSIONS = {
  superAdmin: ['dashboard.view', 'applications.view', 'promotions.manage', 'users.manage',
    'businesses.browse', 'settings.view', 'forms.view', 'records.edit', 'contracts.create',
    'tickets.view', 'tickets.manage'],
  businessAdmin: ['forms.view', 'contracts.create', 'tickets.view', 'tickets.manage'],
  support: ['forms.view', 'tickets.view', 'tickets.manage'],
  underwriter: ['applications.view', 'forms.view', 'tickets.view'],
  applicant: ['tickets.own']
};
const permissionsFor = role => PERMISSIONS[role] || [];

// These mirror the table above: every staff role holds forms.view, while
// applications.view belongs to the super admin and the underwriter. Keeping
// them in step is what stops the UI offering something the API refuses.
const requireGoogleAuth = requireRole('superAdmin');
const requireAdminRead = requireRole('superAdmin', 'businessAdmin', 'support', 'underwriter');
const requireApplicationsRead = requireRole('superAdmin', 'underwriter');

// Lets the client confirm which account it is signed in as, and what that
// account is allowed to do, before rendering admin UI.
app.get('/auth/verify', requireAdminRead, (req, res) => {
  touchLastLogin(req.adminUserId);
  res.json({
    ok: true,
    email: req.adminEmail,
    role: req.adminRole,
    permissions: permissionsFor(req.adminRole),
    businessId: req.adminBusinessId,
    profileComplete: req.adminProfileComplete
  });
});

// ---- Businesses: the directory the super admin browses, and the one
// business everybody else belongs to. ----
function businessToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, pid: d.pid || null,
    tradingName: d.tradingName || '', legalName: d.legalName || '', trn: d.trn || '',
    regulator: d.regulator || '', regulatoryAct: d.regulatoryAct || '',
    licenceNumber: d.licenceNumber || '', licenceVerified: d.licenceVerified === true,
    addressLine1: d.addressLine1 || '', town: d.town || '', parish: d.parish || '',
    country: d.country || '', phone: d.phone || '', email: d.email || '',
    status: d.status || 'active',
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null
  };
}

app.get('/api/businesses', requireRole('superAdmin'), async (req, res) => {
  const snap = await db.collection('businesses').orderBy('tradingName').get();
  res.json({ ok: true, businesses: snap.docs.map(businessToApi) });
});

app.get('/api/businesses/mine', requireAdminRead, async (req, res) => {
  if (!req.adminBusinessId) return res.json({ ok: true, business: null });
  const doc = await db.collection('businesses').doc(req.adminBusinessId).get();
  res.json({ ok: true, business: doc.exists ? businessToApi(doc) : null });
});

// =========================================================================
// Form submissions (standingOrders / salaryDeductions / contracts).
//
// A form session autosaves to one draft document — the page sends a draftId
// that is used as its id — so repeated autosaves update it rather than piling
// up. Every print is written as its own record and replaces its session's
// draft, so no print is ever overwritten. Across sessions, a record that
// repeats another's information is collapsed: printed records always stay,
// only the latest of identical autosaves does.
// =========================================================================
// A Jamaican TRN is exactly 9 digits. Records that fail this are rejected so
// invalid submissions never reach the collections. The standing order form
// historically had no TRN field, so a blank TRN is still accepted there for
// the older client still deployed on doxservices.com — anything actually
// entered must be valid.
function trnProblem(trn, required) {
  const digits = String(trn == null ? '' : trn).replace(/\D/g, '');
  if (!digits.length) return required ? 'TRN is required and must be exactly 9 digits' : null;
  return digits.length === 9 ? null : 'TRN must be exactly 9 digits';
}

// Fields that say when, or in which session, a record was saved rather than
// what it says. Two records hold "the same information" when everything else
// matches. contractToken has to be here: it is a random key unique to every
// record, and while it counted as content no two records could ever match.
// scripts/dedupe-form-records.js carries a copy of this rule — keep them equal.
const META_KEYS = new Set(['autosaved', 'submittedAt', 'updatedAt', 'printedAt', 'draftId', 'editedByAdmin', 'contractToken']);

function contentSignature(rec) {
  return JSON.stringify(
    Object.keys(rec)
      .filter(k => !META_KEYS.has(k))
      // An absent field and an empty one say the same thing, so a form that
      // gains a field still matches the records saved before it existed.
      .filter(k => rec[k] != null && String(rec[k]) !== '')
      .sort()
      .map(k => [k, String(rec[k])])
  );
}

// Keeps one copy of any given information without ever touching a printed
// record. A printed record supersedes every autosave that says the same thing,
// and among autosaves that say the same thing only the latest stays. `rec` is
// the record just written, as stored, under `savedId`.
async function dropDuplicateAutosaves(collection, savedId, rec) {
  const target = contentSignature(rec);
  const query = rec.trn ? db.collection(collection).where('trn', '==', rec.trn) : db.collection(collection);
  const snap = await query.get();
  const same = snap.docs.filter(d => d.id !== savedId && contentSignature(d.data()) === target);

  // Other matching autosaves go whichever kind was just written: an autosave
  // is newer than all of them, and a print supersedes them.
  const doomed = same.filter(d => d.data().autosaved === true).map(d => d.ref);
  // An autosave that repeats a printed record adds nothing, so it goes too.
  if (rec.autosaved === true && same.some(d => d.data().autosaved !== true)) {
    doomed.push(db.collection(collection).doc(savedId));
  }
  if (!doomed.length) return 0;

  const batch = db.batch();
  doomed.forEach(ref => batch.delete(ref));
  await batch.commit();
  return doomed.length;
}

// Where a session's autosave lives: the session id itself, unless the older
// save flow left a printed record there, which an autosave must not overwrite.
async function sessionDraft(col, draftId) {
  const ref = col.doc(draftId);
  const snap = await ref.get();
  if (snap.exists && snap.data().autosaved !== true) {
    const alt = col.doc(draftId + '-draft');
    return { ref: alt, snap: await alt.get() };
  }
  return { ref, snap };
}

// Fields only the server sets. Taking them from the request would let a
// caller pick a record's contract token or pass a draft off as printed.
const SERVER_KEYS = ['autosaved', 'draftId', 'printedAt', 'submittedAt', 'updatedAt', 'contractToken', 'editedByAdmin'];

// opts.trnRequired  — reject a blank TRN (the standing order's older client
//                     still deployed on doxservices.com has no TRN field).
// opts.seedsContract — mint a contract token, for records a contract can be
//                     prefilled from. A saved contract is the end product and
//                     seeds nothing, so it gets no token.
function formRoutes(path, collection, logLabel, opts) {
  const { trnRequired = true, seedsContract = false } = opts || {};

  app.post(path, async (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      const bad = trnProblem(body.trn, trnRequired);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      const draftId = typeof body.draftId === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(body.draftId)
        ? body.draftId : null;
      const printed = body.autosaved !== true;
      SERVER_KEYS.forEach(k => delete body[k]);

      const col = db.collection(collection);
      const now = FieldValue.serverTimestamp();
      let ref;

      if (printed) {
        // Every print is its own record. Prints used to be merged into the
        // session's autosave document, which left them tagged autosaved and let
        // a later autosave, or a second print, overwrite them.
        ref = col.doc();
        const draft = draftId ? await sessionDraft(col, draftId) : null;
        const openDraft = draft && draft.snap.exists && draft.snap.data().autosaved === true ? draft : null;
        const rec = { ...body, autosaved: false, printedAt: now, submittedAt: now, updatedAt: now };
        if (draftId) rec.draftId = draftId;
        if (seedsContract) {
          // Take over the session draft's token as that draft is replaced, so a
          // contract link already copied from it keeps working.
          rec.contractToken = (openDraft && openDraft.snap.data().contractToken) || newContractToken();
        }
        const batch = db.batch();
        batch.set(ref, rec);
        // The print is the finished state of its own session, so that session's
        // draft goes even if a money field was reformatted on the way to the
        // printer and the two no longer match exactly.
        if (openDraft) batch.delete(openDraft.ref);
        await batch.commit();
      } else {
        const draft = draftId ? await sessionDraft(col, draftId) : { ref: col.doc(), snap: null };
        ref = draft.ref;
        const exists = !!(draft.snap && draft.snap.exists);
        const rec = { ...body, autosaved: true, updatedAt: now };
        if (draftId) rec.draftId = draftId;
        if (!exists) rec.submittedAt = now;
        // Issued once, on the first write of a session, so a link already
        // handed out keeps working while the form goes on autosaving.
        if (seedsContract && (!exists || !draft.snap.data().contractToken)) {
          rec.contractToken = newContractToken();
        }
        await ref.set(rec, { merge: true });
      }

      let removed = 0;
      let savedData = null;
      try {
        const saved = await ref.get();
        if (saved.exists) {
          savedData = saved.data();
          removed = await dropDuplicateAutosaves(collection, ref.id, savedData);
        }
      } catch (e) {
        console.error('[' + logLabel + '] duplicate cleanup failed:', e.message);
      }
      // The form opens the loan contract from its own saved record, so it gets
      // that record's token back — the token of what this caller just wrote.
      res.json({
        ok: true, id: ref.id, printed, removed,
        ...(seedsContract && savedData && savedData.contractToken
          ? { contractToken: savedData.contractToken } : {})
      });
    } catch (e) {
      console.error('[' + logLabel + '] write error:', e.message);
      res.status(500).json({ ok: false, error: 'Failed to save record' });
    }
  });

  app.get(path, requireAdminRead, async (req, res) => {
    try {
      const snap = await db.collection(collection).orderBy('submittedAt', 'desc').get();
      res.json({ ok: true, rows: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
      console.error('[' + logLabel + '] read error:', e.message);
      res.status(500).json({ ok: false, error: 'Query failed' });
    }
  });

  // Single record + admin edit — used by the form pages' edit mode. These
  // records carry applicant personal details, so reading one needs an admin
  // sign-in of either role; changing one is the system account only.
  app.get(path + '/:id', requireAdminRead, async (req, res) => {
    try {
      const doc = await db.collection(collection).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ ok: false, error: 'Record not found' });
      res.json({ ok: true, record: { id: doc.id, ...doc.data() } });
    } catch (e) {
      console.error('[' + logLabel + '] read-one error:', e.message);
      res.status(500).json({ ok: false, error: 'Query failed' });
    }
  });

  app.put(path + '/:id', requireGoogleAuth, async (req, res) => {
    try {
      const ref = db.collection(collection).doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ ok: false, error: 'Record not found' });
      const body = { ...(req.body || {}) };
      const bad = trnProblem(body.trn, trnRequired);
      if (bad) return res.status(400).json({ ok: false, error: bad });
      delete body.submittedAt;
      delete body.draftId;
      await ref.set({ ...body, editedByAdmin: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const saved = await ref.get();
      res.json({ ok: true, record: { id: saved.id, ...saved.data() } });
    } catch (e) {
      console.error('[' + logLabel + '] update error:', e.message);
      res.status(500).json({ ok: false, error: 'Failed to update record' });
    }
  });
}

formRoutes('/standing-orders', 'standingOrders', 'standing-orders', { trnRequired: false, seedsContract: true });
formRoutes('/salary-deductions', 'salaryDeductions', 'salary-deductions', { trnRequired: true, seedsContract: true });
formRoutes('/contracts', 'contracts', 'contracts', { trnRequired: true, seedsContract: false });

// =========================================================================
// Legacy flat applications listing (Firestore: applications) — feeds
// admin.html + admin-applications.html unchanged
// =========================================================================
// promoNames maps promotion id -> name, so rows carry the promotion's name
// rather than its document id, which means nothing to a reader. The snapshot
// taken when the application was submitted wins, since it is what the
// applicant actually agreed to.
function toFlatRow(doc, promoNames) {
  const d = doc.data();
  const a = d.applicant || {};
  const snap = d.promoSnapshot || {};

  // Money is what these tables are actually scanned for, so the row carries
  // the amount and the resulting instalment rather than making each page
  // recompute it. Flat add-on interest, matching the promotion model used
  // across the app.
  const principal = Number(snap.principal) || null;
  const rate = Number(snap.monthlyInterestPct) || 0;
  const term = Number(d.selectedTermMonths) || 0;
  const total = principal && term ? principal + principal * (rate / 100) * term : null;

  return {
    application_id: d.applicationCode || doc.id,
    // Admin-only table (this route is behind requireGoogleAuth); it is what
    // builds the contract link for a row.
    contract_token: d.contractToken || null,
    first_name: a.firstName || '', last_name: a.lastName || '', email: a.email || '',
    phone_full: a.phone || '', address1: a.addressLine1 || '', address2: a.addressLine2 || '',
    parish: a.parish || '', term_months: d.selectedTermMonths ?? null,
    promotion: snap.name || (promoNames && promoNames.get(d.promotionId)) || '',
    promotion_id: d.promotionId ?? null,
    currency: snap.currency || 'JMD',
    loan_amount: principal,
    monthly_interest_pct: snap.monthlyInterestPct ?? null,
    monthly_payment: total ? Math.round((total / term) * 100) / 100 : null,
    total_repayable: total ? Math.round(total * 100) / 100 : null,
    status: d.status || 'Submitted',
    created_at: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/applications', requireApplicationsRead, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  try {
    const [snap, promos] = await Promise.all([
      db.collection('applications').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('promotions').get()
    ]);
    const promoNames = new Map(promos.docs.map(p => [p.id, p.data().name]));
    res.json({ ok: true, rows: snap.docs.map(doc => toFlatRow(doc, promoNames)) });
  } catch (e) {
    console.error('[applications] read error:', e.message);
    res.status(500).json({ ok: false, error: 'Query failed' });
  }
});

app.get('/health', async (req, res) => {
  try {
    await db.collection('_health').limit(1).get();
    res.json({ ok: true, db: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =========================================================================
// Full loan-application API (public-facing pages: user-apply, user-profile,
// applicant-edit, status, admin-promotions, admin-dashboard)
// =========================================================================
const PARISHES = ['Hanover', 'Saint Elizabeth', 'Saint James', 'Trelawny', 'Westmoreland',
  'Clarendon', 'Manchester', 'Saint Ann', 'Saint Catherine', 'Saint Mary',
  'Kingston', 'Portland', 'Saint Andrew', 'Saint Thomas'];

app.get('/api/parishes', (req, res) => res.json(PARISHES));

// =========================================================================
// Users & Loans — currently seeded with dummy/placeholder data only
// (see scripts/seed-dummy-data.js). Every record carries isDummy: true so
// it's identifiable if/when real user & loan data starts flowing in.
// =========================================================================
function userToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, firstName: d.firstName, lastName: d.lastName, email: d.email,
    phone: d.phone || '', role: d.role || 'applicant', status: d.status || 'active',
    lastLogin: d.lastLogin || null,
    addressLine1: d.addressLine1 || '', addressLine2: d.addressLine2 || '', parish: d.parish || '',
    isDummy: !!d.isDummy,
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/api/users', async (req, res) => {
  const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
  res.json(snap.docs.map(userToApi));
});
app.post('/api/users', requireGoogleAuth, async (req, res) => {
  const u = req.body || {};
  if (!u.firstName || !u.lastName || !u.email) return res.status(400).json({ error: 'firstName, lastName and email are required' });
  const ref = await db.collection('users').add({
    firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone || '',
    role: u.role || 'Applicant', status: u.status || 'pending', lastLogin: 'Never',
    addressLine1: u.addressLine1 || '', addressLine2: u.addressLine2 || '', parish: u.parish || '',
    isDummy: !!u.isDummy, createdAt: FieldValue.serverTimestamp()
  });
  res.status(201).json(userToApi(await ref.get()));
});
app.put('/api/users/:id', requireGoogleAuth, async (req, res) => {
  const u = req.body || {};
  const ref = db.collection('users').doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'User not found' });
  const patch = {};
  for (const k of ['firstName', 'lastName', 'email', 'phone', 'role', 'status', 'addressLine1', 'addressLine2', 'parish']) {
    if (u[k] !== undefined) patch[k] = u[k];
  }
  await ref.update(patch);
  res.json(userToApi(await ref.get()));
});
app.delete('/api/users/:id', requireGoogleAuth, async (req, res) => {
  await db.collection('users').doc(req.params.id).delete();
  res.json({ ok: true });
});
// Self-service profile save from the applicant-facing pages (no admin login
// there) — restricted to a whitelist of profile fields, keyed by email.
app.patch('/api/users/by-email/:email', async (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'No user with that email' });
  const u = req.body || {};
  const patch = {};
  for (const k of ['firstName', 'lastName', 'phone', 'addressLine1', 'addressLine2', 'parish', 'trn', 'emailNotifications',
    'workAddress', 'residentialAddress', 'bankAccounts', 'dob']) {
    if (u[k] !== undefined) patch[k] = u[k];
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No updatable fields provided' });
  await snap.docs[0].ref.update(patch);
  res.json(userToApi(await snap.docs[0].ref.get()));
});

function loanToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, applicationCode: d.applicationCode || null, userEmail: d.userEmail, userName: d.userName,
    loanType: d.loanType, principal: d.principal, termMonths: d.termMonths, status: d.status,
    monthlyInterestPct: d.monthlyInterestPct ?? null,
    isDummy: !!d.isDummy,
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/api/loans', async (req, res) => {
  const { email } = req.query;
  let query = db.collection('loans');
  query = email ? query.where('userEmail', '==', email).orderBy('createdAt', 'desc') : query.orderBy('createdAt', 'desc');
  const snap = await query.get();
  res.json(snap.docs.map(loanToApi));
});
app.get('/api/loans/:id', async (req, res) => {
  const doc = await db.collection('loans').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Loan not found' });
  res.json(loanToApi(doc));
});

// =========================================================================
// Payments — written by the Make a Payment page, read by Loan Statements
// =========================================================================
function paymentToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, loanId: d.loanId, applicationCode: d.applicationCode || null,
    userEmail: d.userEmail || '', userName: d.userName || '',
    amount: d.amount, method: d.method || 'bank-transfer', reference: d.reference || '', note: d.note || '',
    isDummy: !!d.isDummy,
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/api/payments', async (req, res) => {
  const { loanId, email } = req.query;
  let query = db.collection('payments');
  if (loanId) query = query.where('loanId', '==', loanId).orderBy('createdAt', 'desc');
  else if (email) query = query.where('userEmail', '==', email).orderBy('createdAt', 'desc');
  else query = query.orderBy('createdAt', 'desc');
  const snap = await query.get();
  res.json(snap.docs.map(paymentToApi));
});
app.post('/api/payments', async (req, res) => {
  const p = req.body || {};
  const amount = Number(p.amount);
  if (!p.loanId || !amount || amount <= 0) return res.status(400).json({ error: 'loanId and a positive amount are required' });
  const loanDoc = await db.collection('loans').doc(String(p.loanId)).get();
  if (!loanDoc.exists) return res.status(400).json({ error: 'Unknown loan' });
  const loan = loanDoc.data();
  const reference = `PAY-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  const ref = await db.collection('payments').add({
    loanId: loanDoc.id, applicationCode: loan.applicationCode || null,
    userEmail: loan.userEmail || '', userName: loan.userName || '',
    amount, method: p.method || 'bank-transfer', reference, note: p.note || '',
    createdAt: FieldValue.serverTimestamp()
  });
  res.status(201).json(paymentToApi(await ref.get()));
});

// A campaign is one of:
//   unpublished — a draft, nobody sees it
//   published   — offered to applicants who are in its cohort
//   staffOnly   — live, but only staff see it: the below-the-line campaigns
const VISIBILITIES = ['unpublished', 'published', 'staffOnly'];
const visibilityOf = d => (VISIBILITIES.includes(d.visibility) ? d.visibility : 'published');

// Who a campaign is for. An empty cohort means everyone.
//   employers — the applicant's employer must be one of these
//   rules     — every rule must hold, e.g. monthlyIncome at least 80000
const COHORT_FIELDS = ['monthlyIncome', 'employer', 'parish', 'town'];
const COHORT_OPS = ['gte', 'lte', 'eq', 'contains'];
const normText = v => String(v == null ? '' : v).trim().toLowerCase();
const asNumber = v => Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));

function ruleHolds(rule, person) {
  if (!rule || !COHORT_FIELDS.includes(rule.field) || !COHORT_OPS.includes(rule.op)) return false;
  const have = person[rule.field];
  if (rule.op === 'gte' || rule.op === 'lte') {
    const a = asNumber(have), b = asNumber(rule.value);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return rule.op === 'gte' ? a >= b : a <= b;
  }
  if (rule.op === 'eq') return normText(have) === normText(rule.value);
  return normText(have).includes(normText(rule.value));
}

function cleanCohort(raw) {
  const employers = Array.isArray(raw && raw.employers)
    ? raw.employers.map(e => String(e || '').trim()).filter(Boolean).slice(0, 50) : [];
  const rules = Array.isArray(raw && raw.rules)
    ? raw.rules.filter(r => r && COHORT_FIELDS.includes(r.field) && COHORT_OPS.includes(r.op))
        .map(r => ({ field: r.field, op: r.op, value: String(r.value == null ? '' : r.value).slice(0, 80) }))
        .slice(0, 20) : [];
  return { employers, rules };
}

// Employer is matched leniently — the values people type carry stray spaces
// and case — while the rules are exact about numbers.
function inCohort(cohort, person) {
  if (!cohort) return true;
  const employers = (cohort.employers || []).map(normText).filter(Boolean);
  if (employers.length && !employers.includes(normText(person.employer))) return false;
  return (cohort.rules || []).every(r => ruleHolds(r, person));
}

// Said in words, so an applicant can be told why, and an admin can see what
// they built without reading JSON.
function describeCohort(cohort) {
  if (!cohort) return 'Open to everyone';
  const parts = [];
  if ((cohort.employers || []).length) parts.push('works at ' + cohort.employers.join(' or '));
  (cohort.rules || []).forEach(r => {
    const label = { monthlyIncome: 'monthly income', employer: 'employer', parish: 'parish', town: 'town' }[r.field];
    const op = { gte: 'at least', lte: 'at most', eq: 'is', contains: 'contains' }[r.op];
    parts.push(label + ' ' + op + ' ' + r.value);
  });
  return parts.length ? parts.join(', and ') : 'Open to everyone';
}

function promoToApi(doc, opts) {
  const d = doc.data();
  return {
    id: doc.id, name: d.name, description: d.description || '', currency: d.currency || 'JMD',
    principal: d.principal, monthlyInterestPct: d.monthlyInterestPct, termMode: d.termMode || 'selectable',
    fixedTermMonths: d.fixedTermMonths ?? null, allowedTerms: d.allowedTerms || [],
    visibility: visibilityOf(d),
    ...((opts && opts.includeCohort) ? { cohort: d.cohort || { employers: [], rules: [] },
      cohortSummary: describeCohort(d.cohort) } : {}),
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/api/promotions', async (req, res) => {
  const snap = await db.collection('promotions').orderBy('createdAt', 'asc').get();
  res.json(snap.docs.filter(d => visibilityOf(d.data()) === 'published').map(d => promoToApi(d)));
});

// The admin's own list: drafts, below-the-line campaigns and cohorts included.
app.get('/api/promotions/all', requireGoogleAuth, async (req, res) => {
  const snap = await db.collection('promotions').orderBy('createdAt', 'asc').get();
  res.json({ ok: true, promotions: snap.docs.map(d => promoToApi(d, { includeCohort: true })) });
});

// What this person may actually apply to. Staff also see the below-the-line
// campaigns, which is what "available only to the loan officer" means.
app.get('/api/promotions/eligible', requireSignedIn, async (req, res) => {
  try {
    const person = req.user.profile || {};
    const snap = await db.collection('promotions').orderBy('createdAt', 'asc').get();
    const staff = isStaff(req.user);
    const promotions = snap.docs.filter(doc => {
      const d = doc.data();
      const v = visibilityOf(d);
      if (v === 'unpublished') return false;
      if (v === 'staffOnly' && !staff) return false;
      return inCohort(d.cohort, person);
    }).map(doc => ({ ...promoToApi(doc), staffOnly: visibilityOf(doc.data()) === 'staffOnly' }));
    res.json({ ok: true, profileComplete: req.user.profileComplete, promotions });
  } catch (e) {
    console.error('[promotions] eligible failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not load campaigns.' });
  }
});
app.get('/api/promotions/:id', async (req, res) => {
  const doc = await db.collection('promotions').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Promotion not found' });
  res.json(promoToApi(doc));
});
// Accepts visibility and cohort alongside the campaign's own figures.
function promoWriteFields(body) {
  const out = {};
  if (VISIBILITIES.includes(body.visibility)) out.visibility = body.visibility;
  if (body.cohort !== undefined) out.cohort = cleanCohort(body.cohort);
  return out;
}

app.post('/api/promotions', requireGoogleAuth, async (req, res) => {
  const p = req.body || {};
  const ref = await db.collection('promotions').add({
    name: p.name, description: p.description || '', currency: p.currency || 'JMD',
    principal: p.principal, monthlyInterestPct: p.monthlyInterestPct, termMode: p.termMode || 'selectable',
    fixedTermMonths: p.fixedTermMonths ?? null, allowedTerms: p.allowedTerms || [],
    ...promoWriteFields(p),
    businessId: await defaultBusinessId(),
    createdAt: FieldValue.serverTimestamp()
  });
  res.status(201).json(promoToApi(await ref.get()));
});
app.put('/api/promotions/:id', requireGoogleAuth, async (req, res) => {
  const p = req.body || {};
  const ref = db.collection('promotions').doc(req.params.id);
  await ref.update({
    name: p.name, description: p.description || '', currency: p.currency || 'JMD',
    principal: p.principal, monthlyInterestPct: p.monthlyInterestPct, termMode: p.termMode || 'selectable',
    fixedTermMonths: p.fixedTermMonths ?? null, allowedTerms: p.allowedTerms || [],
    ...promoWriteFields(p)
  });
  res.json(promoToApi(await ref.get()));
});
app.delete('/api/promotions/:id', requireGoogleAuth, async (req, res) => {
  await db.collection('promotions').doc(req.params.id).delete();
  res.json({ ok: true });
});

// The reference a person quotes. It is deliberately opaque: no prefix, no
// year, no counter — nothing about it says what it is, when it was issued or
// which application came before it. Crockford Base32 leaves out I, L, O and U,
// so there is no 0/O or 1/I to mishear and no accidental words. 12 characters
// is 60 bits, drawn from the CSPRNG rather than Math.random.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function randomCode(length) {
  // 256 is a multiple of 32, so masking a random byte stays uniform.
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}
async function nextApplicationCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode(12);
    const clash = await db.collection('applications').where('applicationCode', '==', code).limit(1).get();
    if (clash.empty) return code;
  }
  return randomCode(16);
}

// The capability key for the contract link: 192 bits of CSPRNG output, so the
// URL cannot be guessed, walked or reasoned about from a neighbouring one.
// Nothing about the applicant or the application is derivable from it.
function newContractToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function appToApi(doc, opts) {
  const d = doc.data();
  return {
    id: doc.id, applicationCode: d.applicationCode || null,
    // Admin-authenticated responses only — the token is what opens the
    // contract, so it never rides along on a publicly reachable route.
    ...((opts && opts.includeContractToken) ? { contractToken: d.contractToken || null } : {}),
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null,
    promotionId: d.promotionId, selectedTermMonths: d.selectedTermMonths, promoSnapshot: d.promoSnapshot || {},
    applicant: d.applicant || {}, status: d.status || 'Submitted', reason: d.reason || '',
    reviewFlags: d.reviewFlags || {}, attachments: d.attachments || {}, messages: d.messages || []
  };
}
app.get('/api/applications', requireApplicationsRead, async (req, res) => {
  const snap = await db.collection('applications').orderBy('createdAt', 'desc').get();
  res.json(snap.docs.map(doc => appToApi(doc, { includeContractToken: true })));
});
app.get('/api/applications/trn/:trn', async (req, res) => {
  const snap = await db.collection('applications').where('applicant.trn', '==', req.params.trn)
    .orderBy('createdAt', 'desc').limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'No application found for this TRN' });
  res.json(appToApi(snap.docs[0]));
});
// Opening a prefilled contract from its link. A loan application, a standing
// order and a salary deduction all describe the same borrower and the same
// loan, so any of the three can seed a contract; the token says which record
// without the link having to name a collection.
//
// The token is unguessable, but holding it is still only permission to draw up
// this one contract, so each branch returns just the fields the contract
// prints — never messages, attachments, review flags, decision reasons, or the
// bank and payroll details that belong to the authorization forms.
const CONTRACT_SOURCES = [
  { collection: 'applications', source: 'application', label: 'Loan application' },
  { collection: 'standingOrders', source: 'standingOrder', label: 'Standing order' },
  { collection: 'salaryDeductions', source: 'salaryDeduction', label: 'Salary deduction' }
];

const asFrequency = v => (['monthly', 'fortnightly', 'weekly'].includes(String(v || '').toLowerCase())
  ? String(v).toLowerCase() : null);

function contractFromApplication(d) {
  const a = d.applicant || {};
  const snap = d.promoSnapshot || {};
  return {
    reference: d.applicationCode || '',
    product: snap.name || '',
    status: d.status || 'Submitted',
    borrower: {
      name: [a.firstName, a.lastName].filter(Boolean).join(' '),
      trn: a.trn || '', phone: a.phone || '', email: a.email || '',
      addressLine1: a.addressLine1 || '', addressLine2: a.addressLine2 || '',
      town: '', parish: a.parish || ''
    },
    loan: {
      principal: snap.principal ?? null, instalments: d.selectedTermMonths ?? null,
      frequency: 'monthly', firstPaymentDate: '', agreementDate: '', instalmentAmount: ''
    }
  };
}

// Both authorization forms carry the borrower, the principal and the
// repayment plan under slightly different field names.
function contractFromForm(d, source) {
  // The form worked out its own repayment schedule, so the contract prints
  // that rather than deriving a second one from the same figures — which for
  // a fortnightly plan would not even have the same number of rows, since the
  // form schedules 26 payments a year against the contract's 12 months.
  // Anything unparseable just falls back to the contract's own maths.
  let schedule = [];
  try {
    const parsed = JSON.parse(d.schedule || '[]');
    if (Array.isArray(parsed)) {
      schedule = parsed.slice(0, 500).map((r, i) => ({
        n: Number(r.n) || i + 1,
        date: String(r.date || ''),
        amount: String(r.amount || ''),
        balance: String(r.balance || '')
      }));
    }
  } catch (e) { /* fall back to the contract's own schedule */ }

  return {
    reference: '',
    product: '',
    status: d.autosaved ? 'Draft' : 'Submitted',
    borrower: {
      name: String(d.borrowerName || '').trim(), trn: d.trn || '',
      phone: d.contactNo || '', email: '',
      addressLine1: '', addressLine2: '', town: '', parish: ''
    },
    loan: {
      schedule,
      principal: d.loanAmount ?? null,
      instalments: schedule.length || (d.totalMonths ?? null),
      frequency: asFrequency(source === 'standingOrder' ? d.repaymentFrequency : d.payFrequency),
      firstPaymentDate: d.startDate || '',
      agreementDate: d.contractDate || '',
      instalmentAmount: (source === 'standingOrder' ? d.paymentAmount : d.deductionAmount) || ''
    }
  };
}

// The fields a saved contract holds, so reopening one restores what was
// entered rather than working it out again.
const CONTRACT_FIELDS = ['principal', 'borrowerName', 'trn', 'contactNo', 'email',
  'addressLine1', 'addressLine2', 'town', 'parish', 'agreementDate', 'processingFee',
  'dailyRate', 'lateFee', 'firstPaymentDate', 'frequency', 'instalments', 'maturityDate',
  'instalmentAmount', 'totalRepayable', 'pricing', 'seededFrom', 'sourceReference', 'sourceRecordId'];

// A contract already drawn up from this record beats rebuilding one from the
// authorization form, because its charges, dates and instalment were settled
// at the time. The contract stores the id of the record it was drawn up from,
// so this is an explicit link rather than a guess at who the borrower is.
async function latestContractForRecord(recordId) {
  if (!recordId) return null;
  const docs = (await db.collection('contracts').where('sourceRecordId', '==', recordId).get()).docs;
  if (!docs.length) return null;

  const when = rec => { const t = rec.updatedAt || rec.submittedAt; return t && t.toMillis ? t.toMillis() : 0; };
  docs.sort((a, b) => when(b.data()) - when(a.data()));
  const doc = docs[0];
  const d = doc.data();

  const fields = {};
  CONTRACT_FIELDS.forEach(k => { if (d[k] != null && d[k] !== '') fields[k] = String(d[k]); });

  let schedule = [];
  try {
    const parsed = JSON.parse(d.schedule || '[]');
    if (Array.isArray(parsed)) schedule = parsed.slice(0, 500);
  } catch (e) { /* the page works its own out */ }

  return {
    id: doc.id,
    autosaved: d.autosaved === true,
    savedAt: when(d) ? new Date(when(d)).toISOString() : null,
    fields,
    schedule
  };
}

app.get('/api/contract/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 20) return res.status(404).json({ error: 'Unknown contract link' });
  for (const { collection, source, label } of CONTRACT_SOURCES) {
    const snap = await db.collection(collection).where('contractToken', '==', token).limit(1).get();
    if (snap.empty) continue;
    const d = snap.docs[0].data();
    const body = source === 'application' ? contractFromApplication(d) : contractFromForm(d, source);
    // Only for the authorization forms: an application is the start of a loan,
    // so a contract opened from one is meant to be drawn up fresh.
    const recordId = snap.docs[0].id;
    const existing = source === 'application' ? null : await latestContractForRecord(recordId);
    return res.json({ source, sourceLabel: label, recordId, existing, ...body });
  }
  res.status(404).json({ error: 'Unknown contract link' });
});
app.get('/api/applications/:id', async (req, res) => {
  const doc = await db.collection('applications').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Application not found' });
  res.json(appToApi(doc));
});
// Applying is a signed-in act: the applicant's details come from their own
// profile rather than the request, and the campaign has to be one they may
// actually see — otherwise a cohort would be a suggestion rather than a rule.
app.post('/api/applications', requireSignedIn, async (req, res) => {
  try {
    const { promotionId, selectedTermMonths } = req.body || {};
    if (!req.user.profileComplete) {
      return res.status(400).json({ ok: false, error: 'Fill in your profile before applying.' });
    }
    const promoDoc = await db.collection('promotions').doc(String(promotionId || '')).get();
    if (!promoDoc.exists) return res.status(400).json({ ok: false, error: 'Unknown campaign' });

    const promo = promoDoc.data();
    const visibility = visibilityOf(promo);
    const staff = isStaff(req.user);
    if (visibility === 'unpublished' || (visibility === 'staffOnly' && !staff)) {
      return res.status(403).json({ ok: false, error: 'That campaign is not open to you.' });
    }
    if (!inCohort(promo.cohort, req.user.profile || {})) {
      return res.status(403).json({ ok: false, error: 'You are not in the group this campaign is for.' });
    }

    const terms = promo.termMode === 'fixed'
      ? [promo.fixedTermMonths].filter(Boolean)
      : (promo.allowedTerms || []);
    const term = Number(selectedTermMonths);
    if (terms.length && !terms.includes(term)) {
      return res.status(400).json({ ok: false, error: 'Choose one of the terms this campaign offers.' });
    }

    const p = req.user.profile || {};
    const ref = await db.collection('applications').add({
      applicationCode: await nextApplicationCode(),
      contractToken: newContractToken(),
      businessId: req.user.businessId || await defaultBusinessId(),
      promotionId: promoDoc.id,
      selectedTermMonths: term || null,
      promoSnapshot: {
        name: promo.name, currency: promo.currency, principal: promo.principal,
        monthlyInterestPct: promo.monthlyInterestPct, termMode: promo.termMode,
        fixedTermMonths: promo.fixedTermMonths ?? null, allowedTerms: promo.allowedTerms || []
      },
      applicant: {
        userId: req.user.userId, email: req.user.email,
        firstName: p.firstName || '', lastName: p.lastName || '', phone: p.phone || '',
        trn: p.trn || '', addressLine1: p.addressLine1 || '', addressLine2: p.addressLine2 || '',
        town: p.town || '', parish: p.parish || '', employer: p.employer || '',
        monthlyIncome: p.monthlyIncome || ''
      },
      status: 'Submitted', reason: '', reviewFlags: {}, attachments: {}, messages: [],
      createdAt: FieldValue.serverTimestamp()
    });
    res.status(201).json({ ok: true, application: appToApi(await ref.get()) });
  } catch (e) {
    console.error('[applications] apply failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not send your application.' });
  }
});

// An applicant's own applications, so they can watch for a decision.
app.get('/api/me/applications', requireSignedIn, async (req, res) => {
  try {
    const snap = await db.collection('applications').where('applicant.userId', '==', req.user.userId || '~none~').get();
    const mine = snap.docs.map(d => {
      const x = d.data();
      return {
        id: d.id, applicationCode: x.applicationCode || null, status: x.status || 'Submitted',
        reason: x.reason || '', selectedTermMonths: x.selectedTermMonths ?? null,
        promoSnapshot: x.promoSnapshot || {},
        createdAt: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString() : null
      };
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json({ ok: true, applications: mine });
  } catch (e) {
    console.error('[applications] mine failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not load your applications.' });
  }
});

// ---- Attachments: base64 data URI -> Cloud Storage (private bucket, proxied read) ----
function extFromNameOrType(name, type) {
  const m = /\.[a-zA-Z0-9]+$/.exec(name || '');
  if (m) return m[0];
  if (type === 'application/pdf') return '.pdf';
  if (type && type.startsWith('image/')) return '.' + type.split('/')[1].split('+')[0];
  return '';
}
function parseDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri || '');
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}
async function saveAttachment(appId, baseName, file) {
  const parsed = parseDataUri(file.data);
  if (!parsed) throw new Error('Invalid attachment data');
  const ext = extFromNameOrType(file.name, file.type || parsed.mime);
  const objectPath = `app-${appId}/${baseName}${ext}`;
  await bucket.file(objectPath).save(parsed.buffer, { contentType: file.type || parsed.mime });
  return `/uploads/${objectPath}`;
}
async function deleteAttachment(relativeUrl) {
  if (!relativeUrl || !relativeUrl.startsWith('/uploads/')) return;
  try {
    await bucket.file(relativeUrl.slice('/uploads/'.length)).delete();
  } catch (e) {
    if (e.code !== 404) throw e;
  }
}

// Public, same as the original local-disk version (no auth on this in any
// prior version of the app — the applicant-facing pages read their own
// attachments back this way too, and they're never signed in as admin).
app.get('/uploads/:appDir/:filename', async (req, res) => {
  try {
    const file = bucket.file(`${req.params.appDir}/${req.params.filename}`);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).send('Not found');
    file.createReadStream().on('error', () => res.status(500).end()).pipe(res);
  } catch (e) {
    res.status(500).send('Error reading file');
  }
});

app.patch('/api/applications/:id', async (req, res) => {
  const id = req.params.id;
  const ref = db.collection('applications').doc(id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Application not found' });
  const current = doc.data();
  const body = req.body || {};

  const applicant = body.applicant ? { ...current.applicant, ...body.applicant } : current.applicant;
  const status = body.status || current.status;
  const reason = typeof body.reason === 'string' ? body.reason : current.reason;
  const reviewFlags = body.reviewFlags || current.reviewFlags;
  const attachments = { ...(current.attachments || {}) };

  if (body.attachments) {
    if (body.attachments.photoId) {
      if (attachments.photoId) await deleteAttachment(attachments.photoId);
      attachments.photoId = await saveAttachment(id, 'photoId', body.attachments.photoId);
    }
    if (Array.isArray(body.attachments.payslips) && body.attachments.payslips.length) {
      attachments.payslips = attachments.payslips || [];
      let n = attachments.payslips.length + 1;
      for (const file of body.attachments.payslips) {
        attachments.payslips.push(await saveAttachment(id, 'payslip' + n, file));
        n++;
      }
    }
  }
  if (body.removeAttachments) {
    if (body.removeAttachments.photoId && attachments.photoId) {
      await deleteAttachment(attachments.photoId);
      delete attachments.photoId;
    }
    if (Array.isArray(body.removeAttachments.payslips) && attachments.payslips) {
      for (const url of body.removeAttachments.payslips) await deleteAttachment(url);
      attachments.payslips = attachments.payslips.filter(u => !body.removeAttachments.payslips.includes(u));
    }
  }

  const messages = [...(current.messages || [])];
  if (body.newMessage) {
    messages.push({ role: body.newMessage.role || 'applicant', text: body.newMessage.text, timestamp: new Date().toISOString() });
  }

  const update = { applicant, status, reason, reviewFlags, attachments, messages };
  if (body.selectedTermMonths !== undefined) update.selectedTermMonths = Number(body.selectedTermMonths) || null;
  if (body.loanAmount !== undefined) {
    update.promoSnapshot = { ...(current.promoSnapshot || {}), principal: Number(body.loanAmount) || 0 };
  }
  await ref.update(update);
  res.json(appToApi(await ref.get()));
});

// =========================================================================
// Support tickets — stage 1 of the CRM: one thread per ticket, linked to the
// record it is about.
//
// Customers sign in with Google like everyone else. Any verified Google
// account may raise a ticket, and a user record is created for it the first
// time it appears, so the ticket has an owner and the profile step has
// somewhere to write. Staff roles are never created this way — they are set
// deliberately in the users table.
// =========================================================================
const STAFF_ROLES = ['superAdmin', 'businessAdmin', 'support', 'underwriter'];
const TICKET_STATUSES = ['open', 'waiting on customer', 'resolved'];
const TICKET_PRIORITIES = ['normal', 'high'];
// What a ticket can be about, and the collection each one lives in.
const ABOUT_TYPES = {
  contract: 'contracts',
  standingOrder: 'standingOrders',
  salaryDeduction: 'salaryDeductions',
  application: 'applications'
};

async function defaultBusinessId() {
  const snap = await db.collection('businesses').limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

async function ensureUser(email, decoded) {
  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!snap.empty) {
    const d = snap.docs[0].data();
    const profile = {};
    ['firstName', 'lastName', 'phone', 'trn', 'addressLine1', 'addressLine2',
      'town', 'parish', 'employer', 'monthlyIncome'].forEach(k => { profile[k] = d[k] || ''; });
    return {
      userId: snap.docs[0].id, email,
      role: d.role || 'applicant',
      businessId: d.businessId || null,
      name: [d.firstName, d.lastName].filter(Boolean).join(' ') || decoded.name || email,
      trn: d.trn || '',
      profile,
      profileComplete: !!d.profileCompletedAt
    };
  }
  const full = String(decoded.name || '').trim();
  const ref = await db.collection('users').add({
    pid: randomCode(12), email, role: 'applicant',
    businessId: await defaultBusinessId(),
    firstName: full.split(' ')[0] || '', lastName: full.split(' ').slice(1).join(' '),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp()
  });
  return { userId: ref.id, email, role: 'applicant', businessId: await defaultBusinessId(),
    name: full || email, trn: '', profile: {}, profileComplete: false };
}

// Any verified Google account, customer or staff. Distinct from requireRole,
// which is the allow-listed admin gate.
async function requireSignedIn(req, res, next) {
  const hdr = req.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });
  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    if (!decoded.email || !decoded.email_verified) {
      return res.status(403).json({ ok: false, error: 'A verified Google account is required.' });
    }
    const email = decoded.email.toLowerCase();
    if (SYSTEM_ADMIN_EMAIL && email === SYSTEM_ADMIN_EMAIL) {
      req.user = { userId: null, email, role: 'superAdmin', businessId: null,
        name: decoded.name || 'Administrator', trn: '', profile: {}, profileComplete: true };
      return next();
    }
    req.user = await ensureUser(email, decoded);
    // The bootstrap list still names the business admins until they have a
    // user record of their own.
    if (BUSINESS_ADMIN_EMAILS.has(email) && req.user.role === 'applicant') req.user.role = 'businessAdmin';
    next();
  } catch (e) {
    console.error('[tickets] auth failed:', e.message);
    res.status(401).json({ ok: false, error: 'Invalid or expired sign-in token.' });
  }
}

const isStaff = u => STAFF_ROLES.includes(u.role);
const iso = t => (t && t.toDate ? t.toDate().toISOString() : null);

function ticketToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, pid: d.pid || null, businessId: d.businessId || null,
    subject: d.subject || '', status: d.status || 'open', priority: d.priority || 'normal',
    customer: d.customer || {}, about: d.about || null, assignedTo: d.assignedTo || null,
    messageCount: d.messageCount || 0,
    createdAt: iso(d.createdAt), lastReplyAt: iso(d.lastReplyAt)
  };
}

// A ticket is readable by staff of the same business, and by the person who
// raised it. Nobody else, whatever they hold.
function mayseeTicket(user, t) {
  if (user.role === 'superAdmin') return true;
  if (isStaff(user)) return !!t.businessId && t.businessId === user.businessId;
  return !!(t.customer && t.customer.userId && t.customer.userId === user.userId);
}

app.post('/api/tickets', requireSignedIn, async (req, res) => {
  try {
    const body = req.body || {};
    const subject = String(body.subject || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 5000);
    if (!subject || !message) {
      return res.status(400).json({ ok: false, error: 'A subject and a message are both needed.' });
    }
    const priority = TICKET_PRIORITIES.includes(body.priority) ? body.priority : 'normal';

    // The record the ticket is about, kept only if it is a kind we know and
    // the record actually exists.
    let about = null;
    const type = body.about && body.about.type;
    const aboutId = body.about && String(body.about.id || '');
    if (ABOUT_TYPES[type] && aboutId) {
      const doc = await db.collection(ABOUT_TYPES[type]).doc(aboutId).get();
      if (doc.exists) {
        const d = doc.data();
        about = { type, id: aboutId, label: d.borrowerName || d.applicationCode ||
          ((d.applicant && [d.applicant.firstName, d.applicant.lastName].filter(Boolean).join(' ')) || aboutId) };
      }
    }

    const now = FieldValue.serverTimestamp();
    const ref = await db.collection('tickets').add({
      pid: randomCode(12),
      businessId: req.user.businessId || await defaultBusinessId(),
      subject, status: 'open', priority, about, assignedTo: null,
      customer: { userId: req.user.userId, name: req.user.name, email: req.user.email, trn: req.user.trn || '' },
      messageCount: 1, createdAt: now, lastReplyAt: now
    });
    await ref.collection('messages').add({
      author: isStaff(req.user) ? 'staff' : 'customer',
      authorId: req.user.userId, authorName: req.user.name,
      body: message, createdAt: now
    });
    res.status(201).json({ ok: true, ticket: ticketToApi(await ref.get()) });
  } catch (e) {
    console.error('[tickets] create failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not open the ticket.' });
  }
});

app.get('/api/tickets', requireSignedIn, async (req, res) => {
  try {
    // Sorted in memory: the filter and the sort are on different fields, which
    // would otherwise need a composite index for what is a small collection.
    let docs;
    if (req.user.role === 'superAdmin') {
      docs = (await db.collection('tickets').get()).docs;
    } else if (isStaff(req.user)) {
      docs = (await db.collection('tickets').where('businessId', '==', req.user.businessId || '~none~').get()).docs;
    } else {
      docs = (await db.collection('tickets').where('customer.userId', '==', req.user.userId || '~none~').get()).docs;
    }
    const tickets = docs.map(ticketToApi)
      .sort((a, b) => String(b.lastReplyAt || '').localeCompare(String(a.lastReplyAt || '')));
    res.json({ ok: true, role: req.user.role, staff: isStaff(req.user), tickets });
  } catch (e) {
    console.error('[tickets] list failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not load tickets.' });
  }
});

app.get('/api/tickets/:id', requireSignedIn, async (req, res) => {
  try {
    const doc = await db.collection('tickets').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    if (!mayseeTicket(req.user, doc.data())) return res.status(403).json({ ok: false, error: 'Not your ticket.' });
    const msgs = await doc.ref.collection('messages').orderBy('createdAt').get();
    res.json({
      ok: true, staff: isStaff(req.user), ticket: ticketToApi(doc),
      messages: msgs.docs.map(m => {
        const d = m.data();
        return { id: m.id, author: d.author, authorName: d.authorName || '', body: d.body || '', createdAt: iso(d.createdAt) };
      })
    });
  } catch (e) {
    console.error('[tickets] read failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not load the ticket.' });
  }
});

app.post('/api/tickets/:id/messages', requireSignedIn, async (req, res) => {
  try {
    const body = String((req.body || {}).message || '').trim().slice(0, 5000);
    if (!body) return res.status(400).json({ ok: false, error: 'A reply cannot be empty.' });
    const ref = db.collection('tickets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    if (!mayseeTicket(req.user, doc.data())) return res.status(403).json({ ok: false, error: 'Not your ticket.' });

    const staff = isStaff(req.user);
    const now = FieldValue.serverTimestamp();
    await ref.collection('messages').add({
      author: staff ? 'staff' : 'customer',
      authorId: req.user.userId, authorName: req.user.name, body, createdAt: now
    });
    // A reply moves the ticket to whoever now owes an answer, and a resolved
    // ticket reopens when either side says something more.
    await ref.update({
      messageCount: FieldValue.increment(1),
      lastReplyAt: now,
      status: staff ? 'waiting on customer' : 'open'
    });
    res.json({ ok: true, ticket: ticketToApi(await ref.get()) });
  } catch (e) {
    console.error('[tickets] reply failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not send the reply.' });
  }
});

app.patch('/api/tickets/:id', requireSignedIn, async (req, res) => {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ ok: false, error: 'Only staff can change a ticket.' });
    const ref = db.collection('tickets').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    if (!mayseeTicket(req.user, doc.data())) return res.status(403).json({ ok: false, error: 'Not your ticket.' });

    const update = {};
    const body = req.body || {};
    if (TICKET_STATUSES.includes(body.status)) update.status = body.status;
    if (TICKET_PRIORITIES.includes(body.priority)) update.priority = body.priority;
    if (body.assignedTo !== undefined) update.assignedTo = body.assignedTo ? String(body.assignedTo).slice(0, 120) : null;
    if (!Object.keys(update).length) return res.status(400).json({ ok: false, error: 'Nothing to change.' });

    await ref.update(update);
    res.json({ ok: true, ticket: ticketToApi(await ref.get()) });
  } catch (e) {
    console.error('[tickets] update failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not update the ticket.' });
  }
});

// The profile an applicant fills in before they can apply. Employer and
// monthly income are here because campaign cohorts are judged on them.
const PROFILE_FIELDS = ['firstName', 'lastName', 'phone', 'trn', 'addressLine1',
  'addressLine2', 'town', 'parish', 'employer', 'monthlyIncome'];
const PROFILE_REQUIRED = ['firstName', 'lastName', 'phone', 'trn', 'addressLine1',
  'town', 'parish', 'employer', 'monthlyIncome'];

app.put('/api/me/profile', requireSignedIn, async (req, res) => {
  try {
    if (!req.user.userId) return res.status(400).json({ ok: false, error: 'This account has no profile to fill in.' });
    const body = req.body || {};
    const profile = {};
    PROFILE_FIELDS.forEach(k => { if (body[k] !== undefined) profile[k] = String(body[k]).trim().slice(0, 200); });

    const missing = PROFILE_REQUIRED.filter(k => !profile[k]);
    if (missing.length) return res.status(400).json({ ok: false, error: 'Still needed: ' + missing.join(', '), missing });
    const bad = trnProblem(profile.trn, true);
    if (bad) return res.status(400).json({ ok: false, error: bad });
    if (!(asNumber(profile.monthlyIncome) > 0)) {
      return res.status(400).json({ ok: false, error: 'Monthly income must be an amount.' });
    }
    profile.monthlyIncome = String(asNumber(profile.monthlyIncome));

    await db.collection('users').doc(req.user.userId).set({
      ...profile, profileCompletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    res.json({ ok: true, profile, profileComplete: true });
  } catch (e) {
    console.error('[profile] save failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not save your profile.' });
  }
});

// Who am I, for the customer-facing pages.
app.get('/api/me', requireSignedIn, (req, res) => {
  touchLastLogin(req.user.userId);
  res.json({ ok: true, ...req.user, staff: isStaff(req.user), permissions: permissionsFor(req.user.role) });
});

exports.api = onRequest({ region: 'us-central1' }, app);
