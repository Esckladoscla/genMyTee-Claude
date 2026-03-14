import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { _resetAuthForTests, registerUser, changePassword, deleteUserAccount, loginUser, validateSession } from "../services/auth.js";
import { _resetDesignHistoryForTests, saveDesign, getUserDesignCount, deleteDesign } from "../services/design-history.js";
import { buildAuthRouter, _resetRateLimitsForTests } from "../routes/auth.js";
import { buildProfileRouter } from "../routes/profile.js";
import { buildBlogRouter, _resetBlogForTests } from "../routes/blog.js";
import express from "express";

// --- Helpers ---

function makeApp(router, path = "/api/auth") {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
}

async function request(app, method, path, body, cookie) {
  const { default: http } = await import("node:http");
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const opts = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json;
          try { json = JSON.parse(data); } catch { json = data; }
          const setCookie = res.headers["set-cookie"]?.[0] || "";
          resolve({ status: res.statusCode, body: json, setCookie });
          server.close();
        });
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// --- Change Password Tests ---

describe("changePassword service", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
    _resetRateLimitsForTests();
  });
  afterEach(() => {
    _resetAuthForTests();
    delete process.env.DB_PATH;
  });

  it("changes password successfully", () => {
    const reg = registerUser("test@example.com", "oldpass123", "Test");
    assert.ok(reg.ok);
    const result = changePassword(reg.user.id, "oldpass123", "newpass456");
    assert.ok(result.ok);
    // Verify new password works
    const login = loginUser("test@example.com", "newpass456");
    assert.ok(login.ok);
  });

  it("rejects wrong current password", () => {
    const reg = registerUser("test2@example.com", "oldpass123", "Test");
    const result = changePassword(reg.user.id, "wrongpass", "newpass456");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_current_password");
  });

  it("rejects short new password", () => {
    const reg = registerUser("test3@example.com", "oldpass123", "Test");
    const result = changePassword(reg.user.id, "oldpass123", "short");
    assert.equal(result.ok, false);
    assert.equal(result.error, "password_too_short");
  });

  it("rejects missing params", () => {
    const result = changePassword(null, "old", "new12345");
    assert.equal(result.ok, false);
  });
});

// --- Delete Account Tests ---

describe("deleteUserAccount service", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
  });
  afterEach(() => {
    _resetAuthForTests();
    delete process.env.DB_PATH;
  });

  it("deletes user account and all data", () => {
    const reg = registerUser("delete@example.com", "password123", "Delete Me");
    assert.ok(reg.ok);
    const result = deleteUserAccount(reg.user.id);
    assert.ok(result.ok);
    // Verify user is gone
    const login = loginUser("delete@example.com", "password123");
    assert.equal(login.ok, false);
  });

  it("invalidates session after deletion", () => {
    const reg = registerUser("delete2@example.com", "password123", "Delete Me");
    assert.ok(reg.ok);
    deleteUserAccount(reg.user.id);
    const user = validateSession(reg.session.token);
    assert.equal(user, null);
  });

  it("rejects missing userId", () => {
    const result = deleteUserAccount(null);
    assert.equal(result.ok, false);
  });

  it("rejects non-existent user", () => {
    const result = deleteUserAccount("nonexistent-id");
    assert.equal(result.ok, false);
    assert.equal(result.error, "user_not_found");
  });
});

// --- Delete Design Tests ---

describe("deleteDesign service", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetDesignHistoryForTests();
  });
  afterEach(() => {
    _resetDesignHistoryForTests();
    delete process.env.DB_PATH;
  });

  it("deletes a design owned by the user", () => {
    const saved = saveDesign({ userId: "user1", prompt: "test design" });
    assert.ok(saved.id);
    const result = deleteDesign(saved.id, "user1");
    assert.ok(result.ok);
    assert.equal(getUserDesignCount("user1"), 0);
  });

  it("rejects deleting design owned by another user", () => {
    const saved = saveDesign({ userId: "user1", prompt: "test design" });
    const result = deleteDesign(saved.id, "user2");
    assert.equal(result.ok, false);
    assert.equal(result.error, "design_not_found");
    // Design still exists
    assert.equal(getUserDesignCount("user1"), 1);
  });

  it("rejects missing params", () => {
    const result = deleteDesign(null, "user1");
    assert.equal(result.ok, false);
  });
});

// --- Auth Route: Change Password ---

