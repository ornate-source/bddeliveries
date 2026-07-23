import test, { afterEach } from "node:test";
import assert from "node:assert";
import { request, normalizePhone, pathSegment, extractErrorMessage, redact } from "../src/utils.js";
import { DeliveryError } from "../src/errors.js";
import { mockFetch, mockHangingFetch } from "./helpers/mock-fetch.js";

let mock;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const call = (opts = {}) => request("https://api.test/x", {}, "test", "context message", opts);

/* ---------------------------------------------------------------- *
 * Finding #5 — null and non-object bodies
 * ---------------------------------------------------------------- */

test("wraps a null error body as a DeliveryError, not a TypeError", async () => {
  mock = mockFetch(() => ({ status: 500, statusText: "Server Error", text: "null" }));

  await assert.rejects(call, (error) => {
    assert.ok(error instanceof DeliveryError, `got ${error.constructor.name}`);
    assert.strictEqual(error.code, "API_ERROR");
    assert.strictEqual(error.statusCode, 500);
    return true;
  });
});

test("does not return a bare null for a successful null body", async () => {
  mock = mockFetch(() => ({ status: 200, text: "null" }));
  assert.deepStrictEqual(await call(), {});
});

test("treats an empty successful body as an empty object", async () => {
  mock = mockFetch(() => ({ status: 204, text: "" }));
  assert.deepStrictEqual(await call(), {});
});

test("handles an errors field that is a string rather than an object", async () => {
  mock = mockFetch(() => ({ status: 422, body: { errors: "a string" } }));

  await assert.rejects(call, (error) => {
    assert.strictEqual(error.message, "a string", "must not be split into characters");
    return true;
  });
});

test("flattens the documented object-of-arrays errors shape", async () => {
  mock = mockFetch(() => ({
    status: 422,
    body: { errors: { phone: ["is invalid"], address: ["is too short"] } },
  }));

  await assert.rejects(call, (e) => e.message === "is invalid, is too short");
});

test("reports a non-JSON response without pasting the whole page into the message", async () => {
  mock = mockFetch(() => ({ status: 200, text: "<html>" + "x".repeat(5000) + "</html>" }));

  await assert.rejects(call, (error) => {
    assert.strictEqual(error.code, "INVALID_RESPONSE");
    assert.ok(error.responseBody.length <= 500);
    return true;
  });
});

/* ---------------------------------------------------------------- *
 * Findings #7 and #8 — timeouts, network errors, retries
 * ---------------------------------------------------------------- */

test("aborts a slow request", async () => {
  mock = mockHangingFetch();

  await assert.rejects(() => call({ timeoutMs: 50 }), (error) => {
    assert.strictEqual(error.code, "TIMEOUT");
    assert.match(error.message, /timed out after 50ms/);
    return true;
  });
});

test("wraps a network failure as NETWORK_ERROR", async () => {
  mock = mockFetch(() => {
    throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
  });

  await assert.rejects(call, (error) => {
    assert.ok(error instanceof DeliveryError);
    assert.strictEqual(error.code, "NETWORK_ERROR");
    assert.strictEqual(error.originalError.message, "ECONNRESET");
    return true;
  });
});

test("retries an idempotent request on a 503", async () => {
  let n = 0;
  mock = mockFetch(() => {
    n += 1;
    return n < 3 ? { status: 503, body: { message: "unavailable" } } : { body: { ok: true } };
  });

  assert.deepStrictEqual(await call({ retryBaseMs: 1 }), { ok: true });
  assert.strictEqual(mock.calls.length, 3);
});

test("does not retry a POST — a retried createOrder would ship a duplicate parcel", async () => {
  mock = mockFetch(() => ({ status: 503, body: { message: "unavailable" } }));

  await assert.rejects(
    () => request("https://api.test/x", { method: "POST" }, "test", "ctx", { retryBaseMs: 1 }),
    (e) => e.statusCode === 503
  );
  assert.strictEqual(mock.calls.length, 1);
});

test("does not retry a 4xx", async () => {
  mock = mockFetch(() => ({ status: 400, body: { message: "bad request" } }));

  await assert.rejects(() => call({ retryBaseMs: 1 }));
  assert.strictEqual(mock.calls.length, 1);
});

test("gives up after the configured number of retries", async () => {
  mock = mockFetch(() => ({ status: 500, body: { message: "boom" } }));

  await assert.rejects(() => call({ retries: 1, retryBaseMs: 1 }));
  assert.strictEqual(mock.calls.length, 2, "one attempt plus one retry");
});

test("honours a caller-supplied AbortSignal", async () => {
  mock = mockHangingFetch();
  const controller = new AbortController();
  const promise = call({ signal: controller.signal, timeoutMs: 5000 });
  controller.abort();

  await assert.rejects(promise, (e) => e.code === "ABORTED");
});

/* ---------------------------------------------------------------- *
 * Finding #10 — error metadata
 * ---------------------------------------------------------------- */

test("attaches the HTTP status and a redacted body to the error", async () => {
  mock = mockFetch(() => ({
    status: 401,
    body: { message: "Unauthorized", password: "hunter2", access_token: "secret" },
  }));

  await assert.rejects(call, (error) => {
    assert.strictEqual(error.statusCode, 401);
    assert.strictEqual(error.responseBody.password, "[redacted]");
    assert.strictEqual(error.responseBody.access_token, "[redacted]");
    assert.strictEqual(error.responseBody.message, "Unauthorized");
    return true;
  });
});

/* ---------------------------------------------------------------- *
 * Finding #16 — phone normalization
 * ---------------------------------------------------------------- */

test("normalizes every Bangladeshi country-code form", () => {
  for (const input of [
    "01711111111",
    "+8801711111111",
    "8801711111111",
    "+880 1711-111111",
    "017 1111 1111",
    "(017) 1111-1111",
  ]) {
    assert.strictEqual(normalizePhone(input), "01711111111", `failed for ${input}`);
  }
});

test("rejects a number that is not a Bangladeshi mobile", () => {
  for (const input of ["hello", "", "12345", "01211111111", null, undefined]) {
    assert.throws(() => normalizePhone(input, { gateway: "test" }), {
      code: "VALIDATION_ERROR",
    });
  }
});

/* ---------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------- */

test("pathSegment encodes traversal and reserved characters", () => {
  assert.strictEqual(pathSegment("test", "id", "../admin"), "..%2Fadmin");
  assert.strictEqual(pathSegment("test", "id", "a b#c?d"), "a%20b%23c%3Fd");
  assert.throws(() => pathSegment("test", "id", "  "), { code: "MISSING_PARAM" });
});

test("extractErrorMessage tolerates any shape", () => {
  assert.strictEqual(extractErrorMessage(null, "fallback"), "fallback");
  assert.strictEqual(extractErrorMessage(42, "fallback"), "fallback");
  assert.strictEqual(extractErrorMessage({}, "fallback"), "fallback");
  assert.strictEqual(extractErrorMessage({ message: "m" }, "fallback"), "m");
  assert.strictEqual(extractErrorMessage({ error: { message: "e" } }, "fallback"), "e");
});

test("redact walks nested structures without mutating the input", () => {
  const input = { a: { "Api-Key": "k", nested: [{ password: "p", safe: 1 }] } };
  const out = redact(input);

  assert.strictEqual(out.a["Api-Key"], "[redacted]");
  assert.strictEqual(out.a.nested[0].password, "[redacted]");
  assert.strictEqual(out.a.nested[0].safe, 1);
  assert.strictEqual(input.a["Api-Key"], "k", "input must not be mutated");
});
