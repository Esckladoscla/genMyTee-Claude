import { getBooleanEnv, getEnv } from "./env.js";
import { createOrderSafe, normalizeMockupLayout, buildPositionFromLayout } from "./printful.js";
import { getPrintfileDims } from "./layout-probe.js";
import {
  inferProductKey,
  normalizeProperties,
  parseVariantTitle,
  resolveVariantId,
} from "./variants.js";
import { resolveProductionUrl } from "./watermark.js";

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
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

function getFallbackImageUrl() {
  const explicit = toNonEmptyString(getEnv("AI_FALLBACK_IMAGE_URL"));
  if (explicit) return explicit;

  const base = toNonEmptyString(getEnv("R2_PUBLIC_BASE_URL"));
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/printful/fallback.png`;
}

/**
 * Builds Printful line items from a generic order item list.
 *
 * Each item can be in one of two formats:
 *
 * 1. Generic (new standalone format):
 *    { product_key, color, size, quantity, image_url, placement? }
 *
 * 2. Shopify-compatible (line_items with properties):
 *    { variant_title, quantity, properties: [{name, value}] | {key: value} }
 *
 * Returns an array of Printful-ready item objects.
 */
export function buildPrintfulItems(
  items,
  {
    normalizePropertiesFn = normalizeProperties,
    parseVariantTitleFn = parseVariantTitle,
    inferProductKeyFn = inferProductKey,
    resolveVariantIdFn = resolveVariantId,
    defaultPlacement = "front",
    aiEnabled = true,
    fallbackImageUrl = null,
  } = {}
) {
  const printfulItems = [];

  for (const item of items) {
    // Generic format: direct color/size/image_url fields
    if (item.image_url && item.product_key) {
      const imageUrl = toNonEmptyString(item.image_url);
      if (!imageUrl) continue;

      const productKey = toNonEmptyString(item.product_key) || DEFAULT_PRODUCT_KEY;
      const color = toNonEmptyString(item.color) || null;
      const size = toNonEmptyString(item.size) || null;

      const variantId = resolveVariantIdFn({
        productKey,
        color,
        size,
        variantTitle: item.variant_title,
      });

      const numericVariantId = Number(variantId);
      if (!Number.isFinite(numericVariantId) || numericVariantId <= 0) continue;

      const placement =
        toNonEmptyString(item.placement) ||
        placementByProduct[productKey] ||
        defaultPlacement;

      const quantity = Math.max(1, Number(item.quantity) || 1);

      const fileEntry = { type: "default", placement, url: resolveProductionUrl(imageUrl) };
      if (item.layout) {
        const normalized = normalizeMockupLayout(item.layout);
        if (normalized) {
          const dims = getPrintfileDims(productKey);
          const fileSpec = dims ? { width: dims.width, height: dims.height } : {};
          fileEntry.position = buildPositionFromLayout(fileSpec, normalized);
        }
      }

      printfulItems.push({
        variant_id: numericVariantId,
        quantity,
        files: [fileEntry],
      });
      continue;
    }

    // Shopify-compatible format: properties-based
    const properties = normalizePropertiesFn(item?.properties);
    let imageUrl = toNonEmptyString(properties?.ai_image_url);
    if (!imageUrl && !aiEnabled) {
      imageUrl = fallbackImageUrl;
    }
    if (!imageUrl) continue;

    const productKey =
      toNonEmptyString(properties?.pf_product_key) ||
      inferProductKeyFn(item, properties) ||
      DEFAULT_PRODUCT_KEY;

    const parsedVariant = parseVariantTitleFn(item?.variant_title);
    const variantId = resolveVariantIdFn({
      productKey,
      color: parsedVariant.color,
      size: parsedVariant.size,
      variantTitle: item?.variant_title,
    });

    const numericVariantId = Number(variantId);
    if (!Number.isFinite(numericVariantId) || numericVariantId <= 0) continue;

    const placement =
      toNonEmptyString(properties?.pf_placement) ||
      placementByProduct[productKey] ||
      defaultPlacement;

    const quantity = Math.max(1, Number(item?.quantity) || 1);

    printfulItems.push({
      variant_id: numericVariantId,
      quantity,
      files: [{ type: "default", placement, url: resolveProductionUrl(imageUrl) }],
    });
  }

  return printfulItems;
}

/**
 * Processes an order: resolves variants, builds Printful payload, creates the order.
 *
 * Accepts a generic order shape:
 * {
 *   order_id: string,
 *   external_id?: string,
 *   recipient: { name, address1, address2?, city, country_code, state_code, zip, email?, phone? },
 *   items: Array<GenericItem | ShopifyLineItem>
 * }
 *
 * Returns { ok, skipped, reason, external_id, printful_order_id }
 */
export async function processOrder(
  order,
  {
    resolveVariantIdFn = resolveVariantId,
    normalizePropertiesFn = normalizeProperties,
    parseVariantTitleFn = parseVariantTitle,
    inferProductKeyFn = inferProductKey,
    createOrderSafeFn = createOrderSafe,
    idempotency,
    getConfirmFn = () => getBooleanEnv("PRINTFUL_CONFIRM", { defaultValue: false }),
    getDefaultPlacementFn = () => getEnv("PRINTFUL_PLACEMENT", { defaultValue: "front" }),
    logger = console,
  } = {}
) {
  const orderId = String(order.order_id || "").trim();
  if (!orderId) {
    throw new Error("order_id is required");
  }

  const externalId = toNonEmptyString(order.external_id) || orderId;

  // Idempotency check
  if (idempotency) {
    const lock = await Promise.resolve(
      idempotency.startProcessing(orderId, { externalId })
    );
    if (!lock.ok) {
      return {
        ok: true,
        skipped: true,
        reason: lock.reason === "completed" ? "duplicate_order" : "order_processing",
        external_id: lock.record?.external_id || externalId,
        printful_order_id: lock.record?.printful_order_id || null,
      };
    }
  }

  const defaultPlacement =
    String(getDefaultPlacementFn() || "front").trim() || "front";
  const aiEnabled = getBooleanEnv("AI_ENABLED", { defaultValue: true });
  const fallbackImageUrl = getFallbackImageUrl();

  const printfulItems = buildPrintfulItems(order.items || [], {
    resolveVariantIdFn,
    normalizePropertiesFn,
    parseVariantTitleFn,
    inferProductKeyFn,
    defaultPlacement,
    aiEnabled,
    fallbackImageUrl,
  });

  if (!printfulItems.length) {
    if (idempotency) {
      await Promise.resolve(
        idempotency.markCompleted(orderId, { externalId, printfulOrderId: null })
      );
    }
    return {
      ok: true,
      skipped: true,
      reason: "no_valid_items",
      external_id: externalId,
      printful_order_id: null,
    };
  }

  const recipient = order.recipient
    ? compactObject(order.recipient)
    : { name: "Customer" };

  const printfulPayload = {
    external_id: externalId,
    recipient,
    items: printfulItems,
  };

  try {
    const printfulOrder = await createOrderSafeFn(printfulPayload, {
      confirm: getConfirmFn(),
    });

    const printfulOrderId =
      toNonEmptyString(printfulOrder?.id) ||
      toNonEmptyString(printfulOrder?.order?.id) ||
      null;

    if (idempotency) {
      await Promise.resolve(
        idempotency.markCompleted(orderId, { externalId, printfulOrderId })
      );
    }

    logger.log("[order] processed", {
      order_id: orderId,
      external_id: externalId,
      printful_order_id: printfulOrderId,
    });

    return {
      ok: true,
      skipped: false,
      reason: null,
      external_id: externalId,
      printful_order_id: printfulOrderId,
    };
  } catch (error) {
    if (idempotency) {
      await Promise.resolve(idempotency.markFailed(orderId, error));
    }
    throw error;
  }
}
