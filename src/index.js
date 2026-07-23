export {
  DeliveryError,
  GatewayNotFoundError,
  ConfigurationError,
  ValidationError,
} from "./errors.js";
export { getSupportedGateways } from "./gateways/index.js";
export { STATUS } from "./status.js";

import {
  configure as configureStore,
  unconfigure as unconfigureStore,
  clearConfig as clearConfigStore,
  createConfigStore,
  getGlobalStore,
  resolveConfig,
} from "./config.js";
import { getGateway } from "./gateways/index.js";
import { DeliveryError } from "./errors.js";
import { clearCaches } from "./caches.js";

/**
 * Operations callable through callGateway(). An allow-list, not a blocklist: without it,
 * callGateway would be arbitrary property invocation on the adapter module.
 */
const ALLOWED_METHODS = new Set([
  "createOrder",
  "trackOrder",
  "cancelOrder",
  "createBulkOrder",
  "getBalance",
  "createReturnRequest",
  "getReturnRequest",
  "getReturnRequests",
  "getPayments",
  "getPayment",
  "getPoliceStations",
  "getStores",
]);

/**
 * Resolve the adapter, assert it supports the operation, resolve credentials, and call it.
 */
async function runOperation(store, method, { gateway, ...options }) {
  const adapter = await getGateway(gateway);

  if (typeof adapter[method] !== "function") {
    throw new DeliveryError(
      `Gateway "${gateway}" does not support ${method}()`,
      gateway,
      "UNSUPPORTED_OPERATION"
    );
  }

  const config = resolveConfig(gateway, options, adapter.META, store);
  return adapter[method](config, options);
}

function makeOperation(method) {
  /**
   * @param {object} options - Must include `gateway`.
   * @returns {Promise<object>} Normalized result.
   */
  return function (options) {
    return runOperation(getGlobalStore(), method, options ?? {});
  };
}

/**
 * Create a delivery order through any supported gateway.
 * @type {(options: object) => Promise<object>}
 */
export const createOrder = makeOperation("createOrder");

/**
 * Track an order through any supported gateway.
 * @type {(options: object) => Promise<object>}
 */
export const trackOrder = makeOperation("trackOrder");

/**
 * Cancel an order through any supported gateway.
 * @type {(options: object) => Promise<object>}
 */
export const cancelOrder = makeOperation("cancelOrder");

/**
 * Call a gateway-specific operation that has no cross-gateway equivalent — for example
 * Steadfast's `getBalance` or `createReturnRequest`.
 *
 * @param {object} options
 * @param {string} options.gateway
 * @param {string} options.method - Must be an allow-listed operation name.
 * @returns {Promise<object>}
 */
export async function callGateway({ gateway, method, ...options }) {
  if (!ALLOWED_METHODS.has(method)) {
    throw new DeliveryError(
      `"${method}" is not a callable gateway operation. Supported: ${[...ALLOWED_METHODS].join(", ")}.`,
      gateway,
      "UNSUPPORTED_OPERATION"
    );
  }
  return runOperation(getGlobalStore(), method, { gateway, ...options });
}

/**
 * Report which operations a gateway implements, so callers can branch before calling
 * rather than catching an UNSUPPORTED_OPERATION error.
 *
 * @param {string} gateway
 * @returns {Promise<Record<string, boolean>>}
 */
export async function getGatewayCapabilities(gateway) {
  const adapter = await getGateway(gateway);

  // META.capabilities is the source of truth, not the presence of an export: an
  // unsupported operation is still *exported*, because it has to throw NOT_SUPPORTED
  // rather than be missing. Reporting it as available would defeat the point of asking.
  const declared = adapter.META?.capabilities;

  const capabilities = {};
  for (const method of ALLOWED_METHODS) {
    capabilities[method] = Array.isArray(declared)
      ? declared.includes(method)
      : typeof adapter[method] === "function";
  }
  return capabilities;
}

/**
 * Set global credentials for one or more gateways.
 * @param {Record<string, object>} configs
 */
export function configure(configs) {
  return configureStore(configs, getGlobalStore());
}

/**
 * Remove stored global configuration for a single gateway.
 * @param {string} gateway
 * @returns {boolean}
 */
export function unconfigure(gateway) {
  return unconfigureStore(gateway, getGlobalStore());
}

/**
 * Clear all stored global configuration, and any cached auth tokens derived from it.
 */
export function clearConfig() {
  clearConfigStore(getGlobalStore());
  clearTokenCaches();
}

/**
 * Discard cached gateway auth tokens. Exported mainly for tests; `clearConfig()` calls it.
 */
export function clearTokenCaches() {
  clearCaches();
}

/**
 * An isolated client with its own credential store.
 *
 * Use this instead of the global `configure()` when one process serves several merchants:
 * the module-level store is a singleton, so the last `configure()` call would otherwise
 * win for every concurrent request.
 */
export class DeliveryClient {
  /**
   * @param {Record<string, object>} [configs] - Credentials keyed by gateway name.
   */
  constructor(configs = {}) {
    /** @private */
    this._store = createConfigStore();
    if (Object.keys(configs).length) configureStore(configs, this._store);
  }

  /** @param {Record<string, object>} configs */
  configure(configs) {
    configureStore(configs, this._store);
    return this;
  }

  /** @param {string} gateway */
  unconfigure(gateway) {
    return unconfigureStore(gateway, this._store);
  }

  clearConfig() {
    clearConfigStore(this._store);
    return this;
  }

  /** @param {object} options */
  createOrder(options) {
    return runOperation(this._store, "createOrder", options ?? {});
  }

  /** @param {object} options */
  trackOrder(options) {
    return runOperation(this._store, "trackOrder", options ?? {});
  }

  /** @param {object} options */
  cancelOrder(options) {
    return runOperation(this._store, "cancelOrder", options ?? {});
  }

  /** @param {object} options */
  callGateway({ gateway, method, ...options }) {
    if (!ALLOWED_METHODS.has(method)) {
      throw new DeliveryError(
        `"${method}" is not a callable gateway operation.`,
        gateway,
        "UNSUPPORTED_OPERATION"
      );
    }
    return runOperation(this._store, method, { gateway, ...options });
  }
}
