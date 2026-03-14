import test from "node:test";
import assert from "node:assert/strict";

// --- Generation tracker: circuit breaker + daily cap ---
import {
  recordGeneration,
  getHourlyStats,
  getDailyStats,
  checkGenerationAllowedByTracker,
  consumeGlobalRateLimit,
  _resetTrackerForTests,
} from "../services/generation-tracker.js";

// --- Watermark: URL mapping ---
import {
  storeProductionMapping,
  resolveProductionUrl,
  cleanupExpiredMappings,
  getUrlMappingCount,
  _resetWatermarkForTests,
  _insertMappingWithDateForTests,
} from "../services/watermark.js";

// --- Auth: purchase bonus ---
import {
  registerUser,
  getUserByEmail,
  getUserGenerationCount,
  grantUserGenerationBonus,
  getPurchaseBonusAmount,
  incrementUserGenerationCount,
  _resetAuthForTests,
} from "../services/auth.js";

// --- Session limiter: purchase bonus ---
import {
  generateSessionId,
  recordSessionGeneration,
  checkGenerationAllowed,
  grantSessionBonus,
  getSessionByEmail,
  unlockWithEmail,
  _resetSessionLimiterForTests,
} from "../services/session-limiter.js";

// ═══════════════════════════════════════════════════════════════
// S10-03: Independent filenames (URL mapping)
// ═══════════════════════════════════════════════════════════════

test.beforeEach(() => {
  process.env.DB_PATH = ":memory:";
});

test.afterEach(() => {
  _resetTrackerForTests();
  _resetWatermarkForTests();
  _resetAuthForTests();
  _resetSessionLimiterForTests();
  delete process.env.DB_PATH;
  delete process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR;
  delete process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR;
  delete process.env.DAILY_GENERATION_CAP;
  delete process.env.GLOBAL_RATE_LIMIT_PER_HOUR;
  delete process.env.PURCHASE_GENERATION_BONUS;
  delete process.env.AI_ENABLED;
});

test("storeProductionMapping + resolveProductionUrl uses DB lookup", () => {
  const previewUrl = "https://r2.example.com/previews/art-abc123.png";
  const productionUrl = "https://r2.example.com/production/art-xyz789.png";

  storeProductionMapping(previewUrl, productionUrl);
  const resolved = resolveProductionUrl(previewUrl);

  assert.equal(resolved, productionUrl);
});

test("resolveProductionUrl falls back to string replacement for unmapped URLs", () => {
  const previewUrl = "https://r2.example.com/previews/art-old.png";
  const resolved = resolveProductionUrl(previewUrl);

  assert.equal(resolved, "https://r2.example.com/production/art-old.png");
});

test("resolveProductionUrl handles null/undefined gracefully", () => {
  assert.equal(resolveProductionUrl(null), null);
  assert.equal(resolveProductionUrl(undefined), undefined);
  assert.equal(resolveProductionUrl(""), "");
});

test("storeProductionMapping ignores empty values", () => {
  // Should not throw
  storeProductionMapping(null, null);
  storeProductionMapping("", "");
  storeProductionMapping("url", null);
});

test("independent filenames mean preview URL does not reveal production URL", () => {
  const previewUrl = "https://r2.example.com/previews/art-1111-aaaa.png";
  const productionUrl = "https://r2.example.com/production/art-2222-bbbb.png";

  storeProductionMapping(previewUrl, productionUrl);

  // String replacement would give wrong result
  const naiveAttempt = previewUrl.replace("/previews/", "/production/");
  assert.notEqual(naiveAttempt, productionUrl, "Filenames should be different");

  // DB lookup gives correct result
  const resolved = resolveProductionUrl(previewUrl);
  assert.equal(resolved, productionUrl);
});

// ═══════════════════════════════════════════════════════════════
// S11-01: URL mapping cleanup/TTL
// ═══════════════════════════════════════════════════════════════

