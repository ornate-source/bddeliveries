import { DeliveryError, ValidationError, redact } from "./errors.js";

export { redact };

/** HTTP statuses worth retrying for an idempotent request. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 300;

/** @returns {boolean} True for a non-null, non-array-agnostic object. */
export function isObject(value) {
  return value !== null && typeof value === "object";
}

/**
 * Return the first of `names` present in `options`. Treats `undefined`, `null` and the
 * empty string as absent, but preserves `0` and `false`.
 *
 * Exists so adapters can accept both camelCase and legacy snake_case spellings.
 *
 * @param {object} options
 * @param {...string} names
 * @returns {any}
 */
export function pick(options, ...names) {
  for (const name of names) {
    const value = options?.[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * Standardize a Bangladeshi mobile number to the local `01XXXXXXXXX` form.
 *
 * Handles `+880…`, `880…`, `+88…` and `88…` prefixes, and strips common separators.
 * Throws rather than passing an unusable number to a courier.
 *
 * @param {string|number} phone
 * @param {object} [context]
 * @param {string} [context.gateway]
 * @param {string} [context.field]
 * @returns {string} Normalized 11-digit number.
 */
export function normalizePhone(phone, { gateway, field = "phone" } = {}) {
  let p = String(phone ?? "").replace(/[\s\-().]/g, "");

  // Order matters: the longer country-code forms must be handled before "+88"/"88",
  // otherwise +8801… and +880171… normalize differently.
  if (p.startsWith("+880")) p = "0" + p.slice(4);
  else if (p.startsWith("880")) p = "0" + p.slice(3);
  else if (p.startsWith("+88")) p = p.slice(3);
  else if (p.startsWith("88") && p.length > 11) p = p.slice(2);

  if (!/^01[3-9]\d{8}$/.test(p)) {
    throw new ValidationError(
      `Invalid Bangladeshi mobile number for ${field}: ${JSON.stringify(String(phone ?? ""))}`,
      gateway,
      [field]
    );
  }
  return p;
}

/**
 * Encode a value for safe interpolation into a single URL path segment.
 *
 * Without this, an identifier containing "/" or ".." redirects the request to a
 * different endpoint while still carrying the merchant's credentials.
 *
 * @param {string} gateway
 * @param {string} field
 * @param {any} value
 * @returns {string}
 */
export function pathSegment(gateway, field, value) {
  const s = String(value ?? "").trim();
  if (!s) {
    throw new DeliveryError(`${field} is required`, gateway, "MISSING_PARAM");
  }
  return encodeURIComponent(s);
}

/**
 * Pull a human-readable message out of an arbitrary error payload.
 * Tolerates `null`, primitives, and an `errors` field that is a string rather than
 * the documented object-of-arrays.
 *
 * @param {any} data
 * @param {string} fallback
 * @returns {string}
 */
export function extractErrorMessage(data, fallback) {
  if (!isObject(data)) return fallback;

  if (isObject(data.errors)) {
    const flat = Object.values(data.errors).flat().filter(Boolean);
    if (flat.length) return flat.join(", ");
  }
  if (typeof data.errors === "string" && data.errors) return data.errors;

  return data.message || data.error?.message || data.error_message || fallback;
}

/** Extract transport options from a resolved gateway config. */
export function httpOptions(config = {}) {
  return {
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    retryBaseMs: config.retryBaseMs,
    signal: config.signal,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt, baseMs, retryAfterMs) {
  if (retryAfterMs) return retryAfterMs;
  const exponential = baseMs * 2 ** (attempt - 1);
  return exponential + Math.random() * baseMs; // jitter, to avoid synchronized retries
}

function isRetryable(error) {
  if (error?.code === "NETWORK_ERROR" || error?.code === "TIMEOUT") return true;
  return RETRYABLE_STATUS.has(error?.statusCode);
}

/**
 * Perform a single fetch, parse the body, and normalize any failure into a DeliveryError.
 */
async function attempt(url, fetchOptions, gateway, contextMessage, timeoutMs, userSignal) {
  const controller = new AbortController();
  let timedOut = false;

  const onAbort = () => controller.abort(userSignal?.reason);
  if (userSignal) {
    if (userSignal.aborted) controller.abort(userSignal.reason);
    else userSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new DeliveryError(
        `${gateway} request timed out after ${timeoutMs}ms`,
        gateway,
        "TIMEOUT",
        error
      );
    }
    if (userSignal?.aborted) {
      throw new DeliveryError(`${gateway} request was aborted`, gateway, "ABORTED", error);
    }
    throw new DeliveryError(
      `${gateway} network request failed: ${error.message}`,
      gateway,
      "NETWORK_ERROR",
      error
    );
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener?.("abort", onAbort);
  }

  const text = await response.text();

  // An empty body on a successful response is legitimate (e.g. 204).
  if (!text.trim()) {
    if (response.ok) return {};
    const error = new DeliveryError(
      `${gateway} API error ${response.status} ${response.statusText} (empty response body)`,
      gateway,
      "API_ERROR"
    );
    error.statusCode = response.status;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (parseError) {
    const error = new DeliveryError(
      response.ok
        ? `${gateway} returned a non-JSON response`
        : `${gateway} API error ${response.status} ${response.statusText} — the endpoint may be incorrect or unavailable`,
      gateway,
      response.ok ? "INVALID_RESPONSE" : "API_ERROR",
      parseError
    );
    error.statusCode = response.status;
    // Truncated: an HTML error page should not be pasted wholesale into a log line.
    error.responseBody = text.slice(0, 500);
    throw error;
  }

  if (!response.ok) {
    const error = new DeliveryError(
      extractErrorMessage(data, contextMessage),
      gateway,
      "API_ERROR"
    );
    error.statusCode = response.status;
    error.responseBody = redact(data);

    const retryAfter = Number(response.headers?.get?.("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      error.retryAfterMs = retryAfter * 1000;
    }
    throw error;
  }

  // JSON.parse("null") succeeds and yields null, which would make every adapter's
  // `data.field` read throw a TypeError. Normalize to an empty object.
  return data ?? {};
}

/**
 * Perform an HTTP request with a timeout, JSON parsing and normalized error handling.
 * Adapters perform their own logical (HTTP-200-with-an-error-body) checks on the result.
 *
 * Retries are applied to idempotent requests only. `createOrder` is never retried
 * automatically: without an idempotency key that would ship duplicate parcels.
 *
 * @param {string} url
 * @param {object} [fetchOptions] - Passed through to fetch.
 * @param {string} gateway
 * @param {string} contextMessage - Fallback message when the API gives none.
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {number} [options.retryBaseMs]
 * @param {boolean} [options.idempotent] - Defaults to true for GET/HEAD.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>} Parsed JSON data.
 */
export async function request(url, fetchOptions = {}, gateway, contextMessage, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    idempotent,
    signal,
  } = options;

  const method = String(fetchOptions.method || "GET").toUpperCase();
  const safeToRetry = idempotent ?? (method === "GET" || method === "HEAD");
  const maxAttempts = 1 + (safeToRetry ? (retries ?? DEFAULT_RETRIES) : 0);

  let lastError;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      return await attempt(url, fetchOptions, gateway, contextMessage, timeoutMs, signal);
    } catch (error) {
      lastError = error;
      if (n === maxAttempts || error.code === "ABORTED" || !isRetryable(error)) throw error;
      await sleep(backoffDelay(n, retryBaseMs, error.retryAfterMs));
    }
  }
  throw lastError;
}
