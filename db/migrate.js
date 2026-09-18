const fs = require("node:fs");
const pool = require("./database");
module.exports = async function migrate() {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(91818001)");
    await db.query(
      fs.readFileSync(__dirname + "/migrations/001-accounts.sql", "utf8"),
    );
    await db.query(
      fs.readFileSync(__dirname + "/migrations/002-linkedin-connection.sql", "utf8"),
    );
    await db.query(
      fs.readFileSync(__dirname + "/migrations/003-linkedin-checkbox.sql", "utf8"),
    );
    await db.query(
      fs.readFileSync(__dirname + "/migrations/004-company-linkedin-checkbox.sql", "utf8"),
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
};
