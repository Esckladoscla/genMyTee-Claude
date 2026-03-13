import test from "node:test";
import assert from "node:assert/strict";
import {
  createGiftCard,
  validateGiftCard,
  redeemGiftCard,
  getValidAmounts,
  _resetGiftCardsForTests,
} from "../services/gift-cards.js";

test.afterEach(() => {
  _resetGiftCardsForTests();
});

// ── Service tests ──

test("getValidAmounts returns expected denominations", () => {
  const amounts = getValidAmounts();
  assert.deepEqual(amounts, [25, 50, 75, 100]);
});

test("createGiftCard creates a valid gift card", () => {
  const result = createGiftCard({
    amountEur: 50,
    senderEmail: "sender@test.com",
    recipientEmail: "recipient@test.com",
    recipientName: "Ana",
    message: "Feliz cumpleaños",
  });
  assert.equal(result.ok, true);
  assert.ok(result.gift_card.code.startsWith("GMT-"));
  assert.equal(result.gift_card.amount_eur, 50);
  assert.equal(result.gift_card.recipient_email, "recipient@test.com");
});

test("createGiftCard rejects invalid amount", () => {
  const result = createGiftCard({ amountEur: 33 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_amount");
});

test("validateGiftCard validates an active card", () => {
  const created = createGiftCard({ amountEur: 75, recipientEmail: "r@t.com" });
  const result = validateGiftCard(created.gift_card.code);
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.equal(result.amount_eur, 75);
  assert.equal(result.amount_cents, 7500);
});

test("validateGiftCard returns not_found for unknown code", () => {
  const result = validateGiftCard("GMT-XXXX-YYYY-ZZZZ");
  assert.equal(result.ok, true);
  assert.equal(result.valid, false);
  assert.equal(result.error, "not_found");
});

test("validateGiftCard handles invalid input", () => {
  assert.equal(validateGiftCard("").ok, false);
  assert.equal(validateGiftCard(null).ok, false);
});

test("redeemGiftCard redeems successfully", () => {
  const created = createGiftCard({ amountEur: 25, recipientEmail: "r@t.com" });
  const result = redeemGiftCard(created.gift_card.code, "cs_test_123");
  assert.equal(result.ok, true);
  assert.equal(result.redeemed, true);
  assert.equal(result.amount_eur, 25);
});

test("redeemGiftCard prevents double redemption", () => {
  const created = createGiftCard({ amountEur: 100, recipientEmail: "r@t.com" });
  redeemGiftCard(created.gift_card.code, "cs_1");
  const result = redeemGiftCard(created.gift_card.code, "cs_2");
  assert.equal(result.valid, false);
  assert.equal(result.error, "already_redeemed");
});

// ── Route tests ──

import { buildGiftCardRouter } from "../routes/gift-cards.js";
import express from "express";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/gift-cards", buildGiftCardRouter({ logger: { log() {}, warn() {}, error() {} } }));
  return app;
}

async function request(app, path, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${port}${path}`, opts)
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("GET /api/gift-cards/amounts returns valid amounts", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gift-cards/amounts");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.amounts, [25, 50, 75, 100]);
});

test("POST /api/gift-cards/purchase creates gift card", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gift-cards/purchase", {
    method: "POST",
    body: { amount: 50, recipient_email: "test@example.com", recipient_name: "Test" },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.gift_card.code.startsWith("GMT-"));
});

test("POST /api/gift-cards/purchase rejects invalid amount", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gift-cards/purchase", {
    method: "POST",
    body: { amount: 42, recipient_email: "test@example.com" },
  });
  assert.equal(status, 422);
  assert.equal(body.ok, false);
});

test("POST /api/gift-cards/purchase requires recipient email", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gift-cards/purchase", {
    method: "POST",
    body: { amount: 50 },
  });
  assert.equal(status, 422);
  assert.equal(body.error, "recipient_email_required");
});

test("GET /api/gift-cards/validate validates a gift card code", async () => {
  const created = createGiftCard({ amountEur: 25, recipientEmail: "r@t.com" });
  const app = buildApp();
  const { status, body } = await request(app, `/api/gift-cards/validate?code=${created.gift_card.code}`);
  assert.equal(status, 200);
  assert.equal(body.valid, true);
  assert.equal(body.amount_eur, 25);
});

test("GET /api/gift-cards/validate returns error for missing code", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/gift-cards/validate");
  assert.equal(status, 422);
  assert.equal(body.error, "code_required");
});
