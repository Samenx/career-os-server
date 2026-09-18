ALTER TABLE applications
    DROP CONSTRAINT IF EXISTS applications_application_method_check;
ALTER TABLE applications
    ADD CONSTRAINT applications_application_method_check
    CHECK (application_method IN (
        'Email', 'LinkedIn', 'LinkedIn Connection',
        'Company Website', 'Referral', 'Other'
    ));
