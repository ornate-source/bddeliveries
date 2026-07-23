# BDDeliveries

Centralized delivery gateway abstraction for Bangladeshi couriers including Pathao, Steadfast, and Paperfly.

## Features

- **Unified API:** `createOrder`, `trackOrder` and `cancelOrder` across all supported gateways, with one canonical status vocabulary.
- **Validated up front:** incomplete or malformed orders throw before any network call, so nothing half-formed reaches a courier.
- **Honest capabilities:** an operation a provider does not support throws `NOT_SUPPORTED` — never a success-shaped result.
- **Lazy Loading:** adapters are only loaded when their respective gateway is used.
- **Easy Configuration:** credentials from per-call options, `configure()`, or environment variables. Use `DeliveryClient` for multi-merchant processes.
- **Reliable transport:** timeouts, bounded retries for idempotent requests, and `AbortSignal` support.

## Install

```bash
npm install bddeliveries
```

Requires Node 18 or later. ESM only.

## Quick start

```js
import { configure, createOrder } from "bddeliveries";

configure({
  pathao: {
    clientId: process.env.PATHAO_CLIENT_ID,
    clientSecret: process.env.PATHAO_CLIENT_SECRET,
    username: process.env.PATHAO_USERNAME,
    password: process.env.PATHAO_PASSWORD,
    storeId: process.env.PATHAO_STORE_ID,
  },
});

const order = await createOrder({
  gateway: "pathao",
  invoice: "INV-1001",
  recipientName: "John Doe",
  recipientPhone: "01711111111",
  recipientAddress: "House 12, Road 5, Dhanmondi, Dhaka",
  codAmount: 1500,
});

order.status;     // "pending"
order.trackingId; // gateway-issued consignment id
```

## Capability matrix

| Operation | pathao | steadfast | paperfly |
|---|:--:|:--:|:--:|
| `createOrder` | ✅ | ✅ | ✅ |
| `trackOrder` | ✅ | ✅ | ✅ |
| `cancelOrder` | ❌ | ❌ | ⚠️ unverified |

Neither Pathao nor Steadfast exposes a cancellation endpoint. Both throw `NOT_SUPPORTED`
rather than reporting a cancellation that did not happen.

## Documentation

See the [docs/](./docs/) directory for the full field reference, status vocabulary,
error codes, and instructions for adding a gateway.

## Development

```bash
npm test        # 87 tests, no network access required
npm run check   # tests + type definitions
```

See [CHANGELOG.md](./CHANGELOG.md) for release notes and breaking changes, and
[notes/plan.md](./notes/plan.md) for the audit this release is based on.
