import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildOrdersRouter } from "../routes/orders.js";
import { withServer } from "./helpers/http.js";

function createOrderApp(router) {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", router);
  return app;
}

function createIdempotencyDouble() {
  const records = new Map();

  return {
    startProcessing(orderId, { externalId } = {}) {
      const existing = records.get(orderId);
      if (!existing) {
        const record = {
          order_id: orderId,
          external_id: externalId,
          printful_order_id: null,
          status: "processing",
          attempts: 1,
        };
        records.set(orderId, record);
        return { ok: true, reason: "started", record };
      }

      if (existing.status === "completed") {
        return { ok: false, reason: "completed", record: existing };
      }

      if (existing.status === "processing") {
        return { ok: false, reason: "processing", record: existing };
      }

      const restarted = {
        ...existing,
        status: "processing",
        attempts: Number(existing.attempts || 0) + 1,
        external_id: externalId || existing.external_id,
      };
      records.set(orderId, restarted);
      return { ok: true, reason: "restarted", record: restarted };
    },

    markCompleted(orderId, { externalId, printfulOrderId } = {}) {
      const existing = records.get(orderId) || { order_id: orderId, attempts: 1 };
      records.set(orderId, {
        ...existing,
        external_id: externalId || existing.external_id,
        printful_order_id: printfulOrderId || null,
        status: "completed",
      });
    },

    markFailed(orderId, error) {
      const existing = records.get(orderId) || { order_id: orderId, attempts: 1 };
      records.set(orderId, {
        ...existing,
        status: "failed",
        last_error: String(error?.message || error || "Unknown error"),
      });
    },
  };
}

const silentLogger = { log() {}, warn() {}, error() {} };

test("orders route rejects missing order_id", async () => {
  const router = buildOrdersRouter({
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async () => ({ id: "pf_1" }),
    idempotency: createIdempotencyDouble(),
    logger: silentLogger,
  });

  await withServer(createOrderApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [], recipient: { name: "Test" } }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "order_id is required");
  });
});

test("orders route rejects missing items", async () => {
  const router = buildOrdersRouter({
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async () => ({ id: "pf_1" }),
    idempotency: createIdempotencyDouble(),
    logger: silentLogger,
  });

  await withServer(createOrderApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: "test-1", recipient: { name: "Test" } }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error, "items array is required");
  });
});

test("orders route rejects missing recipient", async () => {
  const router = buildOrdersRouter({
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async () => ({ id: "pf_1" }),
    idempotency: createIdempotencyDouble(),
    logger: silentLogger,
  });

  await withServer(createOrderApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "test-1",
        items: [{ product_key: "tee", image_url: "https://cdn/img.png", size: "M" }],
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error, "recipient with name is required");
  });
});

test("orders route processes generic order with direct color/size", async () => {
  const idempotency = createIdempotencyDouble();
  const receivedPayloads = [];

  const router = buildOrdersRouter({
    resolveVariantIdFn: ({ productKey, color, size }) => {
      if (productKey === "all-over-print-mens-athletic-t-shirt" && size === "L") return 9960;
      return null;
    },
    createOrderSafeFn: async (payload) => {
      receivedPayloads.push(payload);
      return { id: "pf_generic_1" };
    },
    idempotency,
    getConfirmFn: () => false,
    logger: silentLogger,
  });

  await withServer(createOrderApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "stripe_sess_123",
        external_id: "genmytee-001",
        recipient: {
          name: "Maria Garcia",
          address1: "Calle Mayor 10",
          city: "Madrid",
          country_code: "ES",
          state_code: "MD",
          zip: "28001",
          email: "maria@example.com",
        },
        items: [
          {
            product_key: "all-over-print-mens-athletic-t-shirt",
            color: "Black",
            size: "L",
            quantity: 2,
            image_url: "https://cdn.test/previews/design-123.png",
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.skipped, false);
    assert.equal(payload.external_id, "genmytee-001");
    assert.equal(payload.printful_order_id, "pf_generic_1");

    assert.equal(receivedPayloads.length, 1);
    assert.equal(receivedPayloads[0].external_id, "genmytee-001");
    assert.equal(receivedPayloads[0].items[0].variant_id, 9960);
    assert.equal(receivedPayloads[0].items[0].quantity, 2);
    assert.equal(receivedPayloads[0].items[0].files[0].url, "https://cdn.test/previews/design-123.png");
    assert.equal(receivedPayloads[0].items[0].files[0].placement, "front");
    assert.equal(receivedPayloads[0].recipient.name, "Maria Garcia");
    assert.equal(receivedPayloads[0].recipient.city, "Madrid");
  });
});

test("orders route skips duplicate order via idempotency", async () => {
  const idempotency = createIdempotencyDouble();
  let createCalls = 0;

  const router = buildOrdersRouter({
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async () => {
      createCalls += 1;
      return { id: "pf_1" };
    },
    idempotency,
    logger: silentLogger,
  });

  const orderBody = {
    order_id: "dup-test-1",
    recipient: { name: "Test User", address1: "1 St", city: "NY", country_code: "US", state_code: "NY", zip: "10001" },
    items: [{ product_key: "all-over-print-mens-athletic-t-shirt", size: "M", image_url: "https://cdn/img.png" }],
  };

  await withServer(createOrderApp(router), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderBody),
    });
    assert.equal(first.status, 200);
    const firstPayload = await first.json();
    assert.equal(firstPayload.skipped, false);

    const second = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderBody),
    });
    assert.equal(second.status, 200);
    const secondPayload = await second.json();
    assert.equal(secondPayload.skipped, true);
    assert.equal(secondPayload.reason, "duplicate_order");

    assert.equal(createCalls, 1);
  });
});

test("orders route returns no_valid_items when variant cannot be resolved", async () => {
  const idempotency = createIdempotencyDouble();

  const router = buildOrdersRouter({
    resolveVariantIdFn: () => null,
    createOrderSafeFn: async () => ({ id: "should_not_be_called" }),
    idempotency,
    logger: silentLogger,
  });

  await withServer(createOrderApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: "no-variant-1",
        recipient: { name: "Test" },
        items: [{ product_key: "unknown-product", size: "M", image_url: "https://cdn/img.png" }],
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.skipped, true);
    assert.equal(payload.reason, "no_valid_items");
  });
});
