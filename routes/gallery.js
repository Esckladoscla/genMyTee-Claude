import express from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDesigns() {
  const raw = readFileSync(
    join(__dirname, "..", "data", "curated-designs.json"),
    "utf8"
  );
  return JSON.parse(raw).designs;
}

function loadProducts() {
  const raw = readFileSync(
    join(__dirname, "..", "data", "products.json"),
    "utf8"
  );
  return JSON.parse(raw).products;
}

export function buildGalleryRouter({
  designsFn = loadDesigns,
  productsFn = loadProducts,
} = {}) {
  const router = express.Router();

  router.get("/designs", (req, res) => {
    try {
      let designs = designsFn();
      const { tag, featured } = req.query;

      // Filter by tag
      if (tag) {
        const tagLower = tag.toLowerCase();
        designs = designs.filter((d) =>
          d.tags.some((t) => t.toLowerCase() === tagLower)
        );
      }

      // Filter by featured
      if (featured === "true") {
        designs = designs.filter((d) => d.featured);
      }

      // Only return designs that have an image_url (hide placeholders)
      const showAll = req.query.show_all === "true";
      if (!showAll) {
        designs = designs.filter((d) => d.image_url);
      }

      return res.json({ ok: true, designs, total: designs.length });
    } catch (error) {
      return res
        .status(500)
        .json({ ok: false, error: "gallery_unavailable" });
    }
  });

  router.get("/designs/:id", (req, res) => {
    try {
      const designs = designsFn();
      const design = designs.find((d) => d.id === req.params.id);
      if (!design) {
        return res
          .status(404)
          .json({ ok: false, error: "design_not_found" });
      }

      // Enrich with compatible product details
      const allProducts = productsFn();
      const compatibleProducts = design.compatible_products
        .map((key) => allProducts.find((p) => p.product_key === key))
        .filter(Boolean)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          product_key: p.product_key,
          base_price_eur: p.base_price_eur,
          sizes: p.sizes,
          colors: p.colors,
          garment_emoji: p.garment_emoji,
          image_url: p.image_url,
          default_mockup_url: p.default_mockup_url,
        }));

      return res.json({ ok: true, design, compatible_products: compatibleProducts });
    } catch (error) {
      return res
        .status(500)
        .json({ ok: false, error: "gallery_unavailable" });
    }
  });

  return router;
}

const router = buildGalleryRouter();
export default router;
