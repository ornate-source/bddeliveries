import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createOrder,
  trackOrder,
  cancelOrder,
  callGateway,
  configure,
  clearConfig,
  STATUS,
} from "../../src/index.js";
import { mockFetch, CREDENTIALS, VALID_ORDER } from "../helpers/mock-fetch.js";

let mock;

beforeEach(() => {
  clearConfig();
  configure({ steadfast: CREDENTIALS.steadfast });
});

afterEach(() => {
  mock?.restore();
  mock = undefined;
  clearConfig();
});

const created = {
  status: 200,
  consignment: { consignment_id: 987654, tracking_code: "TRK-987654", status: "in_review" },
};

test("createOrder returns a normalized result", async () => {
  mock = mockFetch(() => created);

  const result = await createOrder({ gateway: "steadfast", ...VALID_ORDER });

  assert.strictEqual(result.gateway, "steadfast");
  assert.strictEqual(result.status, STATUS.PENDING);
  assert.strictEqual(result.trackingId, "987654");
  assert.strictEqual(result.trackingCode, "TRK-987654");
});

// Finding #16 — phone normalization was applied to Pathao only.
test("createOrder normalizes the recipient phone", async () => {
  mock = mockFetch(() => created);

  await createOrder({ gateway: "steadfast", ...VALID_ORDER, recipientPhone: "+880 1711-111111" });

  assert.strictEqual(mock.bodyMatching("create_order").recipient_phone, "01711111111");
});

// Finding #1
test("createOrder rejects an incomplete order before any network call", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "steadfast", recipientName: "John Doe" }),
    (e) => e.code === "VALIDATION_ERROR"
  );
  assert.strictEqual(mock.calls.length, 0);
});

test("createOrder rejects an unusable phone number", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "steadfast", ...VALID_ORDER, recipientPhone: "hello" }),
    (e) => e.code === "VALIDATION_ERROR" && /Invalid Bangladeshi mobile/.test(e.message)
  );
  assert.strictEqual(mock.calls.length, 0);
});

// Finding #1 — floating-point noise in a money field.
test("createOrder formats the COD amount to two decimals", async () => {
  mock = mockFetch(() => created);

  await createOrder({ gateway: "steadfast", ...VALID_ORDER, codAmount: 0.1 + 0.2 });

  assert.strictEqual(mock.bodyMatching("create_order").cod_amount, "0.30");
});

// Finding #3 — this returned { status: "cancelled" } after zero network calls.
test("cancelOrder does not claim an order was cancelled", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => cancelOrder({ gateway: "steadfast", trackingId: "CID-999" }),
    (error) => {
      assert.strictEqual(error.code, "NOT_SUPPORTED");
      assert.match(error.message, /createReturnRequest|merchant panel/i);
      return true;
    }
  );
  assert.strictEqual(mock.calls.length, 0);
});

// Finding #4 — "../get_balance" resolved to a different endpoint entirely.
test("trackOrder encodes invoice numbers into a single path segment", async () => {
  mock = mockFetch(() => ({ status: 200, delivery_status: "delivered" }));

  await trackOrder({ gateway: "steadfast", invoice: "../get_balance" });

  const url = mock.urls[0];
  assert.ok(url.includes("/status_by_invoice/"), "stays on the intended endpoint");
  assert.ok(!url.includes("/../"), `path traversal survived encoding: ${url}`);
  assert.ok(!url.endsWith("/get_balance"));
});

test("trackOrder encodes spaces and fragments in an invoice number", async () => {
  mock = mockFetch(() => ({ status: 200, delivery_status: "delivered" }));

  await trackOrder({ gateway: "steadfast", invoice: "INV 1#x?y=2" });

  assert.match(mock.urls[0], /\/status_by_invoice\/INV%201%23x%3Fy%3D2$/);
});

test("trackOrder requires at least one identifier", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => trackOrder({ gateway: "steadfast" }),
    (e) => e.code === "VALIDATION_ERROR" && /trackingId, invoice, trackingCode/.test(e.message)
  );
  assert.strictEqual(mock.calls.length, 0);
});

// Finding #20
test("trackOrder maps provider statuses onto the canonical vocabulary", async () => {
  mock = mockFetch(() => ({ status: 200, delivery_status: "partial_delivered" }));

  const result = await trackOrder({ gateway: "steadfast", trackingId: "987654" });

  assert.strictEqual(result.status, STATUS.PARTIAL_DELIVERED);
  assert.strictEqual(result.providerStatus, "partial_delivered");
});

test("trackOrder reports NOT_FOUND when the courier has no record", async () => {
  mock = mockFetch(() => ({ status: 200, message: "No consignment found" }));

  await assert.rejects(
    () => trackOrder({ gateway: "steadfast", trackingId: "nope" }),
    (e) => e.code === "NOT_FOUND" && /No consignment found/.test(e.message)
  );
});

test("surfaces a logical error returned with HTTP 200", async () => {
  mock = mockFetch(() => ({ status: 400, message: "Invalid recipient phone" }));

  await assert.rejects(
    () => createOrder({ gateway: "steadfast", ...VALID_ORDER }),
    (e) => e.code === "API_ERROR" && /Invalid recipient phone/.test(e.message)
  );
});

// Finding #11 — sandbox was accepted and silently ignored, sending live parcels.
test("never sends a sandbox request to production", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => createOrder({ gateway: "steadfast", ...VALID_ORDER, sandbox: true }),
    (error) => {
      assert.strictEqual(error.code, "MISSING_CREDENTIALS");
      assert.match(error.message, /no public sandbox host/);
      return true;
    }
  );
  assert.strictEqual(mock.calls.length, 0, "must not fall through to production");
});

test("honours a baseUrl override", async () => {
  mock = mockFetch(() => created);

  await createOrder({ gateway: "steadfast", ...VALID_ORDER, baseUrl: "https://test.local/api" });

  assert.strictEqual(mock.urls[0], "https://test.local/api/create_order");
});

// Finding #14 — these were implemented but unreachable through the public API.
test("callGateway exposes gateway-specific operations", async () => {
  mock = mockFetch(() => ({ status: 200, current_balance: 4200 }));

  const result = await callGateway({ gateway: "steadfast", method: "getBalance" });

  assert.strictEqual(result.balance, 4200);
  assert.strictEqual(mock.urls[0], "https://portal.packzy.com/api/v1/get_balance");
});

test("callGateway rejects a method outside the allow-list", async () => {
  mock = mockFetch(() => created);

  await assert.rejects(
    () => callGateway({ gateway: "steadfast", method: "META" }),
    (e) => e.code === "UNSUPPORTED_OPERATION"
  );
  await assert.rejects(
    () => callGateway({ gateway: "steadfast", method: "constructor" }),
    (e) => e.code === "UNSUPPORTED_OPERATION"
  );
  assert.strictEqual(mock.calls.length, 0);
});

test("createReturnRequest requires an identifier", async () => {
  mock = mockFetch(() => ({ status: 200 }));

  await assert.rejects(
    () => callGateway({ gateway: "steadfast", method: "createReturnRequest", reason: "damaged" }),
    (e) => e.code === "VALIDATION_ERROR"
  );
});
