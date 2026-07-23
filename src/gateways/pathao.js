import { DeliveryError } from "../errors.js";
import {
  request,
  normalizePhone,
  pathSegment,
  pick,
  httpOptions,
  extractErrorMessage,
  isObject,
} from "../utils.js";
import { requireFields, requireLength, toNumber } from "../validation.js";
import { STATUS, PATHAO_STATUS, mapStatus } from "../status.js";
import { registerCache } from "../caches.js";

export const META = {
  envMap: {
    clientId: "PATHAO_CLIENT_ID",
    clientSecret: "PATHAO_CLIENT_SECRET",
    username: "PATHAO_USERNAME",
    password: "PATHAO_PASSWORD",
    storeId: "PATHAO_STORE_ID",
    sandbox: "PATHAO_SANDBOX",
  },
  requiredKeys: ["clientId", "clientSecret", "username", "password"],
  capabilities: ["createOrder", "trackOrder", "getStores"],
};

/**
 * Pathao signals a store mismatch only through the error text — there is no distinct
 * error code — so this coupling cannot be avoided, only isolated and tested.
 */
const WRONG_STORE_MARKER = "Wrong Store";

function getBaseUrl(config) {
  if (config.baseUrl) return config.baseUrl;
  if (config.sandbox) return "https://courier-api-sandbox.pathao.com";
  return "https://api-hermes.pathao.com";
}

