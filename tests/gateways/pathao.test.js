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
  clearConfig(); // also clears the token cache
  configure({ pathao: CREDENTIALS.pathao });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  clearConfig();
});

/** Standard happy-path responses for the token and order endpoints. */
function happyPath(overrides = {}) {
  return (url) => {
    if (url.includes("issue-token")) {
      return { access_token: "mock-token", expires_in: 432000, ...overrides.token };
    }
    if (url.includes("/orders/") && url.includes("/info")) {
      return { code: 200, data: { order_status_slug: "Delivered" }, ...overrides.info };
    }
    if (url.includes("/orders")) {
      return { code: 200, data: { consignment_id: "PATHAO-12345" }, ...overrides.order };
    }
    if (url.includes("/stores")) {
      return { code: 200, data: { data: [{ store_name: "Main", store_id: 77 }] } };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

test("createOrder returns a normalized result", async () => {
  mock = mockFetch(happyPath());

  const result = await createOrder({ gateway: "pathao", ...VALID_ORDER });

  assert.strictEqual(result.gateway, "pathao");
  assert.strictEqual(result.status, STATUS.PENDING);
  assert.strictEqual(result.trackingId, "PATHAO-12345");
});

test("createOrder sends normalized field values", async () => {
  mock = mockFetch(happyPath());

  await createOrder({
    gateway: "pathao",
    ...VALID_ORDER,
    recipientPhone: "+8801711111111",
    codAmount: 1500.4,
  });

  const payload = mock.bodyMatching("/orders");
  assert.strictEqual(payload.recipient_name, "John Doe");
  assert.strictEqual(payload.recipient_phone, "01711111111", "country code should be stripped");
  assert.strictEqual(payload.amount_to_collect, 1500);
  assert.strictEqual(payload.store_id, 123);
  assert.strictEqual(payload.merchant_order_id, "INV-1001");
});

test("createOrder accepts legacy snake_case field names", async () => {
  mock = mockFetch(happyPath());

  const result = await createOrder({
    gateway: "pathao",
    invoice: "INV-1",
    recipient_name: "Jane Roe",
    recipient_phone: "01811111111",
    recipient_address: "House 12, Road 5, Dhanmondi, Dhaka",
    cod_amount: 100,
  });

  assert.strictEqual(result.trackingId, "PATHAO-12345");
  assert.strictEqual(mock.bodyMatching("/orders").recipient_name, "Jane Roe");
});

// Finding #1 — an order with no recipient used to be submitted and reported successful.
test("createOrder rejects an incomplete order before any network call", async () => {
  mock = mockFetch(happyPath());

  await assert.rejects(
    () => createOrder({ gateway: "pathao", recipientName: "John Doe" }),
    (error) => {
      assert.strictEqual(error.code, "VALIDATION_ERROR");
      assert.ok(error.fields.includes("recipient_phone"), "names the missing fields");
      assert.ok(error.fields.includes("recipient_address"));
      return true;
    }
  );
  assert.strictEqual(mock.calls.length, 0, "nothing should reach the network");
});

// Finding #1 — parseFloat("heavy") became NaN, which JSON.stringify emitted as null.
test("createOrder rejects non-numeric weights and amounts", async () => {
  mock = mockFetch(happyPath());

  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER, itemWeight: "heavy" }),
    (e) => e.code === "VALIDATION_ERROR" && /item_weight/.test(e.message)
  );
  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER, codAmount: "abc" }),
    (e) => e.code === "VALIDATION_ERROR" && /cod_amount/.test(e.message)
  );
  assert.strictEqual(mock.calls.length, 0);
});

test("createOrder enforces Pathao's weight bounds", async () => {
  mock = mockFetch(happyPath());
  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER, itemWeight: 25 }),
    (e) => e.code === "VALIDATION_ERROR" && /<= 10/.test(e.message)
  );
});

// Finding #2 — a short address was padded with spaces to defeat Pathao's minimum.
test("createOrder rejects a short address instead of padding it", async () => {
  mock = mockFetch(happyPath());

  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER, recipientAddress: "Dhaka" }),
    (error) => {
      assert.strictEqual(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /at least 10 characters/);
      return true;
    }
  );
  assert.strictEqual(mock.calls.length, 0);
});

