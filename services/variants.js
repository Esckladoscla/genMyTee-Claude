import fs from "node:fs";
import path from "node:path";

const PRIMARY_MAP_PATH = path.resolve(process.cwd(), "data/variants-map.json");
const FALLBACK_MAP_PATH = path.resolve(process.cwd(), "variants-map.json");

let cachedMap;
let cachedMapPath;
let warnedAboutFallback = false;

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toCompactKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function loadVariantsMap() {
  if (cachedMap) return cachedMap;

  if (fs.existsSync(PRIMARY_MAP_PATH)) {
    cachedMap = readJsonFile(PRIMARY_MAP_PATH);
    cachedMapPath = PRIMARY_MAP_PATH;
    return cachedMap;
  }

  if (fs.existsSync(FALLBACK_MAP_PATH)) {
    cachedMap = readJsonFile(FALLBACK_MAP_PATH);
    cachedMapPath = FALLBACK_MAP_PATH;
    if (!warnedAboutFallback) {
      warnedAboutFallback = true;
      console.warn(`[variants] Using fallback map at ${FALLBACK_MAP_PATH}`);
    }
    return cachedMap;
  }

  throw new Error("No variants map found. Expected data/variants-map.json or variants-map.json");
}

function findKeyIgnoreCase(obj, wanted) {
  if (!obj || typeof obj !== "object") return undefined;
  const wantedNorm = norm(wanted);
  return Object.keys(obj).find((key) => norm(key) === wantedNorm);
}

function resolveProductEntry(map, productKey) {
  const keyNorm = norm(productKey);
  if (!keyNorm) return null;
  const keyCompact = toCompactKey(productKey);

  const mapKeys = Object.keys(map || {});
  const exactKey = mapKeys.find((key) => norm(key) === keyNorm);
  if (exactKey) return map[exactKey];

  // Accept equivalent spellings like men-s vs mens.
  if (keyCompact) {
    const compactKey = mapKeys.find((key) => toCompactKey(key) === keyCompact);
    if (compactKey) return map[compactKey];
  }

  const aliases = {
    "gildan-5000": ["unisex-classic-tee-gildan-5000"],
    "unisex-classic-tee-gildan-5000": ["gildan-5000"],
  };

  for (const alias of aliases[keyNorm] || []) {
    const aliasKey = mapKeys.find((key) => norm(key) === alias);
    if (aliasKey) return map[aliasKey];
  }

  const compatibleKeys = mapKeys.filter((key) => {
    const candidate = norm(key);
    return candidate.endsWith(keyNorm) || keyNorm.endsWith(candidate);
  });

  if (!compatibleKeys.length) return null;

  compatibleKeys.sort((a, b) => {
    const aNorm = norm(a);
    const bNorm = norm(b);
    return Math.abs(aNorm.length - keyNorm.length) - Math.abs(bNorm.length - keyNorm.length);
  });

  return map[compatibleKeys[0]];
}

function extractVariantId(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === "number") return Number.isFinite(node) ? node : null;
  if (typeof node === "string") {
    const parsed = Number(node);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof node === "object") {
    const parsed = Number(node.variant_id);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function tryResolveFromObject(node, color, size) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;

  if (color && size) {
    const colorKey = findKeyIgnoreCase(node, color);
    if (colorKey) {
      const sizeNode = node[colorKey];
      const sizeKey = findKeyIgnoreCase(sizeNode, size);
      if (sizeKey) {
        const id = extractVariantId(sizeNode[sizeKey]);
        if (id) return id;
      }
    }
  }

  if (size) {
    const sizeKey = findKeyIgnoreCase(node, size);
    if (sizeKey) {
      const id = extractVariantId(node[sizeKey]);
      if (id) return id;
    }
  }

  if (color) {
    const colorKey = findKeyIgnoreCase(node, color);
    if (colorKey) {
      const colorNode = node[colorKey];
      const directId = extractVariantId(colorNode);
      if (directId) return directId;

      if (colorNode && typeof colorNode === "object" && !Array.isArray(colorNode)) {
        if (size) {
          const nestedSizeKey = findKeyIgnoreCase(colorNode, size);
          if (nestedSizeKey) {
            const nestedId = extractVariantId(colorNode[nestedSizeKey]);
            if (nestedId) return nestedId;
          }
        }

        const oneSizeKey = findKeyIgnoreCase(colorNode, "One size");
        if (oneSizeKey) {
          const oneSizeId = extractVariantId(colorNode[oneSizeKey]);
          if (oneSizeId) return oneSizeId;
        }

        // Last fallback for nested objects with a single size.
        const nestedKeys = Object.keys(colorNode);
        if (nestedKeys.length === 1) {
          const nestedId = extractVariantId(colorNode[nestedKeys[0]]);
          if (nestedId) return nestedId;
        }
      }
    }
  }

  if (size) {
    for (const value of Object.values(node)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const key = findKeyIgnoreCase(value, size);
      if (!key) continue;
      const id = extractVariantId(value[key]);
      if (id) return id;
    }
  }

  return null;
}

