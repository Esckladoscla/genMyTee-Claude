import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";

import {
  saveDesign,
  getUserDesigns,
  getSessionDesigns,
  linkDesignsToUser,
  getUserDesignCount,
  _resetDesignHistoryForTests,
} from "../services/design-history.js";

describe("services/design-history", () => {
  beforeEach(() => _resetDesignHistoryForTests());
  afterEach(() => _resetDesignHistoryForTests());

  it("saves a design with user_id", () => {
    const result = saveDesign({
      userId: "user-1",
      sessionId: "session-1",
      prompt: "a wolf under the moon",
      previewUrl: "https://r2.example.com/previews/wolf.png",
      productionUrl: "https://r2.example.com/production/wolf.png",
    });
    assert.ok(result.id);
    assert.ok(result.created_at);
  });

  it("saves a design with session_id only", () => {
    const result = saveDesign({
      sessionId: "session-anon",
      prompt: "geometric fox",
    });
    assert.ok(result.id);
  });

  it("retrieves designs by user_id", () => {
    saveDesign({ userId: "user-2", prompt: "design 1" });
    saveDesign({ userId: "user-2", prompt: "design 2" });
    saveDesign({ userId: "other-user", prompt: "other design" });

    const designs = getUserDesigns("user-2");
    assert.equal(designs.length, 2);
    // Both designs belong to user-2
    const prompts = designs.map(d => d.prompt);
    assert.ok(prompts.includes("design 1"));
    assert.ok(prompts.includes("design 2"));
  });

  it("retrieves designs by session_id", () => {
    saveDesign({ sessionId: "sess-a", prompt: "session design 1" });
    saveDesign({ sessionId: "sess-a", prompt: "session design 2" });

    const designs = getSessionDesigns("sess-a");
    assert.equal(designs.length, 2);
  });

  it("links anonymous session designs to a user", () => {
    saveDesign({ sessionId: "sess-link", prompt: "pre-registration design" });

    // Before linking
    assert.equal(getUserDesigns("user-new").length, 0);

    // Link
    linkDesignsToUser("sess-link", "user-new");

    // After linking
    const designs = getUserDesigns("user-new");
    assert.equal(designs.length, 1);
    assert.equal(designs[0].prompt, "pre-registration design");
  });

  it("counts designs per user", () => {
    saveDesign({ userId: "user-count", prompt: "d1" });
    saveDesign({ userId: "user-count", prompt: "d2" });
    saveDesign({ userId: "user-count", prompt: "d3" });
    assert.equal(getUserDesignCount("user-count"), 3);
  });

  it("returns empty for unknown user", () => {
    assert.equal(getUserDesigns("nobody").length, 0);
    assert.equal(getUserDesignCount("nobody"), 0);
  });

  it("supports pagination", () => {
    for (let i = 0; i < 5; i++) {
      saveDesign({ userId: "user-page", prompt: `design ${i}` });
    }
    const page1 = getUserDesigns("user-page", { limit: 2, offset: 0 });
    assert.equal(page1.length, 2);

    const page2 = getUserDesigns("user-page", { limit: 2, offset: 2 });
    assert.equal(page2.length, 2);

    const page3 = getUserDesigns("user-page", { limit: 2, offset: 4 });
    assert.equal(page3.length, 1);
  });
});
