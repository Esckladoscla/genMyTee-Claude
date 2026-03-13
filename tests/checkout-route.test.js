import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildCheckoutRouter } from "../routes/checkout.js";
import { withServer } from "./helpers/http.js";

const sampleProducts = [
  {
    slug: "camiseta-personalizada",
    name: "Camiseta Personalizada",
    product_key: "all-over-print-mens-athletic-t-shirt",
    base_price_eur: 39,
    sizes: ["S", "M", "L"],
    customizable: true,
  },
];

function createCheckoutApp(router) {
  const app = express();
  // Webhook needs raw body for signature verification (before JSON parsing)
  app.use(
    "/api/checkout/webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req, res, next) => {
      req.url = "/webhook";
      router(req, res, next);
    }
  );
  // Session route uses parsed JSON body
  app.use("/api/checkout", express.json(), router);
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
      const restarted = { ...existing, status: "processing", attempts: (existing.attempts || 0) + 1 };
      records.set(orderId, restarted);
      return { ok: true, reason: "restarted", record: restarted };
    },
    markCompleted(orderId, { externalId, printfulOrderId } = {}) {
      const existing = records.get(orderId) || { order_id: orderId, attempts: 1 };
      records.set(orderId, { ...existing, external_id: externalId, printful_order_id: printfulOrderId, status: "completed" });
    },
    markFailed(orderId, error) {
      const existing = records.get(orderId) || { order_id: orderId, attempts: 1 };
      records.set(orderId, { ...existing, status: "failed", last_error: String(error?.message || error) });
    },
    getTracking(orderId) {
      const existing = records.get(orderId);
      if (!existing) return null;
      return {
        printful_order_id: existing.printful_order_id || null,
        printful_status: existing.printful_status || null,
        tracking_number: existing.tracking_number || null,
        tracking_url: existing.tracking_url || null,
        shipping_carrier: existing.shipping_carrier || null,
        tracking_updated_at: existing.tracking_updated_at || null,
      };
    },
    updateTracking(orderId, { printfulStatus, trackingNumber, trackingUrl, shippingCarrier } = {}) {
      const existing = records.get(orderId);
      if (!existing) return;
      if (printfulStatus) existing.printful_status = printfulStatus;
      if (trackingNumber) existing.tracking_number = trackingNumber;
      if (trackingUrl) existing.tracking_url = trackingUrl;
      if (shippingCarrier) existing.shipping_carrier = shippingCarrier;
      existing.tracking_updated_at = new Date().toISOString();
      records.set(orderId, existing);
    },
  };
}

const silentLogger = { log() {}, warn() {}, error() {} };

test("checkout session rejects missing items", async () => {
  const router = buildCheckoutRouter({
    createCheckoutSessionFn: async () => ({ id: "cs_1", url: "https://stripe.com/pay" }),
    productsFn: () => sampleProducts,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.error, "items array is required");
  });
});

test("checkout session rejects unknown product", async () => {
  const router = buildCheckoutRouter({
    createCheckoutSessionFn: async () => ({ id: "cs_1", url: "https://stripe.com/pay" }),
    productsFn: () => sampleProducts,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ slug: "no-existe", image_url: "https://cdn/img.png", size: "M" }],
      }),
    });
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.match(data.error, /unknown product/);
  });
});

test("checkout session rejects item without image_url", async () => {
  const router = buildCheckoutRouter({
    createCheckoutSessionFn: async () => ({ id: "cs_1", url: "https://stripe.com/pay" }),
    productsFn: () => sampleProducts,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ slug: "camiseta-personalizada", size: "M" }],
      }),
    });
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.error, "each item must have an image_url");
  });
});

