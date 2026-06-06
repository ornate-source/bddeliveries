import { ConfigurationError } from "./errors.js";

/**
 * Module-level credential store.
 * @type {Map<string, object>}
 */
const globalConfig = new Map();

/**
 * Set global credentials for one or more gateways.
 * @param {object} configs - An object keyed by gateway name.
 */
export function configure(configs) {
  for (const [gateway, config] of Object.entries(configs)) {
    globalConfig.set(gateway, { ...config });
  }
}

/**
 * Clear all stored global configuration.
 */
export function clearConfig() {
  globalConfig.clear();
}

/**
 * Read environment variables for a given gateway metadata.
 */
function readEnvConfig(envMapping) {
  if (!envMapping) return {};

  const envConfig = {};
  for (const [key, envVar] of Object.entries(envMapping)) {
    const value = process.env[envVar];
    if (value !== undefined && value !== "") {
      if (key === "sandbox") {
        envConfig[key] = value === "true" || value === "1";
      } else {
        envConfig[key] = value;
      }
    }
  }
  return envConfig;
}

/**
 * Resolve credentials for a gateway using the three-tier strategy dynamically.
 */
export function resolveConfig(gatewayName, callOptions = {}, adapterMeta = {}) {
  const envMapping = adapterMeta.envMap || {};
  const requiredKeys = adapterMeta.requiredKeys || [];

  const envConfig = readEnvConfig(envMapping);
  const globalCfg = globalConfig.get(gatewayName) || {};

  const merged = { ...envConfig, ...globalCfg, ...callOptions };

  if (merged.sandbox === undefined) {
    merged.sandbox = false;
  }

  const missing = requiredKeys.filter((key) => !merged[key]);

  if (missing.length > 0) {
    throw new ConfigurationError(gatewayName, missing);
  }

  return merged;
}
