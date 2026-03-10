import test from "node:test";
import assert from "node:assert/strict";

test("route modules import successfully", async () => {
  const preview = await import("../routes/preview.js");
  const webhooks = await import("../routes/webhooks.js");

  assert.equal(typeof preview.default, "function");
  assert.equal(typeof webhooks.default, "function");
});
