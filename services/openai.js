import OpenAI from "openai";
import { getBooleanEnv, getEnv, requireEnv } from "./env.js";

export const PROMPT_MIN_LENGTH = 8;
export const PROMPT_MAX_LENGTH = 280;

const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const OPENAI_USAGE_LOG_MAX = 500;

let client;
const openAiUsageLog = [];

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: requireEnv("OPENAI_KEY") });
  }
  return client;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function pushOpenAiUsageEvent(event) {
  const entry = {
    at: new Date().toISOString(),
    ...event,
  };
  openAiUsageLog.push(entry);
  if (openAiUsageLog.length > OPENAI_USAGE_LOG_MAX) {
    openAiUsageLog.splice(0, openAiUsageLog.length - OPENAI_USAGE_LOG_MAX);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientImageError(error) {
  const status = Number(error?.status);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("terminated") ||
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("fetch failed")
  );
}

async function withRetries(fn, { attempts = 3, baseDelayMs = 400, shouldRetry = isTransientImageError } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && shouldRetry(error);
      if (!canRetry) throw error;
      const delay = baseDelayMs * attempt;
      await sleep(delay);
    }
  }
  throw lastError;
}

export function normalizeImageSize(size) {
  const normalized = String(size || "").trim();
  if (ALLOWED_SIZES.has(normalized)) return normalized;
  if (normalized === "2048x2048") return "auto";
  return "auto";
}

async function fetchBuffer(url) {
  const timeoutMs = parsePositiveInt(
    getEnv("OPENAI_IMAGE_DOWNLOAD_TIMEOUT_MS", { defaultValue: "30000" }),
    30000
  );
  const retries = parseNonNegativeInt(
    getEnv("OPENAI_IMAGE_DOWNLOAD_RETRIES", { defaultValue: "2" }),
    2
  );

  return withRetries(
    async () => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const err = new Error(`Failed to download generated image: ${response.status}`);
        err.status = response.status;
        throw err;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
    {
      attempts: retries + 1,
      shouldRetry: (error) => {
        const status = Number(error?.status);
        if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
        return isTransientImageError(error);
      },
    }
  );
}

export function normalizePrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) {
    const err = new Error("Prompt is required");
    err.code = "INVALID_PROMPT";
    throw err;
  }
  if (text.length < PROMPT_MIN_LENGTH || text.length > PROMPT_MAX_LENGTH) {
    const err = new Error(`Prompt length must be between ${PROMPT_MIN_LENGTH} and ${PROMPT_MAX_LENGTH} characters`);
    err.code = "INVALID_PROMPT";
    throw err;
  }
  return text;
}

export async function moderatePrompt(prompt) {
  const p = normalizePrompt(prompt);
  const startedAt = Date.now();
  let response;
  try {
    response = await getClient().moderations.create({
      model: "omni-moderation-latest",
      input: p,
    });
    pushOpenAiUsageEvent({
      operation: "moderation",
      status: "success",
      model: "omni-moderation-latest",
      prompt_length: p.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    pushOpenAiUsageEvent({
      operation: "moderation",
      status: "error",
      model: "omni-moderation-latest",
      prompt_length: p.length,
      duration_ms: Date.now() - startedAt,
      error_status: Number(error?.status) || null,
      error_message: String(error?.message || "").slice(0, 220),
    });
    throw error;
  }

  const result = response?.results?.[0] || {};
  return {
    flagged: Boolean(result.flagged),
    categories: result.categories || {},
    category_scores: result.category_scores || {},
  };
}

export async function generateImageFromPrompt(prompt, { size } = {}) {
  const enabled = getBooleanEnv("AI_ENABLED", { defaultValue: true });
  if (!enabled) {
    throw new Error("AI_DISABLED");
  }

  const p = normalizePrompt(prompt);
  const finalSize = normalizeImageSize(size || getEnv("AI_IMAGE_SIZE", { defaultValue: "auto" }));
  const generationRetries = parseNonNegativeInt(
    getEnv("OPENAI_IMAGE_GENERATION_RETRIES", { defaultValue: "2" }),
    2
  );

  const response = await withRetries(
    async (attempt) => {
      const startedAt = Date.now();
      try {
        const result = await getClient().images.generate({
          model: "gpt-image-1",
          prompt: p,
          size: finalSize,
        });
        pushOpenAiUsageEvent({
          operation: "image_generation",
          status: "success",
          model: "gpt-image-1",
          prompt_length: p.length,
          size: finalSize,
          attempt,
          duration_ms: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        pushOpenAiUsageEvent({
          operation: "image_generation",
          status: "error",
          model: "gpt-image-1",
          prompt_length: p.length,
          size: finalSize,
          attempt,
          duration_ms: Date.now() - startedAt,
          error_status: Number(error?.status) || null,
          error_message: String(error?.message || "").slice(0, 220),
        });
        throw error;
      }
    },
    {
      attempts: generationRetries + 1,
      shouldRetry: (error) => {
        const message = String(error?.message || "").toLowerCase();
        if (message.includes("quota")) return false;
        return isTransientImageError(error);
      },
    }
  );

  const image = response?.data?.[0];
  if (!image) {
    throw new Error("OpenAI image response missing data");
  }

  if (image.b64_json) {
    return Buffer.from(image.b64_json, "base64");
  }

  if (image.url) {
    return fetchBuffer(image.url);
  }

  throw new Error("OpenAI did not return image bytes or URL");
}

export function getOpenAiUsageSnapshot({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const events = openAiUsageLog.slice(-safeLimit);

  let moderationCalls = 0;
  let imageGenerationCalls = 0;
  let successfulCalls = 0;
  let failedCalls = 0;

  for (const event of openAiUsageLog) {
    if (event.operation === "moderation") moderationCalls += 1;
    if (event.operation === "image_generation") imageGenerationCalls += 1;
    if (event.status === "success") successfulCalls += 1;
    if (event.status === "error") failedCalls += 1;
  }

  return {
    total_calls: openAiUsageLog.length,
    moderation_calls: moderationCalls,
    image_generation_calls: imageGenerationCalls,
    successful_calls: successfulCalls,
    failed_calls: failedCalls,
    events,
  };
}

export function _resetOpenAiClientForTests() {
  client = undefined;
  openAiUsageLog.splice(0, openAiUsageLog.length);
}
