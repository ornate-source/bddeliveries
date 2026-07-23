import { DeliveryError, ConfigurationError } from "../errors.js";
import {
  request,
  normalizePhone,
  pick,
  httpOptions,
  extractErrorMessage,
  isObject,
} from "../utils.js";
import { requireFields, toNumber, formatAmount } from "../validation.js";
import { STATUS, mapPaperflyStatus } from "../status.js";

const PRODUCTION_URL = "https://api.paperfly.com.bd";

export const META = {
  envMap: {
    username: "PAPERFLY_USERNAME",
    password: "PAPERFLY_PASSWORD",
    paperflyKey: "PAPERFLY_KEY",
    sandbox: "PAPERFLY_SANDBOX",
  },
  // paperflyKey is required rather than defaulted: the previous hardcoded fallback meant
  // a misconfigured merchant silently authenticated as somebody else.
  requiredKeys: ["username", "password", "paperflyKey"],
  capabilities: ["createOrder", "trackOrder", "cancelOrder"],
};

/**
 * Paperfly publishes no sandbox host. Reject `sandbox: true` rather than quietly
 * sending live parcels while the caller believes they are testing.
 */
function getBaseUrl(config) {
  if (config.baseUrl) return String(config.baseUrl).replace(/\/+$/, "");
  if (config.sandbox) {
    throw new ConfigurationError(
      "paperfly",
      "Paperfly has no public sandbox host. Set `baseUrl` to your test endpoint, " +
        "or remove `sandbox` to use production."
    );
  }
  return PRODUCTION_URL;
}

function getBasicAuth(config) {
  const credentials = `${config.username}:${config.password}`;
  const base64 =
    typeof btoa === "function" ? btoa(credentials) : Buffer.from(credentials).toString("base64");
  return "Basic " + base64;
}

/** Every Paperfly call uses the same headers — including cancelOrder, which did not. */
function getHeaders(config) {
  return {
    Authorization: getBasicAuth(config),
    paperflykey: config.paperflyKey,
    "Content-Type": "application/json",
  };
}

/** Paperfly reports logical failures inside a 200 response; check them uniformly. */
function assertPaperflyOk(data, contextMessage) {
  const code = String(data?.response_code ?? data?.success?.response_code ?? "");
  if (code !== "200") {
    const error = new DeliveryError(
      extractErrorMessage(data, contextMessage),
      "paperfly",
      "API_ERROR"
    );
    error.responseBody = isObject(data) ? data : undefined;
    throw error;
  }
  return data;
}

async function paperflyRequest(url, fetchOptions, contextMessage, config) {
  const data = await request(url, fetchOptions, "paperfly", contextMessage, httpOptions(config));
  return assertPaperflyOk(data, contextMessage);
}

export async function createOrder(config, options) {
  const fields = {
    merchantOrderReference: pick(options, "invoice", "merchantOrderReference"),
    customerName: pick(options, "recipientName", "recipient_name", "customerName"),
    customerPhone: pick(options, "recipientPhone", "recipient_phone", "customerPhone"),
    customerAddress: pick(options, "recipientAddress", "recipient_address", "customerAddress"),
  };

  requireFields("paperfly", fields, [
    "merchantOrderReference",
    "customerName",
    "customerPhone",
    "customerAddress",
  ]);

  const packagePrice = pick(options, "codAmount", "cod_amount", "packagePrice");
  const maxWeight = pick(options, "maxWeight", "max_weight", "itemWeight", "item_weight");

  const payload = {
    merchantOrderReference: String(fields.merchantOrderReference),
    storeName: pick(options, "storeName", "store_name") ?? "",
    productBrief:
      pick(options, "itemDescription", "item_description", "productBrief") ?? "Product",
    packagePrice: formatAmount(
      toNumber("paperfly", "packagePrice", packagePrice, { fallback: 0, min: 0 })
    ),
    max_weight: String(
      toNumber("paperfly", "max_weight", maxWeight, { fallback: 0.5, min: 0 })
    ),
    customerName: String(fields.customerName).trim(),
    customerAddress: String(fields.customerAddress).trim(),
    customerPhone: normalizePhone(fields.customerPhone, {
      gateway: "paperfly",
      field: "customerPhone",
    }),
  };

  const data = await paperflyRequest(
    `${getBaseUrl(config)}/merchant/api/service/new_order_v2.php`,
    { method: "POST", headers: getHeaders(config), body: JSON.stringify(payload) },
    "Failed to create order",
    config
  );

  return {
    gateway: "paperfly",
    status: STATUS.PENDING,
    providerStatus: null,
    trackingId: payload.merchantOrderReference,
    providerTrackingNumber: data?.success?.tracking_number,
    raw: data,
  };
}

export async function trackOrder(config, options) {
  const trackingId = pick(options, "trackingId", "invoice", "merchantOrderReference");
  if (!trackingId) {
    throw new DeliveryError(
      "trackingId (ReferenceNumber) is required for trackOrder",
      "paperfly",
      "MISSING_PARAM"
    );
  }

  const data = await paperflyRequest(
    `${getBaseUrl(config)}/API-Order-Tracking`,
    {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify({ ReferenceNumber: String(trackingId) }),
    },
    "Failed to track order",
    config
  );

  const { status, providerStatus } = mapPaperflyStatus(data?.success?.trackingStatus?.[0] ?? {});

  return {
    gateway: "paperfly",
    status,
    providerStatus,
    trackingId: String(trackingId),
    raw: data,
  };
}

/**
 * ⚠️ Unverified against current Paperfly documentation. The endpoint shape differs from
 * its siblings (`/api/v1/...` vs `/merchant/api/service/*.php`), which suggests it was
 * written against a different API version. Confirm before relying on it.
 */
export async function cancelOrder(config, options) {
  const trackingId = pick(options, "trackingId", "orderId", "order_id");
  if (!trackingId) {
    throw new DeliveryError(
      "trackingId (order_id) is required for cancelOrder",
      "paperfly",
      "MISSING_PARAM"
    );
  }

  const data = await paperflyRequest(
    `${getBaseUrl(config)}/api/v1/cancel-order`,
    {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify({ order_id: String(trackingId) }),
    },
    "Failed to cancel order",
    config
  );

  return {
    gateway: "paperfly",
    status: STATUS.CANCELLED,
    providerStatus: null,
    trackingId: String(trackingId),
    raw: data,
  };
}
