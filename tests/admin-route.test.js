import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildAdminRouter } from "../routes/admin.js";
import { withServer } from "./helpers/http.js";
import { _resetTrackerForTests } from "../services/generation-tracker.js";

const TEST_SECRET = "test-admin-secret-123";

function createAdminApp(overrides) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", buildAdminRouter(overrides));
  return app;
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TEST_SECRET}`,
  };
}

test.beforeEach(() => {
  process.env.ADMIN_SECRET = TEST_SECRET;
  _resetTrackerForTests();
});

test.afterEach(() => {
  delete process.env.ADMIN_SECRET;
  delete process.env.AI_ENABLED;
  _resetTrackerForTests();
});

test("admin/ai rejects request without auth", async () => {
  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "unauthorized");
  });
});

test("admin/ai rejects request with wrong secret", async () => {
  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(response.status, 401);
  });
});

test("admin/ai disables AI generation at runtime", async () => {
  process.env.AI_ENABLED = "true";

  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.ai_enabled, false);
    assert.equal(payload.previous, true);
    assert.equal(process.env.AI_ENABLED, "false");
  });
});

test("admin/ai enables AI generation at runtime", async () => {
  process.env.AI_ENABLED = "false";

  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ enabled: true }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.ai_enabled, true);
    assert.equal(payload.previous, false);
    assert.equal(process.env.AI_ENABLED, "true");
  });
});

test("admin/ai rejects missing enabled field", async () => {
  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
  });
});

test("admin/ai GET returns current AI status", async () => {
  process.env.AI_ENABLED = "true";

  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/ai`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.ai_enabled, true);
  });
});

test("admin/stats returns usage overview", async () => {
  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/stats`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.ai_enabled, "boolean");
    assert.equal(typeof payload.hourly_generations.count, "number");
    assert.equal(typeof payload.hourly_generations.threshold, "number");
    assert.equal(typeof payload.openai_usage.total_calls, "number");
  });
});

test("admin/stats rejects without auth", async () => {
  await withServer(createAdminApp(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/stats`, {
      method: "GET",
    });

    assert.equal(response.status, 401);
  });
});
