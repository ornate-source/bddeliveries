import test from "node:test";
import assert from "node:assert";
import { createOrder, trackOrder, configure } from "../src/index.js";

test("configure and createOrder with pathao", async (t) => {
  configure({
    pathao: {
      clientId: "test-client",
      clientSecret: "test-secret",
      username: "test-user",
      password: "test-password",
    },
  });

  const result = await createOrder({
    gateway: "pathao",
    recipientName: "John Doe",
    address: "Dhaka",
  });

  assert.strictEqual(result.gateway, "pathao");
  assert.strictEqual(result.status, "created");
  assert.ok(result.trackingId.startsWith("PATHAO-"));
  assert.strictEqual(result.raw.recipientName, "John Doe");
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
