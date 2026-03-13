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
import { parseSessionCookie } from "../services/session-limiter.js";
import { linkDesignsToUser } from "../services/design-history.js";

const EMAIL_TEMPLATES = {
  email_verification: {
    subject: "Tu código de verificación - genMyTee",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1e293b;font-size:24px;">Verifica tu email</h1>
        <p style="color:#475569;font-size:16px;line-height:1.6;">
          Tu código de verificación es:
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">
          <p style="margin:0;color:#1e293b;font-size:36px;font-weight:700;letter-spacing:8px;">{code}</p>
        </div>
        <p style="color:#475569;font-size:14px;">
          Este código expira en 30 minutos. Si no solicitaste este código, puedes ignorar este email.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#94a3b8;font-size:12px;">genMyTee - Tu diseño, tu estilo</p>
      </div>
    `,
  },
};

export function buildAuthRouter({
  registerUserFn = registerUser,
  loginUserFn = loginUser,
  logoutSessionFn = logoutSession,
  validateSessionFn = validateSession,
  generateVerificationCodeFn = generateVerificationCode,
  verifyEmailCodeFn = verifyEmailCode,
  handleGoogleCallbackFn = handleGoogleCallback,
  sendEmailFn = sendEmail,
  linkSessionToUserFn = linkSessionToUser,
  linkDesignsToUserFn = linkDesignsToUser,
  logger = console,
} = {}) {
  const router = express.Router();

  // --- Register ---
  router.post("/register", (req, res) => {
    const { email, password, name } = req.body || {};
    const result = registerUserFn(email, password, name);

    if (!result.ok) {
      const statusMap = {
        email_invalid: 422,
        password_too_short: 422,
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
    const url = getGoogleAuthUrl();
    return res.redirect(url);
  });

  // --- Google OAuth: callback ---
  router.get("/google/callback", async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) {
      return res.redirect("/?auth_error=google_denied");
    }

    try {
      const result = await handleGoogleCallbackFn(String(code));
      if (!result.ok) {
        return res.redirect(`/?auth_error=${result.error}`);
      }

      // Link anonymous session data
      const sessionId = parseSessionCookie(req.headers.cookie);
      if (sessionId) {
        try {
          linkSessionToUserFn(sessionId, result.user.id);
          linkDesignsToUserFn(sessionId, result.user.id);
        } catch (_) { /* best-effort */ }
      }

      res.setHeader("Set-Cookie", buildAuthCookie(result.session.token));
      return res.redirect("/?auth=success");
    } catch (err) {
      logger.error("[auth] Google callback error", { message: err?.message });
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

// Register email_verification template with the email service
// We do this by re-exporting for the email service to use
export { EMAIL_TEMPLATES as AUTH_EMAIL_TEMPLATES };

const router = buildAuthRouter();
export default router;
