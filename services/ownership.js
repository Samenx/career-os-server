const pool = require("../db/database");
function ownerCondition(table, alias, parameter) {
  return table === "companies"
    ? `${alias}.owner_id=${parameter}`
    : `${alias}.company_id IN (SELECT id FROM companies WHERE owner_id=${parameter})`;
}
async function requireCompany(id, userId, db = pool) {
  const result = await db.query(
    "SELECT id FROM companies WHERE id=$1 AND owner_id=$2",
    [id, userId],
  );
  if (!result.rowCount) {
    const error = new Error("Company not found.");
    error.status = 404;
    throw error;
  }
}
module.exports = { ownerCondition, requireCompany };
