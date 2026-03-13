import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_ALERT_THRESHOLD = 50;

// In-memory cache (fast path for alerting within the current process)
let currentHourBucket = null;
let currentHourCount = 0;
let alertedThisHour = false;

// SQLite persistence (survives restarts)
let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS generation_tracker (
      hour_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      alerted INTEGER NOT NULL DEFAULT 0,
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

function getCurrentHourKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function getThreshold() {
  return getNumberEnv("GENERATION_ALERT_THRESHOLD_PER_HOUR", {
    defaultValue: DEFAULT_ALERT_THRESHOLD,
  });
}

/**
 * Load the current hour's count from SQLite into the in-memory cache.
 * Called on first access or when the hour rolls over.
 */
function syncFromDb(hourKey) {
  try {
    const database = ensureDb();
    const row = database
      .prepare("SELECT count, alerted FROM generation_tracker WHERE hour_key = ?")
      .get(hourKey);
    if (row) {
      currentHourCount = Number(row.count);
      alertedThisHour = Boolean(row.alerted);
    } else {
      currentHourCount = 0;
      alertedThisHour = false;
    }
  } catch (_) {
    // Fall back to in-memory if DB fails
    currentHourCount = 0;
    alertedThisHour = false;
  }
  currentHourBucket = hourKey;
}

function persistToDb(hourKey) {
  try {
    const database = ensureDb();
    const now = new Date().toISOString();
    database
      .prepare(`
        INSERT INTO generation_tracker (hour_key, count, alerted, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(hour_key) DO UPDATE SET count = ?, alerted = ?, updated_at = ?
      `)
      .run(hourKey, currentHourCount, alertedThisHour ? 1 : 0, now,
           currentHourCount, alertedThisHour ? 1 : 0, now);
  } catch (_) {
    // Best-effort persistence — in-memory still works
  }
}

export function recordGeneration({ logger = console } = {}) {
  const hourKey = getCurrentHourKey();

  if (hourKey !== currentHourBucket) {
    syncFromDb(hourKey);
  }

  currentHourCount += 1;

  const threshold = getThreshold();
  if (currentHourCount >= threshold && !alertedThisHour) {
    alertedThisHour = true;
    logger.warn(
      `[generation-tracker] ALERT: ${currentHourCount} generations this hour (threshold: ${threshold}). ` +
        "Consider disabling AI via POST /api/admin/ai if this is unexpected."
    );
  }

  persistToDb(hourKey);

  return { count: currentHourCount, threshold, alerted: alertedThisHour };
}

export function getHourlyStats() {
  const hourKey = getCurrentHourKey();
  if (hourKey !== currentHourBucket) {
    syncFromDb(hourKey);
  }
  return {
    count: currentHourCount,
    threshold: getThreshold(),
    alerted: alertedThisHour,
    hour: currentHourBucket,
  };
}

export function _resetTrackerForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
  currentHourBucket = null;
  currentHourCount = 0;
  alertedThisHour = false;
}
