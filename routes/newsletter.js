import { Router } from "express";
import { subscribeEmail } from "../services/newsletter.js";

const router = Router();

router.post("/", (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ ok: false, error: "email_invalid" });
  }
  const result = subscribeEmail(email.trim().toLowerCase());
  return res.json({ ok: true, ...result });
});

export default router;
