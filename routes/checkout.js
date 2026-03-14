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
import { sendOrderConfirmation } from "../services/email.js";
import { getUserByEmail, grantUserGenerationBonus, getPurchaseBonusAmount } from "../services/auth.js";
import { grantSessionBonus, getSessionByEmail } from "../services/session-limiter.js";
import { markCompleted, markFailed, startProcessing, getTracking, updateTracking, recordOrderAmount } from "../services/idempotency.js";
import { getOrder as getPrintfulOrder } from "../services/printful.js";
import { resolveVariantId } from "../services/variants.js";

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
  createOrderSafeFn = createOrderSafe,
  idempotency = { startProcessing, markCompleted, markFailed, getTracking, updateTracking, recordOrderAmount },
  getPrintfulOrderFn = getPrintfulOrder,
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

      // Validate and clamp layout if provided
      let layout;
      if (item.layout && typeof item.layout === "object") {
        const s = Number(item.layout.scale);
        const ox = Number(item.layout.offset_x);
        const oy = Number(item.layout.offset_y);
        if (Number.isFinite(s) && Number.isFinite(ox) && Number.isFinite(oy)) {
          const scale = Math.min(1.35, Math.max(0.30, s));
          const offset_x = Math.min(100, Math.max(-100, ox));
          const offset_y = Math.min(100, Math.max(-100, oy));
          const isDefault = Math.abs(scale - 1) < 0.001 && Math.abs(offset_x) < 0.001 && Math.abs(offset_y) < 0.001;
          if (!isDefault) {
            layout = { scale: +scale.toFixed(3), offset_x: +offset_x.toFixed(2), offset_y: +offset_y.toFixed(2) };
          }
        }
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
        layout,
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

  // GET /status — order status lookup with tracking
  router.get("/status", async (req, res) => {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) {
      return res.status(422).json({ ok: false, error: "session_id is required" });
    }

    let status;
    try {
      status = await retrieveSessionFn(sessionId);
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

    // Enrich with tracking data from SQLite + Printful
    let tracking = null;
    try {
      const cached = idempotency.getTracking(sessionId);
      if (cached?.printful_order_id) {
        const TRACKING_CACHE_MS = 30 * 60 * 1000; // 30 minutes
        const cacheAge = cached.tracking_updated_at
          ? Date.now() - Date.parse(cached.tracking_updated_at)
          : Infinity;
        const isFresh = Number.isFinite(cacheAge) && cacheAge < TRACKING_CACHE_MS;
        const isTerminal = cached.printful_status === "fulfilled" || cached.printful_status === "canceled";

        if (isFresh || isTerminal) {
          tracking = cached;
        } else {
          // Fetch fresh data from Printful
          try {
            const pfOrder = await getPrintfulOrderFn(cached.printful_order_id);
            const shipment = Array.isArray(pfOrder?.shipments) ? pfOrder.shipments[0] : null;
            const pfStatus = pfOrder?.status || null;

            const trackingData = {
              printfulStatus: pfStatus,
              trackingNumber: shipment?.tracking_number || null,
              trackingUrl: shipment?.tracking_url || null,
              shippingCarrier: shipment?.carrier || shipment?.service || null,
            };

            idempotency.updateTracking(sessionId, trackingData);
            tracking = {
              printful_order_id: cached.printful_order_id,
              printful_status: trackingData.printfulStatus,
              tracking_number: trackingData.trackingNumber,
              tracking_url: trackingData.trackingUrl,
              shipping_carrier: trackingData.shippingCarrier,
            };
          } catch (pfError) {
            logger.error("[checkout] Printful order fetch failed", {
              printful_order_id: cached.printful_order_id,
              message: pfError?.message,
            });
            // Return stale cached data if available
            tracking = cached;
          }
        }
      }
    } catch {
      // Tracking enrichment is best-effort; don't fail the whole request
    }

    const response = { ok: true, ...status };
    if (tracking) {
      response.printful_status = tracking.printful_status || null;
      response.tracking_number = tracking.tracking_number || null;
      response.tracking_url = tracking.tracking_url || null;
      response.shipping_carrier = tracking.shipping_carrier || null;
    }

    return res.json(response);
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
        createOrderSafeFn,
        idempotency,
        getConfirmFn,
        getDefaultPlacementFn,
        logger,
      });

      // Record order amount for dashboard metrics
      try {
        if (session.amount_total && idempotency.recordOrderAmount) {
          idempotency.recordOrderAmount(session.id, {
            amountCents: session.amount_total,
            currency: session.currency || "eur",
          });
        }
      } catch { /* best-effort */ }

      // Send order confirmation email (best-effort)
      try {
        const customerEmail = session.customer_details?.email;
        if (customerEmail && !result.skipped) {
          sendOrderConfirmation(customerEmail, { orderId: session.id }, { logger })
            .catch(() => {});
        }
      } catch { /* best-effort */ }

      // Grant generation bonus on successful purchase (best-effort)
      try {
        const customerEmail = session.customer_details?.email;
        if (customerEmail && !result.skipped) {
          const bonus = getPurchaseBonusAmount();
          // Try authenticated user first
          const user = getUserByEmail(customerEmail);
          if (user) {
            grantUserGenerationBonus(user.id, bonus);
            logger.log("[checkout] generation bonus granted to user", {
              user_id: user.id, bonus,
            });
          }
          // Also grant session bonus (covers guest checkout)
          const sessionId = getSessionByEmail(customerEmail);
          if (sessionId) {
            grantSessionBonus(sessionId, bonus);
            logger.log("[checkout] session generation bonus granted", {
              session_id: sessionId, bonus,
            });
          }
        }
      } catch { /* best-effort */ }

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
