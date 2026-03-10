import { resolveVariantId } from "../services/variants.js";

function runCase(name, input) {
  const variantId = resolveVariantId(input);
  if (!variantId) {
    throw new Error(`No variant found for case: ${name}`);
  }
  console.log(`[OK] ${name} -> ${variantId}`);
}

runCase("AOP athletic tee / M", {
  productKey: "all-over-print-mens-athletic-t-shirt",
  variantTitle: "M",
});

runCase("Adidas A401 Black / XL", {
  productKey: "adidas-a401",
  variantTitle: "Black / XL",
});
