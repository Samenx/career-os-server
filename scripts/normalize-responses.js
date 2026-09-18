require("dotenv").config();
const pool = require("../db/database");
(async () => {
  try {
    const result = await pool.query(
      `UPDATE applications SET response='No Response',updated_at=CURRENT_TIMESTAMP WHERE lower(btrim(response))='no response' AND response IS DISTINCT FROM 'No Response' RETURNING id`,
    );
    console.log(
      `Normalized ${result.rowCount} existing application responses. No other fields changed.`,
    );
  } finally {
    await pool.end();
  }
})().catch(() => {
  console.error(
    "Could not connect to the configured database. Check server/.env.",
  );
  process.exitCode = 1;
});
