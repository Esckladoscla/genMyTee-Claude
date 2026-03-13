import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { getDbPath, getNumberEnv } from "./env.js";

const MAX_RETRIES = 2;
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

let db;
let currentDbPath;
let processing = false;
let processCallback = null;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS generation_queue (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT NOT NULL,
      session_id TEXT,
      client_ip TEXT,
      result_url TEXT,
      error_message TEXT,
      retries INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON generation_queue(status);
  `;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(schema);
    currentDbPath = dbPath;
  } catch (_) {
    db = new DatabaseSync(":memory:");
    db.exec(schema);
    currentDbPath = ":memory:";
  }

  return db;
}

function generateJobId() {
  return randomBytes(8).toString("hex");
}

/**
 * Enqueue a generation job. Returns the job_id immediately.
 */
export function enqueueGeneration({ prompt, sessionId, clientIp }) {
  const database = ensureDb();
  const jobId = generateJobId();
  const now = new Date().toISOString();

  database
    .prepare(
      "INSERT INTO generation_queue (job_id, status, prompt, session_id, client_ip, created_at) VALUES (?, 'pending', ?, ?, ?, ?)"
    )
    .run(jobId, prompt, sessionId || null, clientIp || null, now);

  // Trigger processing
  scheduleProcessing();

  // Return position in queue
  const position = database
    .prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'pending' AND created_at <= ?")
    .get(now);

  return {
    job_id: jobId,
    status: "pending",
    position: Number(position.count),
  };
}

/**
 * Get the status of a generation job.
 */
export function getJobStatus(jobId) {
  if (!jobId) return null;

  const database = ensureDb();
  const row = database
    .prepare("SELECT job_id, status, result_url, error_message, created_at, started_at, completed_at FROM generation_queue WHERE job_id = ?")
    .get(jobId);

  if (!row) return null;

  const result = {
    job_id: row.job_id,
    status: row.status,
    created_at: row.created_at,
  };

  if (row.status === "completed") {
    result.image_url = row.result_url;
    result.completed_at = row.completed_at;
  } else if (row.status === "failed") {
    result.error = row.error_message;
    result.completed_at = row.completed_at;
  } else if (row.status === "processing") {
    result.started_at = row.started_at;
  } else if (row.status === "pending") {
    const position = database
      .prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'pending' AND created_at <= ?")
      .get(row.created_at);
    result.position = Number(position.count);
  }

  return result;
}

/**
 * Get queue stats.
 */
export function getQueueStats() {
  const database = ensureDb();
  const pending = database.prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'pending'").get();
  const processing_count = database.prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'processing'").get();
  const completed = database.prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'completed'").get();
  const failed = database.prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'failed'").get();

  return {
    pending: Number(pending.count),
    processing: Number(processing_count.count),
    completed: Number(completed.count),
    failed: Number(failed.count),
  };
}

/**
 * Register the callback that processes a single job.
 * Signature: async (prompt) => { image_url: string }
 */
export function registerProcessor(callback) {
  processCallback = callback;
}

function scheduleProcessing() {
  if (processing) return;
  // Use setImmediate to avoid blocking
  setImmediate(() => processNextJob());
}

async function processNextJob() {
  if (processing || !processCallback) return;

  const database = ensureDb();

  // Clean up stale jobs (processing for too long)
  const staleCutoff = new Date(Date.now() - JOB_TTL_MS).toISOString();
  database
    .prepare("UPDATE generation_queue SET status = 'failed', error_message = 'timeout', completed_at = ? WHERE status = 'processing' AND started_at < ?")
    .run(new Date().toISOString(), staleCutoff);

  // Pick next pending job
  const job = database
    .prepare("SELECT job_id, prompt, retries FROM generation_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
    .get();

  if (!job) return;

  processing = true;
  const now = new Date().toISOString();

  // Mark as processing
  database
    .prepare("UPDATE generation_queue SET status = 'processing', started_at = ? WHERE job_id = ?")
    .run(now, job.job_id);

  try {
    const result = await processCallback(job.prompt);

    database
      .prepare("UPDATE generation_queue SET status = 'completed', result_url = ?, completed_at = ? WHERE job_id = ?")
      .run(result.image_url, new Date().toISOString(), job.job_id);
  } catch (error) {
    const message = String(error?.message || "generation_failed");
    const isTransient =
      /429|timeout|timed out|network|socket|econnreset|fetch failed|terminated|aborted|502|503|504/i.test(message);

    if (isTransient && Number(job.retries) < MAX_RETRIES) {
      // Retry: put back to pending with incremented retry count
      database
        .prepare("UPDATE generation_queue SET status = 'pending', retries = retries + 1, started_at = NULL WHERE job_id = ?")
        .run(job.job_id);
    } else {
      database
        .prepare("UPDATE generation_queue SET status = 'failed', error_message = ?, completed_at = ? WHERE job_id = ?")
        .run(message, new Date().toISOString(), job.job_id);
    }
  }

  processing = false;

  // Process next if any
  const nextPending = database
    .prepare("SELECT COUNT(*) as count FROM generation_queue WHERE status = 'pending'")
    .get();

  if (Number(nextPending.count) > 0) {
    scheduleProcessing();
  }
}

/**
 * Clean up old completed/failed jobs (call periodically).
 */
export function cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
  const database = ensureDb();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  database
    .prepare("DELETE FROM generation_queue WHERE status IN ('completed', 'failed') AND completed_at < ?")
    .run(cutoff);
}

export function _resetQueueForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
  processing = false;
  processCallback = null;
}
