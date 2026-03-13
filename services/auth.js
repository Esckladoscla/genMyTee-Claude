import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getEnv, getBooleanEnv, getNumberEnv } from "./env.js";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SESSION_MAX_AGE_DAYS = 30;
const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_CODE_EXPIRY_MINUTES = 30;
const AUTH_GENERATIONS_LIMIT = 15;

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    currentDbPath = dbPath;
  } catch (_) {
    db = new DatabaseSync(":memory:");
    currentDbPath = ":memory:";
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      google_id TEXT,
      avatar_url TEXT,
      generation_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS email_verifications (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email);
  `);

  return db;
}

// --- Password hashing ---

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  });
  return `${salt}:${derived.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  });
  const hashBuf = Buffer.from(hash, "hex");
  const derivedBuf = derived;
  if (hashBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, derivedBuf);
}

// --- Session management ---

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createSession(userId) {
  const database = ensureDb();
  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  database
    .prepare("INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now.toISOString(), expires.toISOString());
  return { token, expires_at: expires.toISOString() };
}

export function buildAuthCookie(token) {
  const maxAge = SESSION_MAX_AGE_DAYS * 24 * 60 * 60;
  return `gmt_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearAuthCookie() {
  return "gmt_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function parseAuthCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const match = cookieHeader.match(/(?:^|;\s*)gmt_auth=([^;]+)/);
  return match ? match[1].trim() : null;
}

export function validateSession(token) {
  if (!token) return null;
  const database = ensureDb();
  const session = database
    .prepare("SELECT * FROM auth_sessions WHERE token = ?")
    .get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    database.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    return null;
  }
  const user = database
    .prepare("SELECT id, email, name, email_verified, google_id, avatar_url, generation_count, created_at FROM users WHERE id = ?")
    .get(session.user_id);
  return user || null;
}

// --- User registration ---

export function registerUser(email, password, name) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "email_invalid" };
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return { ok: false, error: "password_too_short" };
  }

  const database = ensureDb();
  const trimmedEmail = email.trim().toLowerCase();
  const existing = database
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(trimmedEmail);
  if (existing) {
    return { ok: false, error: "email_exists" };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);

  database
    .prepare(
      "INSERT INTO users (id, email, password_hash, name, email_verified, generation_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)"
    )
    .run(id, trimmedEmail, passwordHash, name || null, now, now);

  const session = createSession(id);
  return {
    ok: true,
    user: { id, email: trimmedEmail, name: name || null, email_verified: false },
    session,
  };
}

// --- User login ---

export function loginUser(email, password) {
  if (!email || !password) {
    return { ok: false, error: "credentials_required" };
  }

  const database = ensureDb();
  const trimmedEmail = email.trim().toLowerCase();
  const user = database
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(trimmedEmail);

  if (!user) {
    return { ok: false, error: "invalid_credentials" };
  }

  if (!user.password_hash) {
    // User registered via Google, no password set
    return { ok: false, error: "use_google_login" };
  }

  if (!verifyPassword(password, user.password_hash)) {
    return { ok: false, error: "invalid_credentials" };
  }

  const session = createSession(user.id);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      email_verified: Boolean(user.email_verified),
      avatar_url: user.avatar_url,
    },
    session,
  };
}

// --- Logout ---

export function logoutSession(token) {
  if (!token) return;
  const database = ensureDb();
  database.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
}

// --- Email verification ---

export function generateVerificationCode(email) {
  if (!email) return { ok: false, error: "email_required" };
  const database = ensureDb();
  const trimmedEmail = email.trim().toLowerCase();

  // Clean expired codes
  database
    .prepare("DELETE FROM email_verifications WHERE expires_at < ?")
    .run(new Date().toISOString());

  const code = String(crypto.randomInt(100000, 999999));
  const now = new Date();
  const expires = new Date(now.getTime() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

  database
    .prepare("INSERT INTO email_verifications (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(trimmedEmail, code, expires.toISOString(), now.toISOString());

  return { ok: true, code, expires_at: expires.toISOString() };
}

export function verifyEmailCode(email, code) {
  if (!email || !code) return { ok: false, error: "code_required" };
  const database = ensureDb();
  const trimmedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();

  const record = database
    .prepare("SELECT * FROM email_verifications WHERE email = ? AND code = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(trimmedEmail, String(code).trim(), now);

  if (!record) {
    return { ok: false, error: "invalid_or_expired_code" };
  }

  // Mark email as verified
  database
    .prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE email = ?")
    .run(now, trimmedEmail);

  // Clean up verification codes for this email
  database
    .prepare("DELETE FROM email_verifications WHERE email = ?")
    .run(trimmedEmail);

  return { ok: true };
}

// --- Google OAuth ---

export function getGoogleOAuthConfig() {
  const clientId = getEnv("GOOGLE_CLIENT_ID", { defaultValue: "" });
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET", { defaultValue: "" });
  const redirectUri = getEnv("GOOGLE_REDIRECT_URI", {
    defaultValue: "https://genmytee.com/api/auth/google/callback",
  });
  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function getGoogleAuthUrl() {
  const config = getGoogleOAuthConfig();
  if (!config.enabled) return null;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function handleGoogleCallback(code) {
  const config = getGoogleOAuthConfig();
  if (!config.enabled) return { ok: false, error: "google_not_configured" };

  // Exchange code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return { ok: false, error: "google_token_exchange_failed" };
  }

  const tokens = await tokenResponse.json();

  // Get user info
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return { ok: false, error: "google_userinfo_failed" };
  }

  const googleUser = await userInfoResponse.json();
  const { id: googleId, email, name, picture } = googleUser;

  if (!email) {
    return { ok: false, error: "google_no_email" };
  }

  const database = ensureDb();
  const trimmedEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();

  // Check if user exists by Google ID or email
  let user = database
    .prepare("SELECT * FROM users WHERE google_id = ?")
    .get(String(googleId));

  if (!user) {
    user = database
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(trimmedEmail);

    if (user) {
      // Link Google to existing account
      database
        .prepare("UPDATE users SET google_id = ?, avatar_url = ?, email_verified = 1, updated_at = ? WHERE id = ?")
        .run(String(googleId), picture || null, now, user.id);
    } else {
      // Create new user
      const id = crypto.randomUUID();
      database
        .prepare(
          "INSERT INTO users (id, email, password_hash, name, email_verified, google_id, avatar_url, generation_count, created_at, updated_at) VALUES (?, ?, NULL, ?, 1, ?, ?, 0, ?, ?)"
        )
        .run(id, trimmedEmail, name || null, String(googleId), picture || null, now, now);
      user = { id, email: trimmedEmail, name: name || null };
    }
  }

  const session = createSession(user.id);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email || trimmedEmail,
      name: user.name || name,
      email_verified: true,
      avatar_url: user.avatar_url || picture,
    },
    session,
  };
}

// --- Auth-based generation limit ---

export function getAuthGenerationLimit() {
  return getNumberEnv("AUTH_GENERATIONS_LIMIT", { defaultValue: AUTH_GENERATIONS_LIMIT });
}

export function getUserGenerationCount(userId) {
  const database = ensureDb();
  const user = database
    .prepare("SELECT generation_count FROM users WHERE id = ?")
    .get(userId);
  return user ? Number(user.generation_count) : 0;
}

export function incrementUserGenerationCount(userId) {
  const database = ensureDb();
  const now = new Date().toISOString();
  database
    .prepare("UPDATE users SET generation_count = generation_count + 1, updated_at = ? WHERE id = ?")
    .run(now, userId);
}

// --- Link session to user ---

export function linkSessionToUser(sessionId, userId) {
  // When a user registers/logs in, link their anonymous session's generation count
  const database = ensureDb();
  try {
    const session = database
      .prepare("SELECT count FROM session_generations WHERE session_id = ?")
      .get(sessionId);
    if (session && session.count > 0) {
      database
        .prepare("UPDATE users SET generation_count = generation_count + ? WHERE id = ?")
        .run(session.count, userId);
    }
  } catch (_) {
    // Best-effort — session_generations table might not exist yet
  }
}

// --- Admin stats ---

export function getUserStats() {
  const database = ensureDb();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS total_users,
        COUNT(CASE WHEN email_verified = 1 THEN 1 END) AS verified_users,
        COUNT(CASE WHEN google_id IS NOT NULL THEN 1 END) AS google_users,
        COALESCE(SUM(generation_count), 0) AS total_generations
      FROM users
    `)
    .get();
  return {
    total_users: Number(row.total_users),
    verified_users: Number(row.verified_users),
    google_users: Number(row.google_users),
    total_generations: Number(row.total_generations),
  };
}

// --- Test helpers ---

export function _resetAuthForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
