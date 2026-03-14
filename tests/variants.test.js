import test from "node:test";
import assert from "node:assert/strict";
import { parseVariantTitle, resolveVariantId } from "../services/variants.js";

test("parseVariantTitle supports color/size and size-only", () => {
  assert.deepEqual(parseVariantTitle("Black / M"), { color: "Black", size: "M" });
  assert.deepEqual(parseVariantTitle("M"), { color: null, size: "M" });
});

test("resolveVariantId resolves AOP athletic tee size", () => {
  const variantId = resolveVariantId({
    productKey: "all-over-print-mens-athletic-t-shirt",
    variantTitle: "M",
  });

  assert.equal(variantId, 9954);
});

test("resolveVariantId supports product key alias for Gildan 5000", () => {
  const direct = resolveVariantId({
    productKey: "gildan-5000",
    variantTitle: "S",
  });

  const aliased = resolveVariantId({
    productKey: "unisex-classic-tee-gildan-5000",
    variantTitle: "S",
  });

  assert.equal(aliased, direct);
});

test("resolveVariantId supports reversed title order (size/color)", () => {
  const variantId = resolveVariantId({
    productKey: "all-over-print-men-s-rash-guard",
    variantTitle: "M / White",
  });

  assert.equal(variantId, 9328);
});

test("resolveVariantId falls back for default title variants", () => {
  const variantId = resolveVariantId({
    productKey: "all-over-print-men-s-rash-guard",
    variantTitle: "Default Title",
  });

  assert.equal(variantId, 9326);
});
