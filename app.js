import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import previewRouter from "./routes/preview.js";
import ordersRouter from "./routes/orders.js";
import catalogRouter from "./routes/catalog.js";
import newsletterRouter from "./routes/newsletter.js";
import adminRouter from "./routes/admin.js";
import galleryRouter from "./routes/gallery.js";
import referralsRouter from "./routes/referrals.js";
import giftCardRouter from "./routes/gift-cards.js";
import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import { buildCheckoutRouter } from "./routes/checkout.js";
import { getAllowedOrigins } from "./services/env.js";
import { assignVariant, trackEvent, isAbTestingEnabled } from "./services/ab-testing.js";
import { parseSessionCookie } from "./services/session-limiter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function addVaryOrigin(res) {
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", "Origin");
    return;
  }
  const value = String(existing);
  if (!value.toLowerCase().includes("origin")) {
    res.setHeader("Vary", `${value}, Origin`);
  }
}

function buildCorsMiddleware() {
  const allowedOrigins = getAllowedOrigins();
  const allowAll = allowedOrigins.includes("*");

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();

    const originAllowed = allowAll || allowedOrigins.includes(origin);
    if (!originAllowed) {
      if (req.method === "OPTIONS") {
        return res.status(403).send("Origin blocked by CORS policy");
      }
      return res.status(403).json({ ok: false, error: "origin_not_allowed" });
    }

    addVaryOrigin(res);
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    return next();
  };
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(buildCorsMiddleware());

  // Raw-body routes (webhooks need unparsed body for signature verification)
  const rawBody = express.raw({ type: "application/json", limit: "2mb" });

  // Stripe checkout webhook needs raw body (before express.json)
  const checkoutRouter = buildCheckoutRouter();
  app.use("/api/checkout/webhook", rawBody, (req, res, next) => {
    // Forward to the checkout router's /webhook handler
    req.url = "/webhook";
    checkoutRouter(req, res, next);
  });

  // JSON-body routes
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/checkout", checkoutRouter);
  app.use("/api/preview", previewRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/newsletter", newsletterRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/gallery", galleryRouter);
  app.use("/api/referrals", referralsRouter);
  app.use("/api/gift-cards", giftCardRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/profile", profileRouter);

  // SSR design pages (SEO-indexable)
  // /galeria/:id → gallery SSR page
  app.get("/galeria/coleccion/:slug", (req, res, next) => {
    req.url = `/coleccion/${req.params.slug}`;
    galleryRouter(req, res, next);
  });
  app.get("/galeria/:id", (req, res, next) => {
    req.url = `/page/${req.params.id}`;
    galleryRouter(req, res, next);
  });

  // Dynamic sitemap
  app.get("/sitemap.xml", (req, res, next) => {
    req.url = "/sitemap.xml";
    galleryRouter(req, res, next);
  });

  // A/B testing public endpoints (F2-08)
  app.get("/api/ab/assign", (req, res) => {
    if (!isAbTestingEnabled()) {
      return res.json({ ok: true, variant: null, enabled: false });
    }
    const experimentId = String(req.query.experiment_id || "").trim();
    if (!experimentId) {
      return res.status(422).json({ ok: false, error: "experiment_id required" });
    }
    const sessionId = parseSessionCookie(req.headers.cookie) || "anon";
    const variant = assignVariant(experimentId, sessionId);
    return res.json({ ok: true, variant, experiment_id: experimentId });
  });

  app.post("/api/ab/track", (req, res) => {
    if (!isAbTestingEnabled()) return res.json({ ok: true });
    const { experiment_id, event_type } = req.body || {};
    if (!experiment_id || !event_type) {
      return res.status(422).json({ ok: false, error: "experiment_id and event_type required" });
    }
    const sessionId = parseSessionCookie(req.headers.cookie) || "anon";
    trackEvent(experiment_id, sessionId, event_type);
    return res.json({ ok: true });
  });

  app.use(express.static(join(__dirname, "public")));

  app.get("/health", (_req, res) => {
    res.status(200).send("ok");
  });

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: "not_found" });
  });

  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }
    console.error("[server] unhandled error", { message: err?.message });
    res.status(500).json({ ok: false, error: "internal_error" });
  });

  return app;
}
