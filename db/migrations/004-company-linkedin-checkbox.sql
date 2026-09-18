-- NULL preserves the existing application-derived status until a company
-- is explicitly edited. Both true and false are independent company choices.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS applied_through_linkedin BOOLEAN;
