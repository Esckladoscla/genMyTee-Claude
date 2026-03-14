import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_FREE_LIMIT = 3;
const DEFAULT_EMAIL_BONUS = 5;

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS session_generations (
      session_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;

  const addColumnSafe = (col, type) => {
    try { db?.exec(`ALTER TABLE session_generations ADD COLUMN ${col} ${type}`); }
    catch { /* column already exists */ }
  };

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(schema);
    addColumnSafe("ip_address", "TEXT");
    currentDbPath = dbPath;
  } catch (_) {
    db = new DatabaseSync(":memory:");
    db.exec(schema);
    currentDbPath = ":memory:";
  }

  return db;
}

function getFreeLimit() {
  return getNumberEnv("FREE_GENERATIONS_LIMIT", { defaultValue: DEFAULT_FREE_LIMIT });
}

function getEmailBonus() {
  return getNumberEnv("EMAIL_BONUS_GENERATIONS", { defaultValue: DEFAULT_EMAIL_BONUS });
}

export function generateSessionId() {
  return crypto.randomUUID();
}

export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const match = cookieHeader.match(/(?:^|;\s*)gmt_session=([^;]+)/);
  return match ? match[1].trim() : null;
}

export function buildSessionCookie(sessionId) {
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  return `gmt_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function ensureSession(sessionId, ipAddress) {
  const database = ensureDb();
  const now = new Date().toISOString();
  const existing = database
    .prepare("SELECT * FROM session_generations WHERE session_id = ?")
    .get(sessionId);

  if (existing) {
    // Update IP if not set or changed
    if (ipAddress && existing.ip_address !== ipAddress) {
      database
        .prepare("UPDATE session_generations SET ip_address = ?, updated_at = ? WHERE session_id = ?")
        .run(ipAddress, now, sessionId);
    }
    return database
      .prepare("SELECT * FROM session_generations WHERE session_id = ?")
      .get(sessionId);
  }

  database
    .prepare(
      "INSERT INTO session_generations (session_id, count, email, ip_address, created_at, updated_at) VALUES (?, 0, NULL, ?, ?, ?)"
    )
    .run(sessionId, ipAddress || null, now, now);

  return database
    .prepare("SELECT * FROM session_generations WHERE session_id = ?")
    .get(sessionId);
}

/**
 * Returns the total generation count across all sessions from the same IP.
 * This prevents cookie-clearing abuse: even with a fresh session cookie,
 * the IP-level count is carried over.
 */
function getIpGenerationCount(ipAddress) {
  if (!ipAddress) return 0;
  const database = ensureDb();
  const row = database
    .prepare("SELECT COALESCE(SUM(count), 0) AS total FROM session_generations WHERE ip_address = ?")
    .get(ipAddress);
  return Number(row?.total || 0);
}

export function checkGenerationAllowed(sessionId, ipAddress) {
  const session = ensureSession(sessionId, ipAddress);
  const freeLimit = getFreeLimit();
  const emailBonus = getEmailBonus();
  const hasEmail = Boolean(session.email);
  const maxAllowed = hasEmail ? freeLimit + emailBonus : freeLimit;
  const sessionCount = Number(session.count || 0);

  // Use the higher of session count or IP-aggregated count
  const ipCount = getIpGenerationCount(ipAddress);
  const effectiveCount = Math.max(sessionCount, ipCount);
  const remaining = Math.max(0, maxAllowed - effectiveCount);

  if (effectiveCount >= maxAllowed) {
    return {
      allowed: false,
      count: effectiveCount,
      limit: maxAllowed,
      remaining: 0,
      has_email: hasEmail,
      needs_email: !hasEmail,
    };
  }

  return {
    allowed: true,
    count: effectiveCount,
    limit: maxAllowed,
    remaining,
    has_email: hasEmail,
    needs_email: false,
  };
}

export function recordSessionGeneration(sessionId) {
  const database = ensureDb();
  ensureSession(sessionId);
  const now = new Date().toISOString();
  database
    .prepare("UPDATE session_generations SET count = count + 1, updated_at = ? WHERE session_id = ?")
    .run(now, sessionId);
}

export function unlockWithEmail(sessionId, email) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return { ok: false, error: "email_invalid" };
  }

  const database = ensureDb();
  ensureSession(sessionId);
  const now = new Date().toISOString();
  const trimmedEmail = email.trim().toLowerCase();

  database
    .prepare("UPDATE session_generations SET email = ?, updated_at = ? WHERE session_id = ?")
    .run(trimmedEmail, now, sessionId);

  // Also subscribe to newsletter (best-effort)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        email TEXT PRIMARY KEY,
        subscribed_at TEXT NOT NULL,
        source TEXT DEFAULT 'website'
      )
    `);
    const existing = database
      .prepare("SELECT email FROM newsletter_subscribers WHERE email = ?")
      .get(trimmedEmail);
    if (!existing) {
      database
        .prepare("INSERT INTO newsletter_subscribers (email, subscribed_at, source) VALUES (?, ?, 'generation_gate')")
        .run(trimmedEmail, now);
    }
  } catch (_) {
    /* best-effort newsletter subscribe */
  }

  const freeLimit = getFreeLimit();
  const emailBonus = getEmailBonus();
  const session = database
    .prepare("SELECT * FROM session_generations WHERE session_id = ?")
    .get(sessionId);
  const count = Number(session?.count || 0);
  const maxAllowed = freeLimit + emailBonus;

  return {
    ok: true,
    remaining: Math.max(0, maxAllowed - count),
    limit: maxAllowed,
  };
}

/**
 * Grant bonus generations to a session by reducing its count.
 * Used when a customer completes a purchase.
 */
export function grantSessionBonus(sessionId, bonus) {
  if (!sessionId || !bonus || bonus <= 0) return;
  const database = ensureDb();
  const now = new Date().toISOString();
  database
    .prepare("UPDATE session_generations SET count = MAX(0, count - ?), updated_at = ? WHERE session_id = ?")
    .run(bonus, now, sessionId);
}

/**
 * Find session ID associated with an email (from unlock flow).
 */
export function getSessionByEmail(email) {
  if (!email) return null;
  const database = ensureDb();
  const row = database
    .prepare("SELECT session_id FROM session_generations WHERE email = ? ORDER BY updated_at DESC LIMIT 1")
    .get(email.trim().toLowerCase());
  return row?.session_id || null;
}

export function getSessionStats() {
  const database = ensureDb();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS total_sessions,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) AS sessions_with_email,
        COALESCE(SUM(count), 0) AS total_generations,
        COUNT(DISTINCT ip_address) AS unique_ips
      FROM session_generations
    `)
    .get();
  return {
    total_sessions: Number(row.total_sessions),
    sessions_with_email: Number(row.sessions_with_email),
    total_generations: Number(row.total_generations),
    unique_ips: Number(row.unique_ips),
  };
}

export function _resetSessionLimiterForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
