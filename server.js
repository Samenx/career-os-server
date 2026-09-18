require("dotenv").config();
const app = require("./app");
const pool = require("./db/database");
const migrate = require("./db/migrate");
const port = process.env.PORT || 5000;
(async () => {
  await migrate();
  const server = app.listen(port, () =>
    console.log(`Internship Tracker API: http://localhost:${port}`),
  );
  const stop = () => server.close(() => pool.end());
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
})().catch((error) => {
  console.error(
    "Could not initialize database. Check your database setup.",
    error.message,
  );
  pool.end();
  process.exitCode = 1;
});
