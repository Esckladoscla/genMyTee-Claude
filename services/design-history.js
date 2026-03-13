import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./env.js";

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
    CREATE TABLE IF NOT EXISTS user_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      prompt TEXT NOT NULL,
      preview_url TEXT,
      production_url TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_designs_user ON user_designs(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_designs_session ON user_designs(session_id);
  `);

  return db;
}

export function saveDesign({ userId, sessionId, prompt, previewUrl, productionUrl }) {
  const database = ensureDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  database
    .prepare(
      "INSERT INTO user_designs (id, user_id, session_id, prompt, preview_url, production_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(id, userId || null, sessionId || null, prompt, previewUrl || null, productionUrl || null, now);

  return { id, created_at: now };
}

export function getUserDesigns(userId, { limit = 20, offset = 0 } = {}) {
  if (!userId) return [];
  const database = ensureDb();
  return database
    .prepare(
      "SELECT id, prompt, preview_url, created_at FROM user_designs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .all(userId, limit, offset);
}

export function getSessionDesigns(sessionId, { limit = 20, offset = 0 } = {}) {
  if (!sessionId) return [];
  const database = ensureDb();
  return database
    .prepare(
      "SELECT id, prompt, preview_url, created_at FROM user_designs WHERE session_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .all(sessionId, limit, offset);
}

export function linkDesignsToUser(sessionId, userId) {
  if (!sessionId || !userId) return;
  const database = ensureDb();
  const now = new Date().toISOString();
  database
    .prepare("UPDATE user_designs SET user_id = ? WHERE session_id = ? AND user_id IS NULL")
    .run(userId, sessionId);
}

export function getUserDesignCount(userId) {
  if (!userId) return 0;
  const database = ensureDb();
  const row = database
    .prepare("SELECT COUNT(*) AS total FROM user_designs WHERE user_id = ?")
    .get(userId);
  return Number(row?.total || 0);
}

export function _resetDesignHistoryForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
