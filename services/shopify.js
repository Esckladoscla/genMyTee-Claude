// services/shopify.js
import { getEnv } from "./env.js";

const SHOP = getEnv("SHOPIFY_STORE");
const TOKEN = getEnv("SHOPIFY_ADMIN_TOKEN", { aliases: ["SHOPIFY_ACCESS_TOKEN"] });

// cache tonto en memoria para no spamear la API
const productKeyCache = new Map();

/**
 * Lee el metafield custom.printful_product_key del producto (Admin API REST).
 * Devuelve el 'value' o null si no existe / no hay credenciales.
 */
export async function getProductPrintfulKey(productId) {
  try {
    if (!SHOP || !TOKEN || !productId) return null;

    // cache rápida
    if (productKeyCache.has(productId)) {
      return productKeyCache.get(productId);
    }

    const url = `https://${SHOP}/admin/api/2024-07/products/${productId}/metafields.json`;
    const resp = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      // 429/403/404 → no rompas el flujo
      return null;
    }

    const data = await resp.json();
    const mf = (data.metafields || []).find(
      (m) => m.namespace === 'custom' && m.key === 'printful_product_key'
    );

    const value = mf?.value || null;
    productKeyCache.set(productId, value);
    return value;
  } catch {
    return null;
  }
}
