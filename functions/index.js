const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const express = require('express');

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
// Restricted to one allow-listed account. Applied to all 5 admin surfaces.
// =========================================================================
const ALLOWED_ADMIN_EMAIL = (process.env.ALLOWED_ADMIN_EMAIL || '').toLowerCase();

async function requireGoogleAuth(req, res, next) {
  const hdr = req.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Missing bearer token' });
  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    if (!decoded.email_verified || !ALLOWED_ADMIN_EMAIL || email !== ALLOWED_ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: 'This Google account is not authorized for admin access.' });
    }
    req.adminEmail = email;
    next();
  } catch (e) {
    console.error('[auth] verifyIdToken failed:', e.message);
    res.status(401).json({ ok: false, error: 'Invalid or expired sign-in token.' });
  }
}

// Lets the client confirm "am I signed in as the right account?" before
// rendering admin UI, independent of any specific data call.
app.get('/auth/verify', requireGoogleAuth, (req, res) => res.json({ ok: true, email: req.adminEmail }));

// =========================================================================
// Authorization form submissions (standingOrders / salaryDeductions).
//
// One record per form session: the page sends a draftId that is used as the
// document id, so a session's autosaves and its final printed submission all
// land on the SAME document instead of piling up duplicates. submittedAt is
// kept from the first write; later writes only move updatedAt.
// =========================================================================
function formRoutes(path, collection, logLabel) {
  app.post(path, async (req, res) => {
    try {
      const body = { ...(req.body || {}) };
      const draftId = typeof body.draftId === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(body.draftId)
        ? body.draftId : null;

      if (!draftId) {
        const ref = await db.collection(collection).add({ submittedAt: FieldValue.serverTimestamp(), ...body });
        return res.json({ ok: true, id: ref.id, created: true });
      }

      const ref = db.collection(collection).doc(draftId);
      const existing = await ref.get();
      const rec = { ...body, updatedAt: FieldValue.serverTimestamp() };
      if (!existing.exists) rec.submittedAt = FieldValue.serverTimestamp();
      await ref.set(rec, { merge: true });
      res.json({ ok: true, id: ref.id, created: !existing.exists });
    } catch (e) {
      console.error('[' + logLabel + '] write error:', e.message);
      res.status(500).json({ ok: false, error: 'Failed to save record' });
    }
  });

  app.get(path, requireGoogleAuth, async (req, res) => {
    try {
      const snap = await db.collection(collection).orderBy('submittedAt', 'desc').get();
      res.json({ ok: true, rows: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    } catch (e) {
      console.error('[' + logLabel + '] read error:', e.message);
      res.status(500).json({ ok: false, error: 'Query failed' });
    }
  });

  // Single record + admin edit — used by the form pages' edit mode. Reading
  // and writing an existing record both require the admin sign-in, since the
  // records carry applicant personal details.
  app.get(path + '/:id', requireGoogleAuth, async (req, res) => {
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

formRoutes('/standing-orders', 'standingOrders', 'standing-orders');
formRoutes('/salary-deductions', 'salaryDeductions', 'salary-deductions');

// =========================================================================
// Legacy flat applications listing (Firestore: applications) — feeds
// admin.html + admin-applications.html unchanged
// =========================================================================
function toFlatRow(doc) {
  const d = doc.data();
  const a = d.applicant || {};
  return {
    application_id: d.applicationCode || doc.id,
    first_name: a.firstName || '', last_name: a.lastName || '', email: a.email || '',
    phone_full: a.phone || '', address1: a.addressLine1 || '', address2: a.addressLine2 || '',
    parish: a.parish || '', term_months: d.selectedTermMonths ?? null, promotion_id: d.promotionId ?? null,
    created_at: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/applications', requireGoogleAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  try {
    const snap = await db.collection('applications').orderBy('createdAt', 'desc').limit(limit).get();
    res.json({ ok: true, rows: snap.docs.map(toFlatRow) });
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

function promoToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, name: d.name, description: d.description || '', currency: d.currency || 'JMD',
    principal: d.principal, monthlyInterestPct: d.monthlyInterestPct, termMode: d.termMode || 'selectable',
    fixedTermMonths: d.fixedTermMonths ?? null, allowedTerms: d.allowedTerms || [],
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null
  };
}
app.get('/api/promotions', async (req, res) => {
  const snap = await db.collection('promotions').orderBy('createdAt', 'asc').get();
  res.json(snap.docs.map(promoToApi));
});
app.get('/api/promotions/:id', async (req, res) => {
  const doc = await db.collection('promotions').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Promotion not found' });
  res.json(promoToApi(doc));
});
app.post('/api/promotions', requireGoogleAuth, async (req, res) => {
  const p = req.body || {};
  const ref = await db.collection('promotions').add({
    name: p.name, description: p.description || '', currency: p.currency || 'JMD',
    principal: p.principal, monthlyInterestPct: p.monthlyInterestPct, termMode: p.termMode || 'selectable',
    fixedTermMonths: p.fixedTermMonths ?? null, allowedTerms: p.allowedTerms || [],
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
    fixedTermMonths: p.fixedTermMonths ?? null, allowedTerms: p.allowedTerms || []
  });
  res.json(promoToApi(await ref.get()));
});
app.delete('/api/promotions/:id', requireGoogleAuth, async (req, res) => {
  await db.collection('promotions').doc(req.params.id).delete();
  res.json({ ok: true });
});

function appToApi(doc) {
  const d = doc.data();
  return {
    id: doc.id, applicationCode: d.applicationCode || null,
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt || null,
    promotionId: d.promotionId, selectedTermMonths: d.selectedTermMonths, promoSnapshot: d.promoSnapshot || {},
    applicant: d.applicant || {}, status: d.status || 'Submitted', reason: d.reason || '',
    reviewFlags: d.reviewFlags || {}, attachments: d.attachments || {}, messages: d.messages || []
  };
}
app.get('/api/applications', requireGoogleAuth, async (req, res) => {
  const snap = await db.collection('applications').orderBy('createdAt', 'desc').get();
  res.json(snap.docs.map(appToApi));
});
app.get('/api/applications/trn/:trn', async (req, res) => {
  const snap = await db.collection('applications').where('applicant.trn', '==', req.params.trn)
    .orderBy('createdAt', 'desc').limit(1).get();
  if (snap.empty) return res.status(404).json({ error: 'No application found for this TRN' });
  res.json(appToApi(snap.docs[0]));
});
app.get('/api/applications/:id', async (req, res) => {
  const doc = await db.collection('applications').doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Application not found' });
  res.json(appToApi(doc));
});
app.post('/api/applications', async (req, res) => {
  const { promotionId, selectedTermMonths, applicant } = req.body || {};
  const promoDoc = await db.collection('promotions').doc(String(promotionId)).get();
  if (!promoDoc.exists) return res.status(400).json({ error: 'Unknown promotion' });
  const promo = promoDoc.data();
  const promoSnapshot = {
    name: promo.name, currency: promo.currency, principal: promo.principal,
    monthlyInterestPct: promo.monthlyInterestPct, termMode: promo.termMode,
    fixedTermMonths: promo.fixedTermMonths ?? null, allowedTerms: promo.allowedTerms || []
  };
  const applicationCode = `APP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const ref = await db.collection('applications').add({
    applicationCode, promotionId: promoDoc.id, selectedTermMonths, promoSnapshot,
    applicant: applicant || {}, status: 'Submitted', reason: '', reviewFlags: {}, attachments: {}, messages: [],
    createdAt: FieldValue.serverTimestamp()
  });
  res.status(201).json(appToApi(await ref.get()));
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

exports.api = onRequest({ region: 'us-central1' }, app);
