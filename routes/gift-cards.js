import express from "express";
import {
  getValidAmounts,
  createGiftCard,
  validateGiftCard,
  redeemGiftCard,
} from "../services/gift-cards.js";
import { sendEmail } from "../services/email.js";

export function buildGiftCardRouter({ logger = console } = {}) {
  const router = express.Router();

  // GET /api/gift-cards/amounts — available denominations
  router.get("/amounts", (_req, res) => {
    return res.json({ ok: true, amounts: getValidAmounts() });
  });

  // POST /api/gift-cards/purchase — create gift card after Stripe payment
  router.post("/purchase", async (req, res) => {
    try {
      const { amount, sender_email, recipient_email, recipient_name, message, stripe_session_id } = req.body || {};

      if (!amount || !getValidAmounts().includes(amount)) {
        return res.status(422).json({ ok: false, error: "invalid_amount", valid_amounts: getValidAmounts() });
      }
      if (!recipient_email || !recipient_email.includes("@")) {
        return res.status(422).json({ ok: false, error: "recipient_email_required" });
      }

      const result = createGiftCard({
        amountEur: amount,
        senderEmail: sender_email,
        recipientEmail: recipient_email,
        recipientName: recipient_name,
        message: message,
        stripeSessionId: stripe_session_id,
      });

      if (!result.ok) {
        return res.status(422).json(result);
      }

      // Send gift card email to recipient
      try {
        await sendEmail(recipient_email, "gift_card", {
          recipient_name: recipient_name || "amigo/a",
          sender_name: sender_email ? sender_email.split("@")[0] : "Alguien especial",
          amount: amount,
          code: result.gift_card.code,
          message: message || "",
          shop_url: "https://genmytee.com",
        }, { logger });
      } catch (err) {
        logger.warn(`[gift-cards] email send failed: ${err?.message}`);
      }

      return res.json(result);
    } catch (err) {
      logger.error(`[gift-cards] purchase error: ${err?.message}`);
      return res.status(500).json({ ok: false, error: "gift_card_creation_failed" });
    }
  });

  // GET /api/gift-cards/validate?code=GMT-XXXX-XXXX-XXXX
  router.get("/validate", (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(422).json({ ok: false, error: "code_required" });
    }
    const result = validateGiftCard(code);
    return res.json(result);
  });

  // POST /api/gift-cards/redeem
  router.post("/redeem", (req, res) => {
    try {
      const { code, stripe_session_id } = req.body || {};
      if (!code) {
        return res.status(422).json({ ok: false, error: "code_required" });
      }
      const result = redeemGiftCard(code, stripe_session_id);
      return res.json(result);
    } catch (err) {
      logger.error(`[gift-cards] redeem error: ${err?.message}`);
      return res.status(500).json({ ok: false, error: "redeem_failed" });
    }
  });

  return router;
}

const router = buildGiftCardRouter();
export default router;
