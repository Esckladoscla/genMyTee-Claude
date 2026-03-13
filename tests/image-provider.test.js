import test from "node:test";
import assert from "node:assert/strict";
import {
  getProvider,
  getProviderName,
  registerProvider,
  listProviders,
  generateImage,
  moderatePrompt,
} from "../services/image-provider.js";

test.afterEach(() => {
  delete process.env.IMAGE_PROVIDER;
});

test("getProviderName defaults to openai", () => {
  assert.equal(getProviderName(), "openai");
});

test("getProviderName reads IMAGE_PROVIDER env", () => {
  process.env.IMAGE_PROVIDER = "stable-diffusion";
  assert.equal(getProviderName(), "stable-diffusion");
});

test("getProvider returns openai provider by default", () => {
  const provider = getProvider();
  assert.equal(provider.name, "openai");
});

test("registerProvider adds a new provider", () => {
  registerProvider("test-provider", {
    generateImage: async () => Buffer.from("test"),
    moderatePrompt: async () => ({ flagged: false }),
    available: () => true,
  });

  const providers = listProviders();
  assert.ok(providers.some((p) => p.name === "test-provider"));
});

test("getProvider falls back to available provider when primary unavailable", () => {
  registerProvider("fallback", {
    generateImage: async () => Buffer.from("fallback"),
    moderatePrompt: async () => ({ flagged: false }),
    available: () => true,
  });

  // Set primary to nonexistent provider
  process.env.IMAGE_PROVIDER = "nonexistent";
  const provider = getProvider();
  // Should fallback to an available one
  assert.ok(provider.available());
});

test("generateImage delegates to active provider", async () => {
  registerProvider("mock-gen", {
    generateImage: async (prompt) => Buffer.from(`generated:${prompt}`),
    moderatePrompt: async () => ({ flagged: false }),
    available: () => true,
  });

  process.env.IMAGE_PROVIDER = "mock-gen";
  const result = await generateImage("test prompt");
  assert.equal(result.toString(), "generated:test prompt");
});

test("moderatePrompt delegates to active provider", async () => {
  registerProvider("mock-mod", {
    generateImage: async () => Buffer.from("x"),
    moderatePrompt: async (prompt) => ({ flagged: prompt.includes("bad") }),
    available: () => true,
  });

  process.env.IMAGE_PROVIDER = "mock-mod";
  const clean = await moderatePrompt("good prompt");
  assert.equal(clean.flagged, false);

  const flagged = await moderatePrompt("bad prompt");
  assert.equal(flagged.flagged, true);
});

test("listProviders shows availability status", () => {
  const providers = listProviders();
  assert.ok(providers.length >= 1);
  assert.ok(providers.some((p) => p.name === "openai"));
  for (const p of providers) {
    assert.equal(typeof p.available, "boolean");
    assert.equal(typeof p.active, "boolean");
  }
});
