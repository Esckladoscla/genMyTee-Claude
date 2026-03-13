import express from "express";
import { getBooleanEnv, getEnv } from "../services/env.js";
import { getOpenAiUsageSnapshot } from "../services/openai.js";
import { getHourlyStats } from "../services/generation-tracker.js";

function verifyAdminSecret(req) {
  const secret = getEnv("ADMIN_SECRET");
  if (!secret) return false;

  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7).trim();
  return token === secret;
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

  return router;
}

const router = buildAdminRouter();
export default router;
