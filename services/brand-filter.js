import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let blacklist = null;
let patterns = null;

function loadBlacklist() {
  if (blacklist) return;
  const filePath = join(__dirname, "..", "data", "brand-blacklist.json");
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  blacklist = data.brands || [];
  // Pre-compile regex patterns for word-boundary matching (case-insensitive)
  patterns = blacklist.map((brand) => {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i");
  });
}

/**
 * Check if a prompt contains blacklisted brand/IP terms.
 * @param {string} prompt - The user prompt to check.
 * @returns {{ blocked: boolean, brand?: string }}
 */
export function checkBrandBlacklist(prompt) {
  loadBlacklist();
  if (!prompt || typeof prompt !== "string") {
    return { blocked: false };
  }
  for (let i = 0; i < patterns.length; i++) {
    if (patterns[i].test(prompt)) {
      return { blocked: true, brand: blacklist[i] };
    }
  }
  return { blocked: false };
}

/** Reset for tests */
export function _resetBrandFilterForTests() {
  blacklist = null;
  patterns = null;
}
