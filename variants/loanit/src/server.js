// src/server.js
// Loan system server — Express + JSON file persistence + cookie sessions

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

// ---------------------------
// Constants & Paths
// ---------------------------
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const DATA_DIR = path.join(ROOT_DIR, 'storage', 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'storage', 'uploads');
const LOGS_DIR = path.join(ROOT_DIR, 'storage', 'logs');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROMOS_FILE = path.join(DATA_DIR, 'promotions.json');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');
const LOANS_FILE = path.join(DATA_DIR, 'loans.json');
const PARISHES_FILE = path.join(DATA_DIR, 'parishes.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const EDIT_LOG_FILE = path.join(DATA_DIR, 'app_edit_log.jsonl');

for (const dir of [DATA_DIR, UPLOADS_DIR, LOGS_DIR]) {
  if (!fssync.existsSync(dir)) fssync.mkdirSync(dir, { recursive: true });
}

// ---------------------------
// JSON file helpers
// ---------------------------
async function readJSON(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function appendEditLog(entry) {
  await fs.appendFile(EDIT_LOG_FILE, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}

function nextId(list) {
  return list.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

// ---------------------------
// Password hashing (pbkdf2, matches existing users.json entries)
// ---------------------------
function verifyPassword(user, password) {
  if (user.password && user.password.algo === 'pbkdf2') {
    const { iterations, salt, hash } = user.password;
    const computed = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return computed === hash;
  }
  // Legacy demo fallback documented in README: admin / testpass
  if (user.role === 'admin' && !user.password) {
    return password === 'testpass';
  }
  return false;
}

// ---------------------------
// Attachment (data URI) helpers
// ---------------------------
function extFromNameOrType(name, type) {
  const match = /\.[a-zA-Z0-9]+$/.exec(name || '');
  if (match) return match[0];
  if (type === 'application/pdf') return '.pdf';
  if (type && type.startsWith('image/')) return '.' + type.split('/')[1].split('+')[0];
  return '';
}

function parseDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri || '');
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function saveAttachmentFile(appId, baseName, file) {
  const parsed = parseDataUri(file.data);
  if (!parsed) throw new Error('Invalid attachment data');
  const ext = extFromNameOrType(file.name, file.type || parsed.mime);
  const dir = path.join(UPLOADS_DIR, 'app-' + appId);
  await fs.mkdir(dir, { recursive: true });
  const fileName = baseName + ext;
  await fs.writeFile(path.join(dir, fileName), parsed.buffer);
  return '/uploads/app-' + appId + '/' + fileName;
}

async function deleteUploadedFile(relativeUrl) {
  if (!relativeUrl || !relativeUrl.startsWith('/uploads/')) return;
  const filePath = path.join(ROOT_DIR, 'storage', relativeUrl.replace('/uploads/', 'uploads/'));
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// ---------------------------
// Sessions
// ---------------------------
async function createSession(userId) {
  const sessions = await readJSON(SESSIONS_FILE, []);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.push({ token, userId, createdAt: new Date().toISOString() });
  await writeJSON(SESSIONS_FILE, sessions);
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const sessions = await readJSON(SESSIONS_FILE, []);
  const session = sessions.find(s => s.token === token);
  if (!session) return null;
  const users = await readJSON(USERS_FILE, []);
  const user = users.find(u => u.id === session.userId);
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

async function destroySession(token) {
  const sessions = await readJSON(SESSIONS_FILE, []);
  await writeJSON(SESSIONS_FILE, sessions.filter(s => s.token !== token));
}

// ---------------------------
// App setup
// ---------------------------
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(async (req, res, next) => {
  req.user = await getSessionUser(req.cookies.sid);
  next();
});

// ---------------------------
// Auth
// ---------------------------
app.post('/api/login', async (req, res) => {
  const { username, email, password } = req.body || {};
  const identifier = (email || username || '').toLowerCase();
  const users = await readJSON(USERS_FILE, []);
  const user = users.find(u =>
    (u.email && u.email.toLowerCase() === identifier) ||
    (u.name && u.name.toLowerCase() === identifier)
  );
  if (!user || !verifyPassword(user, password || '')) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = await createSession(user.id);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax' });
  const { password: _pw, ...safeUser } = user;
  res.json(safeUser);
});

app.post('/api/logout', async (req, res) => {
  if (req.cookies.sid) await destroySession(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ user: req.user || null });
});

// ---------------------------
// Parishes
// ---------------------------
app.get('/api/parishes', async (req, res) => {
  res.json(await readJSON(PARISHES_FILE, []));
});

// ---------------------------
// Users
// ---------------------------
app.get('/api/users', async (req, res) => {
  const users = await readJSON(USERS_FILE, []);
  res.json(users.map(({ password, ...u }) => u));
});

// ---------------------------
// Loans
// ---------------------------
app.get('/api/loans', async (req, res) => {
  res.json(await readJSON(LOANS_FILE, []));
});

// ---------------------------
// Promotions
// ---------------------------
app.get('/api/promotions', async (req, res) => {
  res.json(await readJSON(PROMOS_FILE, []));
});

app.get('/api/promotions/:id', async (req, res) => {
  const promos = await readJSON(PROMOS_FILE, []);
  const promo = promos.find(p => p.id === Number(req.params.id));
  if (!promo) return res.status(404).json({ error: 'Promotion not found' });
  res.json(promo);
});

app.post('/api/promotions', async (req, res) => {
  const promos = await readJSON(PROMOS_FILE, []);
  const promo = { ...req.body, id: nextId(promos), createdAt: new Date().toISOString() };
  promos.push(promo);
  await writeJSON(PROMOS_FILE, promos);
  res.status(201).json(promo);
});

app.put('/api/promotions/:id', async (req, res) => {
  const promos = await readJSON(PROMOS_FILE, []);
  const idx = promos.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Promotion not found' });
  promos[idx] = { ...promos[idx], ...req.body, id: promos[idx].id };
  await writeJSON(PROMOS_FILE, promos);
  res.json(promos[idx]);
});

app.delete('/api/promotions/:id', async (req, res) => {
  const promos = await readJSON(PROMOS_FILE, []);
  const filtered = promos.filter(p => p.id !== Number(req.params.id));
  await writeJSON(PROMOS_FILE, filtered);
  res.json({ ok: true });
});

// ---------------------------
// Applications
// ---------------------------
app.get('/api/applications', async (req, res) => {
  res.json(await readJSON(APPS_FILE, []));
});

app.get('/api/applications/trn/:trn', async (req, res) => {
  const apps = await readJSON(APPS_FILE, []);
  const match = apps
    .filter(a => a.applicant && a.applicant.trn === req.params.trn)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!match) return res.status(404).json({ error: 'No application found for this TRN' });
  res.json(match);
});

app.get('/api/applications/:id', async (req, res) => {
  const apps = await readJSON(APPS_FILE, []);
  const application = apps.find(a => a.id === Number(req.params.id));
  if (!application) return res.status(404).json({ error: 'Application not found' });
  res.json(application);
});

app.post('/api/applications', async (req, res) => {
  const { promotionId, selectedTermMonths, applicant } = req.body || {};
  const promos = await readJSON(PROMOS_FILE, []);
  const promo = promos.find(p => p.id === Number(promotionId));
  if (!promo) return res.status(400).json({ error: 'Unknown promotion' });

  const apps = await readJSON(APPS_FILE, []);
  const application = {
    id: nextId(apps),
    createdAt: new Date().toISOString(),
    promotionId: promo.id,
    selectedTermMonths,
    promoSnapshot: {
      name: promo.name,
      currency: promo.currency,
      principal: promo.principal,
      monthlyInterestPct: promo.monthlyInterestPct,
      termMode: promo.termMode,
      fixedTermMonths: promo.fixedTermMonths,
      allowedTerms: promo.allowedTerms
    },
    applicant: applicant || {},
    status: 'Submitted',
    reason: '',
    reviewFlags: {},
    attachments: {},
    messages: []
  };
  apps.push(application);
  await writeJSON(APPS_FILE, apps);
  res.status(201).json(application);
});

app.patch('/api/applications/:id', async (req, res) => {
  const id = Number(req.params.id);
  const apps = await readJSON(APPS_FILE, []);
  const idx = apps.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Application not found' });

  const application = apps[idx];
  const body = req.body || {};

  if (body.applicant) {
    application.applicant = { ...application.applicant, ...body.applicant };
  }
  if (body.status) application.status = body.status;
  if (typeof body.reason === 'string') application.reason = body.reason;
  if (body.reviewFlags) application.reviewFlags = body.reviewFlags;

  application.attachments = application.attachments || {};

  if (body.attachments) {
    if (body.attachments.photoId) {
      if (application.attachments.photoId) await deleteUploadedFile(application.attachments.photoId);
      application.attachments.photoId = await saveAttachmentFile(id, 'photoId', body.attachments.photoId);
    }
    if (Array.isArray(body.attachments.payslips) && body.attachments.payslips.length) {
      application.attachments.payslips = application.attachments.payslips || [];
      let n = application.attachments.payslips.length + 1;
      for (const file of body.attachments.payslips) {
        const url = await saveAttachmentFile(id, 'payslip' + n, file);
        application.attachments.payslips.push(url);
        n++;
      }
    }
  }

  if (body.removeAttachments) {
    if (body.removeAttachments.photoId && application.attachments.photoId) {
      await deleteUploadedFile(application.attachments.photoId);
      delete application.attachments.photoId;
    }
    if (Array.isArray(body.removeAttachments.payslips) && application.attachments.payslips) {
      for (const url of body.removeAttachments.payslips) {
        await deleteUploadedFile(url);
      }
      application.attachments.payslips = application.attachments.payslips.filter(
        url => !body.removeAttachments.payslips.includes(url)
      );
    }
  }

  if (body.newMessage) {
    application.messages = application.messages || [];
    application.messages.push({
      role: body.newMessage.role || 'applicant',
      text: body.newMessage.text,
      timestamp: new Date().toISOString()
    });
  }

  apps[idx] = application;
  await writeJSON(APPS_FILE, apps);
  await appendEditLog({ applicationId: id, change: Object.keys(body) });
  res.json(application);
});

// ---------------------------
// Start server
// ---------------------------
app.listen(PORT, () => {
  console.log(`Loan system server running at http://localhost:${PORT}/`);
});
