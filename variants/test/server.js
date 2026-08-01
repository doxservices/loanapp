// test/server.js
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());

const pool = new Pool({
  host: "dpg-d2ju9oumcj7s739ldva0-a.oregon-postgres.render.com",
  user: "loanit_db_user",
  password: "DyTClzWWK6c227SyBsRcWIU0VdbA7gFd", // replace with your DB password
  database: "loanit_db",
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

app.get("/applications", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM applications");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error querying database");
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

// Add this DELETE endpoint after your existing endpoints
app.delete('/applications/:id', requireApiKey, async (req, res) => {
  const applicationId = req.params.id;
  
  if (!applicationId) {
    return res.status(400).json({ ok: false, error: 'Application ID is required' });
  }
  
  try {
    const result = await pool.query(
      'DELETE FROM applications WHERE application_id = $1 RETURNING application_id',
      [applicationId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Application not found' });
    }
    
    res.json({ ok: true, deletedId: result.rows[0].application_id });
  } catch (e) {
    console.error('[DB] delete error:', e.message);
    res.status(500).json({ ok: false, error: 'Database delete failed' });
  }
});
