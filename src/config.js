import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_FILE = ".poohcode/config.json";

const DEFAULTS = {
  model: {
    temperature: 0.7,
    top_p: 1.0,
    max_tokens: 4096,
  },
  tools: {
    searchCode: { maxResults: 50, maxFileSize: 500 * 1024, maxFiles: 500 },
    executeCommand: { timeout: 30000, maxOutputLength: 5000 },
    webSearch: { maxResults: 5 },
  },
  sandbox: {
    workspace: null, // null = use cwd
    dockerEnabled: false,
  },
  agent: {
    maxIterations: 25,
    confirmDestructive: true, // false = auto-allow all destructive actions without prompting
  },
  llm: {
    model: null, // null = use env DEEPSEEK_MODEL or default
    baseUrl: null,
  },
};

let cachedConfig = null;

/**
 * Load config from .poohcode/config.json, merged with defaults.
 */
export function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = resolve(process.cwd(), CONFIG_FILE);
  let userConfig = {};

  if (existsSync(configPath)) {
    try {
      userConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // corrupted config, ignore
    }
  }

  cachedConfig = deepMerge(DEFAULTS, userConfig);
  return cachedConfig;
}

/**
 * Get a specific config value by dot-separated path.
 */
export function get(key, fallback) {
  const config = loadConfig();
  const parts = key.split(".");
  let val = config;
  for (const part of parts) {
    if (val == null || typeof val !== "object") return fallback;
    val = val[part];
  }
  return val !== undefined ? val : fallback;
}

/**
 * Reload config (clears cache).
 */
export function reloadConfig() {
  cachedConfig = null;
  return loadConfig();
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}
