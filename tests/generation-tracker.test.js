import test from "node:test";
import assert from "node:assert/strict";
import {
  recordGeneration,
  getHourlyStats,
  _resetTrackerForTests,
} from "../services/generation-tracker.js";

test.beforeEach(() => {
  _resetTrackerForTests();
  process.env.GENERATION_ALERT_THRESHOLD_PER_HOUR = "3";
});

test.afterEach(() => {
  _resetTrackerForTests();
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
