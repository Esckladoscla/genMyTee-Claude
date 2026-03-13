import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSessionId,
  parseSessionCookie,
  buildSessionCookie,
  checkGenerationAllowed,
  recordSessionGeneration,
  unlockWithEmail,
  _resetSessionLimiterForTests,
} from "../services/session-limiter.js";

test.beforeEach(() => {
  _resetSessionLimiterForTests();
  process.env.DB_PATH = ":memory:";
  process.env.FREE_GENERATIONS_LIMIT = "3";
  process.env.EMAIL_BONUS_GENERATIONS = "5";
});

test.afterEach(() => {
  _resetSessionLimiterForTests();
  delete process.env.DB_PATH;
  delete process.env.FREE_GENERATIONS_LIMIT;
  delete process.env.EMAIL_BONUS_GENERATIONS;
});

test("generateSessionId returns a UUID-like string", () => {
  const id = generateSessionId();
  assert.equal(typeof id, "string");
  assert.ok(id.length > 10);
});

test("parseSessionCookie extracts gmt_session from cookie header", () => {
  assert.equal(parseSessionCookie("gmt_session=abc123"), "abc123");
  assert.equal(parseSessionCookie("other=val; gmt_session=xyz; foo=bar"), "xyz");
  assert.equal(parseSessionCookie("other=val"), null);
  assert.equal(parseSessionCookie(null), null);
  assert.equal(parseSessionCookie(""), null);
});

test("buildSessionCookie creates valid Set-Cookie string", () => {
  const cookie = buildSessionCookie("test-session-id");
  assert.ok(cookie.includes("gmt_session=test-session-id"));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Path=/"));
  assert.ok(cookie.includes("Max-Age="));
});

test("checkGenerationAllowed allows first 3 generations", () => {
  const sessionId = "test-session-1";

  for (let i = 0; i < 3; i++) {
    const check = checkGenerationAllowed(sessionId);
    assert.equal(check.allowed, true);
    assert.equal(check.remaining, 3 - i);
    recordSessionGeneration(sessionId);
  }

  const blocked = checkGenerationAllowed(sessionId);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.needs_email, true);
});

test("unlockWithEmail grants bonus generations", () => {
  const sessionId = "test-session-2";

  // Use up free generations
  for (let i = 0; i < 3; i++) {
    recordSessionGeneration(sessionId);
  }

  const blocked = checkGenerationAllowed(sessionId);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.needs_email, true);

  // Unlock with email
  const result = unlockWithEmail(sessionId, "user@test.com");
  assert.equal(result.ok, true);
  assert.equal(result.remaining, 5);
  assert.equal(result.limit, 8);

  // Now allowed again
  const afterUnlock = checkGenerationAllowed(sessionId);
  assert.equal(afterUnlock.allowed, true);
  assert.equal(afterUnlock.remaining, 5);
  assert.equal(afterUnlock.has_email, true);
});

test("unlockWithEmail rejects invalid email", () => {
  const result = unlockWithEmail("test-session-3", "not-an-email");
  assert.equal(result.ok, false);
  assert.equal(result.error, "email_invalid");
});

test("session limit is configurable via env vars", () => {
  _resetSessionLimiterForTests();
  process.env.DB_PATH = ":memory:";
  process.env.FREE_GENERATIONS_LIMIT = "1";
  process.env.EMAIL_BONUS_GENERATIONS = "2";

  const sessionId = "test-session-4";
  recordSessionGeneration(sessionId);

  const blocked = checkGenerationAllowed(sessionId);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.limit, 1);

  unlockWithEmail(sessionId, "test@example.com");
  const afterUnlock = checkGenerationAllowed(sessionId);
  assert.equal(afterUnlock.allowed, true);
  assert.equal(afterUnlock.limit, 3); // 1 + 2
  assert.equal(afterUnlock.remaining, 2);
});

test("IP correlation blocks new session from same IP", () => {
  const ip = "192.168.1.100";
  const session1 = "session-ip-1";
  const session2 = "session-ip-2";

  // Exhaust limit on session1 from this IP
  for (let i = 0; i < 3; i++) {
    checkGenerationAllowed(session1, ip);
    recordSessionGeneration(session1);
  }

  const blocked1 = checkGenerationAllowed(session1, ip);
  assert.equal(blocked1.allowed, false);

  // New session (cleared cookies) from same IP should also be blocked
  const blocked2 = checkGenerationAllowed(session2, ip);
  assert.equal(blocked2.allowed, false, "New session from same IP should be blocked");
  assert.equal(blocked2.count, 3, "IP-aggregated count should be 3");
});

test("different IPs are tracked independently", () => {
  const session1 = "session-diff-ip-1";
  const session2 = "session-diff-ip-2";

  // Exhaust limit on IP1
  for (let i = 0; i < 3; i++) {
    checkGenerationAllowed(session1, "10.0.0.1");
    recordSessionGeneration(session1);
  }

  // Different IP should still be allowed
  const check = checkGenerationAllowed(session2, "10.0.0.2");
  assert.equal(check.allowed, true, "Different IP should have fresh limits");
  assert.equal(check.remaining, 3);
});
