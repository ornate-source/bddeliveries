# Documentation

Welcome to the BDDeliveries documentation.

## Setup

```js
import { configure } from "bddeliveries";

configure({
  pathao: {
    clientId: process.env.PATHAO_CLIENT_ID,
    clientSecret: process.env.PATHAO_CLIENT_SECRET,
    username: process.env.PATHAO_USERNAME,
    password: process.env.PATHAO_PASSWORD,
    storeId: process.env.PATHAO_STORE_ID,
  }
});
```

Credentials resolve in three tiers, most specific first:
**per-call options** → **`configure()`** → **environment variables**.

If one process serves several merchants, use `DeliveryClient` instead — the global
store is a singleton, so the last `configure()` call would win for every request.

```js
import { DeliveryClient } from "bddeliveries";

const merchant = new DeliveryClient({ pathao: { /* … */ } });
await merchant.createOrder({ /* … */ });
```

## Creating an Order

```js
import { createOrder } from "bddeliveries";

const order = await createOrder({
  gateway: "pathao",
  invoice: "INV-1001",
  recipientName: "John Doe",
  recipientPhone: "01711111111",
  recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
  codAmount: 1500,
});

order.status;     // "pending" — canonical, same vocabulary on every gateway
order.trackingId; // gateway-issued consignment id
order.raw;        // untouched provider response
```

Missing or malformed fields throw a `ValidationError` **before** any network call, so an
incomplete order never reaches the courier.

## Order fields

Both camelCase and legacy snake_case spellings are accepted; camelCase is canonical.

| Field | pathao | steadfast | paperfly | Notes |
|---|:--:|:--:|:--:|---|
| `invoice` | required | required | required | your own order reference |
| `recipientName` | required | required | required | |
| `recipientPhone` | required | required | required | normalized to `01XXXXXXXXX` |
| `recipientAddress` | required | required | required | Pathao requires ≥ 10 characters |
| `codAmount` | optional | optional | optional | defaults to 0 |
| `storeId` | **required** | — | — | or `PATHAO_STORE_ID` |
| `itemWeight` | optional | — | `maxWeight` | Pathao: 0.5–10 kg |
| `itemQuantity` | optional | — | — | |
| `cityId` / `zoneId` / `areaId` | optional | — | — | |
| `alternativePhone` | — | optional | — | |
| `totalLot` | — | optional | — | |
| `storeName` | — | — | optional | |
| `note` | optional | optional | — | |
| `itemDescription` | optional | optional | optional | |

## Tracking

```js
const status = await trackOrder({ gateway: "steadfast", trackingId: "987654" });
```

Steadfast can also track by `invoice` or `trackingCode`.

`status` is always one of the canonical values below; the provider's own value is
preserved as `providerStatus`, so nothing is lost in normalization.

`pending` · `picked_up` · `in_transit` · `delivered` · `partial_delivered` ·
`returned` · `cancelled` · `on_hold` · `failed` · `unknown`

## Capability matrix

| Operation | pathao | steadfast | paperfly |
|---|:--:|:--:|:--:|
| `createOrder` | ✅ | ✅ | ✅ |
| `trackOrder` | ✅ | ✅ | ✅ |
| `cancelOrder` | ❌ | ❌ | ⚠️ |

Neither Pathao nor Steadfast exposes a cancellation endpoint — both throw
`NOT_SUPPORTED` rather than reporting a cancellation that did not happen. Cancel via the
merchant panel, or use Steadfast's return-request flow. Paperfly's cancel endpoint is
implemented but unverified against current documentation.

Check at runtime with `getGatewayCapabilities(name)`.

## Gateway-specific operations

Operations with no cross-gateway equivalent go through `callGateway`:

```js
const { balance } = await callGateway({ gateway: "steadfast", method: "getBalance" });
```

Steadfast also supports `createBulkOrder`, `createReturnRequest`, `getReturnRequest`,
`getReturnRequests`, `getPayments`, `getPayment` and `getPoliceStations`.
Pathao supports `getStores`.

## Sandbox and test endpoints

Pathao has a sandbox: set `sandbox: true` or `PATHAO_SANDBOX=true`.

Steadfast and Paperfly publish no sandbox host. Passing `sandbox: true` to either
**throws** rather than silently sending live parcels — point `baseUrl` at your test
endpoint instead.

## Timeouts, retries and cancellation

Every request times out after 15 seconds by default. Idempotent requests (GET, and
Pathao's token grant) retry twice with exponential backoff on 5xx, 429 and network
errors. **`createOrder` is never retried automatically** — without an idempotency key
that would ship duplicate parcels.

```js
configure({ pathao: { timeoutMs: 8000, retries: 3 } });

const controller = new AbortController();
await createOrder({ gateway: "pathao", signal: controller.signal, /* … */ });
```

Idempotency is the caller's responsibility. Each gateway has a natural key — Pathao
`merchant_order_id`, Steadfast `invoice`, Paperfly `merchantOrderReference` — all set
from your `invoice` field. Re-sending the same `invoice` is the safe way to retry.

## Errors

Every failure is a `DeliveryError` (or a subclass) carrying `gateway`, `code`, and where
applicable `statusCode` and a **redacted** `responseBody`.

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | caller-supplied data is missing or malformed; nothing was sent |
| `MISSING_CREDENTIALS` | credentials not resolvable from any tier |
| `MISSING_PARAM` | a required identifier was absent |
| `GATEWAY_NOT_FOUND` | unknown gateway name |
| `UNSUPPORTED_OPERATION` | the gateway does not implement that operation |
| `NOT_SUPPORTED` | the provider's API has no such capability |
| `NOT_FOUND` | the courier has no record of the order |
| `TIMEOUT` / `NETWORK_ERROR` / `ABORTED` | transport failures |
| `API_ERROR` | the gateway rejected the request |
| `INVALID_RESPONSE` | the gateway returned something that was not JSON |

## Extending the Package (Adding a New Gateway)

The package uses a decentralized Open/Closed architecture. To add a new gateway, you don't need to touch `config.js` or `index.js`.

1. Create a new file in `src/gateways/` (e.g., `mycourier.js`).
2. Export your gateway's `META` requirements:
   ```javascript
   export const META = {
       envMap: {
           apiKey: "MYCOURIER_API_KEY",
           sandbox: "MYCOURIER_SANDBOX",
       },
       requiredKeys: ["apiKey"],
       capabilities: ["createOrder", "trackOrder"],
   };
   ```
3. Implement `createOrder`, `trackOrder`, and `cancelOrder` using the shared `request`
   utility from `src/utils.js`, the validators from `src/validation.js`, and the
   canonical statuses from `src/status.js`.
4. Register the new file inside `src/gateways/index.js`.

Only implement what the provider actually supports. An operation that cannot be
performed must throw `NOT_SUPPORTED` — never return a success-shaped result.
