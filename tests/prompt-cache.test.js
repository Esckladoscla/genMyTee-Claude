import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPrompt,
  getCachedImage,
  cacheImage,
  getCacheStats,
  _resetPromptCacheForTests,
} from "../services/prompt-cache.js";

test.beforeEach(() => {
  _resetPromptCacheForTests();
  process.env.DB_PATH = ":memory:";
  process.env.PROMPT_CACHE_TTL_HOURS = "24";
});

test.afterEach(() => {
  _resetPromptCacheForTests();
  delete process.env.DB_PATH;
  delete process.env.PROMPT_CACHE_TTL_HOURS;
});

test("hashPrompt produces consistent hash for same prompt", () => {
  const h1 = hashPrompt("a wolf in the forest");
  const h2 = hashPrompt("a wolf in the forest");
  assert.equal(h1, h2);
});

test("hashPrompt normalizes whitespace and case", () => {
  const h1 = hashPrompt("A  Wolf  in the  Forest");
  const h2 = hashPrompt("a wolf in the forest");
  assert.equal(h1, h2);
});

test("hashPrompt returns different hashes for different prompts", () => {
  const h1 = hashPrompt("a wolf");
  const h2 = hashPrompt("a tiger");
  assert.notEqual(h1, h2);
});

test("getCachedImage returns miss for unknown prompt", () => {
  const result = getCachedImage("unknown prompt");
  assert.equal(result.hit, false);
});

test("cacheImage stores and getCachedImage retrieves", () => {
  cacheImage("test prompt", "https://example.com/image.png");
  const result = getCachedImage("test prompt");
  assert.equal(result.hit, true);
  assert.equal(result.image_url, "https://example.com/image.png");
});

test("cache lookup is case-insensitive", () => {
  cacheImage("Wolf Design", "https://example.com/wolf.png");
  const result = getCachedImage("wolf design");
  assert.equal(result.hit, true);
});

test("getCacheStats returns stats", () => {
  cacheImage("prompt1", "https://example.com/1.png");
  cacheImage("prompt2", "https://example.com/2.png");
  getCachedImage("prompt1"); // hit
  getCachedImage("prompt1"); // hit

  const stats = getCacheStats();
  assert.equal(stats.cached_prompts, 2);
  assert.equal(stats.total_hits, 2);
  assert.ok(stats.top_prompts.length > 0);
  assert.equal(stats.top_prompts[0].hits, 2);
});

test("cache respects TTL", () => {
  // Set extremely short TTL
  process.env.PROMPT_CACHE_TTL_HOURS = "0";
  _resetPromptCacheForTests();
  process.env.DB_PATH = ":memory:";

  cacheImage("old prompt", "https://example.com/old.png");
  const result = getCachedImage("old prompt");
  // With 0 hours TTL, everything is expired
  assert.equal(result.hit, false);
});
