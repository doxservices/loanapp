// Loan Application API with viewer (ready-to-run)
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function buildPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  let sslOpt;
  try {
    const u = new URL(connectionString);
    sslOpt = (/\.render\.com$/i).test(u.hostname) ? { rejectUnauthorized: false } : false;
  } catch {
    sslOpt = process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false };
  }
  return new Pool({ connectionString, ssl: sslOpt });
}
const pool = buildPool();

function requireApiKey(req, res, next) {
  const k = process.env.API_KEY;
  if (!k) return next();
  if (req.get('x-api-key') === k) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

app.get('/health', async (_req, res) => {
  try { const r = await pool.query('SELECT 1 AS ok'); res.json({ ok: true, db: r.rows?.[0]?.ok === 1 }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/apply', requireApiKey, async (req, res) => {
  const b = req.body || {}; const clean = v => (typeof v === 'string' ? v.trim() : v);
  const d = { firstName: clean(b.firstName), lastName: clean(b.lastName), email: clean(b.email),
    phoneArea: clean(b.phoneArea) || clean(b['phone-area']), phoneMid: clean(b.phoneMid) || clean(b['phone-mid']), phoneLast: clean(b.phoneLast) || clean(b['phone-last']),
    addressLine1: clean(b.addressLine1), addressLine2: clean(b.addressLine2) || null, parish: clean(b.parish) || clean(b.parishSelect) || null,
    selectedTermMonths: b.selectedTermMonths ? parseInt(b.selectedTermMonths, 10) : null, promotionId: clean(b.promotionId) || clean(b.promoSelect) || null };
  for (const k of ['firstName','lastName','email','phoneArea','phoneMid','phoneLast','addressLine1']) { if (!d[k]) return res.status(400).json({ ok:false, error:`Missing required field: ${k}` }); }
  const id = `APP-${new Date().getFullYear()}-${Math.floor(1000+Math.random()*9000)}`; const phone = `(${d.phoneArea}) ${d.phoneMid}-${d.phoneLast}`;
  const sql = `insert into applications(application_id,first_name,last_name,email,phone_area,phone_mid,phone_last,phone_full,address1,address2,parish,term_months,promotion_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning application_id`;
  const p = [id,d.firstName,d.lastName,d.email,d.phoneArea,d.phoneMid,d.phoneLast,phone,d.addressLine1,d.addressLine2,d.parish,d.selectedTermMonths,d.promotionId];
  try { const r = await pool.query(sql, p); res.json({ ok: true, applicationId: r.rows[0].application_id }); }
  catch (e) { console.error('[DB] insert error:', e.message); res.status(500).json({ ok: false, error: 'Database insert failed' }); }
});

app.get('/applications', requireApiKey, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  try {
    const { rows } = await pool.query(`select application_id,first_name,last_name,email,phone_full,address1,address2,parish,term_months,promotion_id,created_at from applications order by id desc limit $1`, [limit]);
    res.json({ ok: true, rows });
  } catch (e) {
    console.error('[DB] select error:', e.message);
    res.status(500).json({ ok: false, error: 'Query failed' });
  }
});

app.use(express.static('public'));
app.use((_req, res) => res.status(404).json({ ok:false, error:'Not found' }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
