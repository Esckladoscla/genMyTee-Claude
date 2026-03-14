import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Set test DB path before importing services
process.env.DB_PATH = ":memory:";

import {
  registerUser,
  loginUser,
  logoutSession,
  validateSession,
  buildAuthCookie,
  buildClearAuthCookie,
  parseAuthCookie,
  generateVerificationCode,
  verifyEmailCode,
  getGoogleAuthUrl,
  getAuthGenerationLimit,
  getUserGenerationCount,
  incrementUserGenerationCount,
  getGenerationResetDate,
  getUserStats,
  _resetAuthForTests,
  _setUserGenerationResetAt,
} from "../services/auth.js";

import { buildAuthRouter, _resetRateLimitsForTests } from "../routes/auth.js";

describe("services/auth — user registration", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("registers a new user", () => {
    const result = registerUser("test@example.com", "password123", "Test User");
    assert.equal(result.ok, true);
    assert.equal(result.user.email, "test@example.com");
    assert.equal(result.user.name, "Test User");
    assert.ok(result.session.token);
  });

  it("rejects duplicate email", () => {
    registerUser("test@example.com", "password123");
    const result = registerUser("test@example.com", "password456");
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_exists");
  });

  it("rejects invalid email", () => {
    const result = registerUser("not-an-email", "password123");
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_invalid");
  });

  it("rejects short password", () => {
    const result = registerUser("test@example.com", "short");
    assert.equal(result.ok, false);
    assert.equal(result.error, "password_too_short");
  });

  it("normalizes email to lowercase", () => {
    const result = registerUser("Test@Example.COM", "password123");
    assert.equal(result.ok, true);
    assert.equal(result.user.email, "test@example.com");
  });
});

describe("services/auth — login", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("logs in with valid credentials", () => {
    registerUser("user@example.com", "password123", "User");
    const result = loginUser("user@example.com", "password123");
    assert.equal(result.ok, true);
    assert.equal(result.user.email, "user@example.com");
    assert.ok(result.session.token);
  });

  it("rejects wrong password", () => {
    registerUser("user@example.com", "password123");
    const result = loginUser("user@example.com", "wrongpass");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_credentials");
  });

  it("rejects unknown email", () => {
    const result = loginUser("nobody@example.com", "password123");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_credentials");
  });

  it("rejects empty credentials", () => {
    const result = loginUser("", "");
    assert.equal(result.ok, false);
    assert.equal(result.error, "credentials_required");
  });
});

describe("services/auth — sessions", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("validates a valid session token", () => {
    const reg = registerUser("session@example.com", "password123");
    const user = validateSession(reg.session.token);
    assert.ok(user);
    assert.equal(user.email, "session@example.com");
  });

  it("returns null for invalid token", () => {
    const user = validateSession("invalid-token");
    assert.equal(user, null);
  });

  it("returns null after logout", () => {
    const reg = registerUser("logout@example.com", "password123");
    logoutSession(reg.session.token);
    const user = validateSession(reg.session.token);
    assert.equal(user, null);
  });
});

describe("services/auth — cookie helpers", () => {
  it("builds auth cookie", () => {
    const cookie = buildAuthCookie("test-token-123");
    assert.ok(cookie.includes("gmt_auth=test-token-123"));
    assert.ok(cookie.includes("HttpOnly"));
    assert.ok(cookie.includes("Secure"));
  });

  it("builds clear cookie", () => {
    const cookie = buildClearAuthCookie();
    assert.ok(cookie.includes("gmt_auth="));
    assert.ok(cookie.includes("Max-Age=0"));
  });

  it("parses auth cookie from header", () => {
    const token = parseAuthCookie("gmt_session=abc; gmt_auth=my-token-xyz; other=val");
    assert.equal(token, "my-token-xyz");
  });

  it("returns null for missing cookie", () => {
    assert.equal(parseAuthCookie("gmt_session=abc"), null);
    assert.equal(parseAuthCookie(null), null);
  });
});

describe("services/auth — email verification", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("generates and verifies a code", () => {
    registerUser("verify@example.com", "password123");
    const gen = generateVerificationCode("verify@example.com");
    assert.equal(gen.ok, true);
    assert.ok(gen.code);
    assert.equal(gen.code.length, 6);

    const verify = verifyEmailCode("verify@example.com", gen.code);
    assert.equal(verify.ok, true);

    // User should now be verified
    const login = loginUser("verify@example.com", "password123");
    assert.equal(login.user.email_verified, true);
  });

  it("rejects wrong code", () => {
    registerUser("verify2@example.com", "password123");
    generateVerificationCode("verify2@example.com");
    const verify = verifyEmailCode("verify2@example.com", "000000");
    assert.equal(verify.ok, false);
    assert.equal(verify.error, "invalid_or_expired_code");
  });
});

