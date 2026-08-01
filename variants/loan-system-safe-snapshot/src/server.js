const http = require('http');
const fs = require('fs').promises;
const path = require('path');

const PORT = process.env.PORT || 3000;

// Paths to JSON data files
const DATA_DIR = path.join(__dirname, '..', 'storage', 'data');
const PROMOS_FILE = path.join(DATA_DIR, 'promotions.json');
const APPS_FILE = path.join(DATA_DIR, 'applications.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LOANS_FILE = path.join(DATA_DIR, 'loans.json');
const PARISHES_FILE = path.join(DATA_DIR, 'parishes.json');

// Directory where uploaded attachments will be stored
const UPLOADS_DIR = path.join(__dirname, '..', 'storage', 'uploads');

// Log file for application edits
const APP_EDIT_LOG_FILE = path.join(DATA_DIR, 'app_edit_log.jsonl');

// Helper to save uploaded attachments
async function saveAttachments(appId, attachments) {
  const saved = {};
  if (!attachments) return saved;
  const appDir = path.join(UPLOADS_DIR, 'app-' + appId);
  await fs.mkdir(appDir, { recursive: true });
  if (attachments.photoId && attachments.photoId.data) {
    const { name, data } = attachments.photoId;
    const ext = path.extname(name) || '';
    const fileName = 'photoId' + ext;
    const filePath = path.join(appDir, fileName);
    const base64 = data.split(',')[1];
    if (base64) {
      await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
      saved.photoId = `/uploads/app-${appId}/${fileName}`;
    }
  }
  if (Array.isArray(attachments.payslips)) {
    saved.payslips = [];
    let idx = 1;
    for (const file of attachments.payslips) {
      if (!file || !file.data) continue;
      const ext = path.extname(file.name) || '';
      const fileName = `payslip${idx}${ext}`;
      const filePath = path.join(appDir, fileName);
      const base64 = file.data.split(',')[1];
      if (base64) {
        await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
        saved.payslips.push(`/uploads/app-${appId}/${fileName}`);
        idx++;
      }
    }
  }
  return saved;
}

// Helper functions to read and write JSON files
async function readFileOrEmpty(file) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text || '[]');
  } catch (err) {
    return [];
  }
}

async function writeFile(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Serve static files
async function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/uploads/')) {
    const relPath = pathname.replace('/uploads/', '');
    const filePath = path.join(UPLOADS_DIR, relPath);
    if (!filePath.startsWith(UPLOADS_DIR)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.svg') contentType = 'image/svg+xml';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
      return;
    } catch (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }
  const fileName = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, '..', 'public', fileName);
  const publicDir = path.join(__dirname, '..', 'public');
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
}

