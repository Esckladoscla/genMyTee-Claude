import { getEnv } from "./env.js";
import { sendEmail } from "./email.js";

// Cooldown tracking — avoid spamming the same alert type
const lastSent = new Map();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between same alert type

/**
 * Check if an alert type is on cooldown.
 * @param {string} alertType
 * @returns {boolean}
 */
function isOnCooldown(alertType) {
  const last = lastSent.get(alertType);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

/**
 * Send an external alert via email and/or webhook.
 * Fires and forgets — never blocks or throws.
 *
 * @param {string} alertType - e.g. "threshold", "circuit_breaker", "daily_cap"
 * @param {object} data - { count, limit, message }
 * @param {object} [opts]
 * @param {object} [opts.logger=console]
 */
export async function sendAlert(alertType, data, { logger = console } = {}) {
  if (isOnCooldown(alertType)) return;
  lastSent.set(alertType, Date.now());

  const adminEmail = getEnv("ALERT_EMAIL", { defaultValue: "" });
  const webhookUrl = getEnv("ALERT_WEBHOOK_URL", { defaultValue: "" });

  if (!adminEmail && !webhookUrl) return;

  const promises = [];

  if (adminEmail) {
    promises.push(
      sendEmail(adminEmail, "admin_alert", {
        alert_type: formatAlertType(alertType),
        count: data.count,
        limit: data.limit,
        message: data.message,
        timestamp: new Date().toISOString(),
      }, { logger }).catch((err) => {
        logger.warn(`[alerts] email failed: ${err?.message}`);
      })
    );
  }

  if (webhookUrl) {
    promises.push(
      sendWebhook(webhookUrl, alertType, data, { logger }).catch((err) => {
        logger.warn(`[alerts] webhook failed: ${err?.message}`);
      })
    );
  }

  await Promise.allSettled(promises);
}

function formatAlertType(type) {
  const labels = {
    threshold: "Alerta de generaciones",
    circuit_breaker: "Circuit Breaker activado",
    daily_cap: "Limite diario alcanzado",
  };
  return labels[type] || type;
}

async function sendWebhook(url, alertType, data, { logger = console } = {}) {
  const payload = {
    text: `[genMyTee] ${formatAlertType(alertType)}: ${data.count}/${data.limit} — ${data.message}`,
    alert_type: alertType,
    count: data.count,
    limit: data.limit,
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    logger.warn(`[alerts] webhook returned ${response.status}`);
  }
}

export function _resetAlertsForTests() {
  lastSent.clear();
}
