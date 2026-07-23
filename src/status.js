/**
 * Canonical delivery statuses. Every adapter maps its provider's vocabulary onto these,
 * and returns the untouched provider value alongside as `providerStatus`, so
 * normalization is never lossy.
 */
export const STATUS = Object.freeze({
  PENDING: "pending",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  PARTIAL_DELIVERED: "partial_delivered",
  RETURNED: "returned",
  CANCELLED: "cancelled",
  ON_HOLD: "on_hold",
  FAILED: "failed",
  UNKNOWN: "unknown",
});

/** Pathao `order_status_slug` values. */
export const PATHAO_STATUS = Object.freeze({
  Pickup_Requested: STATUS.PENDING,
  Assigned_for_Pickup: STATUS.PENDING,
  Picked: STATUS.PICKED_UP,
  Pickup_Failed: STATUS.FAILED,
  Pickup_Cancelled: STATUS.CANCELLED,
  At_the_Sorting_HUB: STATUS.IN_TRANSIT,
  In_Transit: STATUS.IN_TRANSIT,
  Received_at_Last_Mile_HUB: STATUS.IN_TRANSIT,
  Assigned_for_Delivery: STATUS.IN_TRANSIT,
  Delivered: STATUS.DELIVERED,
  Partial_Delivery: STATUS.PARTIAL_DELIVERED,
  Return: STATUS.RETURNED,
  Delivery_Failed: STATUS.FAILED,
  On_Hold: STATUS.ON_HOLD,
  Payment_Invoice: STATUS.DELIVERED,
  Exchange: STATUS.RETURNED,
});

/** Steadfast `delivery_status` values. */
export const STEADFAST_STATUS = Object.freeze({
  pending: STATUS.PENDING,
  in_review: STATUS.PENDING,
  delivered_approval: STATUS.IN_TRANSIT,
  partial_delivered_approval: STATUS.IN_TRANSIT,
  cancelled_approval: STATUS.IN_TRANSIT,
  unknown_approval: STATUS.IN_TRANSIT,
  delivered: STATUS.DELIVERED,
  partial_delivered: STATUS.PARTIAL_DELIVERED,
  cancelled: STATUS.CANCELLED,
  hold: STATUS.ON_HOLD,
  unknown: STATUS.UNKNOWN,
});

/**
 * Paperfly reports a set of booleans rather than a single status field.
 * Ordered most-terminal first: a parcel that was delivered and then returned is returned.
 */
const PAPERFLY_FLAGS = [
  ["Returned", STATUS.RETURNED],
  ["Delivered", STATUS.DELIVERED],
  ["inTransit", STATUS.IN_TRANSIT],
  ["Pick", STATUS.PICKED_UP],
];

/**
 * Map a raw provider status onto the canonical vocabulary.
 * Unrecognized values become UNKNOWN rather than leaking a provider string into a field
 * callers switch on — the raw value is always preserved separately.
 *
 * @param {Record<string, string>} map
 * @param {string} raw
 * @returns {string}
 */
export function mapStatus(map, raw) {
  if (raw === undefined || raw === null) return STATUS.UNKNOWN;
  const key = String(raw).trim();
  if (Object.hasOwn(map, key)) return map[key];

  // Providers are inconsistent about casing between endpoints.
  const lower = key.toLowerCase();
  const hit = Object.keys(map).find((k) => k.toLowerCase() === lower);
  return hit ? map[hit] : STATUS.UNKNOWN;
}

/**
 * Derive a canonical status from Paperfly's boolean tracking flags.
 *
 * @param {object} statusData
 * @returns {{ status: string, providerStatus: string }}
 */
export function mapPaperflyStatus(statusData = {}) {
  for (const [flag, status] of PAPERFLY_FLAGS) {
    if (statusData[flag]) return { status, providerStatus: flag };
  }
  return { status: STATUS.PENDING, providerStatus: "Pending" };
}
