CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  application_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_area TEXT NOT NULL,
  phone_mid TEXT NOT NULL,
  phone_last TEXT NOT NULL,
  phone_full TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT,
  parish TEXT,
  term_months INTEGER,
  promotion_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
