/**
 * Keys whose values must never appear in logs, error payloads or serialized output.
 * Matched case-insensitively against both header names and body fields.
 */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "api-key",
  "apikey",
  "secret-key",
  "secretkey",
  "paperflykey",
  "password",
  "client_secret",
  "clientsecret",
  "access_token",
  "refresh_token",
  "token",
]);

/**
 * Recursively replace sensitive values with "[redacted]".
 * Bounded in depth so a cyclic or pathological payload cannot hang the process.
 *
 * @param {any} value
 * @param {number} [depth]
 * @returns {any} A redacted copy. Never mutates the input.
 */
export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? "[redacted]"
      : redact(val, depth + 1);
  }
  return out;
}

/**
 * Base error class for all BDDeliveries errors.
 */
export class DeliveryError extends Error {
  /**
   * @param {string} message - Human-readable error message.
   * @param {string} gateway - The gateway that produced the error (e.g. "pathao").
   * @param {string} code - A machine-readable error code (e.g. "CREATE_ORDER_FAILED").
   * @param {any} [originalError] - The original error from the gateway SDK/API.
   */
  constructor(message, gateway, code, originalError = null) {
    super(message, originalError ? { cause: originalError } : undefined);
    // new.target gives subclasses the correct name without repeating it in each one.
    this.name = new.target.name;
    this.gateway = gateway;
    this.code = code;
    this.originalError = originalError;
    /** @type {number|undefined} HTTP status, when the error came from a response. */
    this.statusCode = undefined;
    /** @type {any} Redacted response body, when available. */
    this.responseBody = undefined;
    Error.captureStackTrace?.(this, new.target);
  }

  /**
   * Serialize without leaking credentials — a stray `JSON.stringify(err)` is a common
   * way for secrets to reach a log aggregator.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      gateway: this.gateway,
      code: this.code,
      statusCode: this.statusCode,
      responseBody: redact(this.responseBody),
    };
  }
}

/**
 * Thrown when an unsupported or unknown gateway name is passed.
 */
export class GatewayNotFoundError extends DeliveryError {
  /**
   * @param {string} gatewayName - The invalid gateway name that was provided.
   * @param {string[]} [supported] - Names that would have worked.
   */
  constructor(gatewayName, supported = []) {
    super(
      `Gateway "${gatewayName}" is not supported.` +
        (supported.length ? ` Supported gateways: ${supported.join(", ")}.` : ""),
      gatewayName,
      "GATEWAY_NOT_FOUND"
    );
    this.supportedGateways = supported;
  }
}

/**
 * Thrown when required credentials are missing for a gateway.
 */
export class ConfigurationError extends DeliveryError {
  /**
   * @param {string} gateway - The gateway missing credentials.
   * @param {string[]|string} missingKeys - Missing credential keys, or a full message.
   */
  constructor(gateway, missingKeys) {
    const isList = Array.isArray(missingKeys);
    super(
      isList
        ? `Missing required credentials for "${gateway}": ${missingKeys.join(", ")}. ` +
            `Provide them via configure(), per-call options, or environment variables.`
        : String(missingKeys),
      gateway,
      "MISSING_CREDENTIALS"
    );
    this.missingKeys = isList ? missingKeys : [];
  }
}

/**
 * Thrown when caller-supplied order data is missing or malformed. Raised before any
 * network call, so nothing reaches the courier.
 */
export class ValidationError extends DeliveryError {
  /**
   * @param {string} message
   * @param {string} gateway
   * @param {string[]} [fields] - The offending field names.
   */
  constructor(message, gateway, fields = []) {
    super(message, gateway, "VALIDATION_ERROR");
    this.fields = fields;
  }
}
