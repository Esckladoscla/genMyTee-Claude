import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildAdminRouter } from "../routes/admin.js";
import { withServer } from "./helpers/http.js";
import { _resetTrackerForTests } from "../services/generation-tracker.js";
import { _resetSessionLimiterForTests } from "../services/session-limiter.js";
import { _resetIdempotencyStateForTests } from "../services/idempotency.js";

const TEST_SECRET = "dashboard-test-secret";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", buildAdminRouter());
  return app;
}

function authHeaders() {
  return { Authorization: `Bearer ${TEST_SECRET}` };
}

describe("dashboard", () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = TEST_SECRET;
    process.env.APP_DB_PATH = ":memory:";
    _resetTrackerForTests();
    _resetSessionLimiterForTests();
    _resetIdempotencyStateForTests();
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    delete process.env.AI_ENABLED;
    delete process.env.APP_DB_PATH;
    _resetTrackerForTests();
    _resetSessionLimiterForTests();
    _resetIdempotencyStateForTests();
  });

  test("dashboard endpoint returns ok with all sections", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: authHeaders(),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(typeof data.ai_enabled, "boolean");
      assert.ok(data.hourly_generations);
      assert.ok(data.openai_usage);
      assert.ok(data.estimated_cost);
      assert.ok(data.conversion);
      assert.equal(typeof data.conversion.rate_percent, "string");
    });
  });

  test("dashboard rejects without auth", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`);
      assert.equal(res.status, 401);
    });
  });

  test("dashboard estimated_cost has expected fields", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      assert.equal(typeof data.estimated_cost.image_generation_usd, "number");
      assert.equal(typeof data.estimated_cost.moderation_usd, "number");
      assert.equal(typeof data.estimated_cost.total_usd, "number");
      assert.ok(data.estimated_cost.note);
    });
  });

  test("dashboard orders section returns stats", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.orders) {
        assert.equal(typeof data.orders.total_orders, "number");
        assert.equal(typeof data.orders.completed_orders, "number");
        assert.equal(typeof data.orders.total_revenue_cents, "number");
        assert.ok(data.orders.daily_orders);
      }
    });
  });

  test("dashboard sessions section returns stats", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.sessions) {
        assert.equal(typeof data.sessions.total_sessions, "number");
        assert.equal(typeof data.sessions.sessions_with_email, "number");
        assert.equal(typeof data.sessions.unique_ips, "number");
      }
    });
  });

  test("dashboard generation_history is an array", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      assert.ok(Array.isArray(data.generation_history));
    });
  });
});
