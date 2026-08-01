#!/usr/bin/env bash
set -euo pipefail

# Run from script directory
cd "$(dirname "$0")"

echo "[setup] Ensuring Node deps..."
if [ ! -f package.json ]; then
  npm init -y >/dev/null 2>&1
fi

# Pin lightweight deps
if [ ! -d node_modules ]; then
  npm install express cors >/dev/null 2>&1
fi

echo "[setup] Seeding users (idempotent)..."
# ADMIN_EMAIL / ADMIN_PASSWORD envs may override defaults
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const file = path.join('storage','data','users.json');
const adminEmail = process.env.ADMIN_EMAIL || 'admin@loanitfinancial.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

let users = [];
try { users = JSON.parse(fs.readFileSync(file,'utf8')||'[]'); } catch(e) { users = []; }
const byEmail = (e) => users.find(u => u.email === e);
const nextId = () => users.length ? Math.max(...users.map(u => u.id || 0)) + 1 : 1;
const upsert = (u) => {
  const existing = byEmail(u.email);
  if (existing) Object.assign(existing, u);
  else users.push({ id: nextId(), ...u });
};
upsert({ name: 'Admin', email: adminEmail, role: 'admin', password: adminPassword });
upsert({ name: 'User',  email: 'user@example.com', role: 'applicant', password: 'password123' });

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(users, null, 2));
console.log('[setup] Users:', users.map(u => `${u.email}:${u.role}`).join(', '));
NODE

echo "[setup] Starting server..."
exec node server.js