function tryResolveFromArray(node, color, size) {
  if (!Array.isArray(node)) return null;
  const colorNorm = norm(color);
  const sizeNorm = norm(size);
  const found = node.find((entry) => {
    const entryColor = norm(entry?.color);
    const entrySize = norm(entry?.size);
    return (!colorNorm || colorNorm === entryColor) && (!sizeNorm || sizeNorm === entrySize);
  });
  return found ? extractVariantId(found.variant_id) : null;
}

function extractFirstVariantId(node) {
  const direct = extractVariantId(node);
  if (direct) return direct;

  if (Array.isArray(node)) {
    for (const item of node) {
      const nested = extractFirstVariantId(item);
      if (nested) return nested;
    }
    return null;
  }

  if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      const nested = extractFirstVariantId(value);
      if (nested) return nested;
    }
  }

  return null;
}

export function parseVariantTitle(variantTitle) {
  if (!variantTitle) return { color: null, size: null };
  const parts = String(variantTitle)
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { color: parts[0], size: parts[1] };
  }
  return { color: null, size: parts[0] || null };
}

function parseVariantTitleParts(variantTitle) {
  if (!variantTitle) return [];
  return String(variantTitle)
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function tryResolveWithCandidates(entry, candidates) {
  const seen = new Set();

  for (const candidate of candidates) {
    const color = candidate?.color || null;
    const size = candidate?.size || null;
    const key = `${norm(color)}|${norm(size)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fromObject = tryResolveFromObject(entry, color, size);
    if (fromObject) return fromObject;

    const fromArray = tryResolveFromArray(entry, color, size);
    if (fromArray) return fromArray;
  }

  return null;
}

export function resolveVariantId({ productKey, color, size, variantTitle } = {}) {
  const map = loadVariantsMap();
  const key = String(productKey || "").trim();
  if (!key) return null;

  const entry = resolveProductEntry(map, key);
  if (!entry) return null;

  let finalColor = color || null;
  let finalSize = size || null;
  if ((!finalColor || !finalSize) && variantTitle) {
    const parsed = parseVariantTitle(variantTitle);
    finalColor = finalColor || parsed.color;
    finalSize = finalSize || parsed.size;
  }

  const titleParts = parseVariantTitleParts(variantTitle);
  const firstPart = titleParts[0] || null;
  const secondPart = titleParts[1] || null;

  const resolved = tryResolveWithCandidates(entry, [
    { color: finalColor, size: finalSize },
    // Accept both title orders: "Color / Size" and "Size / Color".
    { color: firstPart, size: secondPart },
    { color: secondPart, size: firstPart },
    // Fallback to size-only lookups when color is unavailable or unreliable.
    { color: null, size: finalSize },
    { color: null, size: firstPart },
    { color: null, size: secondPart },
  ]);
  if (resolved) return resolved;

  // Fallback for "Default Title" single-variant products.
  // Pick any valid Printful variant to avoid skipping mockup generation.
  const variantTitleNorm = norm(variantTitle);
  const allowGenericFallback =
    !variantTitleNorm || variantTitleNorm === "default title" || variantTitleNorm === "default";
  if (allowGenericFallback) {
    const fallbackVariantId = extractFirstVariantId(entry);
    if (fallbackVariantId) return fallbackVariantId;
  }

  return null;
}

export function getVariantsMapPath() {
  if (!cachedMapPath) loadVariantsMap();
  return cachedMapPath;
}

export function _resetVariantsCacheForTests() {
  cachedMap = undefined;
  cachedMapPath = undefined;
  warnedAboutFallback = false;
}
