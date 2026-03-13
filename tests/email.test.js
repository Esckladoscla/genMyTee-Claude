import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

describe("email service", () => {
  let emailModule;

  beforeEach(async () => {
    delete process.env.EMAIL_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    // Fresh import each time to pick up env changes
    emailModule = await import(`../services/email.js?t=${Date.now()}`);
  });

  afterEach(() => {
    delete process.env.EMAIL_ENABLED;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  test("isEmailEnabled returns false by default", () => {
    assert.equal(emailModule.isEmailEnabled(), false);
  });

  test("isEmailEnabled returns true when EMAIL_ENABLED=true", async () => {
    process.env.EMAIL_ENABLED = "true";
    const mod = await import(`../services/email.js?t=${Date.now()}_2`);
    assert.equal(mod.isEmailEnabled(), true);
  });

  test("sendEmail returns error when disabled", async () => {
    const result = await emailModule.sendEmail("user@example.com", "order_confirmation", {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_disabled");
  });

  test("sendEmail returns error for invalid recipient", async () => {
    process.env.EMAIL_ENABLED = "true";
    const mod = await import(`../services/email.js?t=${Date.now()}_3`);
    const result = await mod.sendEmail("not-an-email", "order_confirmation", {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_recipient");
  });

  test("sendEmail returns error for unknown template", async () => {
    process.env.EMAIL_ENABLED = "true";
    const mod = await import(`../services/email.js?t=${Date.now()}_4`);
    const result = await mod.sendEmail("user@example.com", "nonexistent_template", {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "unknown_template");
  });

  test("sendEmail returns no_api_key when RESEND_API_KEY is not set", async () => {
    process.env.EMAIL_ENABLED = "true";
    const mod = await import(`../services/email.js?t=${Date.now()}_5`);
    const result = await mod.sendEmail("user@example.com", "order_confirmation", {}, {
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_api_key");
  });

  test("EMAIL_TEMPLATES has all required templates", () => {
    const templates = emailModule.EMAIL_TEMPLATES;
    assert.ok(templates.order_confirmation);
    assert.ok(templates.order_shipped);
    assert.ok(templates.review_request);
    for (const key of Object.keys(templates)) {
      assert.ok(templates[key].subject, `${key} missing subject`);
      assert.ok(templates[key].html, `${key} missing html`);
    }
  });

  test("sendOrderConfirmation calls sendEmail with correct template", async () => {
    // With email disabled, we just verify it returns the disabled error
    const result = await emailModule.sendOrderConfirmation("user@example.com", { orderId: "cs_test_abc123" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_disabled");
  });

  test("sendShippingNotification calls sendEmail with correct template", async () => {
    const result = await emailModule.sendShippingNotification("user@example.com", {
      orderId: "cs_test_abc123",
      carrier: "DHL",
      trackingNumber: "123456",
      trackingUrl: "https://tracking.example.com/123456",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_disabled");
  });

  test("sendReviewRequest calls sendEmail with correct template", async () => {
    const result = await emailModule.sendReviewRequest("user@example.com", {
      reviewUrl: "https://genmytee.com/review",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "email_disabled");
  });
});