test("checkout session creates session with valid items", async () => {
  let receivedItems = null;
  let receivedUrls = null;

  const router = buildCheckoutRouter({
    createCheckoutSessionFn: async (items, urls) => {
      receivedItems = items;
      receivedUrls = urls;
      return { id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" };
    },
    productsFn: () => sampleProducts,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            slug: "camiseta-personalizada",
            size: "L",
            quantity: 2,
            image_url: "https://cdn.test/design.png",
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.url, "https://checkout.stripe.com/pay/cs_test_123");
    assert.equal(data.session_id, "cs_test_123");

    // Verify items passed to Stripe
    assert.equal(receivedItems.length, 1);
    assert.equal(receivedItems[0].name, "Camiseta Personalizada");
    assert.equal(receivedItems[0].product_key, "all-over-print-mens-athletic-t-shirt");
    assert.equal(receivedItems[0].size, "L");
    assert.equal(receivedItems[0].quantity, 2);
    assert.equal(receivedItems[0].price, 39);
    assert.equal(receivedItems[0].image_url, "https://cdn.test/design.png");

    // Verify success/cancel URLs
    assert.ok(receivedUrls.successUrl.includes("checkout-success.html"));
    assert.ok(receivedUrls.cancelUrl.includes("checkout-cancel.html"));
  });
});

test("checkout webhook rejects missing signature", async () => {
  const router = buildCheckoutRouter({
    verifyWebhookSignatureFn: () => { throw new Error("should not be called"); },
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "test" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "missing stripe-signature header");
  });
});

test("checkout webhook rejects invalid signature", async () => {
  const router = buildCheckoutRouter({
    verifyWebhookSignatureFn: () => { throw new Error("Invalid signature"); },
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=bad",
      },
      body: JSON.stringify({ type: "test" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "invalid_signature");
  });
});

test("checkout webhook ignores non-checkout events", async () => {
  const router = buildCheckoutRouter({
    verifyWebhookSignatureFn: (body, sig) => ({
      type: "payment_intent.succeeded",
      data: { object: {} },
    }),
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=valid",
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.event_type, "payment_intent.succeeded");
  });
});

test("checkout webhook processes completed session", async () => {
  const idempotency = createIdempotencyDouble();
  let processedOrder = null;

  const router = buildCheckoutRouter({
    verifyWebhookSignatureFn: (body, sig) => ({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_completed_123",
          customer_details: {
            name: "Test Customer",
            email: "test@example.com",
          },
          shipping_details: {
            name: "Test Customer",
            address: {
              line1: "123 Main St",
              city: "Madrid",
              country: "ES",
              state: "MD",
              postal_code: "28001",
            },
          },
        },
      },
    }),
    extractOrderFromSessionFn: async (session) => ({
      order_id: session.id,
      external_id: `genmytee-${session.id}`,
      recipient: {
        name: "Test Customer",
        address1: "123 Main St",
        city: "Madrid",
        country_code: "ES",
        state_code: "MD",
        zip: "28001",
        email: "test@example.com",
      },
      items: [
        {
          product_key: "all-over-print-mens-athletic-t-shirt",
          size: "L",
          quantity: 1,
          image_url: "https://cdn.test/design.png",
        },
      ],
    }),
    resolveVariantIdFn: ({ size }) => (size === "L" ? 9960 : null),
    createOrderSafeFn: async (payload) => {
      processedOrder = payload;
      return { id: "pf_stripe_1" };
    },
    idempotency,
    getConfirmFn: () => false,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123,v1=valid",
      },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.result.ok, true);
    assert.equal(data.result.skipped, false);
    assert.equal(data.result.printful_order_id, "pf_stripe_1");

    // Verify Printful order was created correctly
    assert.ok(processedOrder);
    assert.equal(processedOrder.external_id, "genmytee-cs_completed_123");
    assert.equal(processedOrder.recipient.name, "Test Customer");
    assert.equal(processedOrder.items[0].variant_id, 9960);
  });
});

test("checkout status returns session info", async () => {
  const router = buildCheckoutRouter({
    retrieveSessionFn: async (sessionId) => ({
      session_id: sessionId,
      payment_status: "paid",
      email: "test@example.com",
      fulfillment_status: "processing",
    }),
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/checkout/status?session_id=cs_lookup_123`
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.session_id, "cs_lookup_123");
    assert.equal(data.payment_status, "paid");
    assert.equal(data.email, "test@example.com");
  });
});

test("checkout status returns 404 for unknown session", async () => {
  const router = buildCheckoutRouter({
    retrieveSessionFn: async () => {
      const err = new Error("No such checkout session");
      err.code = "resource_missing";
      err.statusCode = 404;
      throw err;
    },
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/api/checkout/status?session_id=cs_nope`
    );
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, "session_not_found");
  });
});

