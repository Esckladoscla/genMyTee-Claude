import express from "express";
import {
  registerUser,
  loginUser,
  logoutSession,
  validateSession,
  buildAuthCookie,
  buildClearAuthCookie,
  parseAuthCookie,
  generateVerificationCode,
  verifyEmailCode,
  getGoogleOAuthConfig,
  getGoogleAuthUrl,
  handleGoogleCallback,
  linkSessionToUser,
} from "../services/auth.js";
import { sendEmail } from "../services/email.js";
import { verifyCaptcha } from "../services/captcha.js";
import { parseSessionCookie } from "../services/session-limiter.js";
import { linkDesignsToUser } from "../services/design-history.js";

// --- In-memory rate limiter ---
const rateLimits = new Map();

function checkRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const attempts = rateLimits.get(key) || [];
  const recent = attempts.filter(t => now - t < windowMs);
  if (recent.length >= maxAttempts) return false;
  recent.push(now);
  rateLimits.set(key, recent);
  return true;
}

// Periodic cleanup every 15 minutes
const _rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  const maxWindow = 30 * 60 * 1000; // longest window used
  for (const [key, attempts] of rateLimits) {
    const recent = attempts.filter(t => now - t < maxWindow);
    if (recent.length === 0) {
      rateLimits.delete(key);
    } else {
      rateLimits.set(key, recent);
    }
  }
}, 15 * 60 * 1000);
if (_rateLimitCleanupInterval.unref) _rateLimitCleanupInterval.unref();

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
}

export function _resetRateLimitsForTests() {
  rateLimits.clear();
}

