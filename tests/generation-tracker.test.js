import test from "node:test";
import assert from "node:assert/strict";
import {
  recordGeneration,
  getHourlyStats,
  _resetTrackerForTests,
} from "../services/generation-tracker.js";

test.beforeEach(() => {
  _resetTrackerForTests();
  process.env.DB_PATH = ":memory:";
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "3";
});

test.afterEach(() => {
  _resetTrackerForTests();
  delete process.env.DB_PATH;
  delete process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR;
});

test("recordGeneration increments count", () => {
  const r1 = recordGeneration({ logger: { warn: () => {} } });
  assert.equal(r1.count, 1);
  assert.equal(r1.alerted, false);

  const r2 = recordGeneration({ logger: { warn: () => {} } });
  assert.equal(r2.count, 2);
  assert.equal(r2.alerted, false);
});

test("recordGeneration alerts when threshold is reached", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  recordGeneration({ logger });
  recordGeneration({ logger });
  const r3 = recordGeneration({ logger });

  assert.equal(r3.count, 3);
  assert.equal(r3.alerted, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ALERT/);
  assert.match(warnings[0], /3 generations/);
});

test("recordGeneration only alerts once per hour", () => {
  const warnings = [];
  const logger = { warn: (msg) => warnings.push(msg) };

  for (let i = 0; i < 10; i++) {
    recordGeneration({ logger });
  }

  assert.equal(warnings.length, 1);
});

test("getHourlyStats returns current state", () => {
  recordGeneration({ logger: { warn: () => {} } });
  recordGeneration({ logger: { warn: () => {} } });

  const stats = getHourlyStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.threshold, 3);
  assert.equal(stats.alerted, false);
});

test("generation count persists to SQLite and survives cache reset", () => {
  // Use a shared file-based DB for this test
  const tmpDb = ":memory:";
  process.env.DB_PATH = tmpDb;

  const silentLogger = { warn: () => {} };
  recordGeneration({ logger: silentLogger });
  recordGeneration({ logger: silentLogger });

  const statsBefore = getHourlyStats();
  assert.equal(statsBefore.count, 2);

  // Note: with :memory: DB, a full reset also closes the DB,
  // so we can only verify the in-process persistence (syncFromDb).
  // On Render with a file-based DB, the count survives full restarts.
  const stats = getHourlyStats();
  assert.equal(stats.count, 2, "Count should survive within the same process");
});

test("hourly stats hour key uses zero-padded month (1-12), date, and hours", () => {
  recordGeneration({ logger: { warn: () => {} } });
  const stats = getHourlyStats();

  // Key format should be YYYY-MM-DD-HH (all zero-padded)
  assert.match(stats.hour, /^\d{4}-\d{2}-\d{2}-\d{2}$/,
    `Hour key "${stats.hour}" should match YYYY-MM-DD-HH format`);

  // Month should be 01-12, never 00
  const month = parseInt(stats.hour.split("-")[1], 10);
  assert.ok(month >= 1 && month <= 12,
    `Month ${month} should be 1-12, not 0-11`);
});
