import crypto from "node:crypto";
import express from "express";
import { createOrderSafe } from "../services/printful.js";
import { getBooleanEnv, getEnv } from "../services/env.js";
import { markCompleted, markFailed, startProcessing } from "../services/idempotency.js";
import { getRawBodyBuffer, verifyShopifyWebhookHmac } from "../services/shopify-webhook-auth.js";
import {
  inferProductKey,
  normalizeProperties,
  parseVariantTitle,
  resolveVariantId,
} from "../services/variants.js";

const DEFAULT_PRODUCT_KEY = "all-over-print-mens-athletic-t-shirt";

const placementByProduct = {
  "all-over-print-mens-athletic-t-shirt": "front",
  "dtg-tee": "front",
  "adidas-a401": "embroidery_chest_left",
  "adidas-premium-polo-shirt": "embroidery_chest_left",
  "adidas-performance-cap": "embroidery_front",
};

function toNonEmptyString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function extractOrderId(order, rawBody) {
  const candidates = [
    order?.id,
    order?.admin_graphql_api_id,
    order?.name,
    order?.order_number,
  ];

  for (const candidate of candidates) {
    const value = toNonEmptyString(candidate);
    if (value) return value;
  }

  return `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

function buildExternalId(order, orderId) {
  return toNonEmptyString(order?.id) || toNonEmptyString(order?.name) || orderId;
}

function extractLineItems(order) {
  if (Array.isArray(order?.line_items)) return order.line_items;
  if (Array.isArray(order?.items)) return order.items;
  return [];
}

function buildRecipient(order) {
  const shipping = order?.shipping_address || {};

  const fullName =
    toNonEmptyString(shipping.name) ||
    toNonEmptyString([shipping.first_name, shipping.last_name].filter(Boolean).join(" ")) ||
    "Customer";

  return compactObject({
    name: fullName,
    address1: toNonEmptyString(shipping.address1) || "Address 1",
    address2: toNonEmptyString(shipping.address2),
    city: toNonEmptyString(shipping.city) || "City",
    country_code: toNonEmptyString(shipping.country_code) || "US",
    state_code: toNonEmptyString(shipping.province_code) || "NY",
    zip: toNonEmptyString(shipping.zip) || "10001",
    email: toNonEmptyString(order?.email) || toNonEmptyString(order?.customer?.email),
    phone: toNonEmptyString(shipping.phone) || toNonEmptyString(order?.phone),
  });
}

function getFallbackImageUrl() {
  const explicit = toNonEmptyString(getEnv("AI_FALLBACK_IMAGE_URL"));
  if (explicit) return explicit;

  const base = toNonEmptyString(getEnv("R2_PUBLIC_BASE_URL"));
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/printful/fallback.png`;
}

