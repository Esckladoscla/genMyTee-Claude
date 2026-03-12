import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVariantId } from "./variants.js";
import { getVariant, createMockupTask, collectVariantFileSpecs, getMockupPrintfiles, extractPrintfileDimensions } from "./printful.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "..", "data", "layout-support-cache.json");
const PRODUCTS_PATH = join(__dirname, "..", "data", "products.json");
const PROBE_DELAY_MS = 2500;

const layoutSupportMap = new Map();

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.warn("[layout-probe] failed to write cache:", err.message);
  }
}

function loadProducts() {
  const raw = readFileSync(PRODUCTS_PATH, "utf8");
  return JSON.parse(raw).products;
}

function getFirstVariantId(product) {
  const color = product.colors?.[0] || null;
  const size = product.sizes?.[0] || null;
  const variantTitle = color && size ? `${color} / ${size}` : size || color || null;
  return resolveVariantId({
    productKey: product.product_key,
    color,
    size,
    variantTitle,
  });
}

async function probeProduct(product) {
  const variantId = getFirstVariantId(product);
  if (!variantId) {
    console.warn(`[layout-probe] no variant for ${product.product_key}, skipping`);
    return null;
  }

  const variant = await getVariant(variantId);
  const productId =
    variant?.product?.id ||
    variant?.product?.product_id ||
    variant?.variant?.product_id ||
    variant?.product_id;

  if (!productId) {
    console.warn(`[layout-probe] no product_id for variant ${variantId}, skipping`);
    return null;
  }

  const testImageUrl = product.default_mockup_url || product.image_url;
  if (!testImageUrl) {
    console.warn(`[layout-probe] no test image for ${product.product_key}, skipping`);
    return null;
  }

  const testLayout = { scale: 0.85, offset_x: 10, offset_y: 10 };
  const placement = product.placement || "front";

  // Extract real file spec from variant data and printfile dimensions
  const variantFileSpecs = collectVariantFileSpecs(variant);
  const matchingFileSpec = variantFileSpecs.find(
    (s) => s.type === placement
  ) || variantFileSpecs[0] || {};

  // Use printfile dimensions as fallback for correct area_width/area_height
  let printfileDims = null;
  try {
    const printfiles = await getMockupPrintfiles(productId);
    printfileDims = extractPrintfileDimensions(printfiles, placement);
  } catch {
    // non-critical, continue with variant specs
  }

  const effectiveFileSpec = {
    ...matchingFileSpec,
    width: matchingFileSpec.width || printfileDims?.width || null,
    height: matchingFileSpec.height || printfileDims?.height || null,
  };

  const dims = printfileDims
    ? { width: printfileDims.width, height: printfileDims.height }
    : effectiveFileSpec.width && effectiveFileSpec.height
      ? { width: effectiveFileSpec.width, height: effectiveFileSpec.height }
      : null;

  try {
    await createMockupTask(productId, {
      variantId,
      imageUrl: testImageUrl,
      placement,
      format: "png",
      field: "position",
      layout: testLayout,
      fileSpec: effectiveFileSpec,
    });
    return { supported: true, printfile_dims: dims };
  } catch (err) {
    if (Number(err?.status) === 429) {
      throw err;
    }
    return { supported: false, printfile_dims: dims };
  }
}

export async function runLayoutProbe() {
  const products = loadProducts();
  const cache = loadCache();
  let updated = false;

  for (const [key, value] of Object.entries(cache)) {
    // Support both old format (boolean) and new format ({ supported, printfile_dims })
    if (typeof value === "object" && value !== null) {
      layoutSupportMap.set(key, value);
    } else {
      layoutSupportMap.set(key, { supported: !!value, printfile_dims: null });
    }
  }

  const untested = products.filter(
    (p) => p.customizable && (
      !(p.product_key in cache) ||
      typeof cache[p.product_key] === 'boolean'  // re-probe old format entries to capture printfile_dims
    )
  );

  if (!untested.length) {
    console.log(`[layout-probe] all ${products.length} products cached`);
    return;
  }

  console.log(
    `[layout-probe] testing ${untested.length} product(s) for layout support...`
  );

  for (const product of untested) {
    try {
      const result = await probeProduct(product);
      if (result === null) {
        const entry = { supported: false, printfile_dims: null };
        cache[product.product_key] = entry;
        layoutSupportMap.set(product.product_key, entry);
      } else {
        cache[product.product_key] = result;
        layoutSupportMap.set(product.product_key, result);
      }
      updated = true;
      const supported = result?.supported ?? false;
      console.log(
        `[layout-probe] ${product.product_key}: ${supported ? "SUPPORTED" : "NOT SUPPORTED"}`
      );
    } catch (err) {
      if (Number(err?.status) === 429) {
        console.warn("[layout-probe] rate limited, stopping probe. Will retry on next startup.");
        break;
      }
      const entry = { supported: false, printfile_dims: null };
      cache[product.product_key] = entry;
      layoutSupportMap.set(product.product_key, entry);
      updated = true;
      console.warn(`[layout-probe] ${product.product_key}: error — ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, PROBE_DELAY_MS));
  }

  if (updated) {
    saveCache(cache);
    console.log("[layout-probe] cache updated");
  }
}

export function getLayoutSupport(productKey) {
  if (layoutSupportMap.has(productKey)) {
    const entry = layoutSupportMap.get(productKey);
    // Normalize old boolean format to new object format
    if (typeof entry === "boolean") {
      return { supported: entry, printfile_dims: null };
    }
    return entry;
  }
  return null;
}

export function getPrintfileDims(productKey) {
  const entry = getLayoutSupport(productKey);
  return entry?.printfile_dims || null;
}
