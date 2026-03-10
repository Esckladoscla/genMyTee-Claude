import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildWebhooksRouter } from "../routes/webhooks.js";
import { withServer } from "./helpers/http.js";

function createWebhookApp(router) {
  const app = express();
  app.use("/api/webhooks", express.raw({ type: "application/json" }), router);
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

const sampleOrder = {
  id: 12345,
  email: "buyer@example.com",
  shipping_address: {
    name: "Jane Buyer",
    address1: "123 Main St",
    city: "Austin",
    country_code: "US",
    province_code: "TX",
    zip: "73301",
  },
  line_items: [
    {
      variant_title: "M",
      quantity: 1,
      properties: [
        { name: "ai_prompt", value: "A bold geometric tiger" },
        { name: "ai_image_url", value: "https://cdn.test/previews/tiger.png" },
        { name: "pf_product_key", value: "all-over-print-mens-athletic-t-shirt" },
        { name: "pf_placement", value: "front" },
      ],
    },
  ],
};

test("webhook rejects invalid HMAC", async () => {
  let createOrderCalls = 0;

  const router = buildWebhooksRouter({
    verifyWebhookHmacFn: () => false,
    createOrderSafeFn: async () => {
      createOrderCalls += 1;
      return { id: "pf_ignored" };
    },
    resolveVariantIdFn: () => 9954,
    idempotency: createIdempotencyDouble(),
  });

  await withServer(createWebhookApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/webhooks/orders/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": "invalid",
      },
      body: JSON.stringify(sampleOrder),
    });

    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "invalid_webhook_signature");
    assert.equal(createOrderCalls, 0);
  });
});

test("webhook processes once and skips duplicate order", async () => {
  const idempotency = createIdempotencyDouble();
  const receivedPayloads = [];

  const router = buildWebhooksRouter({
    verifyWebhookHmacFn: () => true,
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async (payload) => {
      receivedPayloads.push(payload);
      return { id: "pf_1" };
    },
    idempotency,
    getConfirmFn: () => false,
    logger: {
      log() {},
      warn() {},
      error() {},
    },
  });

  await withServer(createWebhookApp(router), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/webhooks/orders/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": "valid",
      },
      body: JSON.stringify(sampleOrder),
    });

    assert.equal(first.status, 200);
    const firstPayload = await first.json();
    assert.equal(firstPayload.ok, true);
    assert.equal(firstPayload.skipped, false);
    assert.equal(firstPayload.printful_order_id, "pf_1");

    const duplicate = await fetch(`${baseUrl}/api/webhooks/orders/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": "valid",
      },
      body: JSON.stringify(sampleOrder),
    });

    assert.equal(duplicate.status, 200);
    const duplicatePayload = await duplicate.json();
    assert.equal(duplicatePayload.ok, true);
    assert.equal(duplicatePayload.skipped, true);
    assert.equal(duplicatePayload.reason, "duplicate_order");

    assert.equal(receivedPayloads.length, 1);
    assert.equal(receivedPayloads[0].items[0].variant_id, 9954);
    assert.equal(receivedPayloads[0].items[0].files[0].url, "https://cdn.test/previews/tiger.png");
  });
});

test("webhook uses fallback image when AI is disabled and ai_image_url is missing", async () => {
  const originalAiEnabled = process.env.AI_ENABLED;
  const originalR2Base = process.env.R2_PUBLIC_BASE_URL;
  process.env.AI_ENABLED = "false";
  process.env.R2_PUBLIC_BASE_URL = "https://assets.example.com";

  const idempotency = createIdempotencyDouble();
  const receivedPayloads = [];

  const router = buildWebhooksRouter({
    verifyWebhookHmacFn: () => true,
    resolveVariantIdFn: () => 9954,
    createOrderSafeFn: async (payload) => {
      receivedPayloads.push(payload);
      return { id: "pf_fallback_1" };
    },
    idempotency,
    logger: { log() {}, warn() {}, error() {} },
  });

  const fallbackOrder = {
    id: 777001,
    line_items: [
      {
        variant_title: "M",
        quantity: 1,
        properties: [
          { name: "ai_prompt", value: "demo" },
          { name: "pf_product_key", value: "all-over-print-mens-athletic-t-shirt" },
          { name: "pf_placement", value: "front" },
        ],
      },
    ],
  };

  try {
    await withServer(createWebhookApp(router), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/webhooks/orders/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Hmac-Sha256": "valid",
        },
        body: JSON.stringify(fallbackOrder),
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.skipped, false);
      assert.equal(payload.printful_order_id, "pf_fallback_1");

      assert.equal(receivedPayloads.length, 1);
      assert.equal(
        receivedPayloads[0].items[0].files[0].url,
        "https://assets.example.com/printful/fallback.png"
      );
    });
  } finally {
    if (originalAiEnabled === undefined) {
      delete process.env.AI_ENABLED;
    } else {
      process.env.AI_ENABLED = originalAiEnabled;
    }

    if (originalR2Base === undefined) {
      delete process.env.R2_PUBLIC_BASE_URL;
    } else {
      process.env.R2_PUBLIC_BASE_URL = originalR2Base;
    }
  }
});
