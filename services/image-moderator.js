/**
 * Post-generation image moderation — uses OpenAI's moderation/vision API
 * to check generated images for policy violations before serving to users.
 *
 * Env vars:
 *   IMAGE_MODERATION_ENABLED — "true" to enable (default: false)
 *
 * When disabled, moderateImage() always returns { flagged: false }.
 */

import { getBooleanEnv, getEnv } from "./env.js";

/**
 * Check whether image moderation is active.
 * @returns {boolean}
 */
export function isImageModerationEnabled() {
  return getBooleanEnv("IMAGE_MODERATION_ENABLED", { defaultValue: false });
}

/**
 * Moderate a generated image using OpenAI's omni-moderation model.
 *
 * @param {string} imageUrl — Public URL of the image to check
 * @returns {Promise<{ flagged: boolean, categories?: string[] }>}
 */
export async function moderateImage(imageUrl) {
  if (!isImageModerationEnabled()) {
    return { flagged: false };
  }

  const apiKey = getEnv("OPENAI_KEY", { defaultValue: "" });
  if (!apiKey) {
    console.warn("[image-moderator] IMAGE_MODERATION_ENABLED=true but OPENAI_KEY is not set — skipping");
    return { flagged: false };
  }

  if (!imageUrl || typeof imageUrl !== "string") {
    return { flagged: false };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [
          {
            type: "image_url",
            image_url: { url: imageUrl },
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[image-moderator] OpenAI moderation API returned HTTP", res.status);
      // Fail open — don't block users on API issues
      return { flagged: false };
    }

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) {
      return { flagged: false };
    }

    if (!result.flagged) {
      return { flagged: false };
    }

    // Extract which categories were flagged
    const flaggedCategories = [];
    const categories = result.categories || {};
    for (const [category, isFlagged] of Object.entries(categories)) {
      if (isFlagged) flaggedCategories.push(category);
    }

    return {
      flagged: true,
      categories: flaggedCategories,
    };
  } catch (err) {
    console.warn("[image-moderator] moderation request failed:", err?.message);
    // Fail open on network errors
    return { flagged: false };
  }
}
