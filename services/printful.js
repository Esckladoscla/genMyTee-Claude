import { getBooleanEnv, getEnv, requireEnv } from "./env.js";

const PRINTFUL_API_BASE = "https://api.printful.com";
const mockupTaskStrategyCache = new Map();
const mockupPrintfilesCache = new Map();
const LAYOUT_SCALE_MIN = 0.75;
const LAYOUT_SCALE_MAX = 1.35;
const LAYOUT_OFFSET_MIN = -100;
const LAYOUT_OFFSET_MAX = 100;

function getToken() {
  return requireEnv("PRINTFUL_API_KEY", { aliases: ["PRINTFUL_KEY"] });
}

async function pfFetch(path, { method = "GET", body } = {}) {
  const response = await fetch(`${PRINTFUL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Printful HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function ensureStitchColor(payload) {
  const stitchColor = getEnv("PRINTFUL_STITCH_COLOR", { defaultValue: "black" });
  const copy = structuredClone(payload);

  if (!Array.isArray(copy?.items)) return copy;

  for (const item of copy.items) {
    item.options = Array.isArray(item.options) ? item.options : [];
    const alreadySet = item.options.some((option) => option?.id === "stitch_color");
    if (!alreadySet) {
      item.options.push({ id: "stitch_color", value: stitchColor });
    }
  }

  return copy;
}

export async function createOrder(payload, { confirm } = {}) {
  const finalConfirm =
    typeof confirm === "boolean"
      ? confirm
      : getBooleanEnv("PRINTFUL_CONFIRM", { defaultValue: false });

  const body = {
    ...payload,
    confirm: finalConfirm,
  };

  const data = await pfFetch("/orders", { method: "POST", body });
  return data?.result || data;
}

export async function createOrderSafe(payload, { confirm } = {}) {
  try {
    return await createOrder(payload, { confirm });
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (error?.status === 400 && message.includes("stitch_color")) {
      console.warn("[printful] stitch_color required. Retrying with default stitch color.");
      const retryPayload = ensureStitchColor(payload);
      return createOrder(retryPayload, { confirm });
    }
    throw error;
  }
}

export async function getVariant(variantId) {
  const data = await pfFetch(`/products/variant/${variantId}`);
  return data?.result || data;
}

function asNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveProductIdFromVariantPayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.product_id,
    payload.productId,
    payload.sync_product_id,
    payload.product?.id,
    payload.product?.product_id,
    payload.product?.productId,
    payload.product?.sync_product_id,
    payload.variant?.product_id,
    payload.variant?.productId,
    payload.variant?.sync_product_id,
    payload.variant?.product?.id,
    payload.variant?.product?.product_id,
    payload.variant?.product?.productId,
    payload.result?.product_id,
    payload.result?.productId,
    payload.result?.product?.id,
    payload.result?.product?.product_id,
    payload.result?.variant?.product_id,
  ];

  for (const candidate of candidates) {
    const id = asNumberOrNull(candidate);
    if (id) return id;
  }

  return null;
}

function collectPlacementCandidates(variantPayload, requestedPlacement) {
  const requested = String(requestedPlacement || "").trim();
  const first = requested || "front";
  return [first];
}

export function collectVariantFileSpecs(variantPayload) {
  const files = Array.isArray(variantPayload?.files)
    ? variantPayload.files
    : Array.isArray(variantPayload?.variant?.files)
      ? variantPayload.variant.files
      : Array.isArray(variantPayload?.product?.files)
        ? variantPayload.product.files
        : [];

  const out = [];
  const push = (spec) => {
    const normalized = String(spec?.type || "").trim();
    if (!normalized) return;
    if (out.some((item) => item.type === normalized)) return;
    out.push({
      type: normalized,
      width: Number(spec?.width) || null,
      height: Number(spec?.height) || null,
    });
  };

  for (const file of files) {
    push(file);
  }

  return out;
}

export function extractPrintfileDimensions(printfilesPayload, placement) {
  const pfs = Array.isArray(printfilesPayload?.printfiles)
    ? printfilesPayload.printfiles
    : [];
  const normalizedPlacement = String(placement || "").toLowerCase().trim();
  const match = pfs.find(
    (pf) => String(pf?.type || "").toLowerCase().trim() === normalizedPlacement
  );
  if (match?.width && match?.height) {
    return { type: match.type, width: Number(match.width), height: Number(match.height) };
  }
  const first = pfs.find((pf) => pf?.width && pf?.height);
  return first
    ? { type: first.type, width: Number(first.width), height: Number(first.height) }
    : null;
}

function buildDefaultPosition(fileSpec = {}) {
  const areaWidth = Number(fileSpec.width) || 1800;
  const areaHeight = Number(fileSpec.height) || 2400;
  return {
    area_width: areaWidth,
    area_height: areaHeight,
    width: areaWidth,
    height: areaHeight,
    top: 0,
    left: 0,
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeMockupLayout(layout) {
  if (!layout || typeof layout !== "object") return null;

  const scale = clampNumber(layout.scale, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX, 1);
  const offsetX = clampNumber(layout.offset_x, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const offsetY = clampNumber(layout.offset_y, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);

  const hasCustomLayout =
    Math.abs(scale - 1) > 0.0001 || Math.abs(offsetX) > 0.0001 || Math.abs(offsetY) > 0.0001;

  if (!hasCustomLayout) return null;

  return {
    scale: Number(scale.toFixed(3)),
    offset_x: Number(offsetX.toFixed(2)),
    offset_y: Number(offsetY.toFixed(2)),
  };
}

function buildPositionFromLayout(fileSpec = {}, layout = null) {
  if (!layout) {
    return buildDefaultPosition(fileSpec);
  }

  const areaWidth = Number(fileSpec.width) || 1800;
  const areaHeight = Number(fileSpec.height) || 2400;
  const width = Math.max(1, Math.round(areaWidth * layout.scale));
  const height = Math.max(1, Math.round(areaHeight * layout.scale));

  const leftRange = areaWidth - width;
  const topRange = areaHeight - height;
  const left = Math.round(leftRange * ((layout.offset_x + 100) / 200));
  const top = Math.round(topRange * ((layout.offset_y + 100) / 200));

  const position = {
    area_width: areaWidth,
    area_height: areaHeight,
    width,
    height,
    top,
    left,
  };

  console.log("[mockup] buildPositionFromLayout", {
    fileSpecDims: { width: fileSpec.width, height: fileSpec.height },
    layout,
    position,
  });

  return position;
}

function isRetryableMockupPayloadError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("position field is missing") ||
    message.includes("placement field is missing") ||
    message.includes("invalid file object specified") ||
    message.includes("invalid file object") ||
    message.includes("image_url field is missing") ||
    message.includes("url field is missing") ||
    message.includes("invalid placement")
  );
}

function isRateLimitedMockupError(error) {
  const message = String(error?.message || "").toLowerCase();
  return Number(error?.status) === 429 || message.includes("too many requests");
}

function parseCsvList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveIntegerCsv(value) {
  return parseCsvList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function normalizeMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeToStringList(input) {
  if (!Array.isArray(input)) return [];
  const values = [];
  for (const item of input) {
    const candidate =
      typeof item === "string"
        ? item
        : item?.name || item?.title || item?.value || item?.id || "";
    const value = String(candidate || "").trim();
    if (!value || values.includes(value)) continue;
    values.push(value);
  }
  return values;
}

function pickReturnedMockups(mockups, { mockupResultIndexes, mockupResultLimit } = {}) {
  const source = Array.isArray(mockups) ? mockups.filter(Boolean) : [];
  if (!source.length) {
    return {
      allUrls: [],
      selectedUrls: [],
      selectedIndexes: [],
      indexMap: [],
    };
  }

  const requestedIndexes = Array.isArray(mockupResultIndexes)
    ? mockupResultIndexes
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    : parsePositiveIntegerCsv(mockupResultIndexes);
  const configuredIndexes = requestedIndexes.length
    ? requestedIndexes
    : parsePositiveIntegerCsv(getEnv("PRINTFUL_MOCKUP_RESULT_INDEXES", { defaultValue: "" }));
  let selectedEntries = source.map((url, idx) => ({
    index: idx + 1,
    url,
  }));

  if (configuredIndexes.length) {
    const byIndex = [];
    for (const indexOneBased of configuredIndexes) {
      const value = source[indexOneBased - 1];
      if (!value || byIndex.some((item) => item.url === value)) continue;
      byIndex.push({ index: indexOneBased, url: value });
    }
    if (byIndex.length) {
      selectedEntries = byIndex;
    }
  }

  let configuredLimit = null;
  const requestedLimit = Number(mockupResultLimit);
  if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
    configuredLimit = Math.floor(requestedLimit);
  } else {
    const envLimit = Number(getEnv("PRINTFUL_MOCKUP_RESULT_LIMIT", { defaultValue: "" }));
    if (Number.isFinite(envLimit) && envLimit > 0) {
      configuredLimit = Math.floor(envLimit);
    }
  }
  if (configuredLimit) {
    selectedEntries = selectedEntries.slice(0, configuredLimit);
  }

  const selectedUrls = selectedEntries.map((item) => item.url);
  const selectedIndexes = selectedEntries.map((item) => item.index);

  return {
    allUrls: source,
    selectedUrls,
    selectedIndexes,
    indexMap: source.map((url, idx) => ({
      index: idx + 1,
      url,
      selected: selectedIndexes.includes(idx + 1),
    })),
  };
}

function pickMockupOptionGroups(printfilesPayload) {
  const available = normalizeToStringList(printfilesPayload?.option_groups);
  if (!available.length) return [];

  const configured = parseCsvList(getEnv("PRINTFUL_MOCKUP_OPTION_GROUPS", { defaultValue: "" }));
  if (configured.length) {
    const wantsAll = configured.some((value) => normalizeMatchKey(value) === "all");
    if (wantsAll) {
      return available;
    }

    const byKey = new Map(available.map((item) => [normalizeMatchKey(item), item]));
    const selected = [];
    for (const wanted of configured) {
      const match = byKey.get(normalizeMatchKey(wanted));
      if (match && !selected.includes(match)) {
        selected.push(match);
      }
    }
    return selected;
  }

  // Default behavior: request all groups to maximize returned mockup views.
  // Set PRINTFUL_MOCKUP_INCLUDE_ALL_GROUPS=false to disable this.
  const includeAllByDefault = getBooleanEnv("PRINTFUL_MOCKUP_INCLUDE_ALL_GROUPS", {
    defaultValue: true,
  });
  if (includeAllByDefault) {
    return available;
  }

  // No filters -> Printful decides defaults (usually fewer views).
  return [];
}

function pickMockupOptions(printfilesPayload, placement) {
  const available = normalizeToStringList(printfilesPayload?.options);
  if (!available.length) return [];

  const configured = parseCsvList(getEnv("PRINTFUL_MOCKUP_OPTIONS", { defaultValue: "" }));
  if (configured.length) {
    const wantsAll = configured.some((value) => normalizeMatchKey(value) === "all");
    if (wantsAll) {
      return available;
    }

    const byKey = new Map(available.map((item) => [normalizeMatchKey(item), item]));
    const selected = [];
    for (const wanted of configured) {
      const match = byKey.get(normalizeMatchKey(wanted));
      if (match && !selected.includes(match)) {
        selected.push(match);
      }
    }
    return selected;
  }

  // Default: do not constrain options automatically.
  return [];
}

export async function getMockupPrintfiles(productId) {
  const cacheKey = String(productId);
  if (mockupPrintfilesCache.has(cacheKey)) {
    return mockupPrintfilesCache.get(cacheKey);
  }

  const data = await pfFetch(`/mockup-generator/printfiles/${productId}`);
  const result = data?.result || data || {};
  mockupPrintfilesCache.set(cacheKey, result);
  return result;
}

async function createMockupTaskWithFiles(
  productId,
  { variantId, format = "png", files, optionGroups = [], options = [] }
) {
  const body = {
    variant_ids: [variantId],
    format,
    files,
  };
  if (Array.isArray(optionGroups) && optionGroups.length) {
    body.option_groups = optionGroups;
  }
  if (Array.isArray(options) && options.length) {
    body.options = options;
  }

  const data = await pfFetch(`/mockup-generator/create-task/${productId}`, {
    method: "POST",
    body,
  });
  return data?.result || data;
}

export async function createMockupTask(
  productId,
  {
    variantId,
    imageUrl,
    placement = "front",
    format = "png",
    field = "position",
    layout = null,
    fileSpec = {},
    optionGroups = [],
    options = [],
  }
) {
  let file;
  if (field === "position") {
    file = {
      placement,
      position: buildPositionFromLayout(fileSpec, layout),
      image_url: imageUrl,
    };
  } else {
    file = { [field]: placement, image_url: imageUrl };
  }

  return createMockupTaskWithFiles(productId, {
    variantId,
    format,
    files: [file],
    optionGroups,
    options,
  });
}

async function createMockupTaskUsingVariantFiles(
  productId,
  variantPayload,
  {
    variantId,
    imageUrl,
    format = "png",
    layout = null,
    printfileDims = null,
    allowPositionlessFallback = true,
    optionGroups = [],
    options = [],
  }
) {
  const specs = collectVariantFileSpecs(variantPayload);
  if (!specs.length) {
    const error = new Error("Unable to build variant file fallback payload");
    error.code = "NO_VARIANT_FILE_SPECS";
    throw error;
  }

  const limitedSpecs = specs.slice(0, 8);
  const filePayloadAttempts = [
    limitedSpecs.map((spec) => {
      // Use printfile dimensions as fallback when variant spec lacks them
      const effectiveSpec = {
        ...spec,
        width: spec.width || printfileDims?.width || null,
        height: spec.height || printfileDims?.height || null,
      };
      return {
        type: spec.type,
        image_url: imageUrl,
        position: buildPositionFromLayout(effectiveSpec, layout),
      };
    }),
  ];
  if (allowPositionlessFallback) {
    filePayloadAttempts.push(limitedSpecs.map((spec) => ({ type: spec.type, image_url: imageUrl })));
  }

  let lastError = null;
  for (const files of filePayloadAttempts) {
    try {
      return await createMockupTaskWithFiles(productId, {
        variantId,
        format,
        files,
        optionGroups,
        options,
      });
    } catch (error) {
      lastError = error;
      if (isRateLimitedMockupError(error)) {
        throw error;
      }
      if (!isRetryableMockupPayloadError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Unable to create Printful mockup task from variant files");
}

async function createMockupTaskWithPlacementFallbacks(
  productId,
  variantPayload,
  { variantId, imageUrl, placement = "front", format = "png", layout = null }
) {
  const placementCandidates = collectPlacementCandidates(variantPayload, placement);
  const variantFileSpecs = collectVariantFileSpecs(variantPayload);
  const cacheKey = `${productId}:${variantId}`;
  const cachedStrategy = mockupTaskStrategyCache.get(cacheKey);
  const normalizedLayout = normalizeMockupLayout(layout);
  const wantsCustomLayout = Boolean(normalizedLayout);
  const layoutCandidates = wantsCustomLayout ? [normalizedLayout] : [null];
  let lastError = null;
  let optionFilterCandidates = [{ optionGroups: [], options: [] }];
  let printfileDims = null;

  try {
    const printfiles = await getMockupPrintfiles(productId);
    const optionGroups = pickMockupOptionGroups(printfiles);
    const options = pickMockupOptions(printfiles, placement);
    printfileDims = extractPrintfileDimensions(printfiles, placement);
    if (optionGroups.length || options.length) {
      optionFilterCandidates = [
        { optionGroups, options },
        { optionGroups: [], options: [] },
      ];
    }
  } catch {
    optionFilterCandidates = [{ optionGroups: [], options: [] }];
  }

  const strategies = [];
  if (cachedStrategy === "variant_files" || cachedStrategy === "single_position") {
    strategies.push(cachedStrategy);
  }
  if (!strategies.includes("single_position")) strategies.push("single_position");
  if (!strategies.includes("variant_files")) strategies.push("variant_files");

  for (const layoutCandidate of layoutCandidates) {
    for (const optionFilters of optionFilterCandidates) {
      const usingOptionFilters =
        optionFilters.optionGroups.length > 0 || optionFilters.options.length > 0;

      for (const strategy of strategies) {
        if (strategy === "variant_files") {
          try {
            const result = await createMockupTaskUsingVariantFiles(productId, variantPayload, {
              variantId,
              imageUrl,
              format,
              layout: layoutCandidate,
              printfileDims,
              allowPositionlessFallback: !wantsCustomLayout,
              optionGroups: optionFilters.optionGroups,
              options: optionFilters.options,
            });
            mockupTaskStrategyCache.set(cacheKey, "variant_files");
            return result;
          } catch (error) {
            lastError = error;
            if (String(error?.code || "") === "NO_VARIANT_FILE_SPECS") {
              continue;
            }
            if (isRateLimitedMockupError(error)) throw error;
            if (usingOptionFilters && Number(error?.status) === 400) {
              continue;
            }
            if (!isRetryableMockupPayloadError(error)) throw error;
          }
          continue;
        }

        for (const candidate of placementCandidates) {
          try {
            const matchingFileSpec = variantFileSpecs.find(
              (s) => s.type === candidate
            ) || {};
            // Use printfile dimensions as fallback when variant spec lacks them
            const effectiveFileSpec = {
              ...matchingFileSpec,
              width: matchingFileSpec.width || printfileDims?.width || null,
              height: matchingFileSpec.height || printfileDims?.height || null,
            };
            const result = await createMockupTask(productId, {
              variantId,
              imageUrl,
              placement: candidate,
              format,
              field: "position",
              layout: layoutCandidate,
              fileSpec: effectiveFileSpec,
              optionGroups: optionFilters.optionGroups,
              options: optionFilters.options,
            });
            mockupTaskStrategyCache.set(cacheKey, strategy);
            return result;
          } catch (error) {
            lastError = error;
            if (isRateLimitedMockupError(error)) throw error;
            if (usingOptionFilters && Number(error?.status) === 400) {
              continue;
            }
            if (!isRetryableMockupPayloadError(error)) throw error;
          }
        }
      }
    }
  }

  if (wantsCustomLayout) {
    const error = new Error(
      "Printful mockup API for this product does not support manual layout adjustments"
    );
    error.code = "LAYOUT_NOT_SUPPORTED";
    error.cause = lastError;
    throw error;
  }

  throw lastError || new Error("Unable to create Printful mockup task");
}

export async function getMockupTask(
  taskKey,
  { mockupResultIndexes = null, mockupResultLimit = null } = {}
) {
  const data = await pfFetch(`/mockup-generator/task?task_key=${encodeURIComponent(taskKey)}`);
  const result = data?.result || data;
  const status = result?.status || result?.state || "unknown";

  const pickMockupLikeUrl = (node) => {
    const candidates = [
      node?.mockup_url,
      node?.mockupUrl,
      node?.mockup_url_large,
      node?.mockup_url_small,
      node?.url,
      node?.preview_url,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (value) return value;
    }

    return "";
  };

  const mockups = [];
  if (Array.isArray(result?.mockups)) {
    for (const item of result.mockups) {
      const primaryUrl = pickMockupLikeUrl(item);
      if (primaryUrl && !mockups.includes(primaryUrl)) {
        mockups.push(primaryUrl);
      }

      if (Array.isArray(item?.extra)) {
        for (const extra of item.extra) {
          const extraUrl = pickMockupLikeUrl(extra);
          if (extraUrl && !mockups.includes(extraUrl)) {
            mockups.push(extraUrl);
          }
        }
      }
    }
  }

  const selectedMockups = pickReturnedMockups(mockups, {
    mockupResultIndexes,
    mockupResultLimit,
  });

  return {
    status,
    task_key: taskKey,
    mockups: selectedMockups.selectedUrls,
    mockup_source_urls: selectedMockups.allUrls,
    mockup_selected_indexes: selectedMockups.selectedIndexes,
    mockup_index_map: selectedMockups.indexMap,
    raw: result,
  };
}

export async function generateMockupForVariant(
  variantId,
  imageUrl,
  {
    placement = "front",
    format = "png",
    layout = null,
    mockupResultIndexes = null,
    mockupResultLimit = null,
    maxWaitMs = 12000,
    pollEveryMs = 3500,
  } = {}
) {
  const variant = await getVariant(variantId);
  const productId = resolveProductIdFromVariantPayload(variant);
  if (!productId) {
    const keys =
      variant && typeof variant === "object" ? Object.keys(variant).join(", ") : String(variant);
    throw new Error(
      `Unable to resolve product_id from variant ${variantId} (variant keys: ${keys || "none"})`
    );
  }

  const task = await createMockupTaskWithPlacementFallbacks(productId, variant, {
    variantId,
    imageUrl,
    placement,
    format,
    layout,
  });
  const taskKey = task?.task_key || task?.taskKey || task?.task?.task_key;
  if (!taskKey) {
    throw new Error("Printful mockup task_key missing");
  }

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    let state;
    try {
      state = await getMockupTask(taskKey, {
        mockupResultIndexes,
        mockupResultLimit,
      });
    } catch (error) {
      if (isRateLimitedMockupError(error)) {
        return {
          status: "processing",
          task_key: taskKey,
          mockups: [],
        };
      }
      throw error;
    }
    if (state.status === "completed" || state.status === "failed") {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  return {
    status: "processing",
    task_key: taskKey,
    mockups: [],
  };
}
