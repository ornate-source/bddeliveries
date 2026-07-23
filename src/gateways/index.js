import { GatewayNotFoundError } from "../errors.js";

/**
 * Gateway registry — lazily imports adapters.
 *
 * Null-prototype: with a plain object literal, inherited members such as `constructor`
 * and `__proto__` pass a truthiness check and resolve to something that is not an adapter.
 */
const gateways = Object.assign(Object.create(null), {
  pathao: () => import("./pathao.js"),
  steadfast: () => import("./steadfast.js"),
  paperfly: () => import("./paperfly.js"),
});

/**
 * Cache of in-flight and settled adapter imports, keyed by gateway name.
 * Storing the promise (rather than the resolved module) de-duplicates concurrent
 * first-calls into a single dynamic import.
 * @type {Map<string, Promise<object>>}
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
  const normalized = typeof name === "string" ? name.toLowerCase().trim() : "";

  if (!normalized || !Object.hasOwn(gateways, normalized)) {
    throw new GatewayNotFoundError(name, getSupportedGateways());
  }

  if (!cache.has(normalized)) {
    cache.set(
      normalized,
      gateways[normalized]().catch((error) => {
        cache.delete(normalized); // don't cache a failed import
        throw error;
      })
    );
  }
  return cache.get(normalized);
}

/**
 * List all supported gateway names.
 *
 * @returns {string[]}
 */
export function getSupportedGateways() {
  return Object.keys(gateways);
}
