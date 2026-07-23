/**
 * Fetch mock with a call log, so tests can assert *what* was requested and *how many
 * times* — several regressions in this suite are about request counts and URL shapes,
 * which a mock that only returns bodies cannot express.
 */

/**
 * @typedef {object} MockCall
 * @property {string} url
 * @property {string} method
 * @property {object} headers
 * @property {any} body - Parsed JSON when possible, otherwise the raw string.
 */

/**
 * Install a mocked `globalThis.fetch`.
 *
 * The handler receives `(url, options, call)` and returns either a plain object (used as
 * a 200 JSON body) or `{ status, statusText, body, text, headers, ok }`. Throwing from
 * the handler simulates a network-level failure.
 *
 * @param {(url: string, options: object, call: MockCall) => any} handler
 * @returns {{ calls: MockCall[], urls: string[], restore: () => void,
 *             countMatching: (pattern: string|RegExp) => number,
 *             bodyMatching: (pattern: string|RegExp) => any }}
 */
export function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  /** @type {MockCall[]} */
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    let body = options.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as the raw string */
      }
    }

    const call = {
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers: options.headers || {},
      body,
    };
    calls.push(call);

    if (options.signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }

    const result = await handler(String(url), options, call);

    // A response spec must declare `body` or `text`. Detecting on `status` would be
    // ambiguous: Steadfast bodies legitimately contain a `status` field of their own.
    const spec =
      result && typeof result === "object" && ("body" in result || "text" in result)
        ? result
        : { body: result };

    const text =
      spec.text !== undefined
        ? spec.text
        : typeof spec.body === "string"
          ? spec.body
          : JSON.stringify(spec.body ?? {});

    const status = spec.status ?? 200;

    return {
      ok: spec.ok ?? (status >= 200 && status < 300),
      status,
      statusText: spec.statusText || "OK",
      headers: { get: (name) => spec.headers?.[String(name).toLowerCase()] ?? null },
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };

  return {
    calls,
    get urls() {
      return calls.map((c) => c.url);
    },
    countMatching(pattern) {
      const test = pattern instanceof RegExp ? (u) => pattern.test(u) : (u) => u.includes(pattern);
      return calls.filter((c) => test(c.url)).length;
    },
    bodyMatching(pattern) {
      const test = pattern instanceof RegExp ? (u) => pattern.test(u) : (u) => u.includes(pattern);
      return calls.find((c) => test(c.url))?.body;
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

/** A fetch mock that never resolves — for timeout tests. */
export function mockHangingFetch() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
      });
    });
  return { restore: () => { globalThis.fetch = originalFetch; } };
}

/** Valid credentials per gateway, for tests that are not about configuration. */
export const CREDENTIALS = {
  pathao: {
    clientId: "test-client",
    clientSecret: "test-secret",
    username: "test-user",
    password: "test-password",
    storeId: "123",
  },
  steadfast: { apiKey: "test-api", secretKey: "test-secret" },
  paperfly: { username: "u", password: "p", paperflyKey: "k" },
};

/** A complete, valid order — tests override only the field under test. */
export const VALID_ORDER = {
  invoice: "INV-1001",
  recipientName: "John Doe",
  recipientPhone: "01711111111",
  recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
  codAmount: 1500,
};
