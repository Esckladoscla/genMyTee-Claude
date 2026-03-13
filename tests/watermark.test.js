import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { applyWatermark, resolveProductionUrl } from "../services/watermark.js";

test("applyWatermark returns a valid PNG buffer larger than input", async () => {
  // Create a small test image (100x100 red square)
  const input = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const result = await applyWatermark(input);

  assert.ok(Buffer.isBuffer(result));
  assert.ok(result.length > 0);

  // Verify output is valid PNG by reading metadata
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 100);
  assert.equal(metadata.height, 100);
});

test("applyWatermark modifies the image (not identical to input)", async () => {
  const input = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const result = await applyWatermark(input);

  // Buffers should differ (watermark was applied)
  assert.notDeepEqual(input, result);
});

test("applyWatermark rejects non-buffer input", async () => {
  await assert.rejects(() => applyWatermark("not a buffer"), /imageBuffer must be a non-empty Buffer/);
  await assert.rejects(() => applyWatermark(Buffer.alloc(0)), /imageBuffer must be a non-empty Buffer/);
  await assert.rejects(() => applyWatermark(null), /imageBuffer must be a non-empty Buffer/);
});

test("resolveProductionUrl swaps previews to production", () => {
  assert.equal(
    resolveProductionUrl("https://cdn.example.com/previews/art-123.png"),
    "https://cdn.example.com/production/art-123.png"
  );
});

test("resolveProductionUrl leaves non-preview URLs unchanged", () => {
  assert.equal(
    resolveProductionUrl("https://cdn.example.com/other/art-123.png"),
    "https://cdn.example.com/other/art-123.png"
  );
});

test("resolveProductionUrl handles null/undefined gracefully", () => {
  assert.equal(resolveProductionUrl(null), null);
  assert.equal(resolveProductionUrl(undefined), undefined);
  assert.equal(resolveProductionUrl(""), "");
});
