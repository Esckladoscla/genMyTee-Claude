import test from "node:test";
import assert from "node:assert/strict";

// We need to control env vars and mock fetch, so we test the module logic directly.

// Save originals
const originalEnv = { ...process.env };

test.beforeEach(() => {
  delete process.env.CAPTCHA_ENABLED;
  delete process.env.CAPTCHA_SECRET_KEY;
  delete process.env.CAPTCHA_SITE_KEY;
});

test.afterEach(() => {
  delete process.env.CAPTCHA_ENABLED;
  delete process.env.CAPTCHA_SECRET_KEY;
  delete process.env.CAPTCHA_SITE_KEY;
  // Restore global fetch
  if (globalThis._originalFetch) {
    globalThis.fetch = globalThis._originalFetch;
    delete globalThis._originalFetch;
  }
});

function mockFetch(responseBody, status = 200) {
  globalThis._originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
  });
}

function mockFetchError(message) {
  globalThis._originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error(message);
  };
}

test("verifyCaptcha returns ok when CAPTCHA_ENABLED is false", async () => {
  const { verifyCaptcha } = await import("../services/captcha.js");
  const result = await verifyCaptcha("any-token");
  assert.equal(result.ok, true);
});

test("verifyCaptcha returns ok when enabled but no secret key (fail open)", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "";
  // Re-import to pick up env changes
  const mod = await import(`../services/captcha.js?t=${Date.now()}_1`);
  const result = await mod.verifyCaptcha("some-token");
  assert.equal(result.ok, true);
});

test("verifyCaptcha rejects missing token when enabled", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  const mod = await import(`../services/captcha.js?t=${Date.now()}_2`);
  const result = await mod.verifyCaptcha("");
  assert.equal(result.ok, false);
  assert.equal(result.error, "captcha_missing");
});

test("verifyCaptcha rejects null token when enabled", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  const mod = await import(`../services/captcha.js?t=${Date.now()}_3`);
  const result = await mod.verifyCaptcha(null);
  assert.equal(result.ok, false);
  assert.equal(result.error, "captcha_missing");
});

test("verifyCaptcha returns ok for valid token", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  mockFetch({ success: true });
  const mod = await import(`../services/captcha.js?t=${Date.now()}_4`);
  const result = await mod.verifyCaptcha("valid-token", "1.2.3.4");
  assert.equal(result.ok, true);
});

test("verifyCaptcha rejects invalid token", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  mockFetch({ success: false, "error-codes": ["invalid-input-response"] });
  const mod = await import(`../services/captcha.js?t=${Date.now()}_5`);
  const result = await mod.verifyCaptcha("bad-token");
  assert.equal(result.ok, false);
  assert.equal(result.error, "captcha_invalid");
  assert.deepEqual(result.codes, ["invalid-input-response"]);
});

test("verifyCaptcha fails open on network error", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  mockFetchError("ECONNREFUSED");
  const mod = await import(`../services/captcha.js?t=${Date.now()}_6`);
  const result = await mod.verifyCaptcha("some-token");
  assert.equal(result.ok, true); // fail open
});

test("verifyCaptcha fails open on HTTP error from Turnstile", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SECRET_KEY = "test-secret";
  mockFetch({}, 500);
  const mod = await import(`../services/captcha.js?t=${Date.now()}_7`);
  const result = await mod.verifyCaptcha("some-token");
  assert.equal(result.ok, true); // fail open
});

test("isCaptchaEnabled returns false by default", async () => {
  const { isCaptchaEnabled } = await import(`../services/captcha.js?t=${Date.now()}_8`);
  assert.equal(isCaptchaEnabled(), false);
});

test("getCaptchaSiteKey returns null when disabled", async () => {
  const { getCaptchaSiteKey } = await import(`../services/captcha.js?t=${Date.now()}_9`);
  assert.equal(getCaptchaSiteKey(), null);
});

test("getCaptchaSiteKey returns key when enabled", async () => {
  process.env.CAPTCHA_ENABLED = "true";
  process.env.CAPTCHA_SITE_KEY = "0x4AAAAAA_test_key";
  const mod = await import(`../services/captcha.js?t=${Date.now()}_10`);
  assert.equal(mod.getCaptchaSiteKey(), "0x4AAAAAA_test_key");
});
