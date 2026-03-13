import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueGeneration,
  getJobStatus,
  getQueueStats,
  registerProcessor,
  _resetQueueForTests,
} from "../services/generation-queue.js";

test.beforeEach(() => {
  _resetQueueForTests();
  process.env.DB_PATH = ":memory:";
});

test.afterEach(() => {
  _resetQueueForTests();
  delete process.env.DB_PATH;
});

test("enqueueGeneration creates a job with pending status", () => {
  const result = enqueueGeneration({ prompt: "a wolf in the forest", sessionId: "s1" });
  assert.ok(result.job_id);
  assert.equal(result.status, "pending");
  assert.equal(result.position, 1);
});

test("getJobStatus returns null for unknown job", () => {
  const result = getJobStatus("nonexistent");
  assert.equal(result, null);
});

test("getJobStatus returns pending job with position", () => {
  const { job_id } = enqueueGeneration({ prompt: "test", sessionId: "s1" });
  const status = getJobStatus(job_id);
  assert.equal(status.status, "pending");
  assert.equal(status.position, 1);
});

test("enqueue multiple jobs tracks position correctly", () => {
  const j1 = enqueueGeneration({ prompt: "first", sessionId: "s1" });
  const j2 = enqueueGeneration({ prompt: "second", sessionId: "s2" });

  assert.equal(j1.position, 1);
  assert.equal(j2.position, 2);
});

test("getQueueStats returns counts by status", () => {
  enqueueGeneration({ prompt: "test1", sessionId: "s1" });
  enqueueGeneration({ prompt: "test2", sessionId: "s2" });

  const stats = getQueueStats();
  assert.equal(stats.pending, 2);
  assert.equal(stats.processing, 0);
  assert.equal(stats.completed, 0);
  assert.equal(stats.failed, 0);
});

test("processor completes job successfully", async () => {
  registerProcessor(async (prompt) => {
    return { image_url: `https://example.com/${prompt}.png` };
  });

  const { job_id } = enqueueGeneration({ prompt: "wolf" });

  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  const status = getJobStatus(job_id);
  assert.equal(status.status, "completed");
  assert.equal(status.image_url, "https://example.com/wolf.png");
});

test("processor marks job as failed on error", async () => {
  registerProcessor(async () => {
    throw new Error("generation_failed_permanently");
  });

  const { job_id } = enqueueGeneration({ prompt: "bad" });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const status = getJobStatus(job_id);
  assert.equal(status.status, "failed");
  assert.match(status.error, /generation_failed_permanently/);
});

test("processor retries on transient error", async () => {
  let calls = 0;
  registerProcessor(async (prompt) => {
    calls++;
    if (calls === 1) throw new Error("503 timeout");
    return { image_url: "https://example.com/retried.png" };
  });

  const { job_id } = enqueueGeneration({ prompt: "retry-test" });

  // Wait for retry processing
  await new Promise((resolve) => setTimeout(resolve, 150));

  const status = getJobStatus(job_id);
  assert.equal(status.status, "completed");
  assert.equal(status.image_url, "https://example.com/retried.png");
  assert.ok(calls >= 2, "Should have retried at least once");
});

test("processes jobs sequentially (FIFO)", async () => {
  const order = [];
  registerProcessor(async (prompt) => {
    order.push(prompt);
    await new Promise((r) => setTimeout(r, 10));
    return { image_url: `https://example.com/${prompt}.png` };
  });

  enqueueGeneration({ prompt: "first" });
  enqueueGeneration({ prompt: "second" });
  enqueueGeneration({ prompt: "third" });

  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.deepEqual(order, ["first", "second", "third"]);
});
