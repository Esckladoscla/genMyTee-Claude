import test from "node:test";
import assert from "node:assert/strict";
import { buildGalleryRouter } from "../routes/gallery.js";
import express from "express";

const MOCK_COLLECTIONS = [
  { id: "animales", name: "Animales", slug: "animales", description: "Fauna salvaje", emoji: "🐺", featured: true, sort_order: 1 },
  { id: "naturaleza", name: "Naturaleza", slug: "naturaleza", description: "Paisajes", emoji: "🏔️", featured: true, sort_order: 2 },
];

const MOCK_DESIGNS = [
  {
    id: "lobo-geometrico",
    title: "Lobo Geométrico",
    description: "Lobo en triángulos",
    image_url: "https://example.com/lobo.png",
    tags: ["animal", "geometrico"],
    compatible_products: ["all-over-print-mens-athletic-t-shirt"],
    featured: true,
    prompt_used: "Lobo geométrico",
    collection: "animales",
  },
  {
    id: "flores-botanicas",
    title: "Flores Botánicas",
    description: "Flores acuarela",
    image_url: "https://example.com/flores.png",
    tags: ["floral", "acuarela"],
    compatible_products: ["all-over-print-mens-athletic-t-shirt", "all-over-print-womens-crop-top"],
    featured: false,
    prompt_used: "Flores botánicas",
    collection: "naturaleza",
  },
  {
    id: "no-image",
    title: "Sin Imagen",
    description: "Diseño sin imagen aún",
    image_url: null,
    tags: ["placeholder"],
    compatible_products: [],
    featured: false,
    prompt_used: "test",
    collection: "animales",
  },
];

const MOCK_PRODUCTS = [
  {
    slug: "camiseta-personalizada",
    name: "Camiseta Personalizada",
    product_key: "all-over-print-mens-athletic-t-shirt",
    base_price_eur: 39,
    sizes: ["S", "M", "L"],
    colors: undefined,
    garment_emoji: "👕",
    image_url: "https://example.com/shirt.png",
    default_mockup_url: "https://example.com/mockup.png",
  },
  {
    slug: "crop-top",
    name: "Crop Top",
    product_key: "all-over-print-womens-crop-top",
    base_price_eur: 35,
    sizes: ["XS", "S", "M", "L"],
    garment_emoji: "👚",
    image_url: "https://example.com/crop.png",
    default_mockup_url: null,
  },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = buildGalleryRouter({
    designsFn: () => MOCK_DESIGNS,
    productsFn: () => MOCK_PRODUCTS,
    collectionsFn: () => MOCK_COLLECTIONS,
  });
  app.use("/api/gallery", router);
  return app;
}

async function request(app, path, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(async (res) => {
          if (raw) {
            const text = await res.text();
            server.close();
            resolve({ status: res.status, body: text, headers: res.headers });
          } else {
            const json = await res.json();
            server.close();
            resolve({ status: res.status, body: json });
          }
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

test("GET /api/gallery/designs returns only designs with images", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.designs.length, 2);
  assert.equal(body.total, 2);
  assert.ok(body.designs.every((d) => d.image_url !== null));
});

test("GET /api/gallery/designs?show_all=true includes designs without images", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs?show_all=true");
  assert.equal(status, 200);
  assert.equal(body.designs.length, 3);
});

test("GET /api/gallery/designs?tag=animal filters by tag", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs?tag=animal&show_all=true");
  assert.equal(status, 200);
  assert.equal(body.designs.length, 1);
  assert.equal(body.designs[0].id, "lobo-geometrico");
});

test("GET /api/gallery/designs?featured=true returns only featured", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs?featured=true");
  assert.equal(status, 200);
  assert.equal(body.designs.length, 1);
  assert.equal(body.designs[0].id, "lobo-geometrico");
});

test("GET /api/gallery/designs?collection=animales filters by collection", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs?collection=animales&show_all=true");
  assert.equal(status, 200);
  assert.equal(body.designs.length, 2);
  assert.ok(body.designs.every((d) => d.collection === "animales"));
});

test("GET /api/gallery/designs/:id returns design with compatible products", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs/lobo-geometrico");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.design.id, "lobo-geometrico");
  assert.equal(body.compatible_products.length, 1);
  assert.equal(body.compatible_products[0].slug, "camiseta-personalizada");
  assert.equal(body.compatible_products[0].base_price_eur, 39);
  assert.ok(body.compatible_products[0].sizes);
});

test("GET /api/gallery/designs/:id with multiple compatible products", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs/flores-botanicas");
  assert.equal(status, 200);
  assert.equal(body.compatible_products.length, 2);
});

test("GET /api/gallery/designs/:id returns 404 for unknown design", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/designs/nonexistent");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, "design_not_found");
});

test("GET /api/gallery/designs handles designsFn error gracefully", async () => {
  const app = express();
  app.use(express.json());
  const router = buildGalleryRouter({
    designsFn: () => { throw new Error("fail"); },
    productsFn: () => MOCK_PRODUCTS,
    collectionsFn: () => MOCK_COLLECTIONS,
  });
  app.use("/api/gallery", router);
  const { status, body } = await request(app, "/api/gallery/designs");
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.error, "gallery_unavailable");
});

// ── Collection endpoints ──

test("GET /api/gallery/collections returns enriched collections", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/collections");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.collections.length, 2);
  assert.equal(body.collections[0].id, "animales");
  assert.equal(body.collections[0].design_count, 2); // lobo + no-image
  assert.equal(body.collections[1].design_count, 1); // flores
});

// ── SSR design page ──

test("GET /api/gallery/page/:id returns HTML design page", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/page/lobo-geometrico", { raw: true });
  assert.equal(status, 200);
  assert.ok(body.includes("Lobo Geométrico"));
  assert.ok(body.includes("schema.org"));
  assert.ok(body.includes("BreadcrumbList"));
});

test("GET /api/gallery/page/:id returns 404 for unknown", async () => {
  const app = buildApp();
  const { status } = await request(app, "/api/gallery/page/unknown", { raw: true });
  assert.equal(status, 404);
});

// ── SSR collection page ──

test("GET /api/gallery/coleccion/:slug returns HTML collection page", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/coleccion/animales", { raw: true });
  assert.equal(status, 200);
  assert.ok(body.includes("Animales"));
  assert.ok(body.includes("CollectionPage"));
});

test("GET /api/gallery/coleccion/:slug returns 404 for unknown", async () => {
  const app = buildApp();
  const { status } = await request(app, "/api/gallery/coleccion/nonexistent", { raw: true });
  assert.equal(status, 404);
});

// ── Sitemap ──

test("GET /api/gallery/sitemap.xml returns valid XML sitemap", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gallery/sitemap.xml", { raw: true });
  assert.equal(status, 200);
  assert.ok(body.includes('<?xml'));
  assert.ok(body.includes("genmytee.com"));
  assert.ok(body.includes("lobo-geometrico"));
  assert.ok(body.includes("coleccion/animales"));
});
