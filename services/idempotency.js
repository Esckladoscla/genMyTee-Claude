import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath, getNumberEnv } from "./env.js";

let db;
let currentDbPath;
let warnedInMemoryFallback = false;

function nowIso() {
  return new Date().toISOString();
}

function ensureDb() {
  const dbPath = getDbPath();
  if (db && (currentDbPath === dbPath || currentDbPath === ":memory:")) return db;

  if (db) {
    db.close();
  }

  const createSchema = (database) => {
    database.exec(`
    CREATE TABLE IF NOT EXISTS processed_orders (
      order_id TEXT PRIMARY KEY,
      external_id TEXT,
      printful_order_id TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
    // Tracking columns — added in Sprint 3
    const addColumnSafe = (col, type) => {
      try {
        database.exec(`ALTER TABLE processed_orders ADD COLUMN ${col} ${type}`);
      } catch { /* column already exists */ }
    };
    addColumnSafe("printful_status", "TEXT");
    addColumnSafe("tracking_number", "TEXT");
    addColumnSafe("tracking_url", "TEXT");
    addColumnSafe("shipping_carrier", "TEXT");
    addColumnSafe("tracking_updated_at", "TEXT");
  };

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    createSchema(db);
    currentDbPath = dbPath;
  } catch (error) {
    if (!warnedInMemoryFallback) {
      warnedInMemoryFallback = true;
      console.warn(
        `[idempotency] Failed to open sqlite file at ${dbPath}. Falling back to in-memory DB: ${error?.message}`
      );
    }
    db = new DatabaseSync(":memory:");
    createSchema(db);
    currentDbPath = ":memory:";
  }

  return db;
}

function upsertProcessing(orderId, externalId) {
  const database = ensureDb();
  const existing = getOrderRecord(orderId);
  const timestamp = nowIso();

  if (!existing) {
    database
      .prepare(`
        INSERT INTO processed_orders (
          order_id, external_id, printful_order_id, status, attempts, last_error, created_at, updated_at
        ) VALUES (
          ?, ?, NULL, 'processing', 1, NULL, ?, ?
        )
      `)
      .run(orderId, externalId || null, timestamp, timestamp);

    return { ok: true, reason: "started", record: getOrderRecord(orderId) };
  }

  if (existing.status === "completed") {
    return { ok: false, reason: "completed", record: existing };
  }

  if (existing.status === "processing") {
    const ttlMs = getNumberEnv("IDEMPOTENCY_PROCESSING_TTL_MS", { defaultValue: 900000 });
    const updatedAtMs = Date.parse(existing.updated_at || existing.created_at || "");
    const stale = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs > ttlMs : true;
    if (!stale) {
      return { ok: false, reason: "processing", record: existing };
    }
  }

  const attempts = Number(existing.attempts || 0) + 1;
  database
    .prepare(`
      UPDATE processed_orders
      SET
        external_id = COALESCE(?, external_id),
        status = 'processing',
        attempts = ?,
        last_error = NULL,
        updated_at = ?
      WHERE order_id = ?
    `)
    .run(externalId || null, attempts, timestamp, orderId);

  return { ok: true, reason: "restarted", record: getOrderRecord(orderId) };
}

export function getOrderRecord(orderId) {
  if (!orderId) return null;
  const database = ensureDb();
  const row = database
    .prepare("SELECT * FROM processed_orders WHERE order_id = ? LIMIT 1")
    .get(orderId);
  return row || null;
}

export function isCompleted(orderId) {
  const row = getOrderRecord(orderId);
  return Boolean(row && row.status === "completed");
}

export function startProcessing(orderId, { externalId } = {}) {
  if (!orderId) {
    throw new Error("startProcessing requires orderId");
  }
  return upsertProcessing(orderId, externalId);
}

export function markCompleted(orderId, { externalId, printfulOrderId } = {}) {
  if (!orderId) return;
  const database = ensureDb();
  const timestamp = nowIso();
  database
    .prepare(`
      UPDATE processed_orders
      SET
        external_id = COALESCE(?, external_id),
        printful_order_id = COALESCE(?, printful_order_id),
        status = 'completed',
        last_error = NULL,
        updated_at = ?
      WHERE order_id = ?
    `)
    .run(externalId || null, printfulOrderId || null, timestamp, orderId);
}

export function markFailed(orderId, error) {
  if (!orderId) return;
  const database = ensureDb();
  const timestamp = nowIso();
  const message = String(error?.message || error || "Unknown error");
  database
    .prepare(`
      UPDATE processed_orders
      SET
        status = 'failed',
        last_error = ?,
        updated_at = ?
      WHERE order_id = ?
    `)
    .run(message, timestamp, orderId);
}

export function updateTracking(orderId, { printfulStatus, trackingNumber, trackingUrl, shippingCarrier } = {}) {
  if (!orderId) return;
  const database = ensureDb();
  const timestamp = nowIso();
  database
    .prepare(`
      UPDATE processed_orders
      SET
        printful_status = COALESCE(?, printful_status),
        tracking_number = COALESCE(?, tracking_number),
        tracking_url = COALESCE(?, tracking_url),
        shipping_carrier = COALESCE(?, shipping_carrier),
        tracking_updated_at = ?
      WHERE order_id = ?
    `)
    .run(
      printfulStatus || null,
      trackingNumber || null,
      trackingUrl || null,
      shippingCarrier || null,
      timestamp,
      orderId
    );
}

export function getTracking(orderId) {
  const record = getOrderRecord(orderId);
  if (!record) return null;
  return {
    printful_order_id: record.printful_order_id || null,
    printful_status: record.printful_status || null,
    tracking_number: record.tracking_number || null,
    tracking_url: record.tracking_url || null,
    shipping_carrier: record.shipping_carrier || null,
    tracking_updated_at: record.tracking_updated_at || null,
  };
}

export function _resetIdempotencyStateForTests() {
  if (db) {
    db.close();
  }
  db = undefined;
  currentDbPath = undefined;
}
