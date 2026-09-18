const pool = require("../db/database");
module.exports = async (req, res) => {
  const {
    rows: [counts],
  } = await pool.query(
    `WITH companies AS (SELECT * FROM public.companies WHERE owner_id=$1),
 applications AS (SELECT a.* FROM public.applications a JOIN companies c ON c.id=a.company_id),
 follow_ups AS (SELECT f.* FROM public.follow_ups f JOIN companies c ON c.id=f.company_id)
 SELECT
 (SELECT count(*)::int FROM companies) AS "totalCompanies",
 (SELECT count(*)::int FROM applications) AS "totalApplications",
 (SELECT count(*)::int FROM companies c WHERE c.application_status<>'Not Applied' OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id)) AS applied,
 (SELECT count(*)::int FROM companies c WHERE c.application_status='Not Applied' AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id)) AS "notApplied",
 (SELECT count(*)::int FROM follow_ups WHERE status='Pending') AS "pendingFollowUps",
 (SELECT count(*)::int FROM companies c WHERE lower(btrim(coalesce(c.response,''))) NOT IN ('','no response') OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id AND lower(btrim(coalesce(a.response,''))) NOT IN ('','no response'))) AS "responsesReceived",
 (SELECT count(*)::int FROM companies c WHERE c.application_status='Interview' OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id AND a.status IN ('Interview','Technical Interview'))) AS interviews,
 (SELECT count(*)::int FROM companies c WHERE c.application_status='Accepted' OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id AND a.status='Accepted')) AS accepted,
 (SELECT count(*)::int FROM companies c WHERE c.application_status='Rejected' OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=c.id AND a.status='Rejected')) AS rejected`,
    [req.user.id],
  );
  const recent = await pool.query(
    "SELECT a.*,c.name AS company_name FROM applications a JOIN companies c ON c.id=a.company_id WHERE c.owner_id=$1 ORDER BY a.application_date DESC NULLS LAST,a.id DESC LIMIT 8",
    [req.user.id],
  );
  const upcoming = await pool.query(
    `SELECT f.*,c.name AS company_name,(SELECT max(done.follow_up_date) FROM follow_ups done WHERE done.company_id=c.id AND done.status='Completed') AS last_contact FROM follow_ups f JOIN companies c ON c.id=f.company_id WHERE f.status='Pending' AND c.owner_id=$1 ORDER BY f.follow_up_date LIMIT 8`,
    [req.user.id],
  );
  res.json({
    ...counts,
    recentApplications: recent.rows,
    upcomingFollowUps: upcoming.rows,
  });
};
