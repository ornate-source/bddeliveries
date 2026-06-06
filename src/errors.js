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
    super(message);
    this.name = "DeliveryError";
    this.gateway = gateway;
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Thrown when an unsupported or unknown gateway name is passed.
 */
export class GatewayNotFoundError extends DeliveryError {
  /**
   * @param {string} gatewayName - The invalid gateway name that was provided.
   */
  constructor(gatewayName) {
    super(
      `Gateway "${gatewayName}" is not supported.`,
      gatewayName,
      "GATEWAY_NOT_FOUND"
    );
    this.name = "GatewayNotFoundError";
  }
}

/**
 * Thrown when required credentials are missing for a gateway.
 */
export class ConfigurationError extends DeliveryError {
  /**
   * @param {string} gateway - The gateway missing credentials.
   * @param {string[]} missingKeys - List of missing credential keys.
   */
  constructor(gateway, missingKeys) {
    super(
      `Missing required credentials for "${gateway}": ${missingKeys.join(", ")}. ` +
        `Provide them via configure(), per-call options, or environment variables.`,
      gateway,
      "MISSING_CREDENTIALS"
    );
    this.name = "ConfigurationError";
    this.missingKeys = missingKeys;
  }
}
