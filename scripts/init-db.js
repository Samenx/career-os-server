require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db/database");

async function main() {
  const fresh = process.argv.includes("--fresh");
  const sql = fs.readFileSync(
    path.join(__dirname, "../db/database.sql"),
    "utf8",
  );
  const client = await pool.connect();
  try {
    if (fresh) {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      console.log("Reset public schema.");
    }
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    console.log("Schema ready. Tables:", rows.map((row) => row.table_name).join(", "));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Could not initialize database:", error.message);
  process.exitCode = 1;
});
