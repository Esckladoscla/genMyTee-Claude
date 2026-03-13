import { getNumberEnv } from "./env.js";

const DEFAULT_ALERT_THRESHOLD = 50;

let currentHourBucket = null;
let currentHourCount = 0;
let alertedThisHour = false;

function getCurrentHourKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function getThreshold() {
  return getNumberEnv("GENERATION_ALERT_THRESHOLD_PER_HOUR", {
    defaultValue: DEFAULT_ALERT_THRESHOLD,
  });
}

export function recordGeneration({ logger = console } = {}) {
  const hourKey = getCurrentHourKey();

  if (hourKey !== currentHourBucket) {
    currentHourBucket = hourKey;
    currentHourCount = 0;
    alertedThisHour = false;
  }

  currentHourCount += 1;

  const threshold = getThreshold();
  if (currentHourCount >= threshold && !alertedThisHour) {
    alertedThisHour = true;
    logger.warn(
      `[generation-tracker] ALERT: ${currentHourCount} generations this hour (threshold: ${threshold}). ` +
        "Consider disabling AI via POST /api/admin/ai if this is unexpected."
    );
  }

  return { count: currentHourCount, threshold, alerted: alertedThisHour };
}

export function getHourlyStats() {
  const hourKey = getCurrentHourKey();
  if (hourKey !== currentHourBucket) {
    return { count: 0, threshold: getThreshold(), alerted: false, hour: hourKey };
  }
  return {
    count: currentHourCount,
    threshold: getThreshold(),
    alerted: alertedThisHour,
    hour: currentHourBucket,
  };
}

export function _resetTrackerForTests() {
  currentHourBucket = null;
  currentHourCount = 0;
  alertedThisHour = false;
}
