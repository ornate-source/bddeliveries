import { ConfigurationError } from "./errors.js";
import { getSupportedGateways } from "./gateways/index.js";

/**
 * Transport-level keys that are valid for every gateway, alongside its own credentials.
 * @type {string[]}
 */
const TRANSPORT_KEYS = ["baseUrl", "timeoutMs", "retries", "retryBaseMs", "signal"];

/**
 * Create an isolated credential store. Each DeliveryClient owns one, so a process can
 * serve several merchants without their credentials overwriting one another.
 *
 * @returns {Map<string, object>}
 */
export function createConfigStore() {
  return new Map();
}

/** Module-level store backing the global configure()/clearConfig() API. */
const globalConfig = createConfigStore();

/** @returns {Map<string, object>} The global credential store. */
export function getGlobalStore() {
  return globalConfig;
}

/**
 * Set credentials for one or more gateways.
 * Replaces a gateway's entry wholesale rather than merging into it.
 *
 * @param {object} configs - An object keyed by gateway name.
 * @param {Map<string, object>} [store]
 */
export function configure(configs, store = globalConfig) {
  if (configs === null || typeof configs !== "object" || Array.isArray(configs)) {
    throw new ConfigurationError(
      "configure",
      `configure() expects an object keyed by gateway name, got ${
        Array.isArray(configs) ? "an array" : String(configs)
      }.`
    );
  }

  const supported = getSupportedGateways();
  for (const [gateway, config] of Object.entries(configs)) {
    if (!supported.includes(gateway)) {
      // Catches typos like configure({ pathoa: … }) at the point of the mistake, rather
      // than as a confusing "missing credentials" error on the first call.
      throw new ConfigurationError(
        gateway,
        `Unknown gateway "${gateway}" passed to configure(). Supported gateways: ${supported.join(", ")}.`
      );
    }
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw new ConfigurationError(
        gateway,
        `Credentials for "${gateway}" must be an object, got ${String(config)}.`
      );
    }
    store.set(gateway, { ...config });
  }
}

/**
 * Remove stored configuration for a single gateway.
 *
 * @param {string} gateway
 * @param {Map<string, object>} [store]
 * @returns {boolean} True if an entry was removed.
 */
export function unconfigure(gateway, store = globalConfig) {
  return store.delete(gateway);
}

/**
 * Clear all stored configuration.
 *
 * @param {Map<string, object>} [store]
 */
export function clearConfig(store = globalConfig) {
  store.clear();
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
 * Resolve credentials for a gateway using the three-tier strategy:
 * per-call options > configure() > environment.
 *
 * Only recognized credential and transport keys are lifted out of the call options, so
 * order data (and the customer PII in it) never lands in the credential object, and an
 * order field named like a credential cannot shadow the real one.
 *
 * @param {string} gatewayName
 * @param {object} [callOptions]
 * @param {object} [adapterMeta]
 * @param {Map<string, object>} [store]
 * @returns {object} Resolved config.
 */
export function resolveConfig(gatewayName, callOptions = {}, adapterMeta = {}, store = globalConfig) {
  const envMapping = adapterMeta.envMap || {};
  const requiredKeys = adapterMeta.requiredKeys || [];
  const allowed = [...Object.keys(envMapping), ...TRANSPORT_KEYS];

  const overrides = {};
  for (const key of allowed) {
    if (callOptions[key] !== undefined) overrides[key] = callOptions[key];
  }

  const merged = {
    ...readEnvConfig(envMapping),
    ...(store.get(gatewayName) || {}),
    ...overrides,
  };

  if (merged.sandbox === undefined) {
    merged.sandbox = false;
  }

  const missing = requiredKeys.filter((key) => !merged[key]);
  if (missing.length > 0) {
    throw new ConfigurationError(gatewayName, missing);
  }

  return merged;
}
