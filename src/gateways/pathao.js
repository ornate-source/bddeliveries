import { DeliveryError } from "../errors.js";

/**
 * Pathao Delivery API Adapter
 */

export async function createOrder(config, options) {
  // TODO: Implement actual Pathao API call using config.clientId, config.clientSecret, etc.
  return {
    gateway: "pathao",
    status: "created",
    trackingId: "PATHAO-" + Date.now(),
    raw: options
  };
}

export async function trackOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for trackOrder", "pathao", "MISSING_PARAM");
  }
  // TODO: Implement actual Pathao API call
  return {
    gateway: "pathao",
    status: "in_transit",
    trackingId: options.trackingId
  };
}

export async function cancelOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for cancelOrder", "pathao", "MISSING_PARAM");
  }
  // TODO: Implement actual Pathao API call
  return {
    gateway: "pathao",
    status: "cancelled",
    trackingId: options.trackingId
  };
}
