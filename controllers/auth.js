const pool = require("../db/database");
const {
  passwordHash,
  checkPassword,
  hash,
  sessionToken,
  newSession,
  cookieName,
  cookieOptions,
} = require("../services/auth");
function credentials(body) {
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 8 ||
    password.length > 128
  ) {
    const error = new Error(
      "Enter a valid email and a password of 8–128 characters.",
    );
    error.status = 400;
    throw error;
  }
  return { email, password };
}
exports.signup = async (req, res) => {
  const { email, password } = credentials(req.body || {});
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100)
    return res
      .status(400)
      .json({ error: "Enter your name (up to 100 characters)." });
  const encoded = await passwordHash(password);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Serialize first-account setup so legacy records can only be claimed once.
    await db.query("SELECT pg_advisory_xact_lock(91818002)");
    const {
      rows: [counts],
    } = await db.query("SELECT count(*)::int AS total FROM users");
    const {
      rows: [user],
    } = await db.query(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name, email, encoded],
    );
    if (counts.total === 0)
      await db.query(
        "UPDATE companies SET owner_id=$1 WHERE owner_id IS NULL",
        [user.id],
      );
    const setCookie = await newSession(req, res, user.id, db);
    await db.query("COMMIT");
    setCookie();
    res.status(201).json({ user });
  } catch (error) {
    await db.query("ROLLBACK");
    if (error.code === "23505")
      return res.status(409).json({
        error: "An account with this email already exists. Log in instead.",
      });
    throw error;
  } finally {
    db.release();
  }
};
exports.login = async (req, res) => {
  const { email, password } = credentials(req.body || {});
  const {
    rows: [user],
  } = await pool.query(
    "SELECT id,name,email,password_hash FROM users WHERE email=$1",
    [email],
  );
  // Derive a hash even for an unknown email, avoiding a cheap user-existence timing signal.
  const valid = await checkPassword(
    password,
    user?.password_hash || "0".repeat(32) + ":" + "0".repeat(128),
  );
  if (!user || !valid)
    return res.status(401).json({ error: "Email or password is incorrect." });
  const setCookie = await newSession(req, res, user.id);
  setCookie();
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
};
exports.logout = async (req, res) => {
  const token = sessionToken(req);
  if (token)
    await pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      hash(token),
    ]);
  res.clearCookie(cookieName, cookieOptions());
  res.status(204).end();
};
exports.me = (req, res) => res.json({ user: req.user });
