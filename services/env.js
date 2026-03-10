import path from "node:path";

const warnedAliases = new Set();

function readNonEmptyEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length ? trimmed : undefined;
}

function warnAlias(alias, canonical) {
  const key = `${alias}->${canonical}`;
  if (warnedAliases.has(key)) return;
  warnedAliases.add(key);
  console.warn(`[env] ${alias} is deprecated. Use ${canonical} instead.`);
}

function resolveEnv(name, aliases = []) {
  const canonical = readNonEmptyEnv(name);
  if (canonical !== undefined) return { value: canonical, source: name };

  for (const alias of aliases) {
    const aliasValue = readNonEmptyEnv(alias);
    if (aliasValue !== undefined) {
      warnAlias(alias, name);
      return { value: aliasValue, source: alias };
    }
  }

  return { value: undefined, source: undefined };
}

export function getEnv(name, { aliases = [], defaultValue } = {}) {
  const { value } = resolveEnv(name, aliases);
  return value === undefined ? defaultValue : value;
}

export function requireEnv(name, { aliases = [] } = {}) {
  const value = getEnv(name, { aliases });
  if (value === undefined) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export function getBooleanEnv(name, { aliases = [], defaultValue = false } = {}) {
  const value = getEnv(name, { aliases });
  if (value === undefined) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function getNumberEnv(name, { aliases = [], defaultValue } = {}) {
  const value = getEnv(name, { aliases });
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var: ${name}`);
  }
  return parsed;
}

export function getAllowedOrigins() {
  const raw = getEnv("ALLOWED_ORIGINS", {
    defaultValue: "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
  });
  return String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getDbPath() {
  const raw = getEnv("DB_PATH", { defaultValue: path.resolve(process.cwd(), "data/app.db") });
  if (raw === ":memory:") return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export function _resetEnvStateForTests() {
  warnedAliases.clear();
}
