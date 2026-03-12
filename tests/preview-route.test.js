import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildPreviewRouter } from "../routes/preview.js";
import { withServer } from "./helpers/http.js";

function createPreviewApp(router) {
  const app = express();
  app.use(express.json());
  app.use("/api/preview", router);
  return app;
}

test("preview/image returns image url for valid prompt", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => Buffer.from("png"),
    uploadImageBufferFn: async () => "https://cdn.test/previews/sample.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A sharp geometric tiger in retro style",
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
        pf_placement: "front",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.image_url, "https://cdn.test/previews/sample.png");
    assert.deepEqual(payload.moderation, { flagged: false });
  });
});

test("preview/image blocks moderated prompt", async () => {
  let generateCalls = 0;

  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: true }),
    generateImageFromPromptFn: async () => {
      generateCalls += 1;
      return Buffer.from("png");
    },
    uploadImageBufferFn: async () => "https://cdn.test/previews/blocked.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A prompt that moderation should reject",
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.moderation.flagged, true);
    assert.equal(generateCalls, 0);
  });
});

test("preview/image enforces rate limit", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => Buffer.from("png"),
    uploadImageBufferFn: async () => "https://cdn.test/previews/rate.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    for (let i = 0; i < 10; i += 1) {
      const response = await fetch(`${baseUrl}/api/preview/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `Prompt number ${i} is valid text` }),
      });
      assert.equal(response.status, 200);
    }

    const blocked = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Prompt number eleven should be blocked" }),
    });

    assert.equal(blocked.status, 429);
    const payload = await blocked.json();
    assert.equal(payload.ok, false);
    assert.match(payload.error, /Rate limit/i);
  });
});

test("preview/image returns 429 when OpenAI is rate-limited", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => {
      const error = new Error("429 Too Many Requests");
      error.status = 429;
      throw error;
    },
    uploadImageBufferFn: async () => "https://cdn.test/previews/rate.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A long enough prompt for testing OpenAI rate limiting",
      }),
    });

    assert.equal(response.status, 429);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "openai_rate_limited");
  });
});

test("preview/image returns 503 when OpenAI fails with transient terminated error", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => {
      throw new Error("terminated");
    },
    uploadImageBufferFn: async () => "https://cdn.test/previews/rate.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A long enough prompt for transient OpenAI failure handling",
      }),
    });

    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "openai_temporary_error");
  });
});

test("preview/image returns 422 with policy message for OpenAI safety rejection", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => {
      const error = new Error(
        "400 Your request was rejected by the safety system. safety_violations=[sexual, violence]."
      );
      error.status = 400;
      throw error;
    },
    uploadImageBufferFn: async () => "https://cdn.test/previews/policy.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A long enough prompt for policy rejection coverage",
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, "openai_policy_violation");
    assert.equal(payload.policy?.type, "safety");
    assert.deepEqual(payload.policy?.violations, ["sexual", "violence"]);
    assert.match(payload.error, /políticas de uso/i);
  });
});

test("preview/image returns 422 with copyright message for IP policy rejection", async () => {
  const router = buildPreviewRouter({
    moderatePromptFn: async () => ({ flagged: false }),
    generateImageFromPromptFn: async () => {
      const error = new Error(
        "400 Request rejected by the safety system due to copyright policy violation."
      );
      error.status = 400;
      throw error;
    },
    uploadImageBufferFn: async () => "https://cdn.test/previews/copyright.png",
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "A long enough prompt for copyright policy rejection coverage",
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, "openai_copyright_violation");
    assert.equal(payload.policy?.type, "copyright_or_ip");
    assert.match(payload.error, /copyright|propiedad intelectual/i);
  });
});

test("preview/mockup returns completed status with mockup url", async () => {
  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async () => ({
      status: "completed",
      mockups: ["https://cdn.test/mockups/tee.png"],
    }),
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
        pf_placement: "front",
        variant_title: "M",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "completed");
    assert.equal(payload.mockup_url, "https://cdn.test/mockups/tee.png");
    assert.deepEqual(payload.mockup_urls, ["https://cdn.test/mockups/tee.png"]);
    assert.equal(payload.reason, null);
  });
});

test("preview/mockup forwards normalized layout controls to Printful generator", async () => {
  let capturedOptions = null;

  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async (_variantId, _imageUrl, options) => {
      capturedOptions = options;
      return {
        status: "completed",
        mockups: ["https://cdn.test/mockups/layout.png"],
      };
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "gildan-5000",
        pf_placement: "front",
        variant_title: "S",
        layout: {
          scale: 2.5,
          offset_x: -120,
          offset_y: 15,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(capturedOptions.placement, "front");
    assert.deepEqual(capturedOptions.layout, {
      scale: 1.35,
      offset_x: -100,
      offset_y: 15,
    });
  });
});

test("preview/mockup clamps below-minimum scale to 0.30", async () => {
  let capturedOptions = null;

  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async (_variantId, _imageUrl, options) => {
      capturedOptions = options;
      return {
        status: "completed",
        mockups: ["https://cdn.test/mockups/small.png"],
      };
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "gildan-5000",
        variant_title: "S",
        layout: {
          scale: 0.10,
          offset_x: 0,
          offset_y: 0,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(capturedOptions.layout, {
      scale: 0.3,
      offset_x: 0,
      offset_y: 0,
    });
  });
});

test("preview/mockup validates required image_url", async () => {
  const router = buildPreviewRouter();

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
      }),
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "image_url is required");
  });
});

test("preview/mockup returns skipped when variant cannot be resolved", async () => {
  const router = buildPreviewRouter({
    resolveVariantIdFn: () => null,
    generateMockupForVariantFn: async () => {
      throw new Error("Should not be called when variant is unresolved");
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
        variant_title: "Not a real size",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "skipped");
    assert.equal(payload.mockup_url, null);
    assert.deepEqual(payload.mockup_urls, []);
    assert.equal(payload.reason, "variant_not_resolved");
  });
});

test("preview/mockup returns failed status when mockup service errors", async () => {
  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async () => {
      throw new Error("Printful timeout");
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
        variant_title: "M",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "failed");
    assert.equal(payload.mockup_url, null);
    assert.deepEqual(payload.mockup_urls, []);
    assert.equal(payload.reason, "mockup_error");
  });
});

test("preview/mockup returns layout_not_supported when Printful cannot apply manual layout", async () => {
  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async () => {
      const error = new Error(
        "Printful mockup API for this product does not support manual layout adjustments"
      );
      error.code = "LAYOUT_NOT_SUPPORTED";
      throw error;
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "gildan-5000",
        variant_title: "M",
        layout: { scale: 1.1, offset_x: 15, offset_y: -8 },
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "failed");
    assert.equal(payload.reason, "layout_not_supported");
    assert.equal(payload.mockup_url, null);
    assert.deepEqual(payload.mockup_urls, []);
  });
});

test("preview/mockup returns rate_limited status when Printful throttles", async () => {
  const router = buildPreviewRouter({
    resolveVariantIdFn: () => 9952,
    generateMockupForVariantFn: async () => {
      const error = new Error("You've recently sent too many requests. Please try again after 60 seconds.");
      error.status = 429;
      throw error;
    },
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://cdn.test/previews/source.png",
        pf_product_key: "all-over-print-mens-athletic-t-shirt",
        variant_title: "M",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "rate_limited");
    assert.equal(payload.reason, "printful_rate_limited");
    assert.equal(payload.retry_after_seconds, 60);
    assert.equal(payload.mockup_url, null);
    assert.deepEqual(payload.mockup_urls, []);
  });
});

test("preview/mockup/status returns completed status", async () => {
  const router = buildPreviewRouter({
    getMockupTaskFn: async () => ({
      status: "completed",
      mockups: ["https://cdn.test/mockups/status.png"],
    }),
  });

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/preview/mockup/status?task_key=task_123`,
      { method: "GET" }
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mockup_status, "completed");
    assert.equal(payload.mockup_url, "https://cdn.test/mockups/status.png");
    assert.deepEqual(payload.mockup_urls, ["https://cdn.test/mockups/status.png"]);
    assert.equal(payload.task_key, "task_123");
  });
});

test("preview/mockup/status validates required task_key", async () => {
  const router = buildPreviewRouter();

  await withServer(createPreviewApp(router), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/preview/mockup/status`, {
      method: "GET",
    });

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "task_key is required");
  });
});

test("preview/image returns 503 when AI is disabled and does not call moderation", async () => {
  const originalAiEnabled = process.env.AI_ENABLED;
  process.env.AI_ENABLED = "false";

  let moderationCalls = 0;

  const router = buildPreviewRouter({
    moderatePromptFn: async () => {
      moderationCalls += 1;
      return { flagged: false };
    },
    generateImageFromPromptFn: async () => Buffer.from("png"),
    uploadImageBufferFn: async () => "https://cdn.test/previews/disabled.png",
  });

  try {
    await withServer(createPreviewApp(router), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/preview/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "A long enough prompt for disabled mode",
        }),
      });

      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.error, "ai_disabled");
      assert.equal(moderationCalls, 0);
    });
  } finally {
    if (originalAiEnabled === undefined) {
      delete process.env.AI_ENABLED;
    } else {
      process.env.AI_ENABLED = originalAiEnabled;
    }
  }
});
