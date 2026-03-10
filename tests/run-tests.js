const files = [
  "./env.test.js",
  "./idempotency.test.js",
  "./preview-route.test.js",
  "./smoke-imports.test.js",
  "./variants.test.js",
  "./webhooks-route.test.js",
];

for (const file of files) {
  await import(file);
}