describe("POST /api/auth/change-password", () => {
  let app;
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
    _resetRateLimitsForTests();
    const router = buildAuthRouter({
      verifyCaptchaFn: () => ({ ok: true }),
      sendEmailFn: async () => {},
    });
    app = makeApp(router);
  });
  afterEach(() => {
    _resetAuthForTests();
    delete process.env.DB_PATH;
  });

  it("changes password for authenticated user", async () => {
    // Register
    const reg = await request(app, "POST", "/api/auth/register", {
      email: "pw@test.com", password: "oldpass123", name: "PW Test"
    });
    assert.equal(reg.status, 200);
    const cookie = reg.setCookie.split(";")[0];

    // Change password
    const res = await request(app, "POST", "/api/auth/change-password", {
      current_password: "oldpass123", new_password: "newpass456"
    }, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app, "POST", "/api/auth/change-password", {
      current_password: "old", new_password: "newpass456"
    });
    assert.equal(res.status, 401);
  });
});

// --- Auth Route: Delete Account ---

describe("DELETE /api/auth/account", () => {
  let app;
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
    _resetRateLimitsForTests();
    const router = buildAuthRouter({
      verifyCaptchaFn: () => ({ ok: true }),
      sendEmailFn: async () => {},
    });
    app = makeApp(router);
  });
  afterEach(() => {
    _resetAuthForTests();
    delete process.env.DB_PATH;
  });

  it("deletes account for authenticated user", async () => {
    const reg = await request(app, "POST", "/api/auth/register", {
      email: "del@test.com", password: "password123", name: "Del"
    });
    const cookie = reg.setCookie.split(";")[0];

    const res = await request(app, "DELETE", "/api/auth/account", null, cookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);

    // Verify session is cleared
    const me = await request(app, "GET", "/api/auth/me", null, cookie);
    assert.equal(me.body.authenticated, false);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app, "DELETE", "/api/auth/account");
    assert.equal(res.status, 401);
  });
});

// --- Profile Route: Delete Design ---

describe("DELETE /api/profile/designs/:id", () => {
  let app;
  let authCookie;
  let userId;

  beforeEach(async () => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
    _resetDesignHistoryForTests();
    _resetRateLimitsForTests();

    // Register user
    const reg = registerUser("profile@test.com", "password123", "Profile");
    userId = reg.user.id;
    authCookie = `gmt_auth=${reg.session.token}`;

    const profileRouter = buildProfileRouter({
      listOrdersByEmailFn: async () => [],
    });
    app = makeApp(profileRouter, "/api/profile");
  });
  afterEach(() => {
    _resetAuthForTests();
    _resetDesignHistoryForTests();
    delete process.env.DB_PATH;
  });

  it("deletes own design", async () => {
    const saved = saveDesign({ userId, prompt: "my design" });
    const res = await request(app, "DELETE", `/api/profile/designs/${saved.id}`, null, authCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
  });

  it("returns 404 for non-existent design", async () => {
    const res = await request(app, "DELETE", "/api/profile/designs/nonexistent", null, authCookie);
    assert.equal(res.status, 404);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app, "DELETE", "/api/profile/designs/whatever");
    assert.equal(res.status, 401);
  });
});

// --- Profile Route: Orders ---

describe("GET /api/profile/orders", () => {
  let app;

  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    _resetAuthForTests();
    _resetRateLimitsForTests();

    const reg = registerUser("orders@test.com", "password123", "Orders");
    const authCookie = `gmt_auth=${reg.session.token}`;

    const mockOrders = [
      { session_id: "cs_test_1", amount_total: 39, currency: "eur", payment_status: "paid", created: "2026-03-10T12:00:00Z", items: [{ name: "Camiseta personalizada", quantity: 1, amount: 39 }] },
    ];

    const profileRouter = buildProfileRouter({
      listOrdersByEmailFn: async () => mockOrders,
    });
    app = makeApp(profileRouter, "/api/profile");
    app._authCookie = authCookie;
  });
  afterEach(() => {
    _resetAuthForTests();
    delete process.env.DB_PATH;
  });

  it("returns orders from Stripe", async () => {
    const res = await request(app, "GET", "/api/profile/orders", null, app._authCookie);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    assert.equal(res.body.orders.length, 1);
    assert.equal(res.body.orders[0].amount_total, 39);
  });
});

// --- Blog Route Tests ---

describe("Blog routes", () => {
  let app;

  beforeEach(() => {
    _resetBlogForTests();
    const router = buildBlogRouter();
    app = makeApp(router, "/blog");
  });
  afterEach(() => {
    _resetBlogForTests();
  });

  it("GET /blog returns listing page", async () => {
    const res = await request(app, "GET", "/blog");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === "string" || res.body);
  });

  it("GET /blog/guia-de-tallas returns article", async () => {
    const res = await request(app, "GET", "/blog/guia-de-tallas");
    assert.equal(res.status, 200);
  });

  it("GET /blog/nonexistent returns 404", async () => {
    const res = await request(app, "GET", "/blog/nonexistent");
    assert.equal(res.status, 404);
  });
});