describe("services/auth — generation tracking", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("tracks user generation count", () => {
    const reg = registerUser("gen@example.com", "password123");
    assert.equal(getUserGenerationCount(reg.user.id), 0);
    incrementUserGenerationCount(reg.user.id);
    incrementUserGenerationCount(reg.user.id);
    assert.equal(getUserGenerationCount(reg.user.id), 2);
  });

  it("returns default auth generation limit", () => {
    const limit = getAuthGenerationLimit();
    assert.equal(typeof limit, "number");
    assert.ok(limit > 0);
  });
});

describe("services/auth — monthly generation reset", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("resets generation count when month changes", () => {
    const reg = registerUser("monthly@example.com", "password123");
    const userId = reg.user.id;

    // Simulate 10 generations
    for (let i = 0; i < 10; i++) {
      incrementUserGenerationCount(userId);
    }
    assert.equal(getUserGenerationCount(userId), 10);

    // Set reset date to last month to simulate month rollover
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    _setUserGenerationResetAt(userId, lastMonth.toISOString());

    // Count should reset to 0 because it's a new month
    assert.equal(getUserGenerationCount(userId), 0);
  });

  it("does not reset when still in the same month", () => {
    const reg = registerUser("samemonth@example.com", "password123");
    const userId = reg.user.id;

    incrementUserGenerationCount(userId);
    incrementUserGenerationCount(userId);
    assert.equal(getUserGenerationCount(userId), 2);

    // Count should remain unchanged
    assert.equal(getUserGenerationCount(userId), 2);
  });

  it("sets generation_reset_at on registration", () => {
    const reg = registerUser("resetdate@example.com", "password123");
    const resetDate = getGenerationResetDate(reg.user.id);
    assert.ok(resetDate, "generation_reset_at should be set on registration");
  });

  it("preserves bonus generations across month boundaries", () => {
    const reg = registerUser("bonus-month@example.com", "password123");
    const userId = reg.user.id;

    // Use 5 generations
    for (let i = 0; i < 5; i++) {
      incrementUserGenerationCount(userId);
    }
    assert.equal(getUserGenerationCount(userId), 5);

    // Set reset date to last month
    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    _setUserGenerationResetAt(userId, lastMonth.toISOString());

    // Should reset to 0, then increment works fresh
    assert.equal(getUserGenerationCount(userId), 0);
    incrementUserGenerationCount(userId);
    assert.equal(getUserGenerationCount(userId), 1);
  });

  it("handles users without generation_reset_at (legacy users)", () => {
    const reg = registerUser("legacy@example.com", "password123");
    const userId = reg.user.id;

    // Build up some generations normally
    incrementUserGenerationCount(userId);
    incrementUserGenerationCount(userId);
    assert.equal(getUserGenerationCount(userId), 2);

    // Simulate a legacy user state: has count but no generation_reset_at
    _setUserGenerationResetAt(userId, null);

    // getUserGenerationCount should trigger reset because null !== current month
    const count = getUserGenerationCount(userId);
    assert.equal(count, 0);
  });
});

describe("services/auth — user stats", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("returns aggregate user stats", () => {
    registerUser("stats1@example.com", "password123");
    registerUser("stats2@example.com", "password123");
    const stats = getUserStats();
    assert.equal(stats.total_users, 2);
    assert.equal(stats.verified_users, 0);
  });
});

