import { timingSafeEqual } from "node:crypto";
import express from "express";
import { getBooleanEnv, getEnv, getDbPath } from "../services/env.js";
import { getOpenAiUsageSnapshot } from "../services/openai.js";
import { getHourlyStats } from "../services/generation-tracker.js";
import { DatabaseSync } from "node:sqlite";

function verifyAdminSecret(req) {
  const secret = getEnv("ADMIN_SECRET");
  if (!secret) return false;

  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7).trim();

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(tokenBuf, secretBuf);
}

export function buildAdminRouter({ logger = console } = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    if (!verifyAdminSecret(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  });

  router.post("/ai", (req, res) => {
    const { enabled } = req.body || {};

    if (typeof enabled !== "boolean") {
      return res.status(422).json({
        ok: false,
        error: "Request body must include { enabled: true|false }",
      });
    }

    const previous = getBooleanEnv("AI_ENABLED", { defaultValue: true });
    process.env.AI_ENABLED = enabled ? "true" : "false";

    const action = enabled ? "enabled" : "disabled";
    logger.warn(`[admin] AI generation ${action} via admin endpoint (was: ${previous})`);

    return res.json({
      ok: true,
      ai_enabled: enabled,
      previous: previous,
    });
  });

  router.get("/ai", (_req, res) => {
    return res.json({
      ok: true,
      ai_enabled: getBooleanEnv("AI_ENABLED", { defaultValue: true }),
    });
  });

  router.get("/openai/usage", (req, res) => {
    const rawLimit = Number(req.query?.limit);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;
    return res.json({
      ok: true,
      usage: getOpenAiUsageSnapshot({ limit }),
    });
  });

  router.get("/stats", (_req, res) => {
    const hourly = getHourlyStats();
    const usage = getOpenAiUsageSnapshot({ limit: 50 });

    return res.json({
      ok: true,
      ai_enabled: getBooleanEnv("AI_ENABLED", { defaultValue: true }),
      hourly_generations: hourly,
      openai_usage: {
        total_calls: usage.total_calls,
        moderation_calls: usage.moderation_calls,
        image_generation_calls: usage.image_generation_calls,
        successful_calls: usage.successful_calls,
        failed_calls: usage.failed_calls,
      },
    });
  });

  // ── Order review panel (F1-15) ──

  router.get("/orders", (_req, res) => {
    try {
      const db = new DatabaseSync(getDbPath());
      const rows = db.prepare(
        `SELECT * FROM processed_orders ORDER BY created_at DESC LIMIT 100`
      ).all();
      db.close();
      return res.json({ ok: true, orders: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.get("/orders/:orderId", (req, res) => {
    try {
      const db = new DatabaseSync(getDbPath());
      const row = db.prepare(
        `SELECT * FROM processed_orders WHERE order_id = ? LIMIT 1`
      ).get(req.params.orderId);
      db.close();
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      return res.json({ ok: true, order: row });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post("/orders/:orderId/hold", (req, res) => {
    try {
      const db = new DatabaseSync(getDbPath());
      const row = db.prepare(
        `SELECT * FROM processed_orders WHERE order_id = ? LIMIT 1`
      ).get(req.params.orderId);
      if (!row) {
        db.close();
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      db.prepare(
        `UPDATE processed_orders SET status = 'held', updated_at = ? WHERE order_id = ?`
      ).run(new Date().toISOString(), req.params.orderId);
      db.close();
      logger.warn(`[admin] Order ${req.params.orderId} put on hold`);
      return res.json({ ok: true, status: "held" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post("/orders/:orderId/approve", (req, res) => {
    try {
      const db = new DatabaseSync(getDbPath());
      const row = db.prepare(
        `SELECT * FROM processed_orders WHERE order_id = ? LIMIT 1`
      ).get(req.params.orderId);
      if (!row) {
        db.close();
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      db.prepare(
        `UPDATE processed_orders SET status = 'completed', updated_at = ? WHERE order_id = ?`
      ).run(new Date().toISOString(), req.params.orderId);
      db.close();
      logger.warn(`[admin] Order ${req.params.orderId} approved`);
      return res.json({ ok: true, status: "completed" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}

const router = buildAdminRouter();
export default router;
