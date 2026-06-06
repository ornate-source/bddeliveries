import test from "node:test";
import assert from "node:assert";
import { createOrder, trackOrder, configure } from "../src/index.js";

// Helper to mock global fetch
function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    try {
      const result = handler(url, options);
      const bodyText = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
      return {
        ok: result.ok !== false,
        status: result.status || 200,
        statusText: result.statusText || "OK",
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText),
      };
    } catch (err) {
      throw err;
    }
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("Pathao createOrder - mocked fetch", async (t) => {
  const restore = mockFetch((url, options) => {
    if (url.includes("issue-token")) {
      return {
        body: { access_token: "mock-access-token" }
      };
    }
    if (url.includes("orders")) {
      const payload = JSON.parse(options.body);
      assert.strictEqual(payload.recipient_name, "John Doe");
      return {
        body: {
          code: 200,
          data: { consignment_id: "PATHAO-12345" }
        }
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  try {
    configure({
      pathao: {
        clientId: "test-client",
        clientSecret: "test-secret",
        username: "test-user",
        password: "test-password",
        storeId: "123"
      },
    });

    const result = await createOrder({
      gateway: "pathao",
      recipient_name: "John Doe",
      recipient_phone: "01711111111",
      recipient_address: "Dhaka, Bangladesh",
    });

    assert.strictEqual(result.gateway, "pathao");
    assert.strictEqual(result.status, "created");
    assert.strictEqual(result.trackingId, "PATHAO-12345");
  } finally {
    restore();
  }
});

test("trackOrder throws error if trackingId is missing", async (t) => {
  try {
    await trackOrder({ 
      gateway: "steadfast",
      apiKey: "test-api",
      secretKey: "test-secret"
    });
    assert.fail("Should have thrown DeliveryError");
  } catch (error) {
    assert.strictEqual(error.name, "DeliveryError");
    assert.strictEqual(error.code, "MISSING_PARAM");
  }
});
