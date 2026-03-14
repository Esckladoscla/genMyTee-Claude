import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Set test DB path before importing the module
process.env.DB_PATH = ":memory:";
process.env.FINGERPRINT_ENABLED = "true";

import {
  buildFingerprint,
  isKnownBot,
  checkFingerprint,
  cleanupExpiredHits,
  isFingerprintEnabled,
  _resetFingerprintForTests,
} from "../services/browser-fingerprint.js";

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "accept-language": "es-ES,es;q=0.9,en;q=0.8",
  "accept-encoding": "gzip, deflate, br",
  "accept": "application/json",
};

describe("browser-fingerprint", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
    process.env.FINGERPRINT_ENABLED = "true";
    _resetFingerprintForTests();
  });

  afterEach(() => {
    _resetFingerprintForTests();
  });

  describe("buildFingerprint", () => {
    it("returns a 16-char hex string", () => {
      const fp = buildFingerprint(BROWSER_HEADERS);
      assert.match(fp, /^[0-9a-f]{16}$/);
    });

    it("returns same hash for same headers", () => {
      const a = buildFingerprint(BROWSER_HEADERS);
      const b = buildFingerprint(BROWSER_HEADERS);
      assert.equal(a, b);
    });

    it("returns different hash for different User-Agent", () => {
      const a = buildFingerprint(BROWSER_HEADERS);
      const b = buildFingerprint({ ...BROWSER_HEADERS, "user-agent": "Firefox/120.0" });
      assert.notEqual(a, b);
    });

    it("handles missing headers gracefully", () => {
      const fp = buildFingerprint({});
      assert.match(fp, /^[0-9a-f]{16}$/);
    });
  });

  describe("isKnownBot", () => {
    it("detects curl", () => {
      assert.equal(isKnownBot("curl/7.88.1"), true);
    });

    it("detects python-requests", () => {
      assert.equal(isKnownBot("python-requests/2.31.0"), true);
    });

    it("detects headless chrome", () => {
      assert.equal(isKnownBot("Mozilla/5.0 HeadlessChrome/120"), true);
    });

    it("detects Selenium", () => {
      assert.equal(isKnownBot("Selenium/4.0"), true);
    });

    it("detects Playwright", () => {
      assert.equal(isKnownBot("Playwright/1.40"), true);
    });

    it("detects empty UA", () => {
      assert.equal(isKnownBot(""), true);
    });

    it("passes normal Chrome", () => {
      assert.equal(isKnownBot(BROWSER_HEADERS["user-agent"]), false);
    });

    it("passes normal Firefox", () => {
      assert.equal(isKnownBot("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"), false);
    });
  });

  describe("checkFingerprint", () => {
    it("returns not suspicious for normal browser request", () => {
      const result = checkFingerprint("1.2.3.4", BROWSER_HEADERS);
      assert.equal(result.suspicious, false);
      assert.ok(result.fingerprint);
    });

    it("blocks missing User-Agent (caught as known bot — empty UA)", () => {
      const result = checkFingerprint("1.2.3.4", { "accept-language": "es" });
      assert.equal(result.suspicious, true);
      // Empty UA matches the bot pattern ^$, so reason is known_bot_ua
      assert.equal(result.reason, "known_bot_ua");
    });

    it("blocks known bot User-Agent", () => {
      const result = checkFingerprint("1.2.3.4", {
        ...BROWSER_HEADERS,
        "user-agent": "python-requests/2.31.0",
      });
      assert.equal(result.suspicious, true);
      assert.equal(result.reason, "known_bot_ua");
    });

    it("detects botnet pattern (same fingerprint, many IPs)", () => {
      // Default threshold is 5 IPs per fingerprint
      process.env.FP_MAX_IPS_PER_FINGERPRINT = "3";
      _resetFingerprintForTests();

      checkFingerprint("10.0.0.1", BROWSER_HEADERS);
      checkFingerprint("10.0.0.2", BROWSER_HEADERS);
      checkFingerprint("10.0.0.3", BROWSER_HEADERS);

      const result = checkFingerprint("10.0.0.4", BROWSER_HEADERS);
      assert.equal(result.suspicious, true);
      assert.equal(result.reason, "botnet_pattern");
      delete process.env.FP_MAX_IPS_PER_FINGERPRINT;
    });

    it("detects rotation pattern (same IP, many fingerprints)", () => {
      process.env.FP_MAX_FINGERPRINTS_PER_IP = "3";
      _resetFingerprintForTests();

      const ip = "10.0.0.1";
      checkFingerprint(ip, { ...BROWSER_HEADERS, "user-agent": "Chrome/1" });
      checkFingerprint(ip, { ...BROWSER_HEADERS, "user-agent": "Chrome/2" });
      checkFingerprint(ip, { ...BROWSER_HEADERS, "user-agent": "Chrome/3" });

      const result = checkFingerprint(ip, { ...BROWSER_HEADERS, "user-agent": "Chrome/4" });
      assert.equal(result.suspicious, true);
      assert.equal(result.reason, "rotation_pattern");
      delete process.env.FP_MAX_FINGERPRINTS_PER_IP;
    });

    it("allows same IP with same fingerprint (normal user)", () => {
      for (let i = 0; i < 20; i++) {
        const result = checkFingerprint("1.2.3.4", BROWSER_HEADERS);
        assert.equal(result.suspicious, false);
      }
    });

    it("returns not suspicious when disabled", () => {
      process.env.FINGERPRINT_ENABLED = "false";
      _resetFingerprintForTests();

      const result = checkFingerprint("1.2.3.4", {});
      assert.equal(result.suspicious, false);
      process.env.FINGERPRINT_ENABLED = "true";
    });
  });

  describe("cleanupExpiredHits", () => {
    it("removes expired entries", () => {
      // Record a hit
      checkFingerprint("1.2.3.4", BROWSER_HEADERS);

      // Set window to 0 so everything is expired
      process.env.FP_WINDOW_MS = "0";
      const removed = cleanupExpiredHits();
      assert.ok(removed >= 1);
      delete process.env.FP_WINDOW_MS;
    });
  });

  describe("isFingerprintEnabled", () => {
    it("returns true by default", () => {
      assert.equal(isFingerprintEnabled(), true);
    });

    it("returns false when disabled", () => {
      process.env.FINGERPRINT_ENABLED = "false";
      assert.equal(isFingerprintEnabled(), false);
      process.env.FINGERPRINT_ENABLED = "true";
    });
  });
});
