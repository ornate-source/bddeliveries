import { DeliveryError } from "../errors.js";

/**
 * Paperfly Delivery API Adapter
 */

export async function createOrder(config, options) {
  return {
    gateway: "paperfly",
    status: "created",
    trackingId: "PAPERFLY-" + Date.now(),
    raw: options
  };
}

export async function trackOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for trackOrder", "paperfly", "MISSING_PARAM");
  }
  return {
    gateway: "paperfly",
    status: "in_transit",
    trackingId: options.trackingId
  };
}

export async function cancelOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for cancelOrder", "paperfly", "MISSING_PARAM");
  }
  return {
    gateway: "paperfly",
    status: "cancelled",
    trackingId: options.trackingId
  };
}
