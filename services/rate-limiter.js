import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_MAX_PER_IP = 10;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let db;
let currentDbPath;
let cleanupTimer;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rl_ip_time ON rate_limit_hits (ip, created_at_ms);
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

function getMaxPerIp() {
  return getNumberEnv("RATE_LIMIT_MAX_PER_IP", { defaultValue: DEFAULT_MAX_PER_IP });
}

function getWindowMs() {
  return getNumberEnv("RATE_LIMIT_WINDOW_MS", { defaultValue: DEFAULT_WINDOW_MS });
}

export function consumeRateLimit(ip) {
  const database = ensureDb();
  const maxPerIp = getMaxPerIp();
  const windowMs = getWindowMs();
  const now = Date.now();
  const cutoff = now - windowMs;

  const row = database
    .prepare("SELECT COUNT(*) as cnt FROM rate_limit_hits WHERE ip = ? AND created_at_ms > ?")
    .get(ip, cutoff);
  const count = Number(row?.cnt || 0);

  if (count >= maxPerIp) {
    const oldest = database
      .prepare(
        "SELECT MIN(created_at_ms) as oldest FROM rate_limit_hits WHERE ip = ? AND created_at_ms > ?"
      )
      .get(ip, cutoff);
    const retryAfterMs = Math.max(1, windowMs - (now - Number(oldest?.oldest || now)));
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  database
    .prepare("INSERT INTO rate_limit_hits (ip, created_at_ms) VALUES (?, ?)")
    .run(ip, now);

  return {
    limited: false,
    remaining: maxPerIp - count - 1,
    retryAfterSeconds: 0,
  };
}

export function cleanupExpiredHits() {
  try {
    const database = ensureDb();
    const windowMs = getWindowMs();
    const cutoff = Date.now() - windowMs;
    const result = database
      .prepare("DELETE FROM rate_limit_hits WHERE created_at_ms <= ?")
      .run(cutoff);
    return result.changes || 0;
  } catch (_) {
    return 0;
  }
}

export function startCleanupSchedule() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredHits, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

export function _resetRateLimiterForTests() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
