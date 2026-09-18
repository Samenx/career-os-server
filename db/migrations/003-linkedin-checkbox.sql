ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS applied_through_linkedin BOOLEAN NOT NULL DEFAULT false;

UPDATE applications
SET application_method = 'LinkedIn', applied_through_linkedin = true
WHERE application_method = 'LinkedIn Connection';

ALTER TABLE applications
    DROP CONSTRAINT IF EXISTS applications_application_method_check;
ALTER TABLE applications
    ADD CONSTRAINT applications_application_method_check
    CHECK (application_method IN ('Email', 'LinkedIn', 'Company Website', 'Referral', 'Other'));
