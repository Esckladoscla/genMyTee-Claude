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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(schema);
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
  return `gmt_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function ensureSession(sessionId) {
  const database = ensureDb();
  const now = new Date().toISOString();
  const existing = database
    .prepare("SELECT * FROM session_generations WHERE session_id = ?")
    .get(sessionId);

  if (existing) return existing;

  database
    .prepare(
      "INSERT INTO session_generations (session_id, count, email, created_at, updated_at) VALUES (?, 0, NULL, ?, ?)"
    )
    .run(sessionId, now, now);

  return database
    .prepare("SELECT * FROM session_generations WHERE session_id = ?")
    .get(sessionId);
}

export function checkGenerationAllowed(sessionId) {
  const session = ensureSession(sessionId);
  const freeLimit = getFreeLimit();
  const emailBonus = getEmailBonus();
  const maxAllowed = session.email ? freeLimit + emailBonus : freeLimit;
  const count = Number(session.count || 0);
  const remaining = Math.max(0, maxAllowed - count);

  if (count >= maxAllowed) {
    return {
      allowed: false,
      count,
      limit: maxAllowed,
      remaining: 0,
      has_email: Boolean(session.email),
      needs_email: !session.email,
    };
  }

  return {
    allowed: true,
    count,
    limit: maxAllowed,
    remaining,
    has_email: Boolean(session.email),
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

export function _resetSessionLimiterForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
