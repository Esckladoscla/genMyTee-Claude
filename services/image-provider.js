/**
 * Image generation provider abstraction.
 *
 * Primary provider: OpenAI (gpt-image-1)
 * Fallback providers can be added by registering them via registerProvider().
 * Provider selection: env var IMAGE_PROVIDER (default: "openai")
 *
 * Each provider implements:
 *   - name: string
 *   - generateImage(prompt, options) => Promise<Buffer>
 *   - moderatePrompt(prompt) => Promise<{ flagged: boolean }>
 *   - available() => boolean
 */

import { getEnv } from "./env.js";
import {
  generateImageFromPrompt as openaiGenerate,
  moderatePrompt as openaiModerate,
  normalizePrompt as openaiNormalize,
  PROMPT_MIN_LENGTH,
  PROMPT_MAX_LENGTH,
} from "./openai.js";

const providers = new Map();

// Register OpenAI as default provider
providers.set("openai", {
  name: "openai",
  generateImage: openaiGenerate,
  moderatePrompt: openaiModerate,
  available: () => {
    try {
      return !!getEnv("OPENAI_KEY");
    } catch {
      return false;
    }
  },
});

/**
 * Register a new image generation provider.
 */
export function registerProvider(name, provider) {
  providers.set(name, { name, ...provider });
}

/**
 * Get the currently configured provider name.
 */
export function getProviderName() {
  return getEnv("IMAGE_PROVIDER", { defaultValue: "openai" });
}

/**
 * Get the active provider instance.
 * Falls back through registered providers if primary is unavailable.
 */
export function getProvider() {
  const primaryName = getProviderName();
  const primary = providers.get(primaryName);

  if (primary?.available()) {
    return primary;
  }

  // Try fallback providers in registration order
  for (const [name, provider] of providers) {
    if (name !== primaryName && provider.available()) {
      return provider;
    }
  }

  // Return primary even if unavailable (will fail at call time with clear error)
  return primary || providers.get("openai");
}

/**
 * Generate an image using the active provider.
 */
export async function generateImage(prompt, options = {}) {
  const provider = getProvider();
  return provider.generateImage(prompt, options);
}

/**
 * Moderate a prompt using the active provider.
 */
export async function moderatePrompt(prompt) {
  const provider = getProvider();
  return provider.moderatePrompt(prompt);
}

/**
 * List registered providers and their availability.
 */
export function listProviders() {
  const result = [];
  for (const [name, provider] of providers) {
    result.push({
      name,
      available: provider.available(),
      active: name === getProviderName(),
    });
  }
  return result;
}

// Re-export for convenience
export { normalizePrompt } from "./openai.js";
export { PROMPT_MIN_LENGTH, PROMPT_MAX_LENGTH };
