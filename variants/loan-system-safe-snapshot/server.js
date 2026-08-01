/**
 * Minimal API server with default admin bootstrap.
 * Start: node server.js
 */
const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage
const DATA_DIR = path.join(__dirname, 'storage', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure default admin exists (idempotent)
async function ensureAdminExists() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let users = [];
    try {
      const text = await fs.readFile(USERS_FILE, 'utf8');
      users = JSON.parse(text || '[]');
    } catch (e) {
      users = [];
    }
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@loanitfinancial.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    let admin = users.find(u => u.role === 'admin' && u.email === adminEmail);
    if (!admin) {
      const nextId = users.length > 0 ? Math.max(...users.map(u => u.id || 0)) + 1 : 1;
      admin = { id: nextId, name: 'Admin', email: adminEmail, role: 'admin', password: adminPassword };
      await fs.writeFile(USERS_FILE, JSON.stringify([...users, admin], null, 2));
      console.log(`[bootstrap] Seeded default admin ${adminEmail}`);
    } else {
      // Keep password in sync with env on startup
      if (adminPassword && admin.password !== adminPassword) {
        admin.password = adminPassword;
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
        console.log('[bootstrap] Updated admin password from env');
      }
    }
  } catch (err) {
    console.error('Failed to ensure default admin:', err);
  }
}
ensureAdminExists();

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Auth: POST /api/auth { email, password }
app.post('/api/auth', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const text = await fs.readFile(USERS_FILE, 'utf8').catch(() => '[]');
    const users = JSON.parse(text || '[]');
    const match = users.find(u => u.email === email && u.password === password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const { password: _, ...safe } = match;
    res.json(safe);
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Static: serve index.html for quick manual testing
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
