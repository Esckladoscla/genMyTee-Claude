const files = [
  "./env.test.js",
  "./idempotency.test.js",
  "./preview-route.test.js",
  "./smoke-imports.test.js",
  "./variants.test.js",
  "./orders-route.test.js",
  "./catalog-route.test.js",
  "./checkout-route.test.js",
  "./order-processing.test.js",
  "./printful-position.test.js",
];

for (const file of files) {
  await import(file);
}
