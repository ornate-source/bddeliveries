import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createOrder,
  trackOrder,
  cancelOrder,
  configure,
  clearConfig,
  STATUS,
} from "../../src/index.js";
import { mockFetch, CREDENTIALS, VALID_ORDER } from "../helpers/mock-fetch.js";

let mock;

beforeEach(() => {
  clearConfig();
  configure({ paperfly: CREDENTIALS.paperfly });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  clearConfig();
  delete process.env.PAPERFLY_KEY;
});

const created = { response_code: 200, success: { tracking_number: "PF-556677" } };

test("createOrder returns a normalized result", async () => {
  mock = mockFetch(() => created);

  const result = await createOrder({ gateway: "paperfly", ...VALID_ORDER });

  assert.strictEqual(result.gateway, "paperfly");
  assert.strictEqual(result.status, STATUS.PENDING);
  assert.strictEqual(result.trackingId, "INV-1001");
  assert.strictEqual(result.providerTrackingNumber, "PF-556677");
});

test("createOrder normalizes the phone and formats the package price", async () => {
  mock = mockFetch(() => created);

  await createOrder({
    gateway: "paperfly",
    ...VALID_ORDER,
    recipientPhone: "8801711111111",
    codAmount: 0.1 + 0.2,
  });

  const payload = mock.bodyMatching("new_order_v2");
  assert.strictEqual(payload.customerPhone, "01711111111");
  assert.strictEqual(payload.packagePrice, "0.30");
});

// Finding #1
test("createOrder rejects an incomplete order before any network call", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "paperfly", recipientName: "John Doe" }),
    (e) => e.code === "VALIDATION_ERROR"
  );
  assert.strictEqual(mock.calls.length, 0);
});

// Finding #21 — the key used to fall back to a value hardcoded in the source.
test("requires paperflyKey rather than falling back to a hardcoded value", async () => {
  clearConfig();
  configure({ paperfly: { username: "u", password: "p" } });
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "paperfly", ...VALID_ORDER }),
    (error) => {
      assert.strictEqual(error.code, "MISSING_CREDENTIALS");
      assert.ok(error.missingKeys.includes("paperflyKey"));
      return true;
    }
  );
  assert.strictEqual(mock.calls.length, 0);
});

test("paperflyKey can be supplied by environment variable", async () => {
  clearConfig();
  process.env.PAPERFLY_KEY = "env-key";
  configure({ paperfly: { username: "u", password: "p" } });
  mock = mockFetch(() => created);

  await createOrder({ gateway: "paperfly", ...VALID_ORDER });

  assert.strictEqual(mock.calls[0].headers.paperflykey, "env-key");
});

// Finding #26 — cancelOrder built its headers inline and omitted paperflykey.
test("sends consistent headers on every call", async () => {
  mock = mockFetch((url) =>
    url.includes("cancel-order") ? { response_code: 200 } : created
  );

  await createOrder({ gateway: "paperfly", ...VALID_ORDER });
  await cancelOrder({ gateway: "paperfly", trackingId: "INV-1001" });

  const [create, cancel] = mock.calls;
  assert.strictEqual(cancel.headers.paperflykey, "k");
  assert.deepStrictEqual(
    Object.keys(cancel.headers).sort(),
    Object.keys(create.headers).sort()
  );
  assert.strictEqual(cancel.headers.Authorization, create.headers.Authorization);
});

// Finding #20
test("trackOrder maps the boolean tracking flags", async () => {
  mock = mockFetch(() => ({
    response_code: 200,
    success: { trackingStatus: [{ Pick: true, inTransit: true, Delivered: false }] },
  }));

  const result = await trackOrder({ gateway: "paperfly", trackingId: "INV-1001" });

  assert.strictEqual(result.status, STATUS.IN_TRANSIT);
  assert.strictEqual(result.providerStatus, "inTransit");
});

test("trackOrder treats a returned parcel as terminal", async () => {
  mock = mockFetch(() => ({
    response_code: 200,
    success: { trackingStatus: [{ Pick: true, Delivered: true, Returned: true }] },
  }));

  const result = await trackOrder({ gateway: "paperfly", trackingId: "INV-1001" });

  assert.strictEqual(result.status, STATUS.RETURNED);
});

test("trackOrder defaults to pending when no flag is set", async () => {
  mock = mockFetch(() => ({ response_code: 200, success: { trackingStatus: [{}] } }));

  const result = await trackOrder({ gateway: "paperfly", trackingId: "INV-1001" });

  assert.strictEqual(result.status, STATUS.PENDING);
});

test("surfaces a logical error returned with HTTP 200", async () => {
  mock = mockFetch(() => ({ response_code: 400, error: { message: "Duplicate reference" } }));

  await assert.rejects(
    () => createOrder({ gateway: "paperfly", ...VALID_ORDER }),
    (e) => e.code === "API_ERROR" && /Duplicate reference/.test(e.message)
  );
});

// Finding #11
test("never sends a sandbox request to production", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "paperfly", ...VALID_ORDER, sandbox: true }),
    (e) => e.code === "MISSING_CREDENTIALS" && /no public sandbox host/.test(e.message)
  );
  assert.strictEqual(mock.calls.length, 0);
});

test("cancelOrder returns a normalized result", async () => {
  mock = mockFetch(() => ({ response_code: 200 }));

  const result = await cancelOrder({ gateway: "paperfly", trackingId: "INV-1001" });

  assert.strictEqual(result.status, STATUS.CANCELLED);
  assert.strictEqual(result.trackingId, "INV-1001");
});