test("cleanupExpiredMappings deletes rows older than TTL", () => {
  process.env.URL_MAPPING_TTL_DAYS = "7";

  // Insert a fresh row via normal API
  storeProductionMapping("https://r2.example.com/previews/recent.png", "https://r2.example.com/production/recent.png");

  // Insert an old row (10 days ago) via test helper
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  _insertMappingWithDateForTests("https://r2.example.com/previews/old.png", "https://r2.example.com/production/old.png", tenDaysAgo);

  assert.equal(getUrlMappingCount(), 2);

  // Cleanup should delete the old row but keep the fresh one
  const deleted = cleanupExpiredMappings();
  assert.equal(deleted, 1);
  assert.equal(getUrlMappingCount(), 1);

  // The fresh mapping should still resolve
  assert.equal(resolveProductionUrl("https://r2.example.com/previews/recent.png"), "https://r2.example.com/production/recent.png");

  // The old mapping should fall back to legacy resolution
  assert.equal(resolveProductionUrl("https://r2.example.com/previews/old.png"), "https://r2.example.com/production/old.png");

  delete process.env.URL_MAPPING_TTL_DAYS;
});

test("getUrlMappingCount returns correct count", () => {
  assert.equal(getUrlMappingCount(), 0);

  storeProductionMapping("https://r2.example.com/previews/a.png", "https://r2.example.com/production/a.png");
  assert.equal(getUrlMappingCount(), 1);

  storeProductionMapping("https://r2.example.com/previews/b.png", "https://r2.example.com/production/b.png");
  assert.equal(getUrlMappingCount(), 2);
});

test("cleanupExpiredMappings respects URL_MAPPING_TTL_DAYS env var", () => {
  process.env.URL_MAPPING_TTL_DAYS = "365";

  storeProductionMapping("https://r2.example.com/previews/x.png", "https://r2.example.com/production/x.png");

  // With 365-day TTL, fresh row should not be deleted
  const deleted = cleanupExpiredMappings();
  assert.equal(deleted, 0);
  assert.equal(getUrlMappingCount(), 1);

  delete process.env.URL_MAPPING_TTL_DAYS;
});

test("cleanupExpiredMappings defaults to 30 days when no env var", () => {
  delete process.env.URL_MAPPING_TTL_DAYS;

  storeProductionMapping("https://r2.example.com/previews/default.png", "https://r2.example.com/production/default.png");

  // Fresh row with default 30-day TTL should not be deleted
  const deleted = cleanupExpiredMappings();
  assert.equal(deleted, 0);
  assert.equal(getUrlMappingCount(), 1);
});

test("cleanupExpiredMappings handles empty table", () => {
  const deleted = cleanupExpiredMappings();
  assert.equal(deleted, 0);
});

test("getUrlMappingCount handles empty table", () => {
  assert.equal(getUrlMappingCount(), 0);
});

// ═══════════════════════════════════════════════════════════════
// S10-04: Circuit breaker
// ═══════════════════════════════════════════════════════════════

test("circuit breaker triggers at threshold", () => {
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "5";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "3";
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  for (let i = 0; i < 4; i++) {
    recordGeneration({ logger });
  }
  assert.equal(process.env.AI_ENABLED, undefined);

  const r5 = recordGeneration({ logger });
  assert.equal(r5.circuit_broken, true);
  assert.equal(process.env.AI_ENABLED, "false");

  const circuitWarning = warnings.find((w) => w.includes("CIRCUIT BREAKER"));
  assert.ok(circuitWarning, "Should log circuit breaker warning");
});

test("checkGenerationAllowedByTracker blocks after circuit breaker", () => {
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "3";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  for (let i = 0; i < 3; i++) {
    recordGeneration({ logger });
  }

  const check = checkGenerationAllowedByTracker();
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "circuit_breaker");
});

test("checkGenerationAllowedByTracker allows before threshold", () => {
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "10";
  process.env.DAILY_GENERATION_CAP = "100";
  const logger = { warn: () => {} };

  recordGeneration({ logger });

  const check = checkGenerationAllowedByTracker();
  assert.equal(check.allowed, true);
});

test("circuit breaker only fires once per hour", () => {
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "3";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  for (let i = 0; i < 10; i++) {
    recordGeneration({ logger });
  }

  const circuitWarnings = warnings.filter((w) => w.includes("CIRCUIT BREAKER"));
  assert.equal(circuitWarnings.length, 1);
});

// ═══════════════════════════════════════════════════════════════
// S10-05: Daily generation cap
// ═══════════════════════════════════════════════════════════════

