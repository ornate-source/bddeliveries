import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createOrder,
  trackOrder,
  cancelOrder,
  configure,
  unconfigure,
  clearConfig,
  getSupportedGateways,
  getGatewayCapabilities,
  DeliveryClient,
  DeliveryError,
  GatewayNotFoundError,
  ConfigurationError,
} from "../src/index.js";
import { getGateway } from "../src/gateways/index.js";
import { resolveConfig } from "../src/config.js";
import * as pathao from "../src/gateways/pathao.js";
import { mockFetch, CREDENTIALS, VALID_ORDER } from "./helpers/mock-fetch.js";

let mock;

beforeEach(() => clearConfig());
afterEach(() => {
  mock?.restore();
  mock = undefined;
  clearConfig();
});

/* ---------------------------------------------------------------- *
 * Finding #6 — gateway registry
 * ---------------------------------------------------------------- */

test("rejects inherited Object.prototype keys as gateway names", async () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    await assert.rejects(
      () => getGateway(name),
      (error) => {
        assert.ok(error instanceof GatewayNotFoundError, `${name} gave ${error.constructor.name}`);
        assert.strictEqual(error.code, "GATEWAY_NOT_FOUND");
        return true;
      }
    );
  }
});

test("rejects non-string gateway names", async () => {
  for (const name of [123, null, undefined, {}, []]) {
    await assert.rejects(() => getGateway(name), { code: "GATEWAY_NOT_FOUND" });
  }
});

test("a not-found error lists the gateways that would have worked", async () => {
  await assert.rejects(
    () => getGateway("pathoa"),
    (error) => {
      assert.deepStrictEqual(error.supportedGateways, ["pathao", "steadfast", "paperfly"]);
      assert.match(error.message, /pathao, steadfast, paperfly/);
      return true;
    }
  );
});

test("normalizes case and surrounding whitespace", async () => {
  const a = await getGateway("  PATHAO ");
  const b = await getGateway("pathao");
  assert.strictEqual(a, b, "same module, and cached");
});

test("getSupportedGateways lists exactly the implemented adapters", () => {
  assert.deepStrictEqual(getSupportedGateways(), ["pathao", "steadfast", "paperfly"]);
});

/* ---------------------------------------------------------------- *
 * Finding #15 — unsupported operations
 * ---------------------------------------------------------------- */

test("throws DeliveryError, not a bare Error, for an unsupported operation", async () => {
  configure({ pathao: CREDENTIALS.pathao });

  await assert.rejects(
    () => cancelOrder({ gateway: "pathao", trackingId: "C1" }),
    (error) => {
      assert.ok(error instanceof DeliveryError, `got ${error.constructor.name}`);
      assert.strictEqual(error.gateway, "pathao");
      return true;
    }
  );
});

test("getGatewayCapabilities reports what each adapter implements", async () => {
  const steadfast = await getGatewayCapabilities("steadfast");
  assert.strictEqual(steadfast.createOrder, true);
  assert.strictEqual(steadfast.getBalance, true);

  const paperfly = await getGatewayCapabilities("paperfly");
  assert.strictEqual(paperfly.cancelOrder, true);
  assert.strictEqual(paperfly.getBalance, false);
});

// An unsupported operation is still exported — it has to be, so it can throw
// NOT_SUPPORTED. Reporting it as available would make the whole function useless.
test("getGatewayCapabilities reports false for an operation that only throws", async () => {
  for (const gateway of ["pathao", "steadfast"]) {
    const caps = await getGatewayCapabilities(gateway);
    assert.strictEqual(caps.cancelOrder, false, `${gateway} should not advertise cancelOrder`);

    const adapter = await getGateway(gateway);
    assert.strictEqual(
      typeof adapter.cancelOrder,
      "function",
      `${gateway} must still export cancelOrder so it can throw`
    );
  }
});

/* ---------------------------------------------------------------- *
 * Finding #22 — this was the only pre-existing assertion; kept.
 * ---------------------------------------------------------------- */

test("trackOrder reports a missing identifier", async () => {
  await assert.rejects(
    () => trackOrder({ gateway: "steadfast", apiKey: "k", secretKey: "s" }),
    (error) => {
      assert.strictEqual(error.name, "ValidationError");
      assert.ok(error instanceof DeliveryError);
      return true;
    }
  );
});

/* ---------------------------------------------------------------- *
 * Findings #17 and #25 — configuration
 * ---------------------------------------------------------------- */

test("does not copy order fields into the credential object", () => {
  const config = resolveConfig(
    "pathao",
    { ...CREDENTIALS.pathao, recipientName: "Jane", recipientPhone: "0171", codAmount: 5000 },
    pathao.META
  );

  assert.ok(!("recipientName" in config), "PII must not reach the credential object");
  assert.ok(!("codAmount" in config));
  assert.strictEqual(config.clientId, "test-client");
});

