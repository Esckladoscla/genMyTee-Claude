import test from "node:test";
import assert from "node:assert/strict";
import {
  _resetIdempotencyStateForTests,
  getOrderRecord,
  isCompleted,
  markCompleted,
  markFailed,
  startProcessing,
} from "../services/idempotency.js";

test("idempotency marks completed and blocks duplicates", () => {
  process.env.DB_PATH = ":memory:";
  _resetIdempotencyStateForTests();

  try {
    const start = startProcessing("order-1", { externalId: "external-1" });
    assert.equal(start.ok, true);

    markCompleted("order-1", { externalId: "external-1", printfulOrderId: "pf-1" });

    assert.equal(isCompleted("order-1"), true);

    const duplicate = startProcessing("order-1", { externalId: "external-1" });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.reason, "completed");
  } finally {
    _resetIdempotencyStateForTests();
  }
});

test("idempotency allows retry after failure", () => {
  process.env.DB_PATH = ":memory:";
  _resetIdempotencyStateForTests();

  try {
    const first = startProcessing("order-2", { externalId: "external-2" });
    assert.equal(first.ok, true);

    markFailed("order-2", new Error("Printful timeout"));

    const retry = startProcessing("order-2", { externalId: "external-2" });
    assert.equal(retry.ok, true);
    assert.equal(retry.reason, "restarted");

    const record = getOrderRecord("order-2");
    assert.equal(record.status, "processing");
    assert.equal(Number(record.attempts), 2);
  } finally {
    _resetIdempotencyStateForTests();
  }
});
