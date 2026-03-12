import express from "express";
import {
  PROMPT_MAX_LENGTH,
  PROMPT_MIN_LENGTH,
  generateImageFromPrompt,
  getOpenAiUsageSnapshot,
  moderatePrompt,
  normalizePrompt,
} from "../services/openai.js";
import { uploadImageBuffer } from "../services/storage.js";
import { getBooleanEnv, getEnv } from "../services/env.js";
import { resolveVariantId } from "../services/variants.js";
import { generateMockupForVariant, getMockupTask } from "../services/printful.js";

const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const LAYOUT_SCALE_MIN = 0.30;
const LAYOUT_SCALE_MAX = 1.35;
const LAYOUT_OFFSET_MIN = -100;
const LAYOUT_OFFSET_MAX = 100;

function parseSafetyViolations(message) {
  const raw = String(message || "");
  const match = raw.match(/safety_violations=\[([^\]]+)\]/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPolicyRejectionPayload(error) {
  const message = String(error?.message || "");
  const normalized = message.toLowerCase();
  const status = Number(error?.status);
  const violations = parseSafetyViolations(message);

  const looksLikePolicyRejection =
    [400, 403].includes(status) &&
    (/rejected by the safety system/i.test(message) ||
      /safety_violations=\[/i.test(message) ||
      /content policy/i.test(message) ||
      /policy violation/i.test(message));

  if (!looksLikePolicyRejection) return null;

  const copyrightViolation =
    /copyright|trademark|intellectual property|\bip rights\b/i.test(normalized);

  if (copyrightViolation) {
    return {
      status: 422,
      body: {
        ok: false,
        error:
          "No podemos generar esta imagen porque el prompt puede infringir copyright o propiedad intelectual. Usa una descripción original.",
        reason: "openai_copyright_violation",
        policy: {
          provider: "openai",
          type: "copyright_or_ip",
          violations,
        },
      },
    };
  }

  return {
    status: 422,
    body: {
      ok: false,
      error:
        "No podemos generar esta imagen porque el prompt infringe políticas de uso (contenido sensible). Ajusta la descripción y vuelve a intentarlo.",
      reason: "openai_policy_violation",
      policy: {
        provider: "openai",
        type: "safety",
        violations,
      },
    },
  };
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseMockupLayout(input) {
  if (!input || typeof input !== "object") return null;

  const scale = clampNumber(input.scale, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX, 1);
  const offsetX = clampNumber(input.offset_x, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);
  const offsetY = clampNumber(input.offset_y, LAYOUT_OFFSET_MIN, LAYOUT_OFFSET_MAX, 0);

  return {
    scale: Number(scale.toFixed(3)),
    offset_x: Number(offsetX.toFixed(2)),
    offset_y: Number(offsetY.toFixed(2)),
  };
}

function parsePositiveIntegerCsv(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => Number(String(item || "").trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parseOptionalPositiveInteger(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function buildRateLimiter({ maxRequests, windowMs, now }) {
  const buckets = new Map();

  return {
    consume(ip) {
      const nowMs = now();
      const cutoff = nowMs - windowMs;
      const current = (buckets.get(ip) || []).filter((timestamp) => timestamp > cutoff);

      if (current.length >= maxRequests) {
        buckets.set(ip, current);
        const retryAfterMs = Math.max(1, windowMs - (nowMs - current[0]));
        return {
          limited: true,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        };
      }

      current.push(nowMs);
      buckets.set(ip, current);
      return { limited: false, retryAfterSeconds: 0 };
    },
  };
}

export function buildPreviewRouter({
  moderatePromptFn = moderatePrompt,
  generateImageFromPromptFn = generateImageFromPrompt,
  uploadImageBufferFn = uploadImageBuffer,
  resolveVariantIdFn = resolveVariantId,
  generateMockupForVariantFn = generateMockupForVariant,
  getMockupTaskFn = getMockupTask,
  now = () => Date.now(),
  maxRequests = DEFAULT_RATE_LIMIT_MAX,
  windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  logger = console,
} = {}) {
  const router = express.Router();
  const limiter = buildRateLimiter({ maxRequests, windowMs, now });
  const taskMockupSelectionByKey = new Map();
  const mockupSelectionTtlMs = 6 * 60 * 60 * 1000;

  const rememberTaskSelection = (taskKey, selection) => {
    const key = String(taskKey || "").trim();
    if (!key) return;
    const indexes = Array.isArray(selection?.mockupResultIndexes)
      ? selection.mockupResultIndexes
      : [];
    const limit = Number(selection?.mockupResultLimit);
    const hasLimit = Number.isFinite(limit) && limit > 0;
    if (!indexes.length && !hasLimit) return;

    taskMockupSelectionByKey.set(key, {
      mockupResultIndexes: indexes,
      mockupResultLimit: hasLimit ? Math.floor(limit) : null,
      updatedAt: now(),
    });
  };

  const getTaskSelection = (taskKey) => {
    const key = String(taskKey || "").trim();
    if (!key) return { mockupResultIndexes: null, mockupResultLimit: null };
    const entry = taskMockupSelectionByKey.get(key);
    if (!entry) return { mockupResultIndexes: null, mockupResultLimit: null };
    if (now() - Number(entry.updatedAt || 0) > mockupSelectionTtlMs) {
      taskMockupSelectionByKey.delete(key);
      return { mockupResultIndexes: null, mockupResultLimit: null };
    }
    return {
      mockupResultIndexes: Array.isArray(entry.mockupResultIndexes)
        ? entry.mockupResultIndexes
        : null,
      mockupResultLimit: Number.isFinite(Number(entry.mockupResultLimit))
        ? Number(entry.mockupResultLimit)
        : null,
    };
  };

  router.get("/openai/usage", (req, res) => {
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;
    return res.json({
      ok: true,
      usage: getOpenAiUsageSnapshot({ limit }),
    });
  });

  router.post("/image", async (req, res) => {
    const clientIp = getClientIp(req);
    const rate = limiter.consume(clientIp);
    if (rate.limited) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    try {
      const { prompt } = req.body || {};
      const normalizedPrompt = normalizePrompt(prompt);

      const aiEnabled = getBooleanEnv("AI_ENABLED", { defaultValue: true });
      if (!aiEnabled) {
        return res.status(503).json({
          ok: false,
          error: "ai_disabled",
          message: "AI generation is disabled (AI_ENABLED=false)",
        });
      }

      const moderation = await moderatePromptFn(normalizedPrompt);
      if (moderation.flagged) {
        return res.status(422).json({
          ok: false,
          error: "Prompt rejected by moderation policy",
          moderation: { flagged: true },
        });
      }

      const imageBuffer = await generateImageFromPromptFn(normalizedPrompt, {
        size: getEnv("AI_IMAGE_SIZE", { defaultValue: "auto" }),
      });

      const imageUrl = await uploadImageBufferFn(imageBuffer, {
        folder: "previews",
      });

      return res.json({
        ok: true,
        image_url: imageUrl,
        moderation: { flagged: false },
      });
    } catch (error) {
      if (error?.code === "INVALID_PROMPT") {
        return res.status(422).json({
          ok: false,
          error: error.message,
          constraints: {
            min_length: PROMPT_MIN_LENGTH,
            max_length: PROMPT_MAX_LENGTH,
          },
        });
      }

      if (String(error?.message || "") === "AI_DISABLED") {
        return res.status(503).json({ ok: false, error: "AI generation is disabled" });
      }

      const policyRejection = getPolicyRejectionPayload(error);
      if (policyRejection) {
        logger.warn("[preview] image generation rejected by OpenAI policy", {
          message: error?.message,
          reason: policyRejection.body.reason,
          violations: policyRejection.body.policy?.violations || [],
        });
        return res.status(policyRejection.status).json(policyRejection.body);
      }

      if (Number(error?.status) === 429 || /429|too many requests/i.test(String(error?.message || ""))) {
        return res.status(429).json({
          ok: false,
          error: "openai_rate_limited",
          message: "OpenAI rate limit or quota exceeded. Check billing/quota and retry.",
        });
      }

      if (
        [408, 425, 500, 502, 503, 504].includes(Number(error?.status)) ||
        /terminated|aborted|timeout|timed out|network|socket|econnreset|fetch failed/i.test(
          String(error?.message || "")
        )
      ) {
        return res.status(503).json({
          ok: false,
          error: "openai_temporary_error",
          message: "Temporary error generating image. Please retry in a few seconds.",
        });
      }

      logger.error("[preview] image generation failed", {
        message: error?.message,
      });
      return res.status(500).json({ ok: false, error: "Internal error" });
    }
  });

  router.post("/mockup", async (req, res) => {
    const {
      image_url,
      pf_product_key,
      pf_placement,
      pf_mockup_indexes,
      pf_mockup_limit,
      variant_title,
      layout,
    } = req.body || {};

    const imageUrl = String(image_url || "").trim();
    const productKey = String(pf_product_key || "").trim();
    const variantTitle = String(variant_title || "").trim();
    const placement = String(
      pf_placement || getEnv("PRINTFUL_PLACEMENT", { defaultValue: "front" })
    ).trim() || "front";
    const mockupResultIndexes = parsePositiveIntegerCsv(pf_mockup_indexes);
    const mockupResultLimit = parseOptionalPositiveInteger(pf_mockup_limit);

    if (!imageUrl) {
      return res.status(422).json({ ok: false, error: "image_url is required" });
    }

    if (!productKey) {
      return res.status(422).json({ ok: false, error: "pf_product_key is required" });
    }

    const variantId = resolveVariantIdFn({
      productKey,
      variantTitle,
    });

    if (!variantId) {
      return res.json({
        ok: true,
        mockup_status: "skipped",
        mockup_url: null,
        mockup_urls: [],
        reason: "variant_not_resolved",
        debug_variant_resolution: {
          product_key: productKey,
          variant_title: variantTitle,
        },
      });
    }

    try {
      const result = await generateMockupForVariantFn(Number(variantId), imageUrl, {
        placement,
        layout: parseMockupLayout(layout),
        mockupResultIndexes: mockupResultIndexes.length ? mockupResultIndexes : null,
        mockupResultLimit,
      });
      const status = String(result?.status || "processing");
      const mockupUrls = Array.isArray(result?.mockups) ? result.mockups.filter(Boolean) : [];
      const mockupUrl = mockupUrls.length ? mockupUrls[0] : null;
      const taskKey = String(result?.task_key || "").trim() || null;
      rememberTaskSelection(taskKey, {
        mockupResultIndexes,
        mockupResultLimit,
      });
      const mockupSourceUrls = Array.isArray(result?.mockup_source_urls)
        ? result.mockup_source_urls.filter(Boolean)
        : [];
      const mockupSelectedIndexes = Array.isArray(result?.mockup_selected_indexes)
        ? result.mockup_selected_indexes
        : [];
      const mockupIndexMap = Array.isArray(result?.mockup_index_map) ? result.mockup_index_map : [];

      if (status === "completed" && mockupUrl) {
        return res.json({
          ok: true,
          mockup_status: "completed",
          mockup_url: mockupUrl,
          mockup_urls: mockupUrls,
          mockup_source_urls: mockupSourceUrls,
          mockup_selected_indexes: mockupSelectedIndexes,
          mockup_index_map: mockupIndexMap,
          task_key: taskKey,
          reason: null,
        });
      }

      if (status === "failed") {
        return res.json({
          ok: true,
          mockup_status: "failed",
          mockup_url: null,
          mockup_urls: [],
          task_key: taskKey,
          reason: "printful_failed",
        });
      }

      return res.json({
        ok: true,
        mockup_status: "processing",
        mockup_url: mockupUrl,
        mockup_urls: mockupUrls,
        mockup_source_urls: mockupSourceUrls,
        mockup_selected_indexes: mockupSelectedIndexes,
        mockup_index_map: mockupIndexMap,
        task_key: taskKey,
        reason: "mockup_processing",
      });
    } catch (error) {
      const message = String(error?.message || "");
      if (String(error?.code || "") === "LAYOUT_NOT_SUPPORTED") {
        return res.json({
          ok: true,
          mockup_status: "failed",
          mockup_url: null,
          mockup_urls: [],
          task_key: null,
          reason: "layout_not_supported",
        });
      }
      if (Number(error?.status) === 429 || /too many requests|try again after/i.test(message)) {
        const retryMatch = message.match(/after\s+(\d+)\s*seconds?/i);
        const retryAfterSeconds = retryMatch ? Number(retryMatch[1]) : 60;
        return res.json({
          ok: true,
          mockup_status: "rate_limited",
          mockup_url: null,
          mockup_urls: [],
          task_key: null,
          reason: "printful_rate_limited",
          retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60,
        });
      }

      logger.warn("[preview] mockup generation failed", {
        message: error?.message,
      });

      return res.json({
        ok: true,
        mockup_status: "failed",
        mockup_url: null,
        mockup_urls: [],
        task_key: null,
        reason: "mockup_error",
      });
    }
  });

  router.get("/mockup/status", async (req, res) => {
    const taskKey = String(req.query?.task_key || "").trim();
    if (!taskKey) {
      return res.status(422).json({ ok: false, error: "task_key is required" });
    }

    try {
      const taskSelection = getTaskSelection(taskKey);
      const state = await getMockupTaskFn(taskKey, taskSelection);
      const status = String(state?.status || "processing");
      const mockupUrls = Array.isArray(state?.mockups) ? state.mockups.filter(Boolean) : [];
      const mockupUrl = mockupUrls.length ? mockupUrls[0] : null;
      const mockupSourceUrls = Array.isArray(state?.mockup_source_urls)
        ? state.mockup_source_urls.filter(Boolean)
        : [];
      const mockupSelectedIndexes = Array.isArray(state?.mockup_selected_indexes)
        ? state.mockup_selected_indexes
        : [];
      const mockupIndexMap = Array.isArray(state?.mockup_index_map) ? state.mockup_index_map : [];

      if (status === "completed" && mockupUrl) {
        taskMockupSelectionByKey.delete(taskKey);
        return res.json({
          ok: true,
          mockup_status: "completed",
          mockup_url: mockupUrl,
          mockup_urls: mockupUrls,
          mockup_source_urls: mockupSourceUrls,
          mockup_selected_indexes: mockupSelectedIndexes,
          mockup_index_map: mockupIndexMap,
          task_key: taskKey,
          reason: null,
        });
      }

      if (status === "failed") {
        taskMockupSelectionByKey.delete(taskKey);
        return res.json({
          ok: true,
          mockup_status: "failed",
          mockup_url: null,
          mockup_urls: [],
          task_key: taskKey,
          reason: "printful_failed",
        });
      }

      return res.json({
        ok: true,
        mockup_status: "processing",
        mockup_url: mockupUrl,
        mockup_urls: mockupUrls,
        mockup_source_urls: mockupSourceUrls,
        mockup_selected_indexes: mockupSelectedIndexes,
        mockup_index_map: mockupIndexMap,
        task_key: taskKey,
        reason: "mockup_processing",
      });
    } catch (error) {
      const message = String(error?.message || "");
      if (Number(error?.status) === 429 || /too many requests|try again after/i.test(message)) {
        const retryMatch = message.match(/after\s+(\d+)\s*seconds?/i);
        const retryAfterSeconds = retryMatch ? Number(retryMatch[1]) : 60;
        return res.json({
          ok: true,
          mockup_status: "rate_limited",
          mockup_url: null,
          mockup_urls: [],
          task_key: taskKey,
          reason: "printful_rate_limited",
          retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60,
        });
      }

      logger.warn("[preview] mockup status failed", {
        task_key: taskKey,
        message: error?.message,
      });
      return res.json({
        ok: true,
        mockup_status: "failed",
        mockup_url: null,
        mockup_urls: [],
        task_key: taskKey,
        reason: "mockup_status_error",
      });
    }
  });

  return router;
}

const router = buildPreviewRouter();
export default router;
