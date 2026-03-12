import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getLayoutSupport } from "../services/layout-probe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadProducts() {
  const raw = readFileSync(
    join(__dirname, "..", "data", "products.json"),
    "utf8"
  );
  return JSON.parse(raw).products;
}

function enrichWithLayoutSupport(product, layoutSupportFn) {
  const entry = layoutSupportFn(product.product_key);
  // null = untested (probe rate-limited) → default to true for customizable products
  // { supported: true } = probe confirmed layout works
  // { supported: false } = probe confirmed layout does NOT work
  // Legacy: boolean value (old cache format)
  const supported = typeof entry === "boolean" ? entry : entry?.supported ?? null;
  const supportsLayout = supported === true || (supported === null && product.customizable === true);
  const printfileDims = entry?.printfile_dims || null;
  return { ...product, supports_layout: supportsLayout, printfile_dims: printfileDims };
}

export function buildCatalogRouter({
  productsFn = loadProducts,
  layoutSupportFn = getLayoutSupport,
} = {}) {
  const router = express.Router();

  router.get("/products", (_req, res) => {
    try {
      const products = productsFn().map((p) =>
        enrichWithLayoutSupport(p, layoutSupportFn)
      );
      return res.json({ ok: true, products });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "catalog_unavailable" });
    }
  });

  router.get("/products/:slug", (req, res) => {
    try {
      const products = productsFn();
      const product = products.find((p) => p.slug === req.params.slug);
      if (!product) {
        return res.status(404).json({ ok: false, error: "product_not_found" });
      }
      return res.json({
        ok: true,
        product: enrichWithLayoutSupport(product, layoutSupportFn),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "catalog_unavailable" });
    }
  });

  return router;
}

const router = buildCatalogRouter();
export default router;
