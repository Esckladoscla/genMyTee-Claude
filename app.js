import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import previewRouter from "./routes/preview.js";
import webhooksRouter from "./routes/webhooks.js";
import ordersRouter from "./routes/orders.js";
import catalogRouter from "./routes/catalog.js";
import { buildCheckoutRouter } from "./routes/checkout.js";
import { getAllowedOrigins } from "./services/env.js";

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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Shopify-Hmac-Sha256");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    return next();
  };
}

function logLegacyWebhookRoute(req, _res, next) {
  console.warn(`[deprecation] ${req.method} ${req.originalUrl} is deprecated. Use /api/webhooks/orders/create`);
  next();
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(buildCorsMiddleware());

  // Raw-body routes (webhooks need unparsed body for signature verification)
  const rawBody = express.raw({ type: "application/json", limit: "2mb" });
  app.use("/api/webhooks", rawBody, webhooksRouter);
  app.use("/webhooks", rawBody, logLegacyWebhookRoute, webhooksRouter);

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
