const PROMPT_MIN_DEFAULT = 8;
const PROMPT_MAX_DEFAULT = 280;
const GENERATION_ESTIMATE_SECONDS = 5 * 60;
const QUALITY_NOTICE_MESSAGE =
  "Estamos priorizando calidad de impresión (alta resolución y transparencia). Por eso la generación y visualización en la prenda puede tardar hasta 5 minutos.";
const LAYOUT_SCALE_MIN = 0.75;
const LAYOUT_SCALE_MAX = 1.35;
const LAYOUT_OFFSET_MIN = -100;
const LAYOUT_OFFSET_MAX = 100;
const LOCAL_PREVIEW_SHIFT_PERCENT = 28;
const LOCAL_MOCKUP_BASE_X_PERCENT = 50;
const LOCAL_MOCKUP_BASE_Y_PERCENT = 46;
const LOCAL_MOCKUP_SHIFT_PERCENT = 14;
const LOCAL_MOCKUP_WIDTH_PERCENT = 48;
const initializedRoots = new WeakSet();
const galleryStateByRoot = new WeakMap();

function asString(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(raw) {
  const value = asString(raw);
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function buildUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.dataset.error = isError ? "true" : "false";
}

function formatTimeMmSs(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(safeSeconds / 60);
  const ss = safeSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function createEstimatedStatusController(statusNode, totalSeconds = GENERATION_ESTIMATE_SECONDS) {
  let intervalId = null;
  let secondsLeft = totalSeconds;
  let stageText = "Generando imagen";

  const render = () => {
    const message = `${QUALITY_NOTICE_MESSAGE} ${stageText}. Tiempo estimado restante: ${formatTimeMmSs(
      secondsLeft
    )}.`;
    setStatus(statusNode, message, false);
  };

  return {
    start(initialStage = "Generando imagen") {
      this.stop();
      stageText = initialStage;
      secondsLeft = totalSeconds;
      render();
      intervalId = window.setInterval(() => {
        secondsLeft = Math.max(0, secondsLeft - 1);
        render();
      }, 1000);
    },
    setStage(nextStage) {
      if (asString(nextStage)) {
        stageText = asString(nextStage);
      }
      render();
    },
    stop() {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readLayout(scaleInput, offsetXInput, offsetYInput) {
  const scale = clampNumber(scaleInput?.value, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX, 1);
  const offsetX = clampNumber(offsetXInput?.value, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const offsetY = clampNumber(offsetYInput?.value, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);

  return {
    scale: Number(scale.toFixed(3)),
    offset_x: Number(offsetX.toFixed(2)),
    offset_y: Number(offsetY.toFixed(2)),
  };
}

function serializeLayout(layout) {
  return `${layout.scale}|${layout.offset_x}|${layout.offset_y}`;
}

function setImage(img, src) {
  if (!img) return;
  if (src) {
    img.src = src;
    img.hidden = false;
    return;
  }
  img.hidden = true;
  img.removeAttribute("src");
}

function getImageBestSrc(img) {
  if (!(img instanceof HTMLImageElement)) return "";
  return (
    asString(img.getAttribute("data-max-resolution")) ||
    asString(img.currentSrc) ||
    asString(img.src) ||
    asString(img.getAttribute("src"))
  );
}

function applyLocalLayoutPreview(img, layout) {
  if (!(img instanceof HTMLImageElement) || img.hidden) return;
  if (img.parentElement instanceof HTMLElement) {
    img.parentElement.style.overflow = "hidden";
  }
  const scale = clampNumber(layout?.scale, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX, 1);
  const offsetX = clampNumber(layout?.offset_x, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const offsetY = clampNumber(layout?.offset_y, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const tx = Number(((offsetX / 100) * LOCAL_PREVIEW_SHIFT_PERCENT).toFixed(2));
  const ty = Number(((offsetY / 100) * LOCAL_PREVIEW_SHIFT_PERCENT).toFixed(2));
  img.style.transformOrigin = "center center";
  img.style.willChange = "transform";
  img.style.transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
}

function resetLocalLayoutPreview(img) {
  if (!(img instanceof HTMLImageElement)) return;
  img.style.transform = "";
  img.style.transformOrigin = "";
  img.style.willChange = "";
}

function applyLocalMockupDesignPreview(img, layout) {
  if (!(img instanceof HTMLImageElement) || img.hidden) return;
  const scale = clampNumber(layout?.scale, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX, 1);
  const offsetX = clampNumber(layout?.offset_x, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const offsetY = clampNumber(layout?.offset_y, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const left = Number(
    (LOCAL_MOCKUP_BASE_X_PERCENT + (offsetX / 100) * LOCAL_MOCKUP_SHIFT_PERCENT).toFixed(2)
  );
  const top = Number(
    (LOCAL_MOCKUP_BASE_Y_PERCENT + (offsetY / 100) * LOCAL_MOCKUP_SHIFT_PERCENT).toFixed(2)
  );
  img.style.left = `${left}%`;
  img.style.top = `${top}%`;
  img.style.width = `${LOCAL_MOCKUP_WIDTH_PERCENT}%`;
  img.style.transformOrigin = "center center";
  img.style.transform = `translate(-50%, -50%) scale(${scale})`;
  img.style.willChange = "transform,left,top";
}

function resetLocalMockupDesignPreview(img) {
  if (!(img instanceof HTMLImageElement)) return;
  img.style.left = "";
  img.style.top = "";
  img.style.width = "";
  img.style.transform = "";
  img.style.transformOrigin = "";
  img.style.willChange = "";
}

function parseRetryAfterSeconds(payload, response) {
  const retryAfterHeader = asString(response?.headers?.get?.("Retry-After"));
  const retryAfterFromHeader = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterFromHeader) && retryAfterFromHeader > 0) {
    return Math.round(retryAfterFromHeader);
  }

  const retryAfterFromPayload = Number(payload?.retry_after_seconds);
  if (Number.isFinite(retryAfterFromPayload) && retryAfterFromPayload > 0) {
    return Math.round(retryAfterFromPayload);
  }

  return 0;
}

function getFriendlyApiErrorMessage(payload, response) {
  const code = asString(payload?.error).toLowerCase();
  const reason = asString(payload?.reason).toLowerCase();
  const retryAfterSeconds = parseRetryAfterSeconds(payload, response);

  const appendRetryHint = (baseMessage) => {
    if (!retryAfterSeconds) return baseMessage;
    return `${baseMessage} Retry in ${retryAfterSeconds}s.`;
  };

  if (
    code === "openai_rate_limited" ||
    code === "rate limit exceeded" ||
    reason === "openai_rate_limited"
  ) {
    return appendRetryHint(
      "Preview generation is temporarily rate-limited (OpenAI quota or request limit)."
    );
  }

  if (code === "openai_temporary_error") {
    return "Temporary OpenAI error. Please retry in a few seconds.";
  }

  if (code === "ai_disabled") {
    return "AI generation is currently disabled.";
  }

  return "";
}

function getErrorMessage(payload, fallback, response) {
  const message = asString(payload?.message);
  if (message) return message;

  const friendlyMessage = getFriendlyApiErrorMessage(payload, response);
  if (friendlyMessage) return friendlyMessage;

  const errorCodeOrMessage = asString(payload?.error);
  if (errorCodeOrMessage) return errorCodeOrMessage;

  return fallback;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(getErrorMessage(payload, `Request failed (${response.status})`, response));
  }

  return payload;
}

async function getJson(url) {
  const response = await fetch(url, { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(getErrorMessage(payload, `Request failed (${response.status})`, response));
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseVariantMap(root) {
  const script = root.querySelector("[data-ai-variant-map]");
  if (!script) return {};
  try {
    return JSON.parse(script.textContent || "{}");
  } catch {
    return {};
  }
}

function canonicalizeImageUrl(raw) {
  const value = asString(raw);
  if (!value) return "";
  try {
    const parsed = new URL(value, window.location.href);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return value.split("?")[0].toLowerCase();
  }
}

function parseMockupUrls(payload) {
  const urls = [];
  const seenKeys = new Set();
  const pushUnique = (candidate) => {
    const value = asString(candidate);
    if (!value) return;
    const key = canonicalizeImageUrl(value);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    urls.push(value);
  };

  if (Array.isArray(payload?.mockup_urls)) {
    for (const item of payload.mockup_urls) {
      pushUnique(item);
    }
  }

  const single = asString(payload?.mockup_url);
  pushUnique(single);

  return urls;
}

function filterUsableMockupUrls(mockupUrls, artworkImageUrl) {
  const artworkKey = canonicalizeImageUrl(artworkImageUrl);
  if (!artworkKey) return Array.isArray(mockupUrls) ? mockupUrls : [];
  return (Array.isArray(mockupUrls) ? mockupUrls : []).filter(
    (url) => canonicalizeImageUrl(url) !== artworkKey
  );
}

function isElementVisible(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function toUniqueImages(nodes) {
  const results = [];
  const seen = new Set();
  for (const node of nodes || []) {
    if (!(node instanceof HTMLImageElement)) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    results.push(node);
  }
  return results;
}

function findMediaGallery(root) {
  const pickGallery = (node, selector) => {
    if (!node || typeof node.querySelectorAll !== "function") return null;
    const galleries = Array.from(node.querySelectorAll(selector)).filter(
      (gallery) => gallery instanceof HTMLElement
    );
    if (!galleries.length) return null;
    return galleries.find((gallery) => isElementVisible(gallery)) || galleries[0];
  };

  const productInformation = root.closest(".product-information");
  const scopedGallery = pickGallery(
    productInformation,
    ".product-information__media media-gallery, media-gallery"
  );
  if (scopedGallery) return scopedGallery;

  const section = root.closest(".shopify-section");
  const sectionGallery = pickGallery(section, "media-gallery");
  if (sectionGallery) return sectionGallery;

  return pickGallery(document, "media-gallery");
}

function collectGalleryImages(gallery) {
  const selectors = [
    ".product-media__image",
    ".deferred-media__poster-image",
    ".slideshow-controls__thumbnail img",
    ".dialog-thumbnails-list__thumbnail img",
  ];

  const results = [];
  const seen = new Set();
  for (const selector of selectors) {
    gallery.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLImageElement)) return;
      if (seen.has(node)) return;
      seen.add(node);
      results.push(node);
    });
  }
  return results;
}

function collectPrimaryMediaImages(gallery) {
  if (!(gallery instanceof HTMLElement)) return [];

  const images = [];
  gallery.querySelectorAll(".product-media__image").forEach((node) => {
    if (!(node instanceof HTMLImageElement)) return;
    if (node.closest(".dialog-zoomed-gallery")) return;
    if (node.closest(".slideshow-controls__thumbnail")) return;
    if (node.closest(".dialog-thumbnails-list__thumbnail")) return;
    images.push(node);
  });
  return toUniqueImages(images);
}

function collectGridMediaImages(gallery) {
  if (!(gallery instanceof HTMLElement)) return [];
  return toUniqueImages(gallery.querySelectorAll(".media-gallery__grid .product-media__image"));
}

function collectSlideshowMediaImages(gallery) {
  if (!(gallery instanceof HTMLElement)) return [];

  const images = [];
  gallery.querySelectorAll("slideshow-container .product-media__image").forEach((node) => {
    if (!(node instanceof HTMLImageElement)) return;
    if (node.closest(".dialog-zoomed-gallery")) return;
    images.push(node);
  });
  return toUniqueImages(images);
}

function resolveGalleryImageSets(gallery) {
  const gridImages = collectGridMediaImages(gallery);
  const slideshowImages = collectSlideshowMediaImages(gallery);
  const gridContainer = gallery.querySelector(".media-gallery__grid");
  const slideshowContainer = gallery.querySelector("slideshow-container");

  if (gridImages.length && isElementVisible(gridContainer)) {
    return { primaryImages: gridImages, secondaryImages: slideshowImages };
  }

  if (slideshowImages.length && isElementVisible(slideshowContainer)) {
    return { primaryImages: slideshowImages, secondaryImages: gridImages };
  }

  if (gridImages.length) {
    return { primaryImages: gridImages, secondaryImages: slideshowImages };
  }

  if (slideshowImages.length) {
    return { primaryImages: slideshowImages, secondaryImages: gridImages };
  }

  return { primaryImages: collectPrimaryMediaImages(gallery), secondaryImages: [] };
}

function applyMockupUrlToImage(img, url) {
  if (!(img instanceof HTMLImageElement) || !asString(url)) return;
  img.setAttribute("src", url);
  img.setAttribute("srcset", url);
  img.setAttribute("data-max-resolution", url);
}

function rememberOriginalGallery(root, gallery, images) {
  if (!gallery || !images.length) return;
  const current = galleryStateByRoot.get(root);
  if (current?.gallery === gallery) return;

  const originals = images.map((img) => ({
    img,
    src: img.getAttribute("src"),
    srcset: img.getAttribute("srcset"),
    sizes: img.getAttribute("sizes"),
    dataMaxResolution: img.getAttribute("data-max-resolution"),
  }));

  galleryStateByRoot.set(root, { gallery, originals });
}

function restoreOriginalGallery(root) {
  const state = galleryStateByRoot.get(root);
  if (!state?.originals?.length) return;

  for (const original of state.originals) {
    const { img, src, srcset, sizes, dataMaxResolution } = original;
    if (!(img instanceof HTMLImageElement)) continue;

    if (src) img.setAttribute("src", src);
    else img.removeAttribute("src");

    if (srcset) img.setAttribute("srcset", srcset);
    else img.removeAttribute("srcset");

    if (sizes) img.setAttribute("sizes", sizes);
    else img.removeAttribute("sizes");

    if (dataMaxResolution) img.setAttribute("data-max-resolution", dataMaxResolution);
    else img.removeAttribute("data-max-resolution");
  }

  galleryStateByRoot.delete(root);
}

function applyMockupsToGallery(root, mockupUrls) {
  if (!Array.isArray(mockupUrls) || !mockupUrls.length) return 0;

  const gallery = findMediaGallery(root);
  if (!gallery) return 0;

  const { primaryImages, secondaryImages } = resolveGalleryImageSets(gallery);
  const images = primaryImages.length ? primaryImages : collectGalleryImages(gallery);
  if (!images.length) return 0;

  const uniqueUrls = [];
  for (const candidate of mockupUrls) {
    const value = asString(candidate);
    if (!value || uniqueUrls.includes(value)) continue;
    uniqueUrls.push(value);
  }

  if (!uniqueUrls.length) return 0;

  const imagesToRestore = toUniqueImages([...images, ...secondaryImages]);
  rememberOriginalGallery(root, gallery, imagesToRestore);

  const updatesCount = Math.min(images.length, uniqueUrls.length);
  for (let index = 0; index < updatesCount; index += 1) {
    const url = uniqueUrls[index];
    applyMockupUrlToImage(images[index], url);
    applyMockupUrlToImage(secondaryImages[index], url);
  }

  return updatesCount;
}

async function pollMockupStatus(backendBaseUrl, taskKey, { attempts = 12, intervalMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await sleep(intervalMs);
    const url = buildUrl(
      backendBaseUrl,
      `/api/preview/mockup/status?task_key=${encodeURIComponent(taskKey)}`
    );
    const payload = await getJson(url);
    const status = asString(payload?.mockup_status) || "processing";
    if (status !== "processing") {
      return payload;
    }
  }

  return {
    ok: true,
    mockup_status: "processing",
    task_key: taskKey,
  };
}

function initAiDesignWidget(root) {
  if (!root || initializedRoots.has(root)) return;
  initializedRoots.add(root);

  const formId = asString(root.dataset.productFormId);
  const form = formId ? document.getElementById(formId) : null;
  if (!(form instanceof HTMLFormElement)) return;

  const promptInput = root.querySelector("[data-ai-prompt]");
  const imageInput = root.querySelector("[data-ai-image-url]");
  const mockupInput = root.querySelector("[data-ai-mockup-url]");
  const productKeyInput = root.querySelector("[data-ai-product-key]");
  const placementInput = root.querySelector("[data-ai-placement]");
  const mockupIndexesInput = root.querySelector("[data-ai-mockup-indexes]");
  const mockupLimitInput = root.querySelector("[data-ai-mockup-limit]");
  const scaleInput = root.querySelector("[data-ai-scale]");
  const offsetXInput = root.querySelector("[data-ai-offset-x]");
  const offsetYInput = root.querySelector("[data-ai-offset-y]");
  const generateButton = root.querySelector("[data-ai-generate]");
  const applyFitButton = root.querySelector("[data-ai-apply-fit]");
  const statusNode = root.querySelector("[data-ai-status]");
  const generatedPreview = root.querySelector("[data-ai-generated-preview]");
  const localMockup = root.querySelector("[data-ai-local-mockup]");
  const localMockupBase = root.querySelector("[data-ai-local-mockup-base]");
  const localMockupDesign = root.querySelector("[data-ai-local-mockup-design]");
  const mockupPreview = root.querySelector("[data-ai-mockup-preview]");
  const mockupSelection = root.querySelector("[data-ai-mockup-selection]");
  const mockupSelectionList = root.querySelector("[data-ai-mockup-selection-list]");
  const applySelectedMockupsButton = root.querySelector("[data-ai-apply-selected-mockups]");

  if (
    !(promptInput instanceof HTMLTextAreaElement) ||
    !(imageInput instanceof HTMLInputElement) ||
    !(mockupInput instanceof HTMLInputElement) ||
    !(productKeyInput instanceof HTMLInputElement) ||
    !(placementInput instanceof HTMLInputElement) ||
    !(generateButton instanceof HTMLButtonElement)
  ) {
    return;
  }

  const variantMap = parseVariantMap(root);
  const promptMin = Number(root.dataset.promptMin || PROMPT_MIN_DEFAULT);
  const promptMax = Number(root.dataset.promptMax || PROMPT_MAX_DEFAULT);
  const productId = asString(root.dataset.productId);
  const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');

  let lastGeneratedPrompt = "";
  let lastGeneratedVariantId = "";
  let lastGeneratedLayoutKey = "";
  let nextMockupRetryAtMs = 0;
  let mockupApplyInFlight = false;
  let layoutMockupSupported = true;
  let lastReturnedMockupUrls = [];
  let isBusy = false;

  const getVariantId = () => {
    const variantField = form.querySelector('input[name="id"], select[name="id"]');
    return variantField instanceof HTMLInputElement || variantField instanceof HTMLSelectElement
      ? asString(variantField.value)
      : "";
  };

  const getCurrentLayout = () => readLayout(scaleInput, offsetXInput, offsetYInput);
  const getCurrentLayoutKey = () => serializeLayout(getCurrentLayout());

  const resolveLocalMockupBaseUrl = () => {
    const gallery = findMediaGallery(root);
    if (!gallery) return "";
    const images = collectGalleryImages(gallery);
    for (const image of images) {
      const src = getImageBestSrc(image);
      if (src) return src;
    }
    return "";
  };

  const hideLocalMockupPreview = () => {
    if (localMockup instanceof HTMLElement) {
      localMockup.hidden = true;
    }
    if (localMockupBase instanceof HTMLImageElement) {
      setImage(localMockupBase, "");
      delete localMockupBase.dataset.baseUrl;
    }
    if (localMockupDesign instanceof HTMLImageElement) {
      setImage(localMockupDesign, "");
      resetLocalMockupDesignPreview(localMockupDesign);
    }
  };

  const getSelectedMockupUrls = () => {
    if (!lastReturnedMockupUrls.length) return [];
    if (!(mockupSelectionList instanceof HTMLElement)) {
      return [...lastReturnedMockupUrls];
    }

    const checkboxNodes = Array.from(
      mockupSelectionList.querySelectorAll('input[type="checkbox"][data-ai-mockup-choice]')
    );
    if (!checkboxNodes.length) {
      return [...lastReturnedMockupUrls];
    }

    const selected = [];
    for (const node of checkboxNodes) {
      if (!(node instanceof HTMLInputElement) || !node.checked) continue;
      const value = asString(node.value);
      if (!value || selected.includes(value)) continue;
      selected.push(value);
    }
    return selected;
  };

  const setSelectedMockupsButtonState = () => {
    if (!(applySelectedMockupsButton instanceof HTMLButtonElement)) return;
    applySelectedMockupsButton.disabled = isBusy || !getSelectedMockupUrls().length;
  };

  const clearMockupSelectionUi = () => {
    lastReturnedMockupUrls = [];
    if (mockupSelectionList instanceof HTMLElement) {
      mockupSelectionList.replaceChildren();
    }
    if (mockupSelection instanceof HTMLElement) {
      mockupSelection.hidden = true;
    }
    setSelectedMockupsButtonState();
  };

  const renderMockupSelectionUi = (mockupUrls) => {
    const uniqueUrls = [];
    for (const candidate of Array.isArray(mockupUrls) ? mockupUrls : []) {
      const value = asString(candidate);
      if (!value || uniqueUrls.includes(value)) continue;
      uniqueUrls.push(value);
    }

    lastReturnedMockupUrls = uniqueUrls;
    if (!uniqueUrls.length) {
      clearMockupSelectionUi();
      return;
    }

    if (mockupSelectionList instanceof HTMLElement) {
      mockupSelectionList.replaceChildren();
      uniqueUrls.forEach((url, index) => {
        const label = document.createElement("label");
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.gap = "6px";
        label.style.fontSize = "0.75rem";
        label.style.cursor = "pointer";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.value = url;
        checkbox.setAttribute("data-ai-mockup-choice", "true");
        checkbox.addEventListener("change", setSelectedMockupsButtonState);

        const thumb = document.createElement("img");
        thumb.src = url;
        thumb.alt = `Mockup view ${index + 1}`;
        thumb.width = 44;
        thumb.height = 44;
        thumb.style.width = "44px";
        thumb.style.height = "44px";
        thumb.style.objectFit = "cover";
        thumb.style.borderRadius = "4px";

        const title = document.createElement("span");
        title.textContent = `View ${index + 1}`;

        label.append(checkbox, thumb, title);
        mockupSelectionList.appendChild(label);
      });
    }

    if (mockupSelection instanceof HTMLElement) {
      mockupSelection.hidden = false;
    }
    setSelectedMockupsButtonState();
  };

  const applySelectedMockups = () => {
    const selectedMockupUrls = getSelectedMockupUrls();
    if (!selectedMockupUrls.length) {
      setStatus(statusNode, "Choose at least one mockup view to apply.", true);
      return 0;
    }

    const firstSelectedUrl = selectedMockupUrls[0];
    mockupInput.value = firstSelectedUrl;
    setImage(mockupPreview, firstSelectedUrl);
    hideLocalMockupPreview();
    const updatedGalleryImages = applyMockupsToGallery(root, selectedMockupUrls);
    setSelectedMockupsButtonState();
    return updatedGalleryImages;
  };

  const refreshLocalMockupPreview = () => {
    if (
      !(localMockup instanceof HTMLElement) ||
      !(localMockupBase instanceof HTMLImageElement) ||
      !(localMockupDesign instanceof HTMLImageElement)
    ) {
      return;
    }

    const designUrl = asString(imageInput.value);
    if (!designUrl) {
      hideLocalMockupPreview();
      return;
    }

    const liveBaseUrl = resolveLocalMockupBaseUrl();
    const baseUrl = liveBaseUrl || asString(localMockupBase.dataset.baseUrl);
    if (!baseUrl) {
      hideLocalMockupPreview();
      return;
    }

    localMockupBase.dataset.baseUrl = baseUrl;
    setImage(localMockupBase, baseUrl);
    setImage(localMockupDesign, designUrl);
    applyLocalMockupDesignPreview(localMockupDesign, getCurrentLayout());
    localMockup.hidden = false;
  };

  const clearMockupPreview = ({ resetLayout = true } = {}) => {
    mockupInput.value = "";
    setImage(mockupPreview, "");
    restoreOriginalGallery(root);
    clearMockupSelectionUi();
    if (resetLayout) {
      lastGeneratedLayoutKey = "";
    }
    setApplyFitButtonState();
  };

  const clearAllPreviews = () => {
    imageInput.value = "";
    setImage(generatedPreview, "");
    resetLocalLayoutPreview(generatedPreview);
    hideLocalMockupPreview();
    clearMockupPreview({ resetLayout: true });
    lastGeneratedPrompt = "";
    lastGeneratedVariantId = "";
    nextMockupRetryAtMs = 0;
    layoutMockupSupported = true;
    setApplyFitButtonState();
  };

  const setBusy = (busy) => {
    isBusy = busy;
    generateButton.disabled = busy;
    if (applyFitButton instanceof HTMLButtonElement) {
      applyFitButton.disabled = busy || !canApplyFitToMockup();
    }
    setSelectedMockupsButtonState();
    if (submitButton instanceof HTMLButtonElement || submitButton instanceof HTMLInputElement) {
      submitButton.disabled = busy;
    }
  };

  const hasReusableImageForCurrentSelection = () => {
    const prompt = asString(promptInput.value);
    const variantId = getVariantId();
    return Boolean(
      asString(imageInput.value) &&
        prompt === lastGeneratedPrompt &&
        variantId === lastGeneratedVariantId
    );
  };

  const canApplyFitToMockup = () => {
    if (!layoutMockupSupported) return false;
    return Boolean(asString(imageInput.value));
  };

  const setApplyFitButtonState = () => {
    if (!(applyFitButton instanceof HTMLButtonElement)) return;
    applyFitButton.disabled = !canApplyFitToMockup();
  };

  const refreshLocalLayoutPreview = () => {
    applyLocalLayoutPreview(generatedPreview, getCurrentLayout());
    refreshLocalMockupPreview();
  };

  const requestMockupApply = async () => {
    if (mockupApplyInFlight) {
      setStatus(statusNode, "Mockup update already in progress...", false);
      return;
    }

    mockupApplyInFlight = true;
    try {
      await runPreviewFlow({ mockupOnly: true });
    } finally {
      mockupApplyInFlight = false;
    }
  };

  const invalidateIfChanged = () => {
    const prompt = asString(promptInput.value);
    const variantId = getVariantId();
    const layoutKey = getCurrentLayoutKey();
    refreshLocalLayoutPreview();
    setApplyFitButtonState();

    if (prompt !== lastGeneratedPrompt || variantId !== lastGeneratedVariantId) {
      clearAllPreviews();
      return;
    }

    if (layoutKey !== lastGeneratedLayoutKey && hasReusableImageForCurrentSelection()) {
      clearMockupPreview({ resetLayout: true });
      setStatus(
        statusNode,
        'Print fit changed. Click "Apply fit to mockup" to update the real Printful mockup.',
        false
      );
    }
  };

  promptInput.addEventListener("input", invalidateIfChanged);
  [scaleInput, offsetXInput, offsetYInput].forEach((input) => {
    if (input) input.addEventListener("input", invalidateIfChanged);
  });
  if (generatedPreview instanceof HTMLImageElement) {
    generatedPreview.addEventListener("load", refreshLocalLayoutPreview);
  }
  setApplyFitButtonState();
  refreshLocalLayoutPreview();

  document.addEventListener("variant:update", (event) => {
    const updatedProductId = asString(event?.detail?.data?.productId);
    if (!productId || !updatedProductId || updatedProductId !== productId) return;
    if (lastGeneratedVariantId && getVariantId() === lastGeneratedVariantId) return;
    clearAllPreviews();
    setStatus(
      statusNode,
      "Variant changed. Generate a new preview before adding to cart.",
      false
    );
  });

  const runMockupRequest = async ({
    backendBaseUrl,
    imageUrl,
    productKey,
    placement,
    variantTitle,
    layout,
    estimatedStatus,
    reusedExistingImage,
  }) => {
    const mockupPayload = {
      image_url: imageUrl,
      pf_product_key: productKey,
      pf_placement: placement,
      layout,
    };

    const mockupIndexes = asString(mockupIndexesInput?.value);
    const mockupLimit = asString(mockupLimitInput?.value);
    if (mockupIndexes) {
      mockupPayload.pf_mockup_indexes = mockupIndexes;
    }
    if (mockupLimit) {
      mockupPayload.pf_mockup_limit = mockupLimit;
    }

    if (variantTitle) {
      mockupPayload.variant_title = variantTitle;
    }

    const mockupResponse = await postJson(
      buildUrl(backendBaseUrl, "/api/preview/mockup"),
      mockupPayload
    );

    const applyMockupResponse = (responsePayload) => {
      const mockupStatus = asString(responsePayload?.mockup_status) || "processing";
      const mockupReason = asString(responsePayload?.reason);
      const rawMockupUrls = parseMockupUrls(responsePayload);
      const mockupUrls = filterUsableMockupUrls(rawMockupUrls, imageUrl);
      const returnedMockupsCount = mockupUrls.length;
      const ignoredUrlsCount = Math.max(0, rawMockupUrls.length - returnedMockupsCount);
      const mockupUrl = mockupUrls[0] || "";

      if (mockupStatus === "completed" && mockupUrl) {
        estimatedStatus.stop();
        nextMockupRetryAtMs = 0;
        layoutMockupSupported = true;
        renderMockupSelectionUi(mockupUrls);
        const selectedMockupUrls = getSelectedMockupUrls();
        const selectedCount = selectedMockupUrls.length;
        const appliedMockupUrls = selectedCount ? selectedMockupUrls : mockupUrls;
        const firstAppliedMockupUrl = asString(appliedMockupUrls[0]);
        mockupInput.value = firstAppliedMockupUrl;
        setImage(mockupPreview, firstAppliedMockupUrl);
        hideLocalMockupPreview();
        const updatedGalleryImages = applyMockupsToGallery(root, appliedMockupUrls);
        if (updatedGalleryImages > 0) {
          setStatus(
            statusNode,
            `Preview ready. Printful returned ${returnedMockupsCount} usable mockup(s). Applied ${selectedCount || appliedMockupUrls.length} mockup(s). Updated ${updatedGalleryImages} gallery image(s).`,
            false
          );
        } else {
          setStatus(
            statusNode,
            `Preview ready. Printful returned ${returnedMockupsCount} mockup(s), but no visible gallery images were updated with the selected views.`,
            false
          );
        }
        return "completed";
      }

      if (mockupStatus === "completed" && !mockupUrl) {
        estimatedStatus.stop();
        nextMockupRetryAtMs = 0;
        layoutMockupSupported = true;
        clearMockupPreview({ resetLayout: true });
        setStatus(
          statusNode,
          `Printful completed, but no usable wearable mockups were returned${ignoredUrlsCount ? " (artwork-only URLs were ignored)." : "."}`,
          true
        );
        return "failed";
      }

      if (mockupStatus === "rate_limited") {
        estimatedStatus.stop();
        const retryAfter = Number(responsePayload?.retry_after_seconds);
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.round(retryAfter) : 60;
        nextMockupRetryAtMs = Date.now() + waitSeconds * 1000;
        const costHint = reusedExistingImage
          ? "OpenAI image was reused."
          : "Image generation may run again on next attempt.";
        setStatus(
          statusNode,
          `Printful mockup is rate-limited, retry in ${waitSeconds}s. ${costHint}`,
          true
        );
        return "rate_limited";
      }

      if (mockupStatus === "skipped") {
        estimatedStatus.stop();
        nextMockupRetryAtMs = 0;
        layoutMockupSupported = true;
        setStatus(
          statusNode,
          "Mockup unavailable for this variant, but you can add to cart.",
          false
        );
        return "skipped";
      }

      if (mockupStatus === "processing") {
        estimatedStatus.setStage("Esperando a Printful para completar la visualizacion");
        return "processing";
      }

      estimatedStatus.stop();
      nextMockupRetryAtMs = 0;
      if (mockupReason === "layout_not_supported") {
        layoutMockupSupported = false;
        setStatus(
          statusNode,
          "This product does not support manual position/scale in Printful mockups.",
          true
        );
        return "failed";
      }
      layoutMockupSupported = true;
      setStatus(
        statusNode,
        "Mockup unavailable right now, but you can add to cart.",
        false
      );
      return "failed";
    };

    let mockupStatus = applyMockupResponse(mockupResponse);
    if (mockupStatus === "processing") {
      const taskKey = asString(mockupResponse?.task_key);
      if (taskKey) {
        const finalMockupResponse = await pollMockupStatus(backendBaseUrl, taskKey);
        mockupStatus = applyMockupResponse(finalMockupResponse);
        if (mockupStatus === "processing") {
          estimatedStatus.stop();
          setStatus(
            statusNode,
            "Mockup still processing in Printful; retry in a bit.",
            false
          );
        }
      }
    }

    return mockupStatus;
  };

  const runPreviewFlow = async ({ mockupOnly = false } = {}) => {
    const backendBaseUrl = normalizeBaseUrl(root.dataset.backendBaseUrl);
    const productKey = asString(productKeyInput.value);
    const placement = asString(placementInput.value) || "front";
    const prompt = asString(promptInput.value);
    const variantId = getVariantId();
    const variantTitle = asString(variantMap[variantId]);
    const layout = getCurrentLayout();
    const layoutKey = serializeLayout(layout);
    const canReuseExistingImage =
      hasReusableImageForCurrentSelection() && asString(imageInput.value);

    if (!backendBaseUrl) {
      setStatus(statusNode, "Missing AI backend URL in theme settings.", true);
      clearAllPreviews();
      return "invalid";
    }

    if (!productKey) {
      setStatus(statusNode, "Missing printful product key for this product.", true);
      clearAllPreviews();
      return "invalid";
    }

    if (prompt.length < promptMin || prompt.length > promptMax) {
      setStatus(
        statusNode,
        `Prompt must be between ${promptMin} and ${promptMax} characters.`,
        true
      );
      clearAllPreviews();
      return "invalid";
    }

    if (mockupOnly && !canReuseExistingImage) {
      setStatus(
        statusNode,
        "Generate image first. Then you can apply print fit to mockup without OpenAI regeneration.",
        true
      );
      return "missing_image";
    }

    if (mockupOnly) {
      const nowMs = Date.now();
      if (nowMs < nextMockupRetryAtMs && canReuseExistingImage) {
        const waitSeconds = Math.max(1, Math.ceil((nextMockupRetryAtMs - nowMs) / 1000));
        setStatus(
          statusNode,
          `Printful mockup cooldown active. Retry in ${waitSeconds}s. No new OpenAI image was generated.`,
          true
        );
        return "rate_limited";
      }
    }

    setBusy(true);
    const estimatedStatus = createEstimatedStatusController(statusNode);

    try {
      let imageUrl = asString(imageInput.value);

      if (!mockupOnly) {
        if (canReuseExistingImage) {
          imageUrl = asString(imageInput.value);
          clearMockupPreview({ resetLayout: true });
          estimatedStatus.start("Actualizando visualizacion en la prenda (sin regenerar imagen)");
        } else {
          clearAllPreviews();
          estimatedStatus.start("Generando imagen");
          const imagePayload = await postJson(buildUrl(backendBaseUrl, "/api/preview/image"), {
            prompt,
            pf_product_key: productKey,
            pf_placement: placement,
          });

          imageUrl = asString(imagePayload.image_url);
          if (!imageUrl) {
            throw new Error("Image generation did not return a URL.");
          }

          imageInput.value = imageUrl;
          setImage(generatedPreview, imageUrl);
          refreshLocalLayoutPreview();
          lastGeneratedPrompt = prompt;
          lastGeneratedVariantId = variantId;
          lastGeneratedLayoutKey = "";
          nextMockupRetryAtMs = 0;
          clearMockupPreview({ resetLayout: true });
          estimatedStatus.setStage("Generando visualizacion en la prenda");
        }
      } else {
        imageUrl = asString(imageInput.value);
        clearMockupPreview({ resetLayout: true });
        estimatedStatus.start("Aplicando encuadre al mockup (sin regenerar imagen)");
      }

      const mockupStatus = await runMockupRequest({
        backendBaseUrl,
        imageUrl,
        productKey,
        placement,
        variantTitle,
        layout,
        estimatedStatus,
        reusedExistingImage: mockupOnly,
      });

      lastGeneratedPrompt = prompt;
      lastGeneratedVariantId = variantId;
      if (mockupStatus === "completed") {
        lastGeneratedLayoutKey = layoutKey;
      }
      setApplyFitButtonState();
      return mockupStatus;
    } catch (error) {
      estimatedStatus.stop();
      // Keep generated image when mockup fails, so user can retry Apply without paying OpenAI again.
      clearMockupPreview({ resetLayout: true });
      if (!mockupOnly && !asString(imageInput.value)) {
        clearAllPreviews();
      }
      setStatus(statusNode, error?.message || "Preview generation failed.", true);
      return "failed";
    } finally {
      estimatedStatus.stop();
      setBusy(false);
    }
  };

  generateButton.addEventListener("click", async () => {
    await runPreviewFlow({ mockupOnly: false });
  });

  if (applyFitButton instanceof HTMLButtonElement) {
    applyFitButton.addEventListener("click", async () => {
      await requestMockupApply();
    });
  }

  if (applySelectedMockupsButton instanceof HTMLButtonElement) {
    applySelectedMockupsButton.addEventListener("click", () => {
      const selectedCount = getSelectedMockupUrls().length;
      const updatedGalleryImages = applySelectedMockups();
      if (!updatedGalleryImages && selectedCount) {
        setStatus(
          statusNode,
          `Applied ${selectedCount} selected mockup(s), but no visible gallery images were updated.`,
          false
        );
        return;
      }
      if (selectedCount) {
        setStatus(
          statusNode,
          `Applied ${selectedCount} selected mockup(s). Updated ${updatedGalleryImages} gallery image(s).`,
          false
        );
      }
    });
  }

  form.addEventListener("submit", (event) => {
    const prompt = asString(promptInput.value);
    const variantId = getVariantId();
    const layoutKey = getCurrentLayoutKey();

    if (prompt.length < promptMin || prompt.length > promptMax) {
      event.preventDefault();
      setStatus(
        statusNode,
        `Prompt must be between ${promptMin} and ${promptMax} characters.`,
        true
      );
      return;
    }

    if (!asString(imageInput.value)) {
      event.preventDefault();
      setStatus(
        statusNode,
        "Generate an image preview before adding this product to cart.",
        true
      );
      return;
    }

    if (
      prompt !== lastGeneratedPrompt ||
      variantId !== lastGeneratedVariantId ||
      layoutKey !== lastGeneratedLayoutKey
    ) {
      event.preventDefault();
      setStatus(
        statusNode,
        "Prompt, variant, or print fit changed. Generate a new preview before adding to cart.",
        true
      );
    }
  });
}

function initAllAiDesignWidgets() {
  document.querySelectorAll("[data-ai-design-root]").forEach((root) => {
    initAiDesignWidget(root);
  });
}

document.addEventListener("DOMContentLoaded", initAllAiDesignWidgets);

const observer = new MutationObserver(() => {
  initAllAiDesignWidgets();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