export function buildAuthRouter({
  registerUserFn = registerUser,
  loginUserFn = loginUser,
  logoutSessionFn = logoutSession,
  validateSessionFn = validateSession,
  generateVerificationCodeFn = generateVerificationCode,
  verifyEmailCodeFn = verifyEmailCode,
  handleGoogleCallbackFn = handleGoogleCallback,
  sendEmailFn = sendEmail,
  verifyCaptchaFn = verifyCaptcha,
  linkSessionToUserFn = linkSessionToUser,
  linkDesignsToUserFn = linkDesignsToUser,
  logger = console,
} = {}) {
  const router = express.Router();

  // --- Register ---
  router.post("/register", async (req, res) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`register:ip:${ip}`, 3, 15 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const { email, password, name, captcha_token } = req.body || {};

    // CAPTCHA verification (optional — only enforced if enabled)
    const captchaResult = await verifyCaptchaFn(captcha_token, ip);
    if (!captchaResult.ok) {
      return res.status(422).json({ ok: false, error: captchaResult.error });
    }

    const result = registerUserFn(email, password, name);

    if (!result.ok) {
      const statusMap = {
        email_invalid: 422,
        password_too_short: 422,
        password_too_long: 422,
        email_exists: 409,
      };
      return res.status(statusMap[result.error] || 400).json({ ok: false, error: result.error });
    }

    // Link anonymous session data to new user
    const sessionId = parseSessionCookie(req.headers.cookie);
    if (sessionId) {
      try {
        linkSessionToUserFn(sessionId, result.user.id);
        linkDesignsToUserFn(sessionId, result.user.id);
      } catch (_) { /* best-effort */ }
    }

    // Send verification email (best-effort)
    const verification = generateVerificationCodeFn(result.user.email);
    if (verification.ok) {
      sendEmailFn(result.user.email, "email_verification", { code: verification.code }).catch(() => {});
    }

    res.setHeader("Set-Cookie", buildAuthCookie(result.session.token));
    return res.json({
      ok: true,
      user: result.user,
      needs_verification: true,
    });
  });

  // --- Login ---
  router.post("/login", (req, res) => {
    const { email, password } = req.body || {};
    const ip = getClientIp(req);

    // Rate limit by IP
    if (!checkRateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    // Rate limit by email
    if (email && typeof email === "string") {
      const normalizedEmail = email.trim().toLowerCase();
      if (!checkRateLimit(`login:email:${normalizedEmail}`, 5, 15 * 60 * 1000)) {
        return res.status(429).json({ ok: false, error: "rate_limited" });
      }
    }

    const result = loginUserFn(email, password);

    if (!result.ok) {
      const statusMap = {
        credentials_required: 422,
        invalid_credentials: 401,
        use_google_login: 422,
      };
      return res.status(statusMap[result.error] || 400).json({ ok: false, error: result.error });
    }

    // Link anonymous session data to user
    const sessionId = parseSessionCookie(req.headers.cookie);
    if (sessionId) {
      try {
        linkDesignsToUserFn(sessionId, result.user.id);
      } catch (_) { /* best-effort */ }
    }

    res.setHeader("Set-Cookie", buildAuthCookie(result.session.token));
    return res.json({
      ok: true,
      user: result.user,
    });
  });

  // --- Logout ---
  router.post("/logout", (req, res) => {
    const token = parseAuthCookie(req.headers.cookie);
    if (token) {
      logoutSessionFn(token);
    }
    res.setHeader("Set-Cookie", buildClearAuthCookie());
    return res.json({ ok: true });
  });

  // --- Current user ---
  router.get("/me", (req, res) => {
    const token = parseAuthCookie(req.headers.cookie);
    const user = validateSessionFn(token);
    if (!user) {
      return res.json({ ok: true, user: null, authenticated: false });
    }
    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        email_verified: Boolean(user.email_verified),
        avatar_url: user.avatar_url,
      },
      authenticated: true,
    });
  });

  // --- Email verification: send code ---
  router.post("/verify-email/send", (req, res) => {
    const token = parseAuthCookie(req.headers.cookie);
    const user = validateSessionFn(token);
    if (!user) {
      return res.status(401).json({ ok: false, error: "not_authenticated" });
    }
    if (user.email_verified) {
      return res.json({ ok: true, already_verified: true });
    }

    // Rate limit: max 3 per email per 15 min
    if (!checkRateLimit(`verify-send:email:${user.email}`, 3, 15 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const verification = generateVerificationCodeFn(user.email);
    if (!verification.ok) {
      return res.status(500).json({ ok: false, error: "verification_failed" });
    }

    sendEmailFn(user.email, "email_verification", { code: verification.code }).catch(() => {});
    return res.json({ ok: true, sent: true });
  });

  // --- Email verification: confirm code ---
  router.post("/verify-email/confirm", (req, res) => {
    const token = parseAuthCookie(req.headers.cookie);
    const user = validateSessionFn(token);
    if (!user) {
      return res.status(401).json({ ok: false, error: "not_authenticated" });
    }

    // Rate limit: max 5 per email per 30 min
    if (!checkRateLimit(`verify-confirm:email:${user.email}`, 5, 30 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const { code } = req.body || {};
    const result = verifyEmailCodeFn(user.email, code);
    if (!result.ok) {
      return res.status(422).json({ ok: false, error: result.error });
    }

    return res.json({ ok: true, verified: true });
  });

  // --- Google OAuth: redirect ---
  router.get("/google", (_req, res) => {
    const config = getGoogleOAuthConfig();
    if (!config.enabled) {
      return res.status(503).json({ ok: false, error: "google_not_configured" });
    }
    const authResult = getGoogleAuthUrl();
    if (!authResult) {
      return res.status(503).json({ ok: false, error: "google_not_configured" });
    }
    // Store state in cookie for CSRF verification
    res.setHeader("Set-Cookie", `gmt_oauth_state=${authResult.state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return res.redirect(authResult.url);
  });

  // --- Google OAuth: callback ---
  router.get("/google/callback", async (req, res) => {
    const { code, error, state } = req.query;
    if (error || !code) {
      return res.redirect("/?auth_error=google_denied");
    }

    // Verify OAuth state parameter (CSRF protection)
    const cookieHeader = req.headers.cookie || "";
    const stateMatch = cookieHeader.match(/(?:^|;\s*)gmt_oauth_state=([^;]+)/);
    const storedState = stateMatch ? stateMatch[1].trim() : null;
    const clearStateCookie = "gmt_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
    if (!state || !storedState || state !== storedState) {
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect("/?auth_error=invalid_state");
    }

    try {
      const result = await handleGoogleCallbackFn(String(code));
      if (!result.ok) {
        res.setHeader("Set-Cookie", clearStateCookie);
        return res.redirect(`/?auth_error=${encodeURIComponent(result.error)}`);
      }

      // Link anonymous session data
      const sessionId = parseSessionCookie(req.headers.cookie);
      if (sessionId) {
        try {
          linkSessionToUserFn(sessionId, result.user.id);
          linkDesignsToUserFn(sessionId, result.user.id);
        } catch (_) { /* best-effort */ }
      }

      res.setHeader("Set-Cookie", [
        clearStateCookie,
        buildAuthCookie(result.session.token),
      ]);
      return res.redirect("/?auth=success");
    } catch (err) {
      logger.error("[auth] Google callback error", { message: err?.message });
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect("/?auth_error=google_failed");
    }
  });

  // --- Auth config (for frontend) ---
  router.get("/config", (_req, res) => {
    const googleConfig = getGoogleOAuthConfig();
    return res.json({
      ok: true,
      google_enabled: googleConfig.enabled,
      google_client_id: googleConfig.enabled ? googleConfig.clientId : null,
    });
  });

  return router;
}

const router = buildAuthRouter();
export default router;
