-- Creates missing objects and preserves existing rows when rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS companies (
 id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL CHECK (btrim(name) <> ''),
 description TEXT, category VARCHAR(100), website VARCHAR(500), linkedin_url VARCHAR(500),
 directory_profile_url VARCHAR(500), general_email VARCHAR(255), careers_email VARCHAR(255),
 phone VARCHAR(100), location VARCHAR(255), notes TEXT,
 application_status VARCHAR(50) NOT NULL DEFAULT 'Not Applied' CHECK (application_status IN ('Not Applied','Applied','Interview','Accepted','Rejected')),
 application_date DATE, response VARCHAR(50) NOT NULL DEFAULT 'No Response' CHECK (response IN ('No Response','Responded','Interview','Rejected','Accepted')),
 follow_up_sent BOOLEAN NOT NULL DEFAULT false, follow_up_date DATE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS companies_application_date_idx ON companies(application_date);
CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(application_status);
CREATE TABLE IF NOT EXISTS contacts (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name VARCHAR(255) NOT NULL CHECK (btrim(name) <> ''), job_title VARCHAR(255),
 contact_type VARCHAR(50) NOT NULL DEFAULT 'Other' CHECK (contact_type IN ('CEO / Founder','HR / Recruiter','Technical Lead','Employee','Other')),
 email VARCHAR(255), phone VARCHAR(100), linkedin_url VARCHAR(500), notes TEXT,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 position VARCHAR(255), application_date DATE, application_method VARCHAR(50) CHECK (application_method IN ('Email','LinkedIn','Company Website','Referral','Other')),
 status VARCHAR(50) NOT NULL DEFAULT 'Applied' CHECK (status IN ('Applied','Under Review','Interview','Technical Interview','Offer','Accepted','Rejected','Withdrawn')),
 response TEXT, notes TEXT, follow_up_date DATE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS follow_ups (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
 follow_up_date DATE NOT NULL, status VARCHAR(50) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed','Cancelled')),
 notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS company_notes (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 note TEXT NOT NULL CHECK (btrim(note) <> ''), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts(company_id);
CREATE INDEX IF NOT EXISTS applications_company_idx ON applications(company_id);
CREATE INDEX IF NOT EXISTS applications_date_idx ON applications(application_date);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
CREATE INDEX IF NOT EXISTS follow_ups_company_idx ON follow_ups(company_id);
CREATE INDEX IF NOT EXISTS follow_ups_application_idx ON follow_ups(application_id);
CREATE INDEX IF NOT EXISTS follow_ups_contact_idx ON follow_ups(contact_id);
CREATE INDEX IF NOT EXISTS follow_ups_date_idx ON follow_ups(follow_up_date);
CREATE INDEX IF NOT EXISTS notes_company_idx ON company_notes(company_id);
-- Enforce relationship consistency even for direct database writes.
CREATE OR REPLACE FUNCTION validate_follow_up_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.application_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM applications WHERE id=NEW.application_id AND company_id=NEW.company_id) THEN
 RAISE EXCEPTION 'Application must belong to the selected company' USING ERRCODE='23514'; END IF;
 IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id=NEW.contact_id AND company_id=NEW.company_id) THEN
 RAISE EXCEPTION 'Contact must belong to the selected company' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS follow_up_company ON follow_ups;
CREATE TRIGGER follow_up_company BEFORE INSERT OR UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION validate_follow_up_company();
CREATE OR REPLACE FUNCTION prevent_linked_company_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.company_id <> OLD.company_id THEN
 IF TG_TABLE_NAME='applications' THEN
 IF EXISTS(SELECT 1 FROM follow_ups WHERE application_id=OLD.id) THEN RAISE EXCEPTION 'Remove linked follow-ups before changing company' USING ERRCODE='23514'; END IF;
 ELSE
 IF EXISTS(SELECT 1 FROM follow_ups WHERE contact_id=OLD.id) THEN RAISE EXCEPTION 'Remove linked follow-ups before changing company' USING ERRCODE='23514'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS applications_company_change ON applications;
CREATE TRIGGER applications_company_change BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION prevent_linked_company_change();
DROP TRIGGER IF EXISTS contacts_company_change ON contacts;
CREATE TRIGGER contacts_company_change BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION prevent_linked_company_change();
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

COMMIT;
