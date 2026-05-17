import crypto from "node:crypto";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const db = new Database(process.env.DATABASE_PATH || "./casino.sqlite");
const appOrigin = process.env.APP_ORIGIN || "http://localhost:8123";
const startingBalance = Number(process.env.STARTING_BALANCE || 1000);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 1000,
    wagered INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    best_win INTEGER NOT NULL DEFAULT 0,
    history_json TEXT NOT NULL DEFAULT '[]',
    verification_hash TEXT,
    verification_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

[
  "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 1000",
  "ALTER TABLE users ADD COLUMN wagered INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN won INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN best_win INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN history_json TEXT NOT NULL DEFAULT '[]'"
].forEach((sql) => {
  try {
    db.exec(sql);
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) throw error;
  }
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.maileroo.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.use(cors({ origin: appOrigin, credentials: false }));
app.use(express.json({ limit: "32kb" }));

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return {
    username: user.username,
    email: user.email,
    verified: Boolean(user.verified),
    isAdmin: Boolean(user.is_admin)
  };
}

function stateForUser(user) {
  return {
    balance: user.balance,
    wagered: user.wagered,
    won: user.won,
    gamesPlayed: user.games_played,
    bestWin: user.best_win,
    history: JSON.parse(user.history_json || "[]")
  };
}

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing session token." });

  const session = db.prepare(`
    SELECT sessions.*, users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(hashToken(token));

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: "Session expired. Log in again." });
  }

  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: "Admin account required." });
  next();
}

function assertCredentials(username, email, password) {
  if (!username || username.trim().length < 3) return "Username must be at least 3 characters.";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (!password || password.length < 4) return "Password must be at least 4 characters.";
  return "";
}

async function sendVerificationEmail(email, username, code) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`Verification code for ${email}: ${code}`);
    return;
  }

  await mailer.sendMail({
    from: process.env.SMTP_FROM || "Casino Simulator <no-reply@localhost>",
    to: email,
    subject: "Verify your Casino Simulator account",
    text: `Hi ${username}, your verification code is ${code}. It expires in 15 minutes.`,
    html: `<p>Hi ${username},</p><p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 15 minutes.</p>`
  });
}

function ensureAdminAccount() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !email || !password) return;

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  const { salt, hash } = hashPassword(password);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET email = ?, password_salt = ?, password_hash = ?, verified = 1, is_admin = 1
      WHERE id = ?
    `).run(email.toLowerCase(), salt, hash, existing.id);
    return;
  }

  db.prepare(`
    INSERT INTO users (username, email, password_salt, password_hash, verified, is_admin, balance)
    VALUES (?, ?, ?, ?, 1, 1, ?)
  `).run(username, email.toLowerCase(), salt, hash, startingBalance);
}

ensureAdminAccount();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const error = assertCredentials(username, email, password);
  if (error) return res.status(400).json({ error });

  const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(username, email);
  if (existing) return res.status(409).json({ error: "Username or email already exists." });

  const { salt, hash } = hashPassword(password);
  const code = String(crypto.randomInt(100000, 999999));
  const verificationHash = hashToken(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO users (username, email, password_salt, password_hash, balance, verification_hash, verification_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, email, salt, hash, startingBalance, verificationHash, expiresAt);

  await sendVerificationEmail(email, username, code);
  res.status(201).json({ ok: true, message: "Verification email sent." });
});

app.post("/api/verify-email", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.verified) return res.json({ ok: true, user: publicUser(user), state: stateForUser(user) });
  if (!user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: "Verification code expired. Register again for this test build." });
  }
  if (hashToken(code) !== user.verification_hash) return res.status(400).json({ error: "Invalid verification code." });

  db.prepare("UPDATE users SET verified = 1, verification_hash = NULL, verification_expires_at = NULL WHERE id = ?").run(user.id);
  res.json({ ok: true, user: { username: user.username, email: user.email, verified: true, isAdmin: Boolean(user.is_admin) } });
});

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "Wrong username or password." });

  const { hash } = hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) return res.status(401).json({ error: "Wrong username or password." });
  if (!user.verified) return res.status(403).json({ error: "Email is not verified yet." });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), user.id, expiresAt);
  res.json({ ok: true, token, user: publicUser(user), state: stateForUser(user) });
});

app.post("/api/state", requireAuth, (req, res) => {
  const state = req.body.state || {};
  const balance = Math.max(0, Math.floor(Number(state.balance) || 0));
  const wagered = Math.max(0, Math.floor(Number(state.wagered) || 0));
  const won = Math.max(0, Math.floor(Number(state.won) || 0));
  const gamesPlayed = Math.max(0, Math.floor(Number(state.gamesPlayed) || 0));
  const bestWin = Math.max(0, Math.floor(Number(state.bestWin) || 0));
  const history = Array.isArray(state.history) ? state.history.slice(0, 12) : [];

  db.prepare(`
    UPDATE users
    SET balance = ?, wagered = ?, won = ?, games_played = ?, best_win = ?, history_json = ?
    WHERE id = ?
  `).run(balance, wagered, won, gamesPlayed, bestWin, JSON.stringify(history), req.user.id);

  res.json({ ok: true });
});

app.post("/api/admin/summary", requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT username, email, verified, is_admin, balance, wagered, won, games_played, best_win, created_at
    FROM users
    ORDER BY created_at DESC
  `).all();
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS users,
      COALESCE(SUM(balance), 0) AS totalBalance,
      COALESCE(SUM(wagered), 0) AS totalWagered,
      COALESCE(SUM(won), 0) AS totalWon,
      COALESCE(SUM(games_played), 0) AS totalGames,
      COALESCE(MAX(best_win), 0) AS bestWin
    FROM users
  `).get();

  res.json({ ok: true, totals, users });
});

app.post("/api/admin/add-money", requireAuth, requireAdmin, (req, res) => {
  const username = String(req.body.username || "").trim();
  const amount = Math.floor(Number(req.body.amount) || 0);
  if (!username || amount <= 0) return res.status(400).json({ error: "Username and positive amount are required." });

  const result = db.prepare("UPDATE users SET balance = balance + ? WHERE username = ?").run(amount, username);
  if (!result.changes) return res.status(404).json({ error: "User not found." });

  const user = db.prepare("SELECT username, balance FROM users WHERE username = ?").get(username);
  res.json({ ok: true, user });
});

app.listen(port, () => {
  console.log(`Casino test backend listening on http://localhost:${port}`);
});