async function pathaoRequest(url, fetchOptions, contextMessage, config, extra = {}) {
  const data = await request(url, fetchOptions, "pathao", contextMessage, {
    ...httpOptions(config),
    ...extra,
  });

  // Pathao returns 200 OK for logical errors such as validation failures.
  if (isObject(data) && (data.type === "error" || (data.code && data.code !== 200 && data.code !== 202))) {
    const error = new DeliveryError(
      extractErrorMessage(data, contextMessage),
      "pathao",
      "API_ERROR"
    );
    error.responseBody = data;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Access token cache
 * ------------------------------------------------------------------ */

/** @type {Map<string, { token?: string, expiresAt?: number, inflight?: Promise<string> }>} */
const tokenCache = new Map();

/** Keyed by host + credentials so two merchants in one process never share a token. */
const cacheKey = (config) => `${getBaseUrl(config)}|${config.clientId}|${config.username}`;

/** Discard all cached Pathao tokens. Called by clearConfig(); also useful in tests. */
export function clearTokenCache() {
  tokenCache.clear();
}

registerCache(clearTokenCache);

async function issueToken(config) {
  const data = await pathaoRequest(
    `${getBaseUrl(config)}/aladdin/api/v1/issue-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "password",
        username: config.username,
        password: config.password,
      }),
    },
    "Failed to issue access token",
    config,
    { idempotent: true } // safe to retry: issuing a token has no side effect on orders
  );

  if (!data?.access_token) {
    throw new DeliveryError("Failed to obtain Pathao access token", "pathao", "AUTH_ERROR");
  }
  return data;
}

async function getAccessToken(config, { forceRefresh = false } = {}) {
  const key = cacheKey(config);
  const entry = tokenCache.get(key);

  if (forceRefresh) {
    tokenCache.delete(key);
  } else {
    if (entry?.token && Date.now() < entry.expiresAt) return entry.token;
    if (entry?.inflight) return entry.inflight; // de-dupe concurrent grants
  }

  const inflight = issueToken(config)
    .then((data) => {
      const ttlMs = (Number(data.expires_in) || 3600) * 1000;
      // Refresh a minute early so a token cannot expire mid-flight.
      tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 });
      return data.access_token;
    })
    .catch((error) => {
      tokenCache.delete(key);
      throw error;
    });

  tokenCache.set(key, { ...tokenCache.get(key), inflight });
  return inflight;
}

/**
 * Run an authenticated call, refreshing the token once if the cached one was rejected.
 */
async function withAuth(config, fn) {
  const token = await getAccessToken(config);
  try {
    return await fn(token);
  } catch (error) {
    if (error?.statusCode !== 401) throw error;
    return fn(await getAccessToken(config, { forceRefresh: true }));
  }
}

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

/**
 * Fetch the merchant's stores. Used to build an actionable "wrong store" error.
 *
 * @returns {Promise<{ stores: object[], error: Error|null }>}
 */
export async function getStores(config) {
  try {
    const data = await withAuth(config, (token) =>
      pathaoRequest(
        `${getBaseUrl(config)}/aladdin/api/v1/stores`,
        { method: "GET", headers: authHeaders(token) },
        "Failed to fetch stores",
        config
      )
    );
    const stores = data?.data?.data;
    return { stores: Array.isArray(stores) ? stores : [], error: null };
  } catch (error) {
    // Returned rather than logged: a library must not write to the host's stderr.
    return { stores: [], error };
  }
}

export async function createOrder(config, options) {
  const storeId = pick(options, "storeId", "store_id") ?? config.storeId;

  const fields = {
    recipient_name: pick(options, "recipientName", "recipient_name"),
    recipient_phone: pick(options, "recipientPhone", "recipient_phone"),
    recipient_address: pick(options, "recipientAddress", "recipient_address"),
    merchant_order_id: pick(options, "invoice", "merchantOrderId", "merchant_order_id"),
    storeId,
  };

  requireFields("pathao", fields, [
    "recipient_name",
    "recipient_phone",
    "recipient_address",
    "merchant_order_id",
    "storeId",
  ]);

  // Pathao enforces a 10-character minimum. Reject rather than padding: a padded
  // address passes validation and leaves the rider with nothing to deliver to.
  const address = requireLength("pathao", "recipient_address", fields.recipient_address, 10);
  const phone = normalizePhone(fields.recipient_phone, {
    gateway: "pathao",
    field: "recipient_phone",
  });

  const payload = {
    store_id: toNumber("pathao", "storeId", storeId, { integer: true }),
    merchant_order_id: String(fields.merchant_order_id),
    recipient_name: String(fields.recipient_name).trim(),
    recipient_phone: phone,
    recipient_address: address,
    delivery_type: toNumber("pathao", "delivery_type", pick(options, "deliveryType", "delivery_type"), {
      fallback: 48,
      integer: true,
    }),
    item_type: toNumber("pathao", "item_type", pick(options, "itemType", "item_type"), {
      fallback: 2,
      integer: true,
    }),
    special_instruction: pick(options, "note", "specialInstruction", "special_instruction") ?? "",
    item_quantity: toNumber("pathao", "item_quantity", pick(options, "itemQuantity", "item_quantity"), {
      fallback: 1,
      min: 1,
      integer: true,
    }),
    item_weight: toNumber("pathao", "item_weight", pick(options, "itemWeight", "item_weight"), {
      fallback: 0.5,
      min: 0.5,
      max: 10,
    }),
    item_description:
      pick(options, "itemDescription", "item_description") ?? "Order Fulfillment",
    amount_to_collect: Math.round(
      toNumber("pathao", "cod_amount", pick(options, "codAmount", "cod_amount"), {
        fallback: 0,
        min: 0,
      })
    ),
  };

  const cityId = pick(options, "cityId", "city_id");
  const zoneId = pick(options, "zoneId", "zone_id");
  const areaId = pick(options, "areaId", "area_id");
  if (cityId !== undefined) payload.recipient_city = toNumber("pathao", "city_id", cityId, { integer: true });
  if (zoneId !== undefined) payload.recipient_zone = toNumber("pathao", "zone_id", zoneId, { integer: true });
  if (areaId !== undefined) payload.recipient_area = toNumber("pathao", "area_id", areaId, { integer: true });

  let data;
  try {
    data = await withAuth(config, (token) =>
      pathaoRequest(
        `${getBaseUrl(config)}/aladdin/api/v1/orders`,
        { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) },
        "Failed to create order",
        config
      )
    );
  } catch (error) {
    if (error instanceof DeliveryError && error.message.includes(WRONG_STORE_MARKER)) {
      const { stores } = await getStores(config);
      if (stores.length > 0) {
        const list = stores.map((s) => `* ${s.store_name} (ID: ${s.store_id})`).join("\n");
        throw new DeliveryError(
          `Wrong Store selected. Available stores:\n${list}`,
          "pathao",
          "API_ERROR",
          error
        );
      }
    }
    throw error;
  }

  return {
    gateway: "pathao",
    status: STATUS.PENDING,
    providerStatus: "Pickup_Requested",
    trackingId: data?.data?.consignment_id,
    raw: data,
  };
}

export async function trackOrder(config, options) {
  const trackingId = pick(options, "trackingId", "consignment_id");
  if (!trackingId) {
    throw new DeliveryError(
      "trackingId (consignment_id) is required for trackOrder",
      "pathao",
      "MISSING_PARAM"
    );
  }

  const id = pathSegment("pathao", "trackingId", trackingId);
  const data = await withAuth(config, (token) =>
    pathaoRequest(
      `${getBaseUrl(config)}/aladdin/api/v1/orders/${id}/info`,
      { method: "GET", headers: authHeaders(token) },
      "Failed to track order",
      config
    )
  );

  const providerStatus = data?.data?.order_status_slug ?? data?.data?.order_status;

  return {
    gateway: "pathao",
    status: mapStatus(PATHAO_STATUS, providerStatus),
    providerStatus: providerStatus ?? null,
    trackingId: String(trackingId),
    raw: data,
  };
}

export async function cancelOrder() {
  throw new DeliveryError(
    "Pathao does not expose an order-cancellation endpoint. Cancel via the Merchant Panel.",
    "pathao",
    "NOT_SUPPORTED"
  );
}
