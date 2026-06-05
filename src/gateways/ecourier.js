import { DeliveryError } from "../errors.js";

/**
 * eCourier Delivery API Adapter
 */

export async function createOrder(config, options) {
  return {
    gateway: "ecourier",
    status: "created",
    trackingId: "ECOURIER-" + Date.now(),
    raw: options
  };
}

export async function trackOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for trackOrder", "ecourier", "MISSING_PARAM");
  }
  return {
    gateway: "ecourier",
    status: "in_transit",
    trackingId: options.trackingId
  };
}

export async function cancelOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for cancelOrder", "ecourier", "MISSING_PARAM");
  }
  return {
    gateway: "ecourier",
    status: "cancelled",
    trackingId: options.trackingId
  };
}
