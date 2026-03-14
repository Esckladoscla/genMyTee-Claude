import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv, getBooleanEnv } from "./env.js";

// --- Defaults ---
const DEFAULT_MAX_IPS_PER_FINGERPRINT = 5;
const DEFAULT_MAX_FINGERPRINTS_PER_IP = 10;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 min

// Known bot User-Agent patterns
const BOT_UA_PATTERNS = [
  /^$/,                          // empty
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /httpie\//i,
  /java\//i,
  /okhttp\//i,
  /go-http-client/i,
  /node-fetch/i,
  /axios\//i,
  /postman/i,
  /insomnia/i,
  /scrapy/i,
  /phantomjs/i,
  /headlesschrome/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
];

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
    CREATE TABLE IF NOT EXISTS fingerprint_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fp_fingerprint_time
      ON fingerprint_hits (fingerprint, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_fp_ip_time
      ON fingerprint_hits (ip, created_at_ms);
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

// --- Config helpers ---

function getMaxIpsPerFingerprint() {
  return getNumberEnv("FP_MAX_IPS_PER_FINGERPRINT", { defaultValue: DEFAULT_MAX_IPS_PER_FINGERPRINT });
}

function getMaxFingerprintsPerIp() {
  return getNumberEnv("FP_MAX_FINGERPRINTS_PER_IP", { defaultValue: DEFAULT_MAX_FINGERPRINTS_PER_IP });
}

function getWindowMs() {
  return getNumberEnv("FP_WINDOW_MS", { defaultValue: DEFAULT_WINDOW_MS });
}

export function isFingerprintEnabled() {
  return getBooleanEnv("FINGERPRINT_ENABLED", { defaultValue: true });
}

// --- Core ---

/**
 * Build a fingerprint hash from request headers.
 * Uses User-Agent + Accept-Language + Accept-Encoding + Accept.
 */
export function buildFingerprint(headers) {
  const ua = headers["user-agent"] || "";
  const lang = headers["accept-language"] || "";
  const enc = headers["accept-encoding"] || "";
  const accept = headers["accept"] || "";

  const raw = `${ua}|${lang}|${enc}|${accept}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Check if a User-Agent matches known bot patterns.
 */
export function isKnownBot(userAgent) {
  const ua = userAgent || "";
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

/**
 * Record a fingerprint hit and check for suspicious patterns.
 *
 * Returns:
 *   { suspicious: false } — no abuse detected
 *   { suspicious: true, reason: string } — abuse pattern detected
 */
export function checkFingerprint(ip, headers) {
  if (!isFingerprintEnabled()) {
    return { suspicious: false };
  }

  const ua = headers["user-agent"] || "";

  // Check 1: Known bot User-Agent (includes empty UA via ^$ pattern)
  if (isKnownBot(ua)) {
    return { suspicious: true, reason: "known_bot_ua" };
  }

  const fingerprint = buildFingerprint(headers);
  const database = ensureDb();
  const now = Date.now();
  const cutoff = now - getWindowMs();

  // Record this hit
  database
    .prepare("INSERT INTO fingerprint_hits (fingerprint, ip, created_at_ms) VALUES (?, ?, ?)")
    .run(fingerprint, ip, now);

  // Check 3: Botnet pattern — same fingerprint from many different IPs
  const ipCountRow = database
    .prepare(
      "SELECT COUNT(DISTINCT ip) as cnt FROM fingerprint_hits WHERE fingerprint = ? AND created_at_ms > ?"
    )
    .get(fingerprint, cutoff);
  const distinctIps = Number(ipCountRow?.cnt || 0);

  if (distinctIps > getMaxIpsPerFingerprint()) {
    return { suspicious: true, reason: "botnet_pattern", fingerprint, distinct_ips: distinctIps };
  }

  // Check 4: Rotation pattern — same IP with many different fingerprints
  const fpCountRow = database
    .prepare(
      "SELECT COUNT(DISTINCT fingerprint) as cnt FROM fingerprint_hits WHERE ip = ? AND created_at_ms > ?"
    )
    .get(ip, cutoff);
  const distinctFps = Number(fpCountRow?.cnt || 0);

  if (distinctFps > getMaxFingerprintsPerIp()) {
    return { suspicious: true, reason: "rotation_pattern", ip, distinct_fingerprints: distinctFps };
  }

  return { suspicious: false, fingerprint };
}

// --- Cleanup ---

export function cleanupExpiredHits() {
  try {
    const database = ensureDb();
    const cutoff = Date.now() - getWindowMs();
    const result = database
      .prepare("DELETE FROM fingerprint_hits WHERE created_at_ms <= ?")
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

// --- Test helpers ---

export function _resetFingerprintForTests() {
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
