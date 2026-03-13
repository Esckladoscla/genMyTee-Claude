import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_DISCOUNT_PCT = 10;

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS referral_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      visitor_session TEXT,
      visited_at TEXT NOT NULL,
      converted INTEGER NOT NULL DEFAULT 0,
      order_session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_referral_visits_code ON referral_visits(code);
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

function generateCode() {
  return randomBytes(4).toString("hex");
}

function getDiscountPct() {
  return getNumberEnv("REFERRAL_DISCOUNT_PCT", { defaultValue: DEFAULT_DISCOUNT_PCT });
}

/**
 * Create a referral code for an email. Returns existing code if one exists.
 */
export function createReferralCode(email) {
  if (!email || !email.includes("@")) {
    return { ok: false, error: "email_invalid" };
  }

  const database = ensureDb();
  const emailLower = email.toLowerCase().trim();

  // Check for existing code
  const existing = database
    .prepare("SELECT code FROM referral_codes WHERE email = ?")
    .get(emailLower);

  if (existing) {
    return { ok: true, code: existing.code, existing: true };
  }

  const code = generateCode();
  const now = new Date().toISOString();
  database
    .prepare("INSERT INTO referral_codes (code, email, created_at) VALUES (?, ?, ?)")
    .run(code, emailLower, now);

  return { ok: true, code, existing: false };
}

/**
 * Validate a referral code exists.
 */
export function validateReferralCode(code) {
  if (!code) return { valid: false };

  const database = ensureDb();
  const row = database
    .prepare("SELECT code, email FROM referral_codes WHERE code = ?")
    .get(code);

  if (!row) return { valid: false };

  return { valid: true, code: row.code, discount_pct: getDiscountPct() };
}

/**
 * Record a visit from a referred visitor.
 */
export function recordReferralVisit(code, visitorSession) {
  if (!code) return;

  const database = ensureDb();
  const now = new Date().toISOString();
  try {
    database
      .prepare("INSERT INTO referral_visits (code, visitor_session, visited_at) VALUES (?, ?, ?)")
      .run(code, visitorSession || null, now);
  } catch (_) {
    // Best-effort tracking
  }
}

/**
 * Mark a referral visit as converted (purchase completed).
 */
export function markReferralConverted(code, orderSessionId) {
  if (!code || !orderSessionId) return;

  const database = ensureDb();
  try {
    database
      .prepare(
        "UPDATE referral_visits SET converted = 1, order_session_id = ? WHERE code = ? AND converted = 0 AND order_session_id IS NULL LIMIT 1"
      )
      .run(orderSessionId, code);
  } catch (_) {
    // SQLite LIMIT in UPDATE may not work — fallback
    try {
      const row = database
        .prepare("SELECT id FROM referral_visits WHERE code = ? AND converted = 0 AND order_session_id IS NULL LIMIT 1")
        .get(code);
      if (row) {
        database
          .prepare("UPDATE referral_visits SET converted = 1, order_session_id = ? WHERE id = ?")
          .run(orderSessionId, row.id);
      }
    } catch (__) { /* best effort */ }
  }
}

/**
 * Get referral stats for a given email's code.
 */
export function getReferralStats(email) {
  if (!email) return { ok: false, error: "email_required" };

  const database = ensureDb();
  const emailLower = email.toLowerCase().trim();

  const codeRow = database
    .prepare("SELECT code FROM referral_codes WHERE email = ?")
    .get(emailLower);

  if (!codeRow) {
    return { ok: false, error: "no_referral_code" };
  }

  const code = codeRow.code;

  const visits = database
    .prepare("SELECT COUNT(*) as total FROM referral_visits WHERE code = ?")
    .get(code);

  const conversions = database
    .prepare("SELECT COUNT(*) as total FROM referral_visits WHERE code = ? AND converted = 1")
    .get(code);

  return {
    ok: true,
    code,
    visits: Number(visits.total),
    conversions: Number(conversions.total),
    discount_pct: getDiscountPct(),
  };
}

export function _resetReferralsForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