test("daily cap triggers at threshold", () => {
  process.env.DAILY_GENERATION_CAP = "5";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "100";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  for (let i = 0; i < 5; i++) {
    recordGeneration({ logger });
  }

  assert.equal(process.env.AI_ENABLED, "false");

  const dailyWarning = warnings.find((w) => w.includes("DAILY CAP"));
  assert.ok(dailyWarning, "Should log daily cap warning");
});

test("getDailyStats returns current day state", () => {
  process.env.DAILY_GENERATION_CAP = "100";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  recordGeneration({ logger });
  recordGeneration({ logger });

  const stats = getDailyStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.cap, 100);
  assert.equal(stats.cap_triggered, false);
});

test("checkGenerationAllowedByTracker blocks after daily cap", () => {
  process.env.DAILY_GENERATION_CAP = "3";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "100";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  for (let i = 0; i < 3; i++) {
    recordGeneration({ logger });
  }

  const check = checkGenerationAllowedByTracker();
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "daily_cap");
});

test("recordGeneration returns daily stats", () => {
  process.env.DAILY_GENERATION_CAP = "500";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "50";
  const logger = { warn: () => {} };

  const r = recordGeneration({ logger });
  assert.equal(r.daily_count, 1);
  assert.equal(r.daily_cap, 500);
  assert.equal(r.daily_cap_triggered, false);
});

// ═══════════════════════════════════════════════════════════════
// S10-06: Purchase generation bonus
// ═══════════════════════════════════════════════════════════════

test("getUserByEmail returns user by email", () => {
  const result = registerUser("buyer@test.com", "password123", "Buyer");
  assert.equal(result.ok, true);

  const user = getUserByEmail("buyer@test.com");
  assert.ok(user);
  assert.equal(user.email, "buyer@test.com");
  assert.equal(user.id, result.user.id);
});

test("getUserByEmail returns null for unknown email", () => {
  const user = getUserByEmail("nonexistent@test.com");
  assert.equal(user, null);
});

test("getUserByEmail handles null/empty", () => {
  assert.equal(getUserByEmail(null), null);
  assert.equal(getUserByEmail(""), null);
});

test("grantUserGenerationBonus reduces user generation_count", () => {
  const result = registerUser("bonus@test.com", "password123", "Bonus");
  assert.equal(result.ok, true);

  // Simulate 10 generations
  for (let i = 0; i < 10; i++) {
    incrementUserGenerationCount(result.user.id);
  }
  assert.equal(getUserGenerationCount(result.user.id), 10);

  // Grant 5 bonus (reduces count by 5)
  grantUserGenerationBonus(result.user.id, 5);
  assert.equal(getUserGenerationCount(result.user.id), 5);
});

test("grantUserGenerationBonus does not go below zero", () => {
  const result = registerUser("floor@test.com", "password123", "Floor");
  assert.equal(result.ok, true);
  assert.equal(getUserGenerationCount(result.user.id), 0);

  // Grant bonus when count is already 0
  grantUserGenerationBonus(result.user.id, 10);
  assert.equal(getUserGenerationCount(result.user.id), 0);
});

test("grantUserGenerationBonus handles invalid input", () => {
  // Should not throw
  grantUserGenerationBonus(null, 5);
  grantUserGenerationBonus("id", 0);
  grantUserGenerationBonus("id", -1);
});

test("getPurchaseBonusAmount returns default 10", () => {
  const bonus = getPurchaseBonusAmount();
  assert.equal(bonus, 10);
});

test("getPurchaseBonusAmount respects env override", () => {
  process.env.PURCHASE_GENERATION_BONUS = "15";
  const bonus = getPurchaseBonusAmount();
  assert.equal(bonus, 15);
  delete process.env.PURCHASE_GENERATION_BONUS;
});

test("grantSessionBonus reduces session count", () => {
  const sessionId = generateSessionId();
  recordSessionGeneration(sessionId);
  recordSessionGeneration(sessionId);
  recordSessionGeneration(sessionId);

  const before = checkGenerationAllowed(sessionId, "1.2.3.4");
  assert.equal(before.count, 3);

  grantSessionBonus(sessionId, 2);

  const after = checkGenerationAllowed(sessionId, "1.2.3.4");
  assert.equal(after.count, 1);
});

