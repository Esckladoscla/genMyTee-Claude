import test from "node:test";
import assert from "node:assert/strict";
import { buildPrintfulItems } from "../services/order-processing.js";

const stubResolveVariantId = () => 12345;
const baseItem = {
  product_key: "all-over-print-mens-athletic-t-shirt",
  color: "Black",
  size: "M",
  quantity: 1,
  image_url: "https://example.com/design.png",
};

test("buildPrintfulItems includes position when layout is provided", () => {
  const items = buildPrintfulItems(
    [{ ...baseItem, layout: { scale: 0.9, offset_x: 10, offset_y: -5 } }],
    { resolveVariantIdFn: stubResolveVariantId }
  );

  assert.equal(items.length, 1);
  const file = items[0].files[0];
  assert.ok(file.position, "file entry should have a position object");
  assert.equal(typeof file.position.area_width, "number");
  assert.equal(typeof file.position.area_height, "number");
  assert.equal(typeof file.position.width, "number");
  assert.equal(typeof file.position.height, "number");
  assert.equal(typeof file.position.top, "number");
  assert.equal(typeof file.position.left, "number");
  // Scaled down: width should be less than area_width
  assert.ok(file.position.width < file.position.area_width);
});

test("buildPrintfulItems omits position when layout is null", () => {
  const items = buildPrintfulItems(
    [{ ...baseItem }],
    { resolveVariantIdFn: stubResolveVariantId }
  );

  assert.equal(items.length, 1);
  const file = items[0].files[0];
  assert.equal(file.position, undefined, "file entry should not have position");
});

test("buildPrintfulItems omits position for default layout values", () => {
  const items = buildPrintfulItems(
    [{ ...baseItem, layout: { scale: 1, offset_x: 0, offset_y: 0 } }],
    { resolveVariantIdFn: stubResolveVariantId }
  );

  assert.equal(items.length, 1);
  const file = items[0].files[0];
  assert.equal(file.position, undefined, "default layout should not produce position");
});

test("buildPrintfulItems clamps out-of-range layout values", () => {
  const items = buildPrintfulItems(
    [{ ...baseItem, layout: { scale: 5, offset_x: 999, offset_y: -999 } }],
    { resolveVariantIdFn: stubResolveVariantId }
  );

  assert.equal(items.length, 1);
  const file = items[0].files[0];
  assert.ok(file.position, "should have position even with extreme values");
  // Scale clamped to 1.35, so width = 1800 * 1.35 = 2430
  assert.equal(file.position.width, Math.round(1800 * 1.35));
  assert.equal(file.position.height, Math.round(2400 * 1.35));
});
