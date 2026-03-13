import test from "node:test";
import assert from "node:assert/strict";
import {
  _resetIdempotencyStateForTests,
  getOrderRecord,
  getTracking,
  isCompleted,
  markCompleted,
  markFailed,
  startProcessing,
  updateTracking,
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

test("updateTracking stores and getTracking retrieves tracking data", () => {
  process.env.DB_PATH = ":memory:";
  _resetIdempotencyStateForTests();

  try {
    startProcessing("order-track-1", { externalId: "ext-track-1" });
    markCompleted("order-track-1", { externalId: "ext-track-1", printfulOrderId: "pf-track-1" });

    updateTracking("order-track-1", {
      printfulStatus: "fulfilled",
      trackingNumber: "LX123456789ES",
      trackingUrl: "https://tracking.example.com/LX123456789ES",
      shippingCarrier: "DHL",
    });

    const tracking = getTracking("order-track-1");
    assert.equal(tracking.printful_order_id, "pf-track-1");
    assert.equal(tracking.printful_status, "fulfilled");
    assert.equal(tracking.tracking_number, "LX123456789ES");
    assert.equal(tracking.tracking_url, "https://tracking.example.com/LX123456789ES");
    assert.equal(tracking.shipping_carrier, "DHL");
    assert.ok(tracking.tracking_updated_at);
  } finally {
    _resetIdempotencyStateForTests();
  }
});

test("getTracking returns null for unknown order", () => {
  process.env.DB_PATH = ":memory:";
  _resetIdempotencyStateForTests();

  try {
    const tracking = getTracking("nonexistent-order");
    assert.equal(tracking, null);
  } finally {
    _resetIdempotencyStateForTests();
  }
});

test("updateTracking preserves existing values with COALESCE", () => {
  process.env.DB_PATH = ":memory:";
  _resetIdempotencyStateForTests();

  try {
    startProcessing("order-track-2", { externalId: "ext-track-2" });
    markCompleted("order-track-2", { printfulOrderId: "pf-track-2" });

    // First update: set status
    updateTracking("order-track-2", { printfulStatus: "inprocess" });

    // Second update: add tracking number without clearing status
    updateTracking("order-track-2", {
      trackingNumber: "TRACK999",
      trackingUrl: "https://track.example.com/999",
    });

    const tracking = getTracking("order-track-2");
    assert.equal(tracking.printful_status, "inprocess");
    assert.equal(tracking.tracking_number, "TRACK999");
    assert.equal(tracking.tracking_url, "https://track.example.com/999");
  } finally {
    _resetIdempotencyStateForTests();
  }
});
