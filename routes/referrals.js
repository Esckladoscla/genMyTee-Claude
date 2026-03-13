import express from "express";
import {
  createReferralCode,
  validateReferralCode,
  recordReferralVisit,
  getReferralStats,
} from "../services/referrals.js";

export function buildReferralsRouter({
  createCodeFn = createReferralCode,
  validateCodeFn = validateReferralCode,
  recordVisitFn = recordReferralVisit,
  getStatsFn = getReferralStats,
} = {}) {
  const router = express.Router();

  // Generate a referral code for an email
  router.post("/generate", (req, res) => {
    const { email } = req.body || {};
    const result = createCodeFn(email);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.json({
      ok: true,
      code: result.code,
      share_url: `${req.protocol}://${req.get("host")}/?ref=${result.code}`,
      existing: result.existing,
    });
  });

  // Validate a referral code (used by frontend on page load with ?ref=)
  router.get("/validate", (req, res) => {
    const { code } = req.query;
    const result = validateCodeFn(code);
    if (!result.valid) {
      return res.json({ ok: true, valid: false });
    }

    // Record the visit
    const visitorSession = req.headers.cookie
      ? (req.headers.cookie.match(/gmt_session=([^;]+)/) || [])[1]
      : null;
    recordVisitFn(code, visitorSession);

    return res.json({
      ok: true,
      valid: true,
      discount_pct: result.discount_pct,
    });
  });

  // Get stats for your referral code
  router.get("/stats", (req, res) => {
    const { email } = req.query;
    const result = getStatsFn(email);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.json(result);
  });

  return router;
}

const router = buildReferralsRouter();
export default router;
