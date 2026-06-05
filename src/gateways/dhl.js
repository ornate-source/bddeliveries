import { DeliveryError } from "../errors.js";

/**
 * DHL Delivery API Adapter
 */

export async function createOrder(config, options) {
  return {
    gateway: "dhl",
    status: "created",
    trackingId: "DHL-" + Date.now(),
    raw: options
  };
}

export async function trackOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for trackOrder", "dhl", "MISSING_PARAM");
  }
  return {
    gateway: "dhl",
    status: "in_transit",
    trackingId: options.trackingId
  };
}

export async function cancelOrder(config, options) {
  if (!options.trackingId) {
    throw new DeliveryError("trackingId is required for cancelOrder", "dhl", "MISSING_PARAM");
  }
  return {
    gateway: "dhl",
    status: "cancelled",
    trackingId: options.trackingId
  };
}
