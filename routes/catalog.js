import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadProducts() {
  const raw = readFileSync(
    join(__dirname, "..", "data", "products.json"),
    "utf8"
  );
  return JSON.parse(raw).products;
}

export function buildCatalogRouter({ productsFn = loadProducts } = {}) {
  const router = express.Router();

  router.get("/products", (_req, res) => {
    try {
      const products = productsFn();
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
      return res.json({ ok: true, product });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "catalog_unavailable" });
    }
  });

  return router;
}

const router = buildCatalogRouter();
export default router;
