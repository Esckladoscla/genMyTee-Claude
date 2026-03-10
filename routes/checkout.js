import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCheckoutSession,
  verifyWebhookSignature,
  extractOrderFromSession,
  retrieveSession,
} from "../services/stripe.js";
import { processOrder } from "../services/order-processing.js";
import { createOrderSafe } from "../services/printful.js";
import { getBooleanEnv, getEnv } from "../services/env.js";
import { markCompleted, markFailed, startProcessing } from "../services/idempotency.js";
import {
  inferProductKey,
  normalizeProperties,
  parseVariantTitle,
  resolveVariantId,
} from "../services/variants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadProducts() {
  const raw = readFileSync(
    join(__dirname, "..", "data", "products.json"),
    "utf8"
  );
  return JSON.parse(raw).products;
}

/**
 * Checkout routes:
 *
 * POST /api/checkout/session — create a Stripe Checkout Session from cart items
 * POST /api/checkout/webhook — handle Stripe webhook events
 */
export function buildCheckoutRouter({
  createCheckoutSessionFn = createCheckoutSession,
  verifyWebhookSignatureFn = verifyWebhookSignature,
  extractOrderFromSessionFn = extractOrderFromSession,
  retrieveSessionFn = retrieveSession,
  processOrderFn = processOrder,
  resolveVariantIdFn = resolveVariantId,
  normalizePropertiesFn = normalizeProperties,
  parseVariantTitleFn = parseVariantTitle,
  inferProductKeyFn = inferProductKey,
  createOrderSafeFn = createOrderSafe,
  idempotency = { startProcessing, markCompleted, markFailed },
  getConfirmFn = () => getBooleanEnv("PRINTFUL_CONFIRM", { defaultValue: false }),
  getDefaultPlacementFn = () => getEnv("PRINTFUL_PLACEMENT", { defaultValue: "front" }),
  productsFn = loadProducts,
  logger = console,
} = {}) {
  const router = express.Router();

  // POST /session — create checkout session
  router.post("/session", express.json(), async (req, res) => {
    const body = req.body || {};

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(422).json({ ok: false, error: "items array is required" });
    }

    // Validate items against catalog
    let products;
    try {
      products = productsFn();
    } catch {
      return res.status(500).json({ ok: false, error: "catalog_unavailable" });
    }

    const validatedItems = [];
    for (const item of body.items) {
      const product = products.find(
        (p) => p.slug === item.slug || p.product_key === item.product_key
      );
      if (!product) {
        return res.status(422).json({
          ok: false,
          error: `unknown product: ${item.slug || item.product_key}`,
        });
      }

      if (!item.image_url) {
        return res.status(422).json({
          ok: false,
          error: "each item must have an image_url",
        });
      }

      validatedItems.push({
        name: product.name,
        product_key: product.product_key,
        slug: product.slug,
        color: item.color || undefined,
        size: item.size || product.sizes?.[0] || "M",
        quantity: Math.max(1, Math.min(10, Number(item.quantity) || 1)),
        price: product.base_price_eur,
        image_url: item.image_url,
      });
    }

    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}`;

    try {
      const session = await createCheckoutSessionFn(validatedItems, {
        successUrl: `${baseUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/checkout-cancel.html`,
      });

      return res.json({ ok: true, url: session.url, session_id: session.id });
    } catch (error) {
      logger.error("[checkout] session creation failed", {
        message: error?.message,
      });
      return res.status(500).json({ ok: false, error: "checkout_failed" });
    }
  });

  // GET /status — order status lookup
  router.get("/status", async (req, res) => {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) {
      return res.status(422).json({ ok: false, error: "session_id is required" });
    }

    try {
      const status = await retrieveSessionFn(sessionId);
      return res.json({ ok: true, ...status });
    } catch (error) {
      if (error?.statusCode === 404 || error?.code === "resource_missing") {
        return res.status(404).json({ ok: false, error: "session_not_found" });
      }
      logger.error("[checkout] status lookup failed", {
        session_id: sessionId,
        message: error?.message,
      });
      return res.status(500).json({ ok: false, error: "status_unavailable" });
    }
  });

  // POST /webhook — Stripe webhook handler
  // NOTE: This route expects raw body (express.raw), registered in app.js before express.json()
  router.post("/webhook", async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ ok: false, error: "missing stripe-signature header" });
    }

    let event;
    try {
      event = verifyWebhookSignatureFn(req.body, signature);
    } catch (error) {
      logger.error("[checkout] webhook signature verification failed", {
        message: error?.message,
      });
      return res.status(400).json({ ok: false, error: "invalid_signature" });
    }

    // Only handle checkout.session.completed
    if (event.type !== "checkout.session.completed") {
      return res.json({ ok: true, handled: false, event_type: event.type });
    }

    const session = event.data.object;

    try {
      const orderData = await extractOrderFromSessionFn(session);

      const result = await processOrderFn(orderData, {
        resolveVariantIdFn,
        normalizePropertiesFn,
        parseVariantTitleFn,
        inferProductKeyFn,
        createOrderSafeFn,
        idempotency,
        getConfirmFn,
        getDefaultPlacementFn,
        logger,
      });

      logger.log("[checkout] webhook processed", {
        session_id: session.id,
        skipped: result.skipped,
        printful_order_id: result.printful_order_id,
      });

      return res.json({ ok: true, handled: true, result });
    } catch (error) {
      logger.error("[checkout] webhook processing failed", {
        session_id: session.id,
        message: error?.message,
      });
      return res.status(500).json({ ok: false, error: "processing_failed" });
    }
  });

  return router;
}

const router = buildCheckoutRouter();
export default router;
