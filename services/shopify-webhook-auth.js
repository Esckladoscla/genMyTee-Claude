import crypto from "node:crypto";
import { requireEnv } from "./env.js";

export function getRawBodyBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from("");
}

export function verifyShopifyWebhookHmac(rawBody, receivedHmac) {
  if (!receivedHmac) return false;

  const secret = requireEnv("SHOPIFY_WEBHOOK_SECRET");
  const payload = getRawBodyBuffer(rawBody);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const provided = String(receivedHmac).trim();

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