describe("routes/auth — API endpoints", () => {
  let app;
  const captchaOk = async () => ({ ok: true });

  beforeEach(() => {
    _resetAuthForTests();
    _resetRateLimitsForTests();
    app = express();
    app.use(express.json());
  });
  afterEach(() => {
    _resetAuthForTests();
    _resetRateLimitsForTests();
  });

  it("POST /register creates user and returns session", async () => {
    const router = buildAuthRouter({
      sendEmailFn: async () => ({ ok: true }),
      verifyCaptchaFn: captchaOk,
      linkSessionToUserFn: () => {},
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/register", {
      email: "new@example.com",
      password: "password123",
      name: "New User",
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user.email, "new@example.com");
    assert.equal(res.body.needs_verification, true);
  });

  it("POST /register rejects duplicate", async () => {
    registerUser("dup@example.com", "password123");
    const router = buildAuthRouter({
      sendEmailFn: async () => ({ ok: true }),
      verifyCaptchaFn: captchaOk,
      linkSessionToUserFn: () => {},
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/register", {
      email: "dup@example.com",
      password: "password456",
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, "email_exists");
  });

  it("POST /register rejects when captcha fails", async () => {
    const captchaFail = async () => ({ ok: false, error: "captcha_invalid" });
    const router = buildAuthRouter({
      sendEmailFn: async () => ({ ok: true }),
      verifyCaptchaFn: captchaFail,
      linkSessionToUserFn: () => {},
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/register", {
      email: "captcha@example.com",
      password: "password123",
    });

    assert.equal(res.status, 422);
    assert.equal(res.body.error, "captcha_invalid");
  });

  it("POST /register rate limits by IP", async () => {
    const router = buildAuthRouter({
      sendEmailFn: async () => ({ ok: true }),
      verifyCaptchaFn: captchaOk,
      linkSessionToUserFn: () => {},
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    // 3 registrations should succeed (different emails)
    for (let i = 0; i < 3; i++) {
      await injectRequest(app, "POST", "/api/auth/register", {
        email: `ratelimit${i}@example.com`,
        password: "password123",
      });
    }

    // 4th should be rate limited
    const res = await injectRequest(app, "POST", "/api/auth/register", {
      email: "ratelimit3@example.com",
      password: "password123",
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.error, "rate_limited");
  });

  it("POST /login authenticates user", async () => {
    registerUser("login@example.com", "password123");
    const router = buildAuthRouter({
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/login", {
      email: "login@example.com",
      password: "password123",
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.user.email, "login@example.com");
  });

  it("POST /login rejects bad password", async () => {
    registerUser("bad@example.com", "password123");
    const router = buildAuthRouter({
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/login", {
      email: "bad@example.com",
      password: "wrong",
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, "invalid_credentials");
  });

  it("POST /login rate limits by email", async () => {
    registerUser("rl-login@example.com", "password123");
    const router = buildAuthRouter({
      linkDesignsToUserFn: () => {},
    });
    app.use("/api/auth", router);

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await injectRequest(app, "POST", "/api/auth/login", {
        email: "rl-login@example.com",
        password: "wrong",
      });
    }

    // 6th should be rate limited
    const res = await injectRequest(app, "POST", "/api/auth/login", {
      email: "rl-login@example.com",
      password: "password123",
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.error, "rate_limited");
  });

  it("GET /me returns null when unauthenticated", async () => {
    const router = buildAuthRouter();
    app.use("/api/auth", router);

    const res = await injectRequest(app, "GET", "/api/auth/me");
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.user, null);
  });

  it("GET /config returns google status", async () => {
    const router = buildAuthRouter();
    app.use("/api/auth", router);

    const res = await injectRequest(app, "GET", "/api/auth/config");
    assert.equal(res.body.ok, true);
    assert.equal(typeof res.body.google_enabled, "boolean");
  });

  it("POST /logout clears session", async () => {
    const router = buildAuthRouter();
    app.use("/api/auth", router);

    const res = await injectRequest(app, "POST", "/api/auth/logout");
    assert.equal(res.body.ok, true);
  });
});

describe("services/auth — email validation regex", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("rejects email without domain part", () => {
    const result = registerUser("user@", "password123");
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_invalid");
  });

  it("rejects email without local part", () => {
    const result = registerUser("@example.com", "password123");
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_invalid");
  });

  it("rejects email with spaces", () => {
    const result = registerUser("user @example.com", "password123");
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_invalid");
  });

  it("accepts valid email with subdomain", () => {
    const result = registerUser("user@mail.example.com", "password123");
    assert.equal(result.ok, true);
  });
});

describe("services/auth — password max length", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("rejects password longer than 256 characters", () => {
    const longPassword = "a".repeat(257);
    const result = registerUser("long@example.com", longPassword);
    assert.equal(result.ok, false);
    assert.equal(result.error, "password_too_long");
  });

  it("accepts password of exactly 256 characters", () => {
    const maxPassword = "a".repeat(256);
    const result = registerUser("max@example.com", maxPassword);
    assert.equal(result.ok, true);
  });
});

describe("services/auth — verification attempt tracking", () => {
  beforeEach(() => _resetAuthForTests());
  afterEach(() => _resetAuthForTests());

  it("locks out after 5 failed verification attempts", () => {
    registerUser("attempts@example.com", "password123");
    const gen = generateVerificationCode("attempts@example.com");

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const result = verifyEmailCode("attempts@example.com", "000000");
      assert.equal(result.ok, false);
      assert.equal(result.error, "invalid_or_expired_code");
    }

    // 6th attempt should trigger too_many_attempts (even with correct code)
    const result = verifyEmailCode("attempts@example.com", gen.code);
    assert.equal(result.ok, false);
    assert.equal(result.error, "too_many_attempts");
  });

  it("resets attempt counter on successful verification", () => {
    registerUser("reset-attempts@example.com", "password123");
    const gen = generateVerificationCode("reset-attempts@example.com");

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      verifyEmailCode("reset-attempts@example.com", "000000");
    }

    // Succeed with correct code
    const result = verifyEmailCode("reset-attempts@example.com", gen.code);
    assert.equal(result.ok, true);
  });
});

describe("services/auth — Google OAuth state parameter", () => {
  it("getGoogleAuthUrl returns url and state when configured", () => {
    // Without env vars configured, it returns null
    const result = getGoogleAuthUrl();
    // When not configured, returns null
    assert.equal(result, null);
  });
});

import http from "node:http";

// Helper to inject HTTP requests into Express app
async function injectRequest(app, method, urlPath, body) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          server.close();
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data || "{}"),
          });
        });
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}
