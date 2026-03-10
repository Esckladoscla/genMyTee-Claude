import { parseVariantTitle, resolveVariantId } from "./variants.js";

export function resolvePrintfulVariant({
  productKey,
  pfProductKey,
  variant_title,
  variantTitle,
  color,
  size,
}) {
  const key = String(productKey || pfProductKey || "").trim();
  if (!key) throw new Error("resolvePrintfulVariant: missing productKey");

  const title = variantTitle || variant_title || "";
  const parsed = parseVariantTitle(title);
  const resolvedColor = color || parsed.color;
  const resolvedSize = size || parsed.size;

  const variantId = resolveVariantId({
    productKey: key,
    color: resolvedColor,
    size: resolvedSize,
    variantTitle: title,
  });

  if (!variantId) {
    throw new Error(
      `No variant_id match for productKey=${key}, color=${resolvedColor || "n/a"}, size=${resolvedSize || "n/a"}`
    );
  }

  return variantId;
}
