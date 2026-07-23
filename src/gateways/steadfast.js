import { DeliveryError, ConfigurationError } from "../errors.js";
import {
  request,
  normalizePhone,
  pathSegment,
  pick,
  httpOptions,
  extractErrorMessage,
  isObject,
} from "../utils.js";
import { requireFields, requireOneOf, toNumber, formatAmount } from "../validation.js";
import { STATUS, STEADFAST_STATUS, mapStatus } from "../status.js";

const PRODUCTION_URL = "https://portal.packzy.com/api/v1";

export const META = {
  envMap: {
    apiKey: "STEADFAST_API_KEY",
    secretKey: "STEADFAST_SECRET_KEY",
    sandbox: "STEADFAST_SANDBOX",
  },
  requiredKeys: ["apiKey", "secretKey"],
  capabilities: [
    "createOrder",
    "trackOrder",
    "createBulkOrder",
    "getBalance",
    "createReturnRequest",
    "getReturnRequest",
    "getReturnRequests",
    "getPayments",
    "getPayment",
    "getPoliceStations",
  ],
};

/**
 * Steadfast publishes no sandbox host. Rather than accepting `sandbox: true` and
 * silently sending live parcels, reject it and point at `baseUrl`.
 */
function getBaseUrl(config) {
  if (config.baseUrl) return String(config.baseUrl).replace(/\/+$/, "");
  if (config.sandbox) {
    throw new ConfigurationError(
      "steadfast",
      "Steadfast has no public sandbox host. Set `baseUrl` to your test endpoint, " +
        "or remove `sandbox` to use production."
    );
  }
  return PRODUCTION_URL;
}

