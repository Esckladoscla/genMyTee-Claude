import { timingSafeEqual } from "node:crypto";
import express from "express";
import { getBooleanEnv, getEnv, getDbPath } from "../services/env.js";
import { getOpenAiUsageSnapshot } from "../services/openai.js";
import { getHourlyStats, getGenerationHistory } from "../services/generation-tracker.js";
import { getOrderStats } from "../services/idempotency.js";
import { getSessionStats } from "../services/session-limiter.js";
import {
  createExperiment, listExperiments, getExperimentResults, isAbTestingEnabled,
} from "../services/ab-testing.js";
import { listGiftCards } from "../services/gift-cards.js";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __adminDirname = dirname(fileURLToPath(import.meta.url));

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

  // ── Dashboard (F1-31) ──

  router.get("/dashboard", (_req, res) => {
    try {
      const hourly = getHourlyStats();
      const usage = getOpenAiUsageSnapshot({ limit: 500 });
      const generationHistory = getGenerationHistory();

      let orderStats;
      try {
        orderStats = getOrderStats();
      } catch {
        orderStats = null;
      }

      let sessionStats;
      try {
        sessionStats = getSessionStats();
      } catch {
        sessionStats = null;
      }

      // Estimated OpenAI costs (approximate pricing)
      const IMAGE_COST_USD = 0.04; // gpt-image-1 per image (1024x1024)
      const MODERATION_COST_USD = 0.001; // omni-moderation per call
      const estimatedCost = {
        image_generation_usd: usage.image_generation_calls * IMAGE_COST_USD,
        moderation_usd: usage.moderation_calls * MODERATION_COST_USD,
        total_usd: (usage.image_generation_calls * IMAGE_COST_USD) +
                   (usage.moderation_calls * MODERATION_COST_USD),
        note: "Estimates based on approximate per-call pricing. In-memory only (resets on deploy).",
      };

      // Conversion rate
      const totalGenerations = generationHistory.reduce((sum, h) => sum + h.count, 0) || hourly.count;
      const completedOrders = orderStats?.completed_orders || 0;
      const conversionRate = totalGenerations > 0
        ? ((completedOrders / totalGenerations) * 100).toFixed(2)
        : "0.00";

      return res.json({
        ok: true,
        ai_enabled: getBooleanEnv("AI_ENABLED", { defaultValue: true }),
        hourly_generations: hourly,
        generation_history: generationHistory,
        openai_usage: {
          total_calls: usage.total_calls,
          moderation_calls: usage.moderation_calls,
          image_generation_calls: usage.image_generation_calls,
          successful_calls: usage.successful_calls,
          failed_calls: usage.failed_calls,
        },
        estimated_cost: estimatedCost,
        orders: orderStats,
        sessions: sessionStats,
        conversion: {
          total_generations: totalGenerations,
          completed_orders: completedOrders,
          rate_percent: conversionRate,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
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

  // ── A/B Testing (F2-08) ──

  router.get("/experiments", (_req, res) => {
    try {
      return res.json({
        ok: true,
        enabled: isAbTestingEnabled(),
        experiments: listExperiments(),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.post("/experiments", (req, res) => {
    try {
      const { name, variants } = req.body || {};
      if (!name || typeof name !== "string") {
        return res.status(422).json({ ok: false, error: "name is required" });
      }
      const variantList = Array.isArray(variants) && variants.length >= 2
        ? variants
        : ["control", "variant_a"];
      const experiment = createExperiment(name, variantList);
      return res.json({ ok: true, experiment });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  router.get("/experiments/:id/results", (req, res) => {
    try {
      const data = getExperimentResults(req.params.id);
      if (!data) return res.status(404).json({ ok: false, error: "not_found" });
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Gift Cards Admin ──

  router.get("/gift-cards", (_req, res) => {
    try {
      const cards = listGiftCards({ limit: 100 });
      return res.json({ ok: true, gift_cards: cards, total: cards.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── Gallery Batch Generation (F2-01) ──

  router.post("/gallery/batch-generate", async (req, res) => {
    try {
      const { limit = 5, dry_run = true } = req.body || {};

      // Load curated designs that need generation
      const designsPath = join(__adminDirname, "..", "data", "curated-designs.json");
      const raw = readFileSync(designsPath, "utf8");
      const data = JSON.parse(raw);
      const pending = data.designs.filter((d) => !d.image_url);

      if (pending.length === 0) {
        return res.json({ ok: true, message: "all_designs_have_images", pending: 0 });
      }

      const batch = pending.slice(0, Math.min(limit, 10));

      if (dry_run) {
        return res.json({
          ok: true,
          dry_run: true,
          total_pending: pending.length,
          batch_size: batch.length,
          designs: batch.map((d) => ({ id: d.id, prompt: d.prompt_used })),
        });
      }

      // Real generation — requires AI_ENABLED + OpenAI key
      const aiEnabled = getBooleanEnv("AI_ENABLED", { defaultValue: true });
      if (!aiEnabled) {
        return res.status(503).json({ ok: false, error: "ai_disabled" });
      }

      // Dynamic import to avoid load-time issues
      const { generateImageFromPrompt } = await import("../services/openai.js");
      const { uploadImageBuffer } = await import("../services/storage.js");

      const results = [];

      for (const design of batch) {
        try {
          logger.log(`[admin] batch-generate: starting ${design.id}`);
          const buffer = await generateImageFromPrompt(design.prompt_used, { size: "1024x1024" });
          const filename = `${design.id}.png`;
          const url = await uploadImageBuffer(buffer, { filename, folder: "gallery" });

          // Update the design in the JSON file
          const designEntry = data.designs.find((d) => d.id === design.id);
          if (designEntry) designEntry.image_url = url;

          results.push({ id: design.id, ok: true, image_url: url });
          logger.log(`[admin] batch-generate: completed ${design.id} → ${url}`);
        } catch (err) {
          results.push({ id: design.id, ok: false, error: err?.message });
          logger.error(`[admin] batch-generate: failed ${design.id}: ${err?.message}`);
        }
      }

      // Persist updated designs file
      writeFileSync(designsPath, JSON.stringify(data, null, 2) + "\n", "utf8");

      return res.json({
        ok: true,
        generated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        remaining: pending.length - results.filter((r) => r.ok).length,
        results,
      });
    } catch (err) {
      logger.error(`[admin] batch-generate error: ${err?.message}`);
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}

const router = buildAdminRouter();
export default router;