// Finding #9 — the token was re-issued on every single call.
test("reuses a cached access token across calls", async () => {
  mock = mockFetch(happyPath());

  await createOrder({ gateway: "pathao", ...VALID_ORDER });
  await createOrder({ gateway: "pathao", ...VALID_ORDER, invoice: "INV-2" });
  await createOrder({ gateway: "pathao", ...VALID_ORDER, invoice: "INV-3" });

  assert.strictEqual(mock.countMatching("issue-token"), 1, "one grant for three orders");
  assert.strictEqual(mock.countMatching(/\/orders$/), 3);
});

test("de-duplicates concurrent token grants", async () => {
  mock = mockFetch(happyPath());

  await Promise.all([
    createOrder({ gateway: "pathao", ...VALID_ORDER, invoice: "A" }),
    createOrder({ gateway: "pathao", ...VALID_ORDER, invoice: "B" }),
    createOrder({ gateway: "pathao", ...VALID_ORDER, invoice: "C" }),
  ]);

  assert.strictEqual(mock.countMatching("issue-token"), 1);
});

test("does not share a cached token between two merchants", async () => {
  mock = mockFetch(happyPath());

  await createOrder({ gateway: "pathao", ...VALID_ORDER });
  await createOrder({
    gateway: "pathao",
    ...VALID_ORDER,
    clientId: "other-merchant",
    username: "other-user",
  });

  assert.strictEqual(mock.countMatching("issue-token"), 2);
});

// Finding #4 — the tracking id was interpolated into the URL unencoded.
test("trackOrder encodes the tracking id into a single path segment", async () => {
  mock = mockFetch(happyPath());

  await trackOrder({ gateway: "pathao", trackingId: "../../stores" });

  const url = mock.urls.find((u) => u.includes("/info"));
  assert.ok(!url.includes("/../"), `path traversal survived encoding: ${url}`);
  assert.match(url, /\/orders\/\.\.%2F\.\.%2Fstores\/info$/);
});

// Finding #20 — status was sometimes normalized and sometimes a raw provider string.
test("trackOrder maps provider statuses onto the canonical vocabulary", async () => {
  mock = mockFetch(happyPath({ info: { data: { order_status_slug: "In_Transit" } } }));

  const result = await trackOrder({ gateway: "pathao", trackingId: "C1" });

  assert.strictEqual(result.status, STATUS.IN_TRANSIT);
  assert.strictEqual(result.providerStatus, "In_Transit", "raw value is preserved");
});

test("trackOrder reports unknown for an unrecognized provider status", async () => {
  mock = mockFetch(happyPath({ info: { data: { order_status_slug: "Brand_New_Status" } } }));

  const result = await trackOrder({ gateway: "pathao", trackingId: "C1" });

  assert.strictEqual(result.status, STATUS.UNKNOWN);
  assert.strictEqual(result.providerStatus, "Brand_New_Status");
});

test("surfaces a logical error returned with HTTP 200", async () => {
  mock = mockFetch((url) => {
    if (url.includes("issue-token")) return { access_token: "t", expires_in: 3600 };
    return { code: 422, type: "error", errors: { recipient_phone: ["Invalid number"] } };
  });

  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER }),
    (e) => e.code === "API_ERROR" && /Invalid number/.test(e.message)
  );
});

// Finding #13 — the store lookup logged to stderr and swallowed the failure.
test("a wrong-store error lists the available stores", async () => {
  mock = mockFetch((url) => {
    if (url.includes("issue-token")) return { access_token: "t", expires_in: 3600 };
    if (url.includes("/stores")) {
      return { code: 200, data: { data: [{ store_name: "Gulshan Hub", store_id: 77 }] } };
    }
    return { code: 400, type: "error", message: "Wrong Store selected" };
  });

  await assert.rejects(
    () => createOrder({ gateway: "pathao", ...VALID_ORDER }),
    (error) => {
      assert.match(error.message, /Gulshan Hub \(ID: 77\)/);
      assert.ok(error.originalError, "the underlying error is preserved as the cause");
      return true;
    }
  );
});

// Finding #3 — Pathao already did this correctly; pinned so it stays that way.
test("cancelOrder reports that the operation is unsupported", async () => {
  mock = mockFetch(happyPath());

  await assert.rejects(
    () => cancelOrder({ gateway: "pathao", trackingId: "C1" }),
    (e) => e.code === "NOT_SUPPORTED"
  );
  assert.strictEqual(mock.calls.length, 0);
});
