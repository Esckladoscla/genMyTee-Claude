import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_ALERT_THRESHOLD = 50;
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 200;
const DEFAULT_DAILY_CAP = 500;

// In-memory cache (fast path for alerting within the current process)
let currentHourBucket = null;
let currentHourCount = 0;
let alertedThisHour = false;
let circuitBrokenThisHour = false;

// Daily tracking cache
let currentDayBucket = null;
let currentDayCount = 0;
let dailyCapTriggered = false;

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
    CREATE TABLE IF NOT EXISTS daily_generation_tracker (
      day_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      cap_triggered INTEGER NOT NULL DEFAULT 0,
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

function getCurrentDayKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function getThreshold() {
  return getNumberEnv("GENERATION_ALERT_THRESHOLD_PER_HOUR", {
    defaultValue: DEFAULT_ALERT_THRESHOLD,
  });
}

function getCircuitBreakerThreshold() {
  return getNumberEnv("CIRCUIT_BREAKER_THRESHOLD_PER_HOUR", {
    defaultValue: DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  });
}

function getDailyCap() {
  return getNumberEnv("DAILY_GENERATION_CAP", {
    defaultValue: DEFAULT_DAILY_CAP,
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
  // Reset circuit breaker on hour rollover
  circuitBrokenThisHour = false;
}

function syncDayFromDb(dayKey) {
  try {
    const database = ensureDb();
    const row = database
      .prepare("SELECT count, cap_triggered FROM daily_generation_tracker WHERE day_key = ?")
      .get(dayKey);
    if (row) {
      currentDayCount = Number(row.count);
      dailyCapTriggered = Boolean(row.cap_triggered);
    } else {
      currentDayCount = 0;
      dailyCapTriggered = false;
    }
  } catch (_) {
    currentDayCount = 0;
    dailyCapTriggered = false;
  }
  currentDayBucket = dayKey;
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

function persistDayToDb(dayKey) {
  try {
    const database = ensureDb();
    const now = new Date().toISOString();
    database
      .prepare(`
        INSERT INTO daily_generation_tracker (day_key, count, cap_triggered, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(day_key) DO UPDATE SET count = ?, cap_triggered = ?, updated_at = ?
      `)
      .run(dayKey, currentDayCount, dailyCapTriggered ? 1 : 0, now,
           currentDayCount, dailyCapTriggered ? 1 : 0, now);
  } catch (_) {
    // Best-effort
  }
}

export function recordGeneration({ logger = console } = {}) {
  const hourKey = getCurrentHourKey();
  const dayKey = getCurrentDayKey();

  if (hourKey !== currentHourBucket) {
    syncFromDb(hourKey);
  }
  if (dayKey !== currentDayBucket) {
    syncDayFromDb(dayKey);
  }

  currentHourCount += 1;
  currentDayCount += 1;

  const threshold = getThreshold();
  if (currentHourCount >= threshold && !alertedThisHour) {
    alertedThisHour = true;
    logger.warn(
      `[generation-tracker] ALERT: ${currentHourCount} generations this hour (threshold: ${threshold}). ` +
        "Consider disabling AI via POST /api/admin/ai if this is unexpected."
    );
  }

  // Circuit breaker: auto-disable AI when hourly threshold is exceeded
  const circuitBreakerThreshold = getCircuitBreakerThreshold();
  if (currentHourCount >= circuitBreakerThreshold && !circuitBrokenThisHour) {
    circuitBrokenThisHour = true;
    process.env.AI_ENABLED = "false";
    logger.warn(
      `[generation-tracker] CIRCUIT BREAKER: ${currentHourCount} generations this hour ` +
        `(limit: ${circuitBreakerThreshold}). AI auto-disabled. ` +
        "Will auto-re-enable next hour or manually via POST /api/admin/ai."
    );
  }

  // Daily cap: auto-disable AI when daily limit is exceeded
  const dailyCap = getDailyCap();
  if (currentDayCount >= dailyCap && !dailyCapTriggered) {
    dailyCapTriggered = true;
    process.env.AI_ENABLED = "false";
    logger.warn(
      `[generation-tracker] DAILY CAP: ${currentDayCount} generations today ` +
        `(limit: ${dailyCap}). AI auto-disabled until midnight UTC. ` +
        "Override manually via POST /api/admin/ai."
    );
  }

  persistToDb(hourKey);
  persistDayToDb(dayKey);

  return {
    count: currentHourCount,
    threshold,
    alerted: alertedThisHour,
    circuit_broken: circuitBrokenThisHour,
    daily_count: currentDayCount,
    daily_cap: dailyCap,
    daily_cap_triggered: dailyCapTriggered,
  };
}

/**
 * Check whether generation is allowed by the circuit breaker and daily cap.
 * Returns { allowed: true } or { allowed: false, reason: "..." }.
 * Called before generation to block requests proactively.
 */
export function checkGenerationAllowedByTracker() {
  const hourKey = getCurrentHourKey();
  const dayKey = getCurrentDayKey();

  if (hourKey !== currentHourBucket) {
    syncFromDb(hourKey);
  }
  if (dayKey !== currentDayBucket) {
    syncDayFromDb(dayKey);
  }

  const circuitBreakerThreshold = getCircuitBreakerThreshold();
  if (currentHourCount >= circuitBreakerThreshold) {
    return {
      allowed: false,
      reason: "circuit_breaker",
      message: `Límite de generaciones por hora alcanzado (${circuitBreakerThreshold}/hora). Inténtalo más tarde.`,
    };
  }

  const dailyCap = getDailyCap();
  if (currentDayCount >= dailyCap) {
    return {
      allowed: false,
      reason: "daily_cap",
      message: `Límite diario de generaciones alcanzado (${dailyCap}/día). Se reinicia a medianoche UTC.`,
    };
  }

  return { allowed: true };
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
    circuit_broken: circuitBrokenThisHour,
    hour: currentHourBucket,
  };
}

export function getDailyStats() {
  const dayKey = getCurrentDayKey();
  if (dayKey !== currentDayBucket) {
    syncDayFromDb(dayKey);
  }
  return {
    count: currentDayCount,
    cap: getDailyCap(),
    cap_triggered: dailyCapTriggered,
    day: currentDayBucket,
  };
}

export function getGenerationHistory({ limit = 168 } = {}) {
  try {
    const database = ensureDb();
    const rows = database
      .prepare("SELECT hour_key, count FROM generation_tracker ORDER BY hour_key DESC LIMIT ?")
      .all(Math.max(1, Math.min(500, limit)));
    return rows.map((r) => ({ hour: r.hour_key, count: Number(r.count) })).reverse();
  } catch {
    return [];
  }
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
  circuitBrokenThisHour = false;
  currentDayBucket = null;
  currentDayCount = 0;
  dailyCapTriggered = false;
}
