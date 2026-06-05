import { GatewayNotFoundError } from "../errors.js";

/**
 * Gateway registry — lazily imports adapters.
 */
const gateways = {
  pathao: () => import("./pathao.js"),
  steadfast: () => import("./steadfast.js"),
  ecourier: () => import("./ecourier.js"),
  paperfly: () => import("./paperfly.js"),
  dhl: () => import("./dhl.js"),
};

/**
 * Cache for already-loaded gateway modules.
 * @type {Map<string, object>}
 */
const cache = new Map();

/**
 * Get a gateway adapter by name. Lazily loads and caches the module.
 *
 * @param {string} name - Gateway name.
 * @returns {Promise<object>} The gateway adapter module.
 * @throws {GatewayNotFoundError}
 */
export async function getGateway(name) {
  const normalized = name?.toLowerCase?.().trim();

  if (!normalized || !gateways[normalized]) {
    throw new GatewayNotFoundError(name);
  }

  if (cache.has(normalized)) {
    return cache.get(normalized);
  }

  const mod = await gateways[normalized]();
  cache.set(normalized, mod);
  return mod;
}

/**
 * List all supported gateway names.
 *
 * @returns {string[]}
 */
export function getSupportedGateways() {
  return Object.keys(gateways);
}
