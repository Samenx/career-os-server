-- Safe for existing databases: preserves all company and application records.
CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY,
 name VARCHAR(100) NOT NULL,
 email VARCHAR(255) NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 key CHAR(64) PRIMARY KEY,
 attempts INTEGER NOT NULL,
 reset_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS companies_owner_idx ON companies(owner_id);
DROP INDEX IF EXISTS companies_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS companies_owner_name_unique ON companies(owner_id,lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS companies_unclaimed_name_unique ON companies(lower(btrim(name))) WHERE owner_id IS NULL;