function getHeaders(config, isJson = true) {
  const headers = {
    "Api-Key": config.apiKey,
    "Secret-Key": config.secretKey,
  };
  if (isJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function steadfastRequest(url, fetchOptions, contextMessage, config) {
  const data = await request(url, fetchOptions, "steadfast", contextMessage, httpOptions(config));

  // Steadfast returns 200 OK with a non-200 `status` field for logical failures.
  if (isObject(data) && data.status !== undefined && Number(data.status) !== 200) {
    const error = new DeliveryError(
      extractErrorMessage(data, contextMessage),
      "steadfast",
      Number(data.status) === 404 ? "NOT_FOUND" : "API_ERROR"
    );
    error.responseBody = data;
    throw error;
  }
  return data;
}

/** GET helper — these are all idempotent and safe to retry. */
const get = (config, path, contextMessage) =>
  steadfastRequest(
    `${getBaseUrl(config)}${path}`,
    { method: "GET", headers: getHeaders(config, false) },
    contextMessage,
    config
  );

export async function createOrder(config, options) {
  const fields = {
    invoice: pick(options, "invoice", "merchantOrderId", "merchant_order_id"),
    recipient_name: pick(options, "recipientName", "recipient_name"),
    recipient_phone: pick(options, "recipientPhone", "recipient_phone"),
    recipient_address: pick(options, "recipientAddress", "recipient_address"),
    cod_amount: pick(options, "codAmount", "cod_amount"),
  };

  requireFields("steadfast", fields, [
    "invoice",
    "recipient_name",
    "recipient_phone",
    "recipient_address",
  ]);

  const alternativePhone = pick(options, "alternativePhone", "alternative_phone");

  const payload = {
    invoice: String(fields.invoice),
    recipient_name: String(fields.recipient_name).trim(),
    recipient_phone: normalizePhone(fields.recipient_phone, {
      gateway: "steadfast",
      field: "recipient_phone",
    }),
    recipient_address: String(fields.recipient_address).trim(),
    cod_amount: formatAmount(
      toNumber("steadfast", "cod_amount", fields.cod_amount, { fallback: 0, min: 0 })
    ),
  };

  if (alternativePhone !== undefined) {
    payload.alternative_phone = normalizePhone(alternativePhone, {
      gateway: "steadfast",
      field: "alternative_phone",
    });
  }

  const optional = {
    recipient_email: pick(options, "recipientEmail", "recipient_email"),
    note: pick(options, "note"),
    item_description: pick(options, "itemDescription", "item_description"),
    total_lot: pick(options, "totalLot", "total_lot"),
    delivery_type: pick(options, "deliveryType", "delivery_type"),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) payload[key] = value;
  }

  const data = await steadfastRequest(
    `${getBaseUrl(config)}/create_order`,
    { method: "POST", headers: getHeaders(config), body: JSON.stringify(payload) },
    "Failed to create order",
    config
  );

  return {
    gateway: "steadfast",
    status: STATUS.PENDING,
    providerStatus: data?.consignment?.status ?? null,
    trackingId:
      data?.consignment?.consignment_id?.toString() || data?.consignment?.tracking_code,
    trackingCode: data?.consignment?.tracking_code,
    raw: data,
  };
}

export async function createBulkOrder(config, options) {
  if (!Array.isArray(options.data)) {
    throw new DeliveryError(
      "data array is required for createBulkOrder",
      "steadfast",
      "MISSING_PARAM"
    );
  }

  const data = await steadfastRequest(
    `${getBaseUrl(config)}/create_order/bulk-order`,
    { method: "POST", headers: getHeaders(config), body: JSON.stringify({ data: options.data }) },
    "Failed to create bulk order",
    config
  );

  return { gateway: "steadfast", raw: data };
}

export async function trackOrder(config, options) {
  const trackingId = pick(options, "trackingId", "consignment_id");
  const invoice = pick(options, "invoice");
  const trackingCode = pick(options, "trackingCode", "tracking_code");

  requireOneOf("steadfast", { trackingId, invoice, trackingCode }, [
    "trackingId",
    "invoice",
    "trackingCode",
  ]);

  let path;
  let identifier;
  if (trackingId) {
    identifier = trackingId;
    path = `/status_by_cid/${pathSegment("steadfast", "trackingId", trackingId)}`;
  } else if (invoice) {
    identifier = invoice;
    path = `/status_by_invoice/${pathSegment("steadfast", "invoice", invoice)}`;
  } else {
    identifier = trackingCode;
    path = `/status_by_trackingcode/${pathSegment("steadfast", "trackingCode", trackingCode)}`;
  }

  const data = await get(config, path, "Failed to track order");

  if (!data?.delivery_status) {
    throw new DeliveryError(
      extractErrorMessage(data, "Tracking information not found"),
      "steadfast",
      "NOT_FOUND"
    );
  }

  return {
    gateway: "steadfast",
    status: mapStatus(STEADFAST_STATUS, data.delivery_status),
    providerStatus: data.delivery_status,
    trackingId: String(identifier),
    raw: data,
  };
}

export async function getBalance(config) {
  const data = await get(config, "/get_balance", "Failed to get balance");
  return { gateway: "steadfast", balance: data?.current_balance, raw: data };
}

export async function createReturnRequest(config, options) {
  const consignmentId = pick(options, "consignmentId", "consignment_id", "trackingId");
  const invoice = pick(options, "invoice");
  const trackingCode = pick(options, "trackingCode", "tracking_code");

  requireOneOf("steadfast", { consignmentId, invoice, trackingCode }, [
    "consignmentId",
    "invoice",
    "trackingCode",
  ]);

  const payload = {};
  if (consignmentId !== undefined) payload.consignment_id = consignmentId;
  if (invoice !== undefined) payload.invoice = invoice;
  if (trackingCode !== undefined) payload.tracking_code = trackingCode;
  if (options.reason !== undefined) payload.reason = options.reason;

  const data = await steadfastRequest(
    `${getBaseUrl(config)}/create_return_request`,
    { method: "POST", headers: getHeaders(config), body: JSON.stringify(payload) },
    "Failed to create return request",
    config
  );

  return { gateway: "steadfast", raw: data };
}

export async function getReturnRequest(config, options) {
  const id = pathSegment("steadfast", "id", pick(options, "id"));
  const data = await get(config, `/get_return_request/${id}`, "Failed to get return request");
  return { gateway: "steadfast", raw: data };
}

export async function getReturnRequests(config) {
  const data = await get(config, "/get_return_requests", "Failed to get return requests");
  return { gateway: "steadfast", raw: data };
}

export async function getPayments(config) {
  const data = await get(config, "/payments", "Failed to get payments");
  return { gateway: "steadfast", raw: data };
}

export async function getPayment(config, options) {
  const id = pathSegment("steadfast", "payment_id", pick(options, "paymentId", "payment_id"));
  const data = await get(config, `/payments/${id}`, "Failed to get payment");
  return { gateway: "steadfast", raw: data };
}

export async function getPoliceStations(config) {
  const data = await get(config, "/police_stations", "Failed to get police stations");
  return { gateway: "steadfast", raw: data };
}

/**
 * Steadfast's merchant API exposes no cancellation endpoint.
 *
 * This previously returned `{ status: "cancelled" }` without contacting the API at all,
 * so callers marked orders cancelled in their own systems while the parcel still shipped.
 * Returning a return-request instead would be equally wrong: a return is not a
 * cancellation.
 */
export async function cancelOrder() {
  throw new DeliveryError(
    "Steadfast does not expose an order-cancellation endpoint. " +
      "Use createReturnRequest(), or cancel via the Steadfast merchant panel.",
    "steadfast",
    "NOT_SUPPORTED"
  );
}
