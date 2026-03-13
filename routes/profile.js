import express from "express";
import { validateSession, parseAuthCookie } from "../services/auth.js";
import { getUserDesigns, getUserDesignCount } from "../services/design-history.js";

export function buildProfileRouter({
  validateSessionFn = validateSession,
  getUserDesignsFn = getUserDesigns,
  getUserDesignCountFn = getUserDesignCount,
  logger = console,
} = {}) {
  const router = express.Router();

  // Auth middleware
  router.use((req, res, next) => {
    const token = parseAuthCookie(req.headers.cookie);
    const user = validateSessionFn(token);
    if (!user) {
      return res.status(401).json({ ok: false, error: "not_authenticated" });
    }
    req.user = user;
    next();
  });

  // --- User designs ---
  router.get("/designs", (req, res) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const designs = getUserDesignsFn(req.user.id, { limit, offset });
    const total = getUserDesignCountFn(req.user.id);

    return res.json({
      ok: true,
      designs,
      total,
      limit,
      offset,
    });
  });

  // --- User orders (placeholder for Stripe-linked lookup) ---
  router.get("/orders", (_req, res) => {
    // Orders are currently tracked by Stripe session ID, not user account
    // This endpoint will be enhanced when we link Stripe customers to user accounts
    return res.json({
      ok: true,
      orders: [],
      message: "El historial de pedidos estará disponible próximamente vinculado a tu cuenta.",
    });
  });

  // --- Profile summary ---
  router.get("/summary", (req, res) => {
    const designCount = getUserDesignCountFn(req.user.id);
    return res.json({
      ok: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        email_verified: Boolean(req.user.email_verified),
        avatar_url: req.user.avatar_url,
      },
      stats: {
        total_designs: designCount,
      },
    });
  });

  return router;
}

const router = buildProfileRouter();
export default router;
