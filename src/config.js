import { ConfigurationError } from "./errors.js";

/**
 * Module-level credential store.
 * @type {Map<string, object>}
 */
const globalConfig = new Map();

/**
 * Maps gateway names to their environment variable names.
 */
const ENV_MAP = {
  pathao: {
    clientId: "PATHAO_CLIENT_ID",
    clientSecret: "PATHAO_CLIENT_SECRET",
    username: "PATHAO_USERNAME",
    password: "PATHAO_PASSWORD",
    sandbox: "PATHAO_SANDBOX",
  },
  steadfast: {
    apiKey: "STEADFAST_API_KEY",
    secretKey: "STEADFAST_SECRET_KEY",
    sandbox: "STEADFAST_SANDBOX",
  },
  ecourier: {
    apiKey: "ECOURIER_API_KEY",
    apiSecret: "ECOURIER_API_SECRET",
    userId: "ECOURIER_USER_ID",
    sandbox: "ECOURIER_SANDBOX",
  },
  paperfly: {
    username: "PAPERFLY_USERNAME",
    password: "PAPERFLY_PASSWORD",
    sandbox: "PAPERFLY_SANDBOX",
  },
  dhl: {
    apiKey: "DHL_API_KEY",
    apiSecret: "DHL_API_SECRET",
    accountNumber: "DHL_ACCOUNT_NUMBER",
    sandbox: "DHL_SANDBOX",
  },
};

/**
 * Required credentials per gateway.
 */
const REQUIRED_KEYS = {
  pathao: ["clientId", "clientSecret", "username", "password"],
  steadfast: ["apiKey", "secretKey"],
  ecourier: ["apiKey", "apiSecret", "userId"],
  paperfly: ["username", "password"],
  dhl: ["apiKey", "apiSecret", "accountNumber"],
};

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
 * Read environment variables for a given gateway.
 */
function readEnvConfig(gatewayName) {
  const envMapping = ENV_MAP[gatewayName];
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
 * Resolve credentials for a gateway using the three-tier strategy.
 */
export function resolveConfig(gatewayName, callOptions = {}) {
  const envConfig = readEnvConfig(gatewayName);
  const globalCfg = globalConfig.get(gatewayName) || {};

  const merged = { ...envConfig, ...globalCfg, ...callOptions };

  if (merged.sandbox === undefined) {
    merged.sandbox = false;
  }

  const required = REQUIRED_KEYS[gatewayName] || [];
  const missing = required.filter((key) => !merged[key]);

  if (missing.length > 0) {
    throw new ConfigurationError(gatewayName, missing);
  }

  return merged;
}