test("checkout status rejects missing session_id", async () => {
  const router = buildCheckoutRouter({
    retrieveSessionFn: async () => { throw new Error("should not be called"); },
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/status`);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.error, "session_id is required");
  });
});

test("checkout status returns tracking data from Printful", async () => {
  const idempotency = createIdempotencyDouble();
  // Simulate a completed order with a printful_order_id
  idempotency.startProcessing("cs_track_1", { externalId: "gmt-pi_track" });
  idempotency.markCompleted("cs_track_1", { externalId: "gmt-pi_track", printfulOrderId: "12345" });

  const router = buildCheckoutRouter({
    retrieveSessionFn: async (sessionId) => ({
      session_id: sessionId,
      payment_status: "paid",
      email: "buyer@test.com",
      fulfillment_status: "processing",
    }),
    getPrintfulOrderFn: async (orderId) => ({
      id: 12345,
      status: "fulfilled",
      shipments: [
        {
          tracking_number: "LX123456789ES",
          tracking_url: "https://tracking.example.com/LX123456789ES",
          carrier: "DHL",
        },
      ],
    }),
    idempotency,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/status?session_id=cs_track_1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.printful_status, "fulfilled");
    assert.equal(data.tracking_number, "LX123456789ES");
    assert.equal(data.tracking_url, "https://tracking.example.com/LX123456789ES");
    assert.equal(data.shipping_carrier, "DHL");
  });
});

test("checkout status returns cached tracking without calling Printful", async () => {
  const idempotency = createIdempotencyDouble();
  idempotency.startProcessing("cs_cached_1", { externalId: "gmt-pi_cached" });
  idempotency.markCompleted("cs_cached_1", { externalId: "gmt-pi_cached", printfulOrderId: "67890" });
  // Pre-populate cached tracking (fresh timestamp)
  idempotency.updateTracking("cs_cached_1", {
    printfulStatus: "fulfilled",
    trackingNumber: "CACHED123",
    trackingUrl: "https://tracking.example.com/CACHED123",
    shippingCarrier: "FedEx",
  });

  let printfulCalled = false;
  const router = buildCheckoutRouter({
    retrieveSessionFn: async (sessionId) => ({
      session_id: sessionId,
      payment_status: "paid",
      email: "cached@test.com",
      fulfillment_status: "processing",
    }),
    getPrintfulOrderFn: async () => {
      printfulCalled = true;
      return { id: 67890, status: "fulfilled", shipments: [] };
    },
    idempotency,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/status?session_id=cs_cached_1`);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.tracking_number, "CACHED123");
    assert.equal(data.shipping_carrier, "FedEx");
    // fulfilled is terminal — should NOT call Printful again
    assert.equal(printfulCalled, false);
  });
});

test("checkout status works without tracking data", async () => {
  const idempotency = createIdempotencyDouble();

  const router = buildCheckoutRouter({
    retrieveSessionFn: async (sessionId) => ({
      session_id: sessionId,
      payment_status: "paid",
      email: "no-track@test.com",
      fulfillment_status: "processing",
    }),
    idempotency,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/status?session_id=cs_notrack`);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.payment_status, "paid");
    // No tracking fields when no order in DB
    assert.equal(data.tracking_number, undefined);
  });
});

test("checkout status handles Printful API failure gracefully", async () => {
  const idempotency = createIdempotencyDouble();
  idempotency.startProcessing("cs_fail_pf", { externalId: "gmt-fail" });
  idempotency.markCompleted("cs_fail_pf", { externalId: "gmt-fail", printfulOrderId: "99999" });

  const router = buildCheckoutRouter({
    retrieveSessionFn: async (sessionId) => ({
      session_id: sessionId,
      payment_status: "paid",
      email: "fail@test.com",
      fulfillment_status: "processing",
    }),
    getPrintfulOrderFn: async () => {
      throw new Error("Printful API down");
    },
    idempotency,
    logger: silentLogger,
  });

  await withServer(createCheckoutApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/checkout/status?session_id=cs_fail_pf`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    // Still returns basic info even if Printful fails
    assert.equal(data.payment_status, "paid");
  });
});
