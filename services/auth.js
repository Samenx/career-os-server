const {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const pool = require("../db/database");
const cookieName = "internship_session";
// Remember this browser for 90 days; active sessions renew once per day.
const duration = 90 * 24 * 60 * 60 * 1000;
const cookieOptions = () => ({
  httpOnly: true,
  // The deployed frontend and API can be on separate sites.
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  const key = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString("hex")}`;
}
async function checkPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const actual = (await passwordHash(password, salt)).split(":")[1];
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}
function sessionToken(req) {
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + "="));
  const value = cookie?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(value || "") ? value : null;
}
async function newSession(req, res, userId, db = pool) {
  const previous = sessionToken(req);
  if (previous)
    await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      hash(previous),
    ]);
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hash(token), userId, new Date(Date.now() + duration)],
  );
  // Remove expired sessions without affecting active logins.
  await db.query(
    "DELETE FROM auth_sessions WHERE expires_at<CURRENT_TIMESTAMP",
  );
  return () =>
    res.cookie(cookieName, token, { ...cookieOptions(), maxAge: duration });
}
module.exports = {
  passwordHash,
  checkPassword,
  hash,
  sessionToken,
  newSession,
  cookieName,
  cookieOptions,
  duration,
};
