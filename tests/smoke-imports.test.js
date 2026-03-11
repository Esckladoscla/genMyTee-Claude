import test from "node:test";
import assert from "node:assert/strict";

test("route modules import successfully", async () => {
  const preview = await import("../routes/preview.js");
  const orders = await import("../routes/orders.js");

  assert.equal(typeof preview.default, "function");
  assert.equal(typeof orders.default, "function");
});
