import express from "express";
import { validateSession, parseAuthCookie } from "../services/auth.js";
import { getUserDesigns, getUserDesignCount, deleteDesign } from "../services/design-history.js";
import { listOrdersByEmail } from "../services/stripe.js";

export function buildProfileRouter({
  validateSessionFn = validateSession,
  getUserDesignsFn = getUserDesigns,
  getUserDesignCountFn = getUserDesignCount,
  deleteDesignFn = deleteDesign,
  listOrdersByEmailFn = listOrdersByEmail,
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

  // --- Delete a design ---
  router.delete("/designs/:id", (req, res) => {
    const designId = req.params.id;
    const result = deleteDesignFn(designId, req.user.id);
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true });
  });

  // --- User orders (Stripe-linked) ---
  router.get("/orders", async (req, res) => {
    try {
      const orders = await listOrdersByEmailFn(req.user.email, { limit: 20 });
      return res.json({ ok: true, orders });
    } catch (err) {
      logger.warn("[profile] Error fetching orders from Stripe:", err?.message);
      return res.json({
        ok: true,
        orders: [],
        message: "El historial de pedidos no está disponible en este momento.",
      });
    }
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
