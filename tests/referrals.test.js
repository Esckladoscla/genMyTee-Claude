import test from "node:test";
import assert from "node:assert/strict";
import {
  createReferralCode,
  validateReferralCode,
  recordReferralVisit,
  markReferralConverted,
  getReferralStats,
  _resetReferralsForTests,
} from "../services/referrals.js";

test.beforeEach(() => {
  _resetReferralsForTests();
  process.env.DB_PATH = ":memory:";
  process.env.REFERRAL_DISCOUNT_PCT = "15";
});

test.afterEach(() => {
  _resetReferralsForTests();
  delete process.env.DB_PATH;
  delete process.env.REFERRAL_DISCOUNT_PCT;
});

test("createReferralCode generates a code for valid email", () => {
  const result = createReferralCode("user@test.com");
  assert.equal(result.ok, true);
  assert.equal(typeof result.code, "string");
  assert.ok(result.code.length >= 8);
  assert.equal(result.existing, false);
});

test("createReferralCode returns existing code for same email", () => {
  const r1 = createReferralCode("user@test.com");
  const r2 = createReferralCode("user@test.com");
  assert.equal(r1.code, r2.code);
  assert.equal(r2.existing, true);
});

test("createReferralCode normalizes email to lowercase", () => {
  const r1 = createReferralCode("User@Test.COM");
  const r2 = createReferralCode("user@test.com");
  assert.equal(r1.code, r2.code);
});

test("createReferralCode rejects invalid email", () => {
  const result = createReferralCode("not-an-email");
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_invalid");
});

test("validateReferralCode returns valid for existing code", () => {
  const { code } = createReferralCode("user@test.com");
  const result = validateReferralCode(code);
  assert.equal(result.valid, true);
  assert.equal(result.discount_pct, 15);
});

test("validateReferralCode returns invalid for unknown code", () => {
  const result = validateReferralCode("nonexistent");
  assert.equal(result.valid, false);
});

test("recordReferralVisit tracks visits", () => {
  const { code } = createReferralCode("user@test.com");
  recordReferralVisit(code, "session-1");
  recordReferralVisit(code, "session-2");

  const stats = getReferralStats("user@test.com");
  assert.equal(stats.ok, true);
  assert.equal(stats.visits, 2);
  assert.equal(stats.conversions, 0);
});

test("markReferralConverted tracks conversions", () => {
  const { code } = createReferralCode("user@test.com");
  recordReferralVisit(code, "session-1");
  markReferralConverted(code, "stripe-session-123");

  const stats = getReferralStats("user@test.com");
  assert.equal(stats.conversions, 1);
});

test("getReferralStats returns full stats", () => {
  const { code } = createReferralCode("user@test.com");
  recordReferralVisit(code, "s1");
  recordReferralVisit(code, "s2");
  recordReferralVisit(code, "s3");
  markReferralConverted(code, "order-1");

  const stats = getReferralStats("user@test.com");
  assert.equal(stats.ok, true);
  assert.equal(stats.code, code);
  assert.equal(stats.visits, 3);
  assert.equal(stats.conversions, 1);
  assert.equal(stats.discount_pct, 15);
});

test("getReferralStats returns error for unknown email", () => {
  const stats = getReferralStats("unknown@test.com");
  assert.equal(stats.ok, false);
  assert.equal(stats.error, "no_referral_code");
});
