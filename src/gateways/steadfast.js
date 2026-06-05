import { DeliveryError } from "../errors.js";

/**
 * Steadfast Delivery API Adapter
 */

export async function createOrder(config, options) {
  return {
    gateway: "steadfast",
    status: "created",
    trackingId: "STEADFAST-" + Date.now(),
    raw: options
  };
}

export async function trackOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for trackOrder", "steadfast", "MISSING_PARAM");
  }
  return {
    gateway: "steadfast",
    status: "in_transit",
    trackingId: options.trackingId
  };
}

export async function cancelOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for cancelOrder", "steadfast", "MISSING_PARAM");
  }
  return {
    gateway: "steadfast",
    status: "cancelled",
    trackingId: options.trackingId
  };
}
