import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getBooleanEnv } from "./env.js";

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }

  const schema = `
    CREATE TABLE IF NOT EXISTS ab_experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      variants TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ab_assignments (
      experiment_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (experiment_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS ab_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec(schema);
    currentDbPath = dbPath;
  } catch {
    db = new DatabaseSync(":memory:");
    db.exec(schema);
    currentDbPath = ":memory:";
  }

  return db;
}

export function isAbTestingEnabled() {
  return getBooleanEnv("AB_TESTING_ENABLED", { defaultValue: false });
}

export function createExperiment(name, variants = ["control", "variant_a"]) {
  const database = ensureDb();
  const id = `exp_${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  database
    .prepare("INSERT INTO ab_experiments (id, name, variants, active, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(id, name, JSON.stringify(variants), now);

  return { id, name, variants, active: true };
}

export function getExperiment(experimentId) {
  const database = ensureDb();
  const row = database
    .prepare("SELECT * FROM ab_experiments WHERE id = ?")
    .get(experimentId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    variants: JSON.parse(row.variants),
    active: Boolean(row.active),
  };
}

export function listExperiments() {
  const database = ensureDb();
  return database
    .prepare("SELECT * FROM ab_experiments ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      variants: JSON.parse(row.variants),
      active: Boolean(row.active),
    }));
}

export function assignVariant(experimentId, sessionId) {
  if (!isAbTestingEnabled()) return null;

  const database = ensureDb();
  const experiment = getExperiment(experimentId);
  if (!experiment || !experiment.active) return null;

  // Check for existing assignment
  const existing = database
    .prepare("SELECT variant FROM ab_assignments WHERE experiment_id = ? AND session_id = ?")
    .get(experimentId, sessionId);

  if (existing) return existing.variant;

  // Deterministic assignment based on hash (consistent for same session)
  const hash = crypto.createHash("sha256").update(`${experimentId}:${sessionId}`).digest();
  const index = hash[0] % experiment.variants.length;
  const variant = experiment.variants[index];
  const now = new Date().toISOString();

  database
    .prepare("INSERT INTO ab_assignments (experiment_id, session_id, variant, created_at) VALUES (?, ?, ?, ?)")
    .run(experimentId, sessionId, variant, now);

  return variant;
}

export function trackEvent(experimentId, sessionId, eventType) {
  if (!isAbTestingEnabled()) return;

  const database = ensureDb();
  const assignment = database
    .prepare("SELECT variant FROM ab_assignments WHERE experiment_id = ? AND session_id = ?")
    .get(experimentId, sessionId);

  if (!assignment) return;

  const now = new Date().toISOString();
  database
    .prepare("INSERT INTO ab_events (experiment_id, session_id, variant, event_type, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(experimentId, sessionId, assignment.variant, eventType, now);
}

export function getExperimentResults(experimentId) {
  const database = ensureDb();
  const experiment = getExperiment(experimentId);
  if (!experiment) return null;

  const results = {};
  for (const variant of experiment.variants) {
    const assigned = database
      .prepare("SELECT COUNT(*) AS count FROM ab_assignments WHERE experiment_id = ? AND variant = ?")
      .get(experimentId, variant);

    const eventRows = database
      .prepare(`
        SELECT event_type, COUNT(*) AS count
        FROM ab_events
        WHERE experiment_id = ? AND variant = ?
        GROUP BY event_type
      `)
      .all(experimentId, variant);

    const events = {};
    for (const row of eventRows) {
      events[row.event_type] = Number(row.count);
    }

    results[variant] = {
      assigned: Number(assigned.count),
      events,
    };
  }

  return { experiment, results };
}

export function _resetAbTestingForTests() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