export function buildWebhooksRouter({
  verifyWebhookHmacFn = verifyShopifyWebhookHmac,
  getRawBodyBufferFn = getRawBodyBuffer,
  normalizePropertiesFn = normalizeProperties,
  parseVariantTitleFn = parseVariantTitle,
  inferProductKeyFn = inferProductKey,
  resolveVariantIdFn = resolveVariantId,
  createOrderSafeFn = createOrderSafe,
  idempotency = {
    startProcessing,
    markCompleted,
    markFailed,
  },
  getConfirmFn = () => getBooleanEnv("PRINTFUL_CONFIRM", { defaultValue: false }),
  getDefaultPlacementFn = () => getEnv("PRINTFUL_PLACEMENT", { defaultValue: "front" }),
  logger = console,
} = {}) {
  const router = express.Router();

  router.post("/orders/create", async (req, res) => {
    let orderId = null;
    let externalId = null;

    try {
      const rawBody = getRawBodyBufferFn(req.body);
      const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || req.get("x-shopify-hmac-sha256");

      if (!verifyWebhookHmacFn(rawBody, hmacHeader)) {
        return res.status(401).json({ ok: false, error: "invalid_webhook_signature" });
      }

      let order;
      try {
        const payloadText = rawBody.toString("utf8");
        order = payloadText ? JSON.parse(payloadText) : {};
      } catch {
        return res.status(400).json({ ok: false, error: "invalid_json_payload" });
      }

      orderId = extractOrderId(order, rawBody);
      externalId = buildExternalId(order, orderId);

      const lock = await Promise.resolve(idempotency.startProcessing(orderId, { externalId }));
      if (!lock.ok) {
        if (lock.reason === "completed") {
          return res.json({
            ok: true,
            skipped: true,
            reason: "duplicate_order",
            external_id: lock.record?.external_id || externalId,
            printful_order_id: lock.record?.printful_order_id || null,
          });
        }

        if (lock.reason === "processing") {
          return res.status(202).json({
            ok: true,
            skipped: true,
            reason: "order_processing",
            external_id: lock.record?.external_id || externalId,
            printful_order_id: lock.record?.printful_order_id || null,
          });
        }
      }

      const defaultPlacement = String(getDefaultPlacementFn() || "front").trim() || "front";
      const aiEnabled = getBooleanEnv("AI_ENABLED", { defaultValue: true });
      const fallbackImageUrl = getFallbackImageUrl();
      const lineItems = extractLineItems(order);
      const printfulItems = [];

      for (const lineItem of lineItems) {
        const properties = normalizePropertiesFn(lineItem?.properties);
        let imageUrl = toNonEmptyString(properties?.ai_image_url);
        if (!imageUrl && !aiEnabled) {
          imageUrl = fallbackImageUrl;
        }
        if (!imageUrl) continue;

        const productKey =
          toNonEmptyString(properties?.pf_product_key) ||
          inferProductKeyFn(lineItem, properties) ||
          DEFAULT_PRODUCT_KEY;

        const parsedVariant = parseVariantTitleFn(lineItem?.variant_title);
        const variantId = resolveVariantIdFn({
          productKey,
          color: parsedVariant.color,
          size: parsedVariant.size,
          variantTitle: lineItem?.variant_title,
        });

        const numericVariantId = Number(variantId);
        if (!Number.isFinite(numericVariantId)) continue;

        const placement =
          toNonEmptyString(properties?.pf_placement) || placementByProduct[productKey] || defaultPlacement;

        const quantity = Math.max(1, Number(lineItem?.quantity) || 1);

        printfulItems.push({
          variant_id: numericVariantId,
          quantity,
          files: [{ type: "default", placement, url: imageUrl }],
        });
      }

      if (!printfulItems.length) {
        await Promise.resolve(
          idempotency.markCompleted(orderId, {
            externalId,
            printfulOrderId: null,
          })
        );

        return res.json({
          ok: true,
          skipped: true,
          reason: "no_valid_items",
          external_id: externalId,
          printful_order_id: null,
        });
      }

      const printfulPayload = {
        external_id: externalId,
        recipient: buildRecipient(order),
        items: printfulItems,
      };

      const printfulOrder = await createOrderSafeFn(printfulPayload, {
        confirm: getConfirmFn(),
      });

      const printfulOrderId = toNonEmptyString(printfulOrder?.id) || toNonEmptyString(printfulOrder?.order?.id) || null;

      await Promise.resolve(
        idempotency.markCompleted(orderId, {
          externalId,
          printfulOrderId,
        })
      );

      logger.log("[webhook] order processed", {
        order_id: orderId,
        external_id: externalId,
        printful_order_id: printfulOrderId,
      });

      return res.json({
        ok: true,
        skipped: false,
        reason: null,
        external_id: externalId,
        printful_order_id: printfulOrderId,
      });
    } catch (error) {
      if (orderId) {
        await Promise.resolve(idempotency.markFailed(orderId, error));
      }

      logger.error("[webhook] processing failed", {
        order_id: orderId,
        external_id: externalId,
        message: error?.message,
      });

      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  return router;
}

const router = buildWebhooksRouter();
export default router;
