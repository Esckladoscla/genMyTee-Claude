import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDbPath } from "./env.js";

const WATERMARK_TEXT = "genMyTee";
const WATERMARK_OPACITY = 0.18;
const WATERMARK_FONT_SIZE = 32;
const WATERMARK_SPACING_X = 280;
const WATERMARK_SPACING_Y = 160;
const WATERMARK_ANGLE = -30;

// --- URL mapping (preview → production) ---

let db;
let currentDbPath;

function ensureDb() {
  const dbPath = getDbPath();
  if (db && currentDbPath === dbPath) return db;

  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    currentDbPath = dbPath;
  } catch (_) {
    db = new DatabaseSync(":memory:");
    currentDbPath = ":memory:";
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS url_mappings (
      preview_url TEXT PRIMARY KEY,
      production_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

/**
 * Store the mapping between a preview URL and its production URL.
 * Called after uploading both versions with independent filenames.
 */
export function storeProductionMapping(previewUrl, productionUrl) {
  if (!previewUrl || !productionUrl) return;
  try {
    const database = ensureDb();
    const now = new Date().toISOString();
    database
      .prepare(
        "INSERT OR REPLACE INTO url_mappings (preview_url, production_url, created_at) VALUES (?, ?, ?)"
      )
      .run(previewUrl, productionUrl, now);
  } catch (_) {
    // Best-effort — fallback resolution still works
  }
}

function buildWatermarkSvg(width, height) {
  const fillColor = `rgba(255, 255, 255, ${WATERMARK_OPACITY})`;
  const strokeColor = `rgba(0, 0, 0, ${WATERMARK_OPACITY * 0.5})`;

  // Build repeated text elements to cover the full rotated area
  // Expand grid to cover corners after rotation
  const diagonal = Math.ceil(Math.sqrt(width * width + height * height));
  const cols = Math.ceil(diagonal / WATERMARK_SPACING_X) + 2;
  const rows = Math.ceil(diagonal / WATERMARK_SPACING_Y) + 2;
  const offsetX = -diagonal * 0.25;
  const offsetY = -diagonal * 0.25;

  let textElements = "";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = offsetX + col * WATERMARK_SPACING_X;
      const y = offsetY + row * WATERMARK_SPACING_Y;
      textElements += `<text x="${x}" y="${y}" `
        + `font-family="Arial, Helvetica, sans-serif" `
        + `font-size="${WATERMARK_FONT_SIZE}" `
        + `font-weight="bold" `
        + `fill="${fillColor}" `
        + `stroke="${strokeColor}" `
        + `stroke-width="0.5">`
        + `${WATERMARK_TEXT}</text>\n`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g transform="rotate(${WATERMARK_ANGLE}, ${width / 2}, ${height / 2})">
    ${textElements}
  </g>
</svg>`;
}

export async function applyWatermark(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error("applyWatermark: imageBuffer must be a non-empty Buffer");
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  const svgOverlay = Buffer.from(buildWatermarkSvg(width, height));

  return sharp(imageBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

export function resolveProductionUrl(previewUrl) {
  if (!previewUrl || typeof previewUrl !== "string") return previewUrl;

  // Try DB lookup first (independent filenames)
  try {
    const database = ensureDb();
    const row = database
      .prepare("SELECT production_url FROM url_mappings WHERE preview_url = ?")
      .get(previewUrl);
    if (row?.production_url) return row.production_url;
  } catch (_) {
    // Fall through to legacy resolution
  }

  // Legacy fallback: same filename, different folder
  return previewUrl.replace("/previews/", "/production/");
}

export function _resetWatermarkForTests() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = undefined;
  currentDbPath = undefined;
}
