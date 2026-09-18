// Company aliases are internal SQL identifiers, never user input.
const followUpSent = (company) => `(${company}.follow_up_sent OR EXISTS(
  SELECT 1 FROM follow_ups f WHERE f.company_id=${company}.id AND f.status='Completed'
))`;
const needsFollowUp = (company) => `(
  (${company}.application_status<>'Not Applied' OR EXISTS(
    SELECT 1 FROM applications a WHERE a.company_id=${company}.id
  )) AND NOT ${followUpSent(company)}
)`;
module.exports = { followUpSent, needsFollowUp };
