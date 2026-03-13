import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./env.js";

let db;

function getDb() {
  if (db) return db;
  try {
    db = new DatabaseSync(getDbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        code TEXT PRIMARY KEY,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        sender_email TEXT,
        recipient_email TEXT,
        recipient_name TEXT,
        message TEXT,
        stripe_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        redeemed_by_session TEXT,
        redeemed_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    return db;
  } catch {
    console.warn("[gift-cards] SQLite unavailable, using in-memory");
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        code TEXT PRIMARY KEY,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        sender_email TEXT,
        recipient_email TEXT,
        recipient_name TEXT,
        message TEXT,
        stripe_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        redeemed_by_session TEXT,
        redeemed_at TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    return db;
  }
}

function generateCode() {
  // Format: GMT-XXXX-XXXX-XXXX (readable gift card code)
  const bytes = randomBytes(9);
  const hex = bytes.toString("hex").toUpperCase().slice(0, 12);
  return `GMT-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

const VALID_AMOUNTS = [25, 50, 75, 100];
const EXPIRY_DAYS = 365;

export function getValidAmounts() {
  return VALID_AMOUNTS;
}

/**
 * Creates a gift card after payment is confirmed.
 */
export function createGiftCard({
  amountEur,
  senderEmail,
  recipientEmail,
  recipientName,
  message,
  stripeSessionId,
}) {
  if (!VALID_AMOUNTS.includes(amountEur)) {
    return { ok: false, error: "invalid_amount" };
  }

  const database = getDb();
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  database.prepare(`
    INSERT INTO gift_cards (code, amount_cents, currency, sender_email, recipient_email, recipient_name, message, stripe_session_id, status, created_at, expires_at)
    VALUES (?, ?, 'EUR', ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    code,
    amountEur * 100,
    senderEmail || null,
    recipientEmail || null,
    recipientName || null,
    (message || "").slice(0, 500),
    stripeSessionId || null,
    now.toISOString(),
    expiresAt.toISOString()
  );

  return {
    ok: true,
    gift_card: {
      code,
      amount_eur: amountEur,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      expires_at: expiresAt.toISOString(),
    },
  };
}

/**
 * Validates a gift card code and returns its value.
 */
export function validateGiftCard(code) {
  if (!code || typeof code !== "string") return { ok: false, valid: false, error: "invalid_code" };

  const database = getDb();
  const row = database.prepare(
    `SELECT * FROM gift_cards WHERE code = ? LIMIT 1`
  ).get(code.toUpperCase().trim());

  if (!row) return { ok: true, valid: false, error: "not_found" };
  if (row.status === "redeemed") return { ok: true, valid: false, error: "already_redeemed" };
  if (row.status !== "active") return { ok: true, valid: false, error: "inactive" };

  const now = new Date();
  if (new Date(row.expires_at) < now) {
    return { ok: true, valid: false, error: "expired" };
  }

  return {
    ok: true,
    valid: true,
    amount_cents: row.amount_cents,
    amount_eur: row.amount_cents / 100,
    currency: row.currency,
    expires_at: row.expires_at,
  };
}

/**
 * Redeems a gift card (marks as used).
 */
export function redeemGiftCard(code, stripeSessionId) {
  const validation = validateGiftCard(code);
  if (!validation.ok || !validation.valid) return validation;

  const database = getDb();
  database.prepare(`
    UPDATE gift_cards SET status = 'redeemed', redeemed_by_session = ?, redeemed_at = ? WHERE code = ?
  `).run(stripeSessionId || null, new Date().toISOString(), code.toUpperCase().trim());

  return { ok: true, redeemed: true, amount_eur: validation.amount_eur };
}

/**
 * Lists gift cards for admin.
 */
export function listGiftCards({ limit = 50 } = {}) {
  const database = getDb();
  return database.prepare(
    `SELECT * FROM gift_cards ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

export function _resetGiftCardsForTests() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  db = undefined;
}