test("an order field cannot shadow a configured credential", () => {
  configure({ pathao: { ...CREDENTIALS.pathao, password: "real-password" } });

  // "password" is a Pathao credential key, so a per-call override is legitimate; but an
  // unrelated order field must never displace one.
  const config = resolveConfig("pathao", { recipientName: "password" }, pathao.META);
  assert.strictEqual(config.password, "real-password");
});

test("configure rejects unknown gateway names", () => {
  assert.throws(() => configure({ pathoa: CREDENTIALS.pathao }), (error) => {
    assert.ok(error instanceof ConfigurationError);
    assert.match(error.message, /Unknown gateway "pathoa"/);
    assert.match(error.message, /pathao, steadfast, paperfly/);
    return true;
  });
});

test("configure rejects non-object input instead of throwing a TypeError", () => {
  for (const input of [null, undefined, "pathao", 42, []]) {
    assert.throws(() => configure(input), (error) => {
      assert.ok(error instanceof ConfigurationError, `got ${error.constructor.name}`);
      return true;
    });
  }
});

test("configure rejects non-object credentials", () => {
  assert.throws(() => configure({ pathao: "secret" }), { code: "MISSING_CREDENTIALS" });
});

test("unconfigure removes a single gateway", () => {
  configure({ pathao: CREDENTIALS.pathao, steadfast: CREDENTIALS.steadfast });

  assert.strictEqual(unconfigure("pathao"), true);
  assert.throws(() => resolveConfig("pathao", {}, pathao.META), { code: "MISSING_CREDENTIALS" });
  assert.doesNotThrow(() =>
    resolveConfig("steadfast", {}, { envMap: {}, requiredKeys: [] })
  );
});

test("per-call options take precedence over configure()", () => {
  configure({ pathao: CREDENTIALS.pathao });
  const config = resolveConfig("pathao", { clientId: "override" }, pathao.META);
  assert.strictEqual(config.clientId, "override");
});

test("missing credentials name the specific keys", () => {
  assert.throws(() => resolveConfig("pathao", {}, pathao.META), (error) => {
    assert.deepStrictEqual(error.missingKeys, [
      "clientId",
      "clientSecret",
      "username",
      "password",
    ]);
    return true;
  });
});

/* ---------------------------------------------------------------- *
 * Finding #17 — per-tenant isolation
 * ---------------------------------------------------------------- */

test("two clients keep their credentials isolated", async () => {
  mock = mockFetch((url) =>
    url.includes("issue-token")
      ? { access_token: "t", expires_in: 3600 }
      : { code: 200, data: { consignment_id: "C1" } }
  );

  const merchantA = new DeliveryClient({
    pathao: { ...CREDENTIALS.pathao, clientId: "merchant-a", username: "a" },
  });
  const merchantB = new DeliveryClient({
    pathao: { ...CREDENTIALS.pathao, clientId: "merchant-b", username: "b" },
  });

  await merchantA.createOrder({ gateway: "pathao", ...VALID_ORDER });
  await merchantB.createOrder({ gateway: "pathao", ...VALID_ORDER });

  const grants = mock.calls.filter((c) => c.url.includes("issue-token"));
  assert.strictEqual(grants.length, 2, "each merchant grants its own token");
  assert.strictEqual(grants[0].body.client_id, "merchant-a");
  assert.strictEqual(grants[1].body.client_id, "merchant-b");
});

test("a client is unaffected by the global store", async () => {
  configure({ pathao: { ...CREDENTIALS.pathao, clientId: "global" } });
  const client = new DeliveryClient();

  await assert.rejects(
    () => client.createOrder({ gateway: "pathao", ...VALID_ORDER }),
    { code: "MISSING_CREDENTIALS" }
  );
});

/* ---------------------------------------------------------------- *
 * Finding #10 — error contract
 * ---------------------------------------------------------------- */

test("error subclasses report their own name", () => {
  assert.strictEqual(new DeliveryError("m", "g", "C").name, "DeliveryError");
  assert.strictEqual(new GatewayNotFoundError("x").name, "GatewayNotFoundError");
  assert.strictEqual(new ConfigurationError("g", ["k"]).name, "ConfigurationError");
});

test("preserves the original error as cause", () => {
  const original = new Error("underlying");
  const wrapped = new DeliveryError("wrapped", "pathao", "API_ERROR", original);

  assert.strictEqual(wrapped.cause, original);
  assert.strictEqual(wrapped.originalError, original);
});

test("serializing an error does not leak credentials", () => {
  const error = new DeliveryError("failed", "paperfly", "API_ERROR");
  error.responseBody = { password: "hunter2", paperflykey: "k", detail: "visible" };

  const json = JSON.parse(JSON.stringify(error));
  assert.strictEqual(json.responseBody.password, "[redacted]");
  assert.strictEqual(json.responseBody.paperflykey, "[redacted]");
  assert.strictEqual(json.responseBody.detail, "visible");
});
