import test from "node:test";
import assert from "node:assert/strict";
import { buildGalleryRouter } from "../routes/gallery.js";
import express from "express";

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
  });
  app.use("/api/gallery", router);
  return app;
}

async function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json });
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
  });
  app.use("/api/gallery", router);
  const { status, body } = await request(app, "/api/gallery/designs");
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.error, "gallery_unavailable");
});
