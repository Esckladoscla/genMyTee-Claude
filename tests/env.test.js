import test from "node:test";
import assert from "node:assert/strict";
import { _resetEnvStateForTests, getEnv } from "../services/env.js";

test("env aliases resolve and warn once", () => {
  const originalCanonical = process.env.PRINTFUL_API_KEY;
  const originalAlias = process.env.PRINTFUL_KEY;

  delete process.env.PRINTFUL_API_KEY;
  process.env.PRINTFUL_KEY = "legacy-key";

  _resetEnvStateForTests();

  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));

  try {
    const first = getEnv("PRINTFUL_API_KEY", { aliases: ["PRINTFUL_KEY"] });
    const second = getEnv("PRINTFUL_API_KEY", { aliases: ["PRINTFUL_KEY"] });

    assert.equal(first, "legacy-key");
    assert.equal(second, "legacy-key");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = previousWarn;

    if (originalCanonical === undefined) {
      delete process.env.PRINTFUL_API_KEY;
    } else {
      process.env.PRINTFUL_API_KEY = originalCanonical;
    }

    if (originalAlias === undefined) {
      delete process.env.PRINTFUL_KEY;
    } else {
      process.env.PRINTFUL_KEY = originalAlias;
    }
  }
});
