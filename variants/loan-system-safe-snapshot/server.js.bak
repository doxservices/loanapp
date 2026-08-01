#!/usr/bin/env bash
set -euo pipefail

# --- Resolve paths (run from anywhere) ---
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "Running setup for $(basename "$PROJECT_ROOT")..."

# --- Ensure Node is available ---
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or not on PATH."
  echo "Install Node 18+ and re-run: https://nodejs.org/"
  exit 1
fi

# --- Ensure directories ---
mkdir -p storage/data storage/uploads storage/logs

# --- Ensure JSON data files (if missing) ---
touch storage/data/.keep
for f in users.json promotions.json applications.json loans.json parishes.json sessions.json; do
  if [ ! -f "storage/data/$f" ]; then
    echo "[]" > "storage/data/$f"
    echo "Created storage/data/$f"
  else
    # If file exists but empty/whitespace, normalize to []
    if [ ! -s "storage/data/$f" ] || [ -z "$(grep -o '[^[:space:]]' "storage/data/$f" || true)" ]; then
      echo "[]" > "storage/data/$f"
      echo "Normalized empty storage/data/$f"
    fi
  fi
done

# --- Seed admin user if missing (pure Node; no dependencies) ---
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'storage', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function readJson(p, dflt) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; }
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// PBKDF2 hash (same params as server)
const HASH_ALGO = 'sha256';
const PBKDF2_ITER = 210000;
const KEYLEN = 64;
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(plain, salt, PBKDF2_ITER, KEYLEN, HASH_ALGO).toString('hex');
  return { algo: 'pbkdf2', iterations: PBKDF2_ITER, salt, hash };
}

const users = readJson(USERS_FILE, []);
const hasAdmin = users.some(u => String(u.email || '').toLowerCase() === 'admin@loanitfinancial.com');

if (!hasAdmin) {
  const nextId = (arr) => arr.length ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1;
  const admin = {
    id: nextId(users),
    name: 'Admin',
    email: 'admin@loanitfinancial.com',
    role: 'admin',
    createdAt: new Date().toISOString(),
    password: hashPassword('admin123')
  };
  users.push(admin);
  writeJson(USERS_FILE, users);
  console.log('Seeded admin@loanitfinancial.com');
} else {
  console.log('Admin already present; skipping seed.');
}
NODE

# --- Install dependencies only if needed ---
if [ -f package.json ]; then
  NEED_INSTALL="false"
  # If node_modules missing or empty, install
  if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null || true)" ]; then
    NEED_INSTALL="true"
  fi
  # If package-lock exists, prefer ci
  if [ "$NEED_INSTALL" = "true" ]; then
    if command -v npm >/dev/null 2>&1; then
      if [ -f package-lock.json ]; then
        echo "Installing dependencies (npm ci)..."
        npm ci || (echo "npm ci failed; falling back to npm install" && npm install)
      else
        echo "Installing dependencies (npm install)..."
        npm install
      fi
    else
      echo "WARNING: npm not found; skipping install (assuming no external deps)."
    fi
  else
    echo "Dependencies already installed; skipping."
  fi
else
  echo "No package.json found; assuming no external dependencies."
fi

# --- Start server (exec to replace shell; ctrl-c to stop) ---
echo "Starting server..."
exec node src/server.js
