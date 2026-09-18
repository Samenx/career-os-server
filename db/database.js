const { Pool, types } = require("pg");
// Keep calendar dates as YYYY-MM-DD, without timezone conversion.
types.setTypeParser(1082, (value) => value);
const connectionString =
  process.env.DB_URL || process.env["DB-URL"] || process.env.DATABASE_URL;
const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || "internship_tracker",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD,
      }),
  ...(process.env.DB_SSL === "true" ? { ssl: true } : {}),
});
module.exports = pool;
