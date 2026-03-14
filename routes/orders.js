import express from "express";
import { processOrder } from "../services/order-processing.js";
import { createOrderSafe } from "../services/printful.js";
import { getBooleanEnv, getEnv } from "../services/env.js";
import { markCompleted, markFailed, startProcessing } from "../services/idempotency.js";
import { resolveVariantId } from "../services/variants.js";

/**
 * Generic order creation route.
 *
 * POST /api/orders
 *
 * Body:
 * {
 *   order_id: string,
 *   external_id?: string,
 *   recipient: { name, address1, address2?, city, country_code, state_code, zip, email?, phone? },
 *   items: [{ product_key, color, size, quantity, image_url, placement? }]
 * }
 */
export function buildOrdersRouter({
  resolveVariantIdFn = resolveVariantId,
  createOrderSafeFn = createOrderSafe,
  idempotency = { startProcessing, markCompleted, markFailed },
  getConfirmFn = () => getBooleanEnv("PRINTFUL_CONFIRM", { defaultValue: false }),
  getDefaultPlacementFn = () => getEnv("PRINTFUL_PLACEMENT", { defaultValue: "front" }),
  logger = console,
} = {}) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const body = req.body || {};

    const orderId = String(body.order_id || "").trim();
    if (!orderId) {
      return res.status(422).json({ ok: false, error: "order_id is required" });
    }

    if (!Array.isArray(body.items) || !body.items.length) {
      return res.status(422).json({ ok: false, error: "items array is required" });
    }

    if (!body.recipient || !body.recipient.name) {
      return res.status(422).json({ ok: false, error: "recipient with name is required" });
    }

    try {
      const result = await processOrder(body, {
        resolveVariantIdFn,
        createOrderSafeFn,
        idempotency,
        getConfirmFn,
        getDefaultPlacementFn,
        logger,
      });

      const status =
        result.skipped && result.reason === "order_processing" ? 202 : 200;
      return res.status(status).json(result);
    } catch (error) {
      logger.error("[orders] processing failed", {
        order_id: orderId,
        message: error?.message,
      });
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  return router;
}

const router = buildOrdersRouter();
export default router;
