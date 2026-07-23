import { ValidationError } from "./errors.js";

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

/**
 * Assert that every named field is present and non-blank.
 * Runs before any network call, so an incomplete order never reaches the courier.
 *
 * @param {string} gateway
 * @param {object} values - Already-normalized field values.
 * @param {string[]} fields
 */
export function requireFields(gateway, values, fields) {
  const missing = fields.filter((f) => isBlank(values[f]));
  if (missing.length) {
    throw new ValidationError(
      `Missing required field(s) for ${gateway}: ${missing.join(", ")}`,
      gateway,
      missing
    );
  }
}

/**
 * Assert that at least one of the named fields is present.
 *
 * @param {string} gateway
 * @param {object} values
 * @param {string[]} fields
 */
export function requireOneOf(gateway, values, fields) {
  if (fields.every((f) => isBlank(values[f]))) {
    throw new ValidationError(
      `One of the following is required for ${gateway}: ${fields.join(", ")}`,
      gateway,
      fields
    );
  }
}

/**
 * Assert a minimum string length after trimming.
 *
 * @param {string} gateway
 * @param {string} field
 * @param {any} value
 * @param {number} min
 * @returns {string} The trimmed value.
 */
export function requireLength(gateway, field, value, min) {
  const s = String(value ?? "").trim();
  if (s.length < min) {
    throw new ValidationError(
      `"${field}" must be at least ${min} characters (got ${s.length})`,
      gateway,
      [field]
    );
  }
  return s;
}

/**
 * Coerce a value to a finite number, with optional bounds.
 * Rejects `NaN` rather than letting `JSON.stringify` silently emit `null`.
 *
 * @param {string} gateway
 * @param {string} field
 * @param {any} value
 * @param {object} [opts]
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {number} [opts.fallback] - Used when the value is absent.
 * @param {boolean} [opts.integer]
 * @returns {number}
 */
export function toNumber(gateway, field, value, opts = {}) {
  const { min, max, fallback, integer = false } = opts;
  const absent = value === undefined || value === null || value === "";

  if (absent && fallback === undefined) {
    throw new ValidationError(`"${field}" is required`, gateway, [field]);
  }

  const n = absent ? fallback : Number(value);

  if (!Number.isFinite(n)) {
    throw new ValidationError(
      `"${field}" must be a number, got ${JSON.stringify(value)}`,
      gateway,
      [field]
    );
  }
  if (integer && !Number.isInteger(n)) {
    throw new ValidationError(`"${field}" must be a whole number, got ${n}`, gateway, [field]);
  }
  if (min !== undefined && n < min) {
    throw new ValidationError(`"${field}" must be >= ${min}, got ${n}`, gateway, [field]);
  }
  if (max !== undefined && n > max) {
    throw new ValidationError(`"${field}" must be <= ${max}, got ${n}`, gateway, [field]);
  }
  return n;
}

/**
 * Format a monetary amount as a fixed 2-decimal string.
 * Avoids `String(0.1 + 0.2)` producing "0.30000000000000004".
 *
 * @param {number} amount
 * @returns {string}
 */
export function formatAmount(amount) {
  return Number(amount).toFixed(2);
}
