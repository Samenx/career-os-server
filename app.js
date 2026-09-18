const express = require("express");
const cors = require("cors");
const app = express();
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
const { protectWrites, requireAuth } = require("./middleware/auth");
app.use("/api", protectWrites);
app.use("/api/auth", require("./routes/auth"));
app.use("/api", requireAuth, require("./routes/api"));
app.use((req, res) => res.status(404).json({ error: "Endpoint not found." }));
app.use((error, req, res, next) => {
  const messages = {
    23505: "A company with this name already exists.",
    23503: "A linked record no longer exists. Please refresh and try again.",
    23514:
      "Invalid status or relationship. Linked contacts and applications must belong to the same company; remove linked follow-ups before moving a record.",
    23502: "Please fill in all required fields.",
    22001: "A field is too long. Please shorten it.",
    "22P02": "Invalid record ID or field value.",
    22007: "Please enter a valid date.",
    22008: "Please enter a valid date.",
  };
  const status =
    error.status ||
    (messages[error.code] ? 400 : error.code === "LIMIT_FILE_SIZE" ? 413 : 500);
  if (status === 500) console.error(error);
  res.status(status).json({
    error:
      messages[error.code] ||
      (error.code === "LIMIT_FILE_SIZE"
        ? "CSV files must be smaller than 5 MB."
        : status < 500
          ? error.message
          : "Unable to complete the request. Check the database connection and try again."),
  });
});
module.exports = app;
