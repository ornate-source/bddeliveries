export { configure, clearConfig } from "./config.js";
export {
  DeliveryError,
  GatewayNotFoundError,
  ConfigurationError,
} from "./errors.js";
export { getSupportedGateways } from "./gateways/index.js";

import { resolveConfig } from "./config.js";
import { getGateway } from "./gateways/index.js";

/**
 * Create a delivery order through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name (e.g. "pathao", "steadfast").
 * @param {object} [options.extra] - Additional gateway-specific params.
 * @returns {Promise<object>} Normalized creation result.
 */
export async function createOrder({ gateway, ...options }) {
  const adapter = await getGateway(gateway);
  if (typeof adapter.createOrder !== "function") {
    throw new Error(`Gateway "${gateway}" does not support createOrder()`);
  }
  const config = resolveConfig(gateway, options);
  return adapter.createOrder(config, options);
}

/**
 * Track an order through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name.
 * @param {string} options.trackingId - The tracking ID or consignment ID.
 * @returns {Promise<object>} Normalized tracking result.
 */
export async function trackOrder({ gateway, ...options }) {
  const adapter = await getGateway(gateway);
  if (typeof adapter.trackOrder !== "function") {
    throw new Error(`Gateway "${gateway}" does not support trackOrder()`);
  }
  const config = resolveConfig(gateway, options);
  return adapter.trackOrder(config, options);
}

/**
 * Cancel an order through any supported gateway.
 *
 * @param {object} options
 * @param {string} options.gateway - Gateway name.
 * @param {string} options.trackingId - The tracking ID or consignment ID.
 * @returns {Promise<object>} Normalized cancellation result.
 */
export async function cancelOrder({ gateway, ...options }) {
  const adapter = await getGateway(gateway);
  if (typeof adapter.cancelOrder !== "function") {
    throw new Error(`Gateway "${gateway}" does not support cancelOrder()`);
  }
  const config = resolveConfig(gateway, options);
  return adapter.cancelOrder(config, options);
}
