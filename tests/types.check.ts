/**
 * Compile-time checks for the public type definitions. Compiled by `npm run typecheck`,
 * never executed.
 *
 * The `@ts-expect-error` cases are the point: each one fails the build if the error it
 * expects stops happening. An unused `@ts-expect-error` is itself a compile error, so
 * these cannot silently rot.
 */
import {
  createOrder,
  trackOrder,
  cancelOrder,
  callGateway,
  configure,
  unconfigure,
  clearConfig,
  getGatewayCapabilities,
  getSupportedGateways,
  DeliveryClient,
  DeliveryError,
  ValidationError,
  ConfigurationError,
  GatewayNotFoundError,
  STATUS,
  type DeliveryResult,
  type DeliveryStatus,
} from "../src/index.js";

/* ---------------------------------------------------------------- *
 * Results are typed, not `any`
 * ---------------------------------------------------------------- */

async function resultShape() {
  const order: DeliveryResult = await createOrder({
    gateway: "pathao",
    invoice: "INV-1",
    recipientName: "John Doe",
    recipientPhone: "01711111111",
    recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    storeId: 123,
  });

  const status: DeliveryStatus = order.status;
  const tracking: string | undefined = order.trackingId;
  const provider: string | null | undefined = order.providerStatus;

  // @ts-expect-error — status is a union, not an arbitrary string
  const bad: "shipped" = order.status;

  return { status, tracking, provider, bad };
}

/* ---------------------------------------------------------------- *
 * Per-gateway narrowing — the index signature was dropped so that
 * a field meant for another gateway is an error, which is what the
 * docs have always claimed.
 * ---------------------------------------------------------------- */

async function crossGatewayFields() {
  await createOrder({
    gateway: "pathao",
    invoice: "INV-1",
    recipientName: "A",
    recipientPhone: "01711111111",
    recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    // @ts-expect-error — alternativePhone is Steadfast-only
    alternativePhone: "01811111111",
  });

  await createOrder({
    gateway: "steadfast",
    invoice: "INV-1",
    recipientName: "A",
    recipientPhone: "01711111111",
    recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    // @ts-expect-error — cityId is Pathao-only
    cityId: 1,
  });

  await createOrder({
    gateway: "pathao",
    invoice: "INV-1",
    recipientName: "A",
    recipientPhone: "01711111111",
    recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
    // @ts-expect-error — "address" is not a field any adapter reads
    address: "Dhaka",
  });

  // @ts-expect-error — recipientAddress is required
  await createOrder({
    gateway: "paperfly",
    invoice: "INV-1",
    recipientName: "A",
    recipientPhone: "01711111111",
  });

  // @ts-expect-error — unknown gateway
  await createOrder({ gateway: "ecourier", invoice: "INV-1" });
}

/* ---------------------------------------------------------------- *
 * Operations
 * ---------------------------------------------------------------- */

async function operations() {
  await trackOrder({ gateway: "steadfast", invoice: "INV-1" });
  await trackOrder({ gateway: "steadfast", trackingCode: "TRK-1" });
  await cancelOrder({ gateway: "paperfly", trackingId: "INV-1" });

  const balance = await callGateway<{ balance: number }>({
    gateway: "steadfast",
    method: "getBalance",
  });
  const amount: number = balance.balance;

  // @ts-expect-error — not an allow-listed operation
  await callGateway({ gateway: "steadfast", method: "META" });

  const caps = await getGatewayCapabilities("steadfast");
  const supported: boolean = caps.createOrder;
  const names = getSupportedGateways();

  return { amount, supported, names };
}

/* ---------------------------------------------------------------- *
 * Configuration
 * ---------------------------------------------------------------- */

function configuration() {
  configure({
    pathao: { clientId: "a", clientSecret: "b", username: "c", password: "d", storeId: 1 },
    steadfast: { apiKey: "k", secretKey: "s", timeoutMs: 8000 },
    paperfly: { username: "u", password: "p", paperflyKey: "k" },
  });

  // @ts-expect-error — unknown gateway name
  configure({ pathoa: { clientId: "a" } });

  // @ts-expect-error — apiKey belongs to Steadfast, not Pathao
  configure({ pathao: { apiKey: "k" } });

  unconfigure("pathao");
  clearConfig();
}

/* ---------------------------------------------------------------- *
 * Client and errors
 * ---------------------------------------------------------------- */

async function clientAndErrors() {
  const client = new DeliveryClient({ steadfast: { apiKey: "k", secretKey: "s" } });
  client.configure({ paperfly: { username: "u", password: "p", paperflyKey: "k" } });

  try {
    await client.trackOrder({ gateway: "steadfast", trackingId: "1" });
  } catch (error) {
    if (error instanceof ValidationError) {
      const fields: string[] = error.fields;
      return fields;
    }
    if (error instanceof ConfigurationError) {
      const missing: string[] = error.missingKeys;
      return missing;
    }
    if (error instanceof GatewayNotFoundError) {
      return error.supportedGateways;
    }
    if (error instanceof DeliveryError) {
      const code: string = error.code;
      const status: number | undefined = error.statusCode;
      return [code, String(status)];
    }
  }
  return [STATUS.DELIVERED];
}

export { resultShape, crossGatewayFields, operations, configuration, clientAndErrors };
