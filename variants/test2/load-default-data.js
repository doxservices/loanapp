const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load default data from JSON file
const defaultData = JSON.parse(fs.readFileSync(path.join(__dirname, 'default-applications.json'), 'utf8'));

// Database connection setup (same as server.js)
function buildPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  
  let sslOpt;
  try {
    const { URL } = require('url');
    const u = new URL(connectionString);
    sslOpt = (/\.render\.com$/i).test(u.hostname) ? { rejectUnauthorized: false } : false;
  } catch {
    sslOpt = process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false };
  }
  
  return new Pool({ connectionString, ssl: sslOpt });
}

const pool = buildPool();

async function loadDefaultData() {
  const client = await pool.connect();
  
  try {
    console.log('Starting to load default data...');
    
    // Begin transaction
    await client.query('BEGIN');
    
    // Check if applications table is empty
    const result = await client.query('SELECT COUNT(*) FROM applications');
    const rowCount = parseInt(result.rows[0].count, 10);
    
    if (rowCount > 0) {
      console.log(`Applications table already has ${rowCount} records. Skipping data loading.`);
      await client.query('ROLLBACK');
      return;
    }
    
    // Insert each application
    for (const application of defaultData) {
      const query = `
        INSERT INTO applications (
          application_id, first_name, last_name, email, 
          phone_area, phone_mid, phone_last, phone_full,
          address1, address2, parish, term_months, promotion_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `;
      
      const values = [
        application.application_id,
        application.first_name,
        application.last_name,
        application.email,
        application.phone_area,
        application.phone_mid,
        application.phone_last,
        application.phone_full,
        application.address1,
        application.address2,
        application.parish,
        application.term_months,
        application.promotion_id,
        application.created_at
      ];
      
      await client.query(query, values);
      console.log(`Inserted application: ${application.application_id}`);
    }
    
    // Commit transaction
    await client.query('COMMIT');
    console.log('Successfully loaded default data!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error loading default data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the script
loadDefaultData()
  .then(() => {
    console.log('Data loading completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Data loading failed:', error);
    process.exit(1);
  });