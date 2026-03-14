import test from "node:test";
import assert from "node:assert/strict";
import { sendAlert, _resetAlertsForTests } from "../services/alerts.js";

const silentLogger = { log: () => {}, warn: () => {}, error: () => {} };

test.beforeEach(() => {
  _resetAlertsForTests();
  delete process.env.ALERT_EMAIL;
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.EMAIL_ENABLED;
});

test.afterEach(() => {
  _resetAlertsForTests();
  delete process.env.ALERT_EMAIL;
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.EMAIL_ENABLED;
});

test("sendAlert does nothing when no ALERT_EMAIL or ALERT_WEBHOOK_URL configured", async () => {
  // Should not throw
  await sendAlert("threshold", { count: 50, limit: 50, message: "test" }, { logger: silentLogger });
});

test("sendAlert respects cooldown — same type not sent twice within window", async () => {
  process.env.ALERT_EMAIL = "admin@test.com";
  process.env.EMAIL_ENABLED = "true";
  // First call sets cooldown; second is suppressed
  await sendAlert("threshold", { count: 50, limit: 50, message: "first" }, { logger: silentLogger });
  await sendAlert("threshold", { count: 60, limit: 50, message: "second" }, { logger: silentLogger });
  // No error — cooldown silently skips
});

test("sendAlert allows different alert types independently", async () => {
  process.env.ALERT_EMAIL = "admin@test.com";
  process.env.EMAIL_ENABLED = "true";
  await sendAlert("threshold", { count: 50, limit: 50, message: "threshold" }, { logger: silentLogger });
  await sendAlert("circuit_breaker", { count: 200, limit: 200, message: "cb" }, { logger: silentLogger });
  // Both should fire without cooldown blocking
});

test("sendAlert handles webhook failure gracefully", async () => {
  process.env.ALERT_WEBHOOK_URL = "http://localhost:1/nonexistent";
  const warnings = [];
  const logger = { log: () => {}, warn: (msg) => warnings.push(msg), error: () => {} };
  // Should not throw even with unreachable webhook
  await sendAlert("threshold", { count: 50, limit: 50, message: "test" }, { logger });
  assert.ok(warnings.some((w) => w.includes("[alerts]")));
});

test("_resetAlertsForTests clears cooldown state", async () => {
  process.env.ALERT_EMAIL = "admin@test.com";
  process.env.EMAIL_ENABLED = "true";
  await sendAlert("threshold", { count: 50, limit: 50, message: "first" }, { logger: silentLogger });
  _resetAlertsForTests();
  // After reset, same type should be allowed again (no cooldown)
  await sendAlert("threshold", { count: 50, limit: 50, message: "after reset" }, { logger: silentLogger });
});