// Handle API requests
async function handleApi(req, res, pathname) {
  const respond = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyText = Buffer.concat(chunks).toString();
  let body;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      return respond(400, { error: 'Invalid JSON' });
    }
  }

  // Authentication endpoint
  if (pathname === '/api/auth' && req.method === 'POST') {
    const users = await readFileOrEmpty(USERS_FILE);
    const { email, password } = body;
    
    if (!email || !password) {
      return respond(400, { error: 'Email and password are required' });
    }
    
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      return respond(401, { error: 'Invalid credentials' });
    }
    
    // Return user data without password
    const { password: _, ...safeUser } = user;
    return respond(200, safeUser);
  }

  // Promotions API
  if (pathname === '/api/promotions' && req.method === 'GET') {
    const promotions = await readFileOrEmpty(PROMOS_FILE);
    return respond(200, promotions);
  }
  if (pathname === '/api/promotions' && req.method === 'POST') {
    const promotions = await readFileOrEmpty(PROMOS_FILE);
    const nextId = promotions.length > 0 ? Math.max(...promotions.map(p => p.id)) + 1 : 1;
    const newPromo = {
      id: nextId,
      ...body,
      createdAt: new Date().toISOString(),
    };
    promotions.push(newPromo);
    await writeFile(PROMOS_FILE, promotions);
    return respond(201, newPromo);
  }
  if (pathname.startsWith('/api/promotions/') && req.method === 'PATCH') {
    const idStr = pathname.split('/').pop();
    const id = Number(idStr);
    const promotions = await readFileOrEmpty(PROMOS_FILE);
    const idx = promotions.findIndex(p => p.id === id);
    if (idx < 0) return respond(404, { error: 'Promotion not found' });
    promotions[idx] = { ...promotions[idx], ...body };
    await writeFile(PROMOS_FILE, promotions);
    return respond(200, promotions[idx]);
  }
  if (pathname.startsWith('/api/promotions/') && req.method === 'DELETE') {
    const idStr = pathname.split('/').pop();
    const id = Number(idStr);
    let promotions = await readFileOrEmpty(PROMOS_FILE);
    const idx = promotions.findIndex(p => p.id === id);
    if (idx < 0) return respond(404, { error: 'Promotion not found' });
    promotions = promotions.filter(p => p.id !== id);
    await writeFile(PROMOS_FILE, promotions);
    return respond(200, { success: true });
  }

  // Applications API
  if (pathname.startsWith('/api/applications/trn/') && req.method === 'GET') {
    const trn = pathname.split('/').pop();
    const apps = await readFileOrEmpty(APPS_FILE);
    const appObj = apps.find(a => a.applicant && a.applicant.trn === trn);
    if (!appObj) return respond(404, { error: 'Application not found' });
    return respond(200, appObj);
  }
  if (pathname === '/api/applications' && req.method === 'GET') {
    const apps = await readFileOrEmpty(APPS_FILE);
    return respond(200, apps);
  }
  if (pathname.startsWith('/api/applications/') && req.method === 'GET') {
    const idStr = pathname.split('/').pop();
    const id = Number(idStr);
    const apps = await readFileOrEmpty(APPS_FILE);
    const appObj = apps.find(a => a.id === id);
    if (!appObj) return respond(404, { error: 'Application not found' });
    return respond(200, appObj);
  }
  if (pathname === '/api/applications' && req.method === 'POST') {
    const apps = await readFileOrEmpty(APPS_FILE);
    const nextId = apps.length > 0 ? Math.max(...apps.map(a => a.id)) + 1 : 1;
    const newApp = {
      id: nextId,
      createdAt: new Date().toISOString(),
      ...body,
    };
    if (body && body.attachments) {
      try {
        const saved = await saveAttachments(nextId, body.attachments);
        newApp.attachments = saved;
      } catch (err) {
        console.error('Error saving attachments for new application', err);
      }
    }
    if (!newApp.messages) newApp.messages = [];
    apps.push(newApp);
    await writeFile(APPS_FILE, apps);
    return respond(201, newApp);
  }
  if (pathname.startsWith('/api/applications/') && req.method === 'PATCH') {
    const idStr = pathname.split('/').pop();
    const id = Number(idStr);
    const apps = await readFileOrEmpty(APPS_FILE);
    const idx = apps.findIndex(a => a.id === id);
    if (idx < 0) return respond(404, { error: 'Application not found' });

    const existing = JSON.parse(JSON.stringify(apps[idx]));
    const { status, reason, reviewFlags } = body || {};
    if (status !== undefined) apps[idx].status = status;
    if (reason !== undefined) apps[idx].reason = reason;
    if (reviewFlags !== undefined) apps[idx].reviewFlags = reviewFlags;
    if (body && body.applicant !== undefined) {
      apps[idx].applicant = {
        ...apps[idx].applicant,
        ...body.applicant,
      };
    }
    if (body && body.selectedTermMonths !== undefined) {
      apps[idx].selectedTermMonths = body.selectedTermMonths;
    }
    if (body && body.attachments) {
      try {
        const saved = await saveAttachments(id, body.attachments);
        apps[idx].attachments = {
          ...(apps[idx].attachments || {}),
          ...saved,
        };
      } catch (err) {
        console.error('Error saving attachments on update', err);
      }
    }
    if (body && body.removeAttachments) {
      const remove = body.removeAttachments;
      apps[idx].attachments = apps[idx].attachments || {};
      if (remove.photoId && apps[idx].attachments.photoId) {
        try {
          const fullPath = path.join(UPLOADS_DIR, apps[idx].attachments.photoId.replace('/uploads/', ''));
          await fs.unlink(fullPath);
        } catch (err) {}
        delete apps[idx].attachments.photoId;
      }
      if (Array.isArray(remove.payslips) && Array.isArray(apps[idx].attachments.payslips)) {
        const remaining = [];
        for (const url of apps[idx].attachments.payslips) {
          if (remove.payslips.includes(url)) {
            try {
              const fullPath = path.join(UPLOADS_DIR, url.replace('/uploads/', ''));
              await fs.unlink(fullPath);
            } catch (err) {}
          } else {
            remaining.push(url);
          }
        }
        if (remaining.length > 0) {
          apps[idx].attachments.payslips = remaining;
        } else {
          delete apps[idx].attachments.payslips;
        }
      }
      if (apps[idx].attachments && Object.keys(apps[idx].attachments).length === 0) {
        delete apps[idx].attachments;
      }
    }
    if (body && body.newMessage && body.newMessage.text) {
      if (!apps[idx].messages) apps[idx].messages = [];
      apps[idx].messages.push({
        role: body.newMessage.role || 'applicant',
        text: body.newMessage.text,
        timestamp: new Date().toISOString(),
      });
    }
    await writeFile(APPS_FILE, apps);

    const changes = {};
    if (status !== undefined && existing.status !== apps[idx].status) {
      changes.status = { old: existing.status, new: apps[idx].status };
    }
    if (reason !== undefined && existing.reason !== apps[idx].reason) {
      changes.reason = { old: existing.reason, new: apps[idx].reason };
    }
    if (body && body.applicant !== undefined) {
      Object.keys(body.applicant).forEach(key => {
        const oldVal = existing.applicant ? existing.applicant[key] : undefined;
        const newVal = apps[idx].applicant ? apps[idx].applicant[key] : undefined;
        if (oldVal !== newVal) {
          if (!changes.applicant) changes.applicant = {};
          changes.applicant[key] = { old: oldVal, new: newVal };
        }
      });
    }
    if (body && body.selectedTermMonths !== undefined && existing.selectedTermMonths !== apps[idx].selectedTermMonths) {
      changes.selectedTermMonths = { old: existing.selectedTermMonths, new: apps[idx].selectedTermMonths };
    }
    if (reviewFlags !== undefined) {
      const oldFlags = existing.reviewFlags || {};
      const newFlags = apps[idx].reviewFlags || {};
      const flagChanges = {};
      const allFlagKeys = new Set([...Object.keys(oldFlags), ...Object.keys(newFlags)]);
      allFlagKeys.forEach(key => {
        const oldVal = !!oldFlags[key];
        const newVal = !!newFlags[key];
        if (oldVal !== newVal) {
          flagChanges[key] = { old: oldVal, new: newVal };
        }
      });
      if (Object.keys(flagChanges).length > 0) {
        changes.reviewFlags = flagChanges;
      }
    }
    if (Object.keys(changes).length > 0) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        applicationId: id,
        changes,
      };
      try {
        await fs.appendFile(APP_EDIT_LOG_FILE, JSON.stringify(logEntry) + '\n');
      } catch (err) {
        console.error('Error writing to log file', err);
      }
    }
    return respond(200, apps[idx]);
  }

  // Users API (remove passwords from response)
  if (pathname === '/api/users' && req.method === 'GET') {
    const users = await readFileOrEmpty(USERS_FILE);
    const safeUsers = users.map(user => {
      const { password, ...safeUser } = user;
      return safeUser;
    });
    return respond(200, safeUsers);
  }

  // Loans API
  if (pathname === '/api/loans' && req.method === 'GET') {
    const loans = await readFileOrEmpty(LOANS_FILE);
    return respond(200, loans);
  }

  // Parishes API
  if (pathname === '/api/parishes' && req.method === 'GET') {
    const parishes = await readFileOrEmpty(PARISHES_FILE);
    return respond(200, parishes);
  }

  respond(404, { error: 'Not found' });
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname);
  } else {
    await serveStatic(req, res, pathname);
  }
});

server.listen(PORT, () => {
  console.log(`Loan system server is listening on port ${PORT}`);
});