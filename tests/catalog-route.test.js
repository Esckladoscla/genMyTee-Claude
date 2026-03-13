import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildCatalogRouter } from "../routes/catalog.js";
import { withServer } from "./helpers/http.js";

const sampleProducts = [
  {
    slug: "camiseta-personalizada",
    name: "Camiseta Personalizada",
    product_key: "all-over-print-mens-athletic-t-shirt",
    base_price_eur: 39,
    sizes: ["S", "M", "L"],
    customizable: true,
  },
  {
    slug: "polo-adidas",
    name: "Polo Adidas Premium",
    product_key: "adidas-premium-polo-shirt",
    base_price_eur: 55,
    colors: ["Black", "White"],
    sizes: ["S", "M", "L"],
    customizable: true,
  },
];

const stubLayoutSupport = () => null;

function createCatalogApp(router) {
  const app = express();
  app.use("/api/catalog", router);
  return app;
}

test("catalog returns all products", async () => {
  const router = buildCatalogRouter({ productsFn: () => sampleProducts, layoutSupportFn: stubLayoutSupport });

  await withServer(createCatalogApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/catalog/products`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.products.length, 2);
    assert.equal(data.products[0].slug, "camiseta-personalizada");
  });
});

test("catalog returns single product by slug", async () => {
  const router = buildCatalogRouter({ productsFn: () => sampleProducts, layoutSupportFn: stubLayoutSupport });

  await withServer(createCatalogApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/catalog/products/polo-adidas`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.product.name, "Polo Adidas Premium");
    assert.equal(data.product.base_price_eur, 55);
  });
});

test("catalog returns 404 for unknown slug", async () => {
  const router = buildCatalogRouter({ productsFn: () => sampleProducts, layoutSupportFn: stubLayoutSupport });

  await withServer(createCatalogApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/catalog/products/no-existe`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, "product_not_found");
  });
});

const sampleBundles = [
  { id: "pack-3", name: "Pack 3", min_items: 3, categories: ["camisetas"], bundle_price_eur: 79, active: true },
  { id: "pack-inactive", name: "Inactive", min_items: 2, categories: ["gorras"], bundle_price_eur: 40, active: false },
];

test("catalog bundles returns only active bundles", async () => {
  const router = buildCatalogRouter({
    productsFn: () => sampleProducts,
    layoutSupportFn: stubLayoutSupport,
    bundlesFn: () => sampleBundles,
  });

  await withServer(createCatalogApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/catalog/bundles`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.bundles.length, 1);
    assert.equal(data.bundles[0].id, "pack-3");
  });
});

test("catalog loads from real products.json", async () => {
  const router = buildCatalogRouter({ layoutSupportFn: stubLayoutSupport });

  await withServer(createCatalogApp(router), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/catalog/products`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.products.length > 0, "should have at least one product");
    assert.ok(
      data.products.every((p) => p.slug && p.product_key),
      "all products should have slug and product_key"
    );
  });
});
