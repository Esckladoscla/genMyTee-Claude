/**
 * CAPTCHA verification service — Cloudflare Turnstile.
 *
 * Env vars:
 *   CAPTCHA_ENABLED     — "true" to enforce verification (default: false)
 *   CAPTCHA_SECRET_KEY  — Turnstile secret key (server-side)
 *   CAPTCHA_SITE_KEY    — Turnstile site key (client-side, exposed via API)
 *
 * When disabled, verifyCaptcha() always returns { ok: true }.
 */

import { getBooleanEnv, getEnv } from "./env.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Check whether CAPTCHA enforcement is active.
 * @returns {boolean}
 */
export function isCaptchaEnabled() {
  return getBooleanEnv("CAPTCHA_ENABLED", { defaultValue: false });
}

/**
 * Return the site key so the frontend can render the widget.
 * @returns {string|null}
 */
export function getCaptchaSiteKey() {
  if (!isCaptchaEnabled()) return null;
  return getEnv("CAPTCHA_SITE_KEY", { defaultValue: "" }) || null;
}

/**
 * Verify a Turnstile token server-side.
 *
 * @param {string} token  — The `cf-turnstile-response` token from the client
 * @param {string} [ip]   — Optional client IP for additional validation
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifyCaptcha(token, ip) {
  if (!isCaptchaEnabled()) {
    return { ok: true };
  }

  const secretKey = getEnv("CAPTCHA_SECRET_KEY", { defaultValue: "" });
  if (!secretKey) {
    // Misconfiguration: enabled but no secret key → fail open with warning
    console.warn("[captcha] CAPTCHA_ENABLED=true but CAPTCHA_SECRET_KEY is not set — skipping verification");
    return { ok: true };
  }

  if (!token || typeof token !== "string" || !token.trim()) {
    return { ok: false, error: "captcha_missing" };
  }

  try {
    const body = new URLSearchParams({
      secret: secretKey,
      response: token.trim(),
    });
    if (ip) body.append("remoteip", ip);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      console.warn("[captcha] Turnstile API returned HTTP", res.status);
      // Fail open on Turnstile outage — don't block real users
      return { ok: true };
    }

    const data = await res.json();

    if (data.success) {
      return { ok: true };
    }

    const errorCodes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
    return {
      ok: false,
      error: "captcha_invalid",
      codes: errorCodes,
    };
  } catch (err) {
    console.warn("[captcha] verification request failed:", err?.message);
    // Fail open on network errors — don't block real users
    return { ok: true };
  }
}
