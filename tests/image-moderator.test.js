import test from "node:test";
import assert from "node:assert/strict";

test.beforeEach(() => {
  delete process.env.IMAGE_MODERATION_ENABLED;
  delete process.env.OPENAI_KEY;
});

test.afterEach(() => {
  delete process.env.IMAGE_MODERATION_ENABLED;
  delete process.env.OPENAI_KEY;
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

test("moderateImage returns not flagged when disabled", async () => {
  const { moderateImage } = await import(`../services/image-moderator.js?t=${Date.now()}_1`);
  const result = await moderateImage("https://example.com/image.png");
  assert.equal(result.flagged, false);
});

test("moderateImage returns not flagged when enabled but no API key", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_2`);
  const result = await mod.moderateImage("https://example.com/image.png");
  assert.equal(result.flagged, false);
});

test("moderateImage returns not flagged for clean image", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  process.env.OPENAI_KEY = "test-key";
  mockFetch({
    results: [{ flagged: false, categories: { sexual: false, violence: false } }],
  });
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_3`);
  const result = await mod.moderateImage("https://example.com/clean.png");
  assert.equal(result.flagged, false);
});

test("moderateImage flags violating image with categories", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  process.env.OPENAI_KEY = "test-key";
  mockFetch({
    results: [{
      flagged: true,
      categories: { sexual: true, violence: false, hate: true },
    }],
  });
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_4`);
  const result = await mod.moderateImage("https://example.com/bad.png");
  assert.equal(result.flagged, true);
  assert.ok(result.categories.includes("sexual"));
  assert.ok(result.categories.includes("hate"));
  assert.ok(!result.categories.includes("violence"));
});

test("moderateImage fails open on API error", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  process.env.OPENAI_KEY = "test-key";
  mockFetch({}, 500);
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_5`);
  const result = await mod.moderateImage("https://example.com/image.png");
  assert.equal(result.flagged, false);
});

test("moderateImage fails open on network error", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  process.env.OPENAI_KEY = "test-key";
  mockFetchError("ECONNREFUSED");
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_6`);
  const result = await mod.moderateImage("https://example.com/image.png");
  assert.equal(result.flagged, false);
});

test("moderateImage handles null/empty URL", async () => {
  process.env.IMAGE_MODERATION_ENABLED = "true";
  process.env.OPENAI_KEY = "test-key";
  const mod = await import(`../services/image-moderator.js?t=${Date.now()}_7`);
  const result = await mod.moderateImage("");
  assert.equal(result.flagged, false);
});

test("isImageModerationEnabled defaults to false", async () => {
  const { isImageModerationEnabled } = await import(`../services/image-moderator.js?t=${Date.now()}_8`);
  assert.equal(isImageModerationEnabled(), false);
});
