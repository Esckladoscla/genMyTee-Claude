import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { getDbPath, getNumberEnv } from "./env.js";

const DEFAULT_CACHE_TTL_HOURS = 168; // 7 days

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS prompt_cache (
      prompt_hash TEXT PRIMARY KEY,
      prompt_normalized TEXT NOT NULL,
      image_url TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_hit_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_cache_hits ON prompt_cache(hit_count DESC);
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

/**
 * Hash a normalized prompt to a consistent key.
 * Normalizes whitespace and lowercases for better matching.
 */
export function hashPrompt(prompt) {
  const normalized = String(prompt || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Look up a cached result for this prompt.
 * Returns { hit: true, image_url } or { hit: false }.
 */
export function getCachedImage(prompt) {
  const database = ensureDb();
  const hash = hashPrompt(prompt);

  const ttlHours = getNumberEnv("PROMPT_CACHE_TTL_HOURS", { defaultValue: DEFAULT_CACHE_TTL_HOURS });
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();

  const row = database
    .prepare("SELECT image_url, prompt_normalized FROM prompt_cache WHERE prompt_hash = ? AND created_at > ?")
    .get(hash, cutoff);

  if (!row) return { hit: false };

  // Update hit count
  const now = new Date().toISOString();
  database
    .prepare("UPDATE prompt_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE prompt_hash = ?")
    .run(now, hash);

  return { hit: true, image_url: row.image_url };
}

/**
 * Store a generated image for this prompt in the cache.
 */
export function cacheImage(prompt, imageUrl) {
  if (!prompt || !imageUrl) return;

  const database = ensureDb();
  const hash = hashPrompt(prompt);
  const normalized = String(prompt || "").toLowerCase().trim().replace(/\s+/g, " ");
  const now = new Date().toISOString();

  try {
    database
      .prepare(
        "INSERT INTO prompt_cache (prompt_hash, prompt_normalized, image_url, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(prompt_hash) DO UPDATE SET image_url = ?, created_at = ?, hit_count = 0"
      )
      .run(hash, normalized, imageUrl, now, imageUrl, now);
  } catch (_) {
    // Best-effort caching
  }
}

/**
 * Get cache stats.
 */
export function getCacheStats() {
  const database = ensureDb();
  const total = database.prepare("SELECT COUNT(*) as count FROM prompt_cache").get();
  const totalHits = database.prepare("SELECT SUM(hit_count) as total FROM prompt_cache").get();
  const topPrompts = database
    .prepare("SELECT prompt_normalized, hit_count, image_url FROM prompt_cache ORDER BY hit_count DESC LIMIT 10")
    .all();

  return {
    cached_prompts: Number(total.count),
    total_hits: Number(totalHits.total) || 0,
    top_prompts: topPrompts.map((r) => ({
      prompt: r.prompt_normalized,
      hits: Number(r.hit_count),
      image_url: r.image_url,
    })),
  };
}

/**
 * Clean up expired cache entries.
 */
export function cleanupExpiredCache() {
  const database = ensureDb();
  const ttlHours = getNumberEnv("PROMPT_CACHE_TTL_HOURS", { defaultValue: DEFAULT_CACHE_TTL_HOURS });
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000).toISOString();
  database.prepare("DELETE FROM prompt_cache WHERE created_at < ?").run(cutoff);
}

export function _resetPromptCacheForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
