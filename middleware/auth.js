const pool = require("../db/database");
const {
  hash,
  sessionToken,
  cookieName,
  cookieOptions,
  duration,
} = require("../services/auth");
async function requireAuth(req, res, next) {
  const token = sessionToken(req);
  if (!token)
    return res.status(401).json({ error: "Please log in to continue." });
  const { rows } = await pool.query(
    "SELECT u.id,u.name,u.email,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP",
    [hash(token)],
  );
  if (!rows.length)
    return res
      .status(401)
      .json({ error: "Your session has expired. Please log in again." });
  const { expires_at, ...user } = rows[0];
  // Renew only active sessions, including existing seven-day sessions. Never revive expired tokens.
  if (
    new Date(expires_at).getTime() - Date.now() <
    duration - 24 * 60 * 60 * 1000
  ) {
    const expiresAt = new Date(Date.now() + duration);
    const renewed = await pool.query(
      "UPDATE auth_sessions SET expires_at=$2 WHERE token_hash=$1 AND expires_at>CURRENT_TIMESTAMP RETURNING token_hash",
      [hash(token), expiresAt],
    );
    if (!renewed.rowCount)
      return res.status(401).json({ error: "Please log in to continue." });
    res.cookie(cookieName, token, { ...cookieOptions(), expires: expiresAt });
  }
  req.user = user;
  res.set("Cache-Control", "no-store");
  next();
}
function protectWrites(req, res, next) {
  res.set("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  if (
    req.get("X-Requested-With") !== "InternshipTracker" ||
    (req.get("Origin") && req.get("Origin") !== origin)
  )
    return res
      .status(403)
      .json({ error: "Request not allowed. Refresh the app and try again." });
  next();
}
async function limitAuth(req, res, next) {
  const {
    rows: [limit],
  } = await pool.query(
    `INSERT INTO auth_rate_limits(key,attempts,reset_at) VALUES($1,1,CURRENT_TIMESTAMP+INTERVAL '15 minutes')
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.reset_at<CURRENT_TIMESTAMP THEN 1 ELSE auth_rate_limits.attempts+1 END,
 reset_at=CASE WHEN auth_rate_limits.reset_at<CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP+INTERVAL '15 minutes' ELSE auth_rate_limits.reset_at END RETURNING attempts`,
    [hash(req.ip || "local")],
  );
  if (limit.attempts > 30) {
    res.set("Retry-After", "900");
    return res
      .status(429)
      .json({ error: "Too many login attempts. Try again in 15 minutes." });
  }
  next();
}
module.exports = { requireAuth, protectWrites, limitAuth };