test("grantSessionBonus does not go below zero", () => {
  const sessionId = generateSessionId();
  recordSessionGeneration(sessionId);

  grantSessionBonus(sessionId, 10);

  const check = checkGenerationAllowed(sessionId, "1.2.3.4");
  assert.equal(check.count, 0);
});

test("grantSessionBonus handles invalid input", () => {
  // Should not throw
  grantSessionBonus(null, 5);
  grantSessionBonus("id", 0);
  grantSessionBonus("id", -1);
});

test("getSessionByEmail returns session with matching email", () => {
  const sessionId = generateSessionId();
  unlockWithEmail(sessionId, "session@test.com");

  const found = getSessionByEmail("session@test.com");
  assert.equal(found, sessionId);
});

test("getSessionByEmail returns null for unknown email", () => {
  const found = getSessionByEmail("unknown@test.com");
  assert.equal(found, null);
});

test("getSessionByEmail handles null/empty", () => {
  assert.equal(getSessionByEmail(null), null);
  assert.equal(getSessionByEmail(""), null);
});

// ═══════════════════════════════════════════════════════════════
// Integration: hourly stats include circuit_broken field
// ═══════════════════════════════════════════════════════════════

test("getHourlyStats includes circuit_broken field", () => {
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "100";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };
  recordGeneration({ logger });

  const stats = getHourlyStats();
  assert.equal(typeof stats.circuit_broken, "boolean");
  assert.equal(stats.circuit_broken, false);
});

// ═══════════════════════════════════════════════════════════════
// S10-09: Global server-wide rate limit
// ═══════════════════════════════════════════════════════════════

test("consumeGlobalRateLimit allows when under limit", () => {
  process.env.GLOBAL_RATE_LIMIT_PER_HOUR = "10";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.DAILY_GENERATION_CAP = "500";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  recordGeneration({ logger });

  const check = consumeGlobalRateLimit();
  assert.equal(check.allowed, true);
  assert.equal(check.count, 1);
  assert.equal(check.limit, 10);
  assert.equal(check.remaining, 9);
});

test("consumeGlobalRateLimit blocks at hourly limit", () => {
  process.env.GLOBAL_RATE_LIMIT_PER_HOUR = "3";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.DAILY_GENERATION_CAP = "500";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  for (let i = 0; i < 3; i++) {
    recordGeneration({ logger });
  }

  const check = consumeGlobalRateLimit();
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "global_rate_limit");
  assert.ok(check.message.includes("3/hora"));
});

test("consumeGlobalRateLimit blocks at daily cap", () => {
  process.env.GLOBAL_RATE_LIMIT_PER_HOUR = "100";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.DAILY_GENERATION_CAP = "3";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  for (let i = 0; i < 3; i++) {
    recordGeneration({ logger });
  }

  const check = consumeGlobalRateLimit();
  assert.equal(check.allowed, false);
  assert.equal(check.reason, "daily_cap");
  assert.ok(check.message.includes("3/día"));
});

test("consumeGlobalRateLimit uses default 100 when env not set", () => {
  delete process.env.GLOBAL_RATE_LIMIT_PER_HOUR;
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "200";
  process.env.DAILY_GENERATION_CAP = "500";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  recordGeneration({ logger });

  const check = consumeGlobalRateLimit();
  assert.equal(check.allowed, true);
  assert.equal(check.limit, 100);
});

test("consumeGlobalRateLimit fires before circuit breaker", () => {
  process.env.GLOBAL_RATE_LIMIT_PER_HOUR = "5";
  process.env.CIRCUIT_BREAKER_THRESHOLD_PER_HOUR = "10";
  process.env.DAILY_GENERATION_CAP = "500";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "100";
  const logger = { warn: () => {} };

  for (let i = 0; i < 5; i++) {
    recordGeneration({ logger });
  }

  // Global rate limit fires first
  const globalCheck = consumeGlobalRateLimit();
  assert.equal(globalCheck.allowed, false);
  assert.equal(globalCheck.reason, "global_rate_limit");

  // Circuit breaker hasn't fired yet (threshold is 10)
  const cbCheck = checkGenerationAllowedByTracker();
  assert.equal(cbCheck.allowed, true);
});
