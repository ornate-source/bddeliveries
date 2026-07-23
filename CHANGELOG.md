# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07-23

Audit release. All 26 findings from `notes/plan.md` are implemented. Test coverage went
from 2 to 87 tests; every `throw new DeliveryError` site in the adapters is exercised.

### Fixed — data correctness

- **Orders are validated before any network call** (#1). Previously an order with no
  recipient name, an empty phone and a blank address was submitted and returned as
  `status: "created"`. Non-numeric values such as `itemWeight: "heavy"` became `NaN` and
  were serialized as `null` — including in the COD amount field.
- **Pathao addresses are no longer space-padded** (#2). A short address was padded to ten
  characters to defeat Pathao's minimum-length check, leaving the rider with an
  undeliverable address and the merchant unaware the data had been altered. Short
  addresses now throw.
- **`steadfast.cancelOrder()` no longer reports a cancellation that never happened** (#3).
  It returned `{ status: "cancelled" }` after making zero network calls. Steadfast
  exposes no cancellation endpoint, so it now throws `NOT_SUPPORTED`.
- **Path parameters are URL-encoded** (#4). An invoice of `"../get_balance"` resolved to a
  different endpoint, returning the merchant's account balance to a caller who asked for
  order status.
- **`request()` no longer throws a raw `TypeError`** on `null` or non-object error
  bodies, and no longer turns `{ errors: "a string" }` into `"a,  , s, t, r, i, n, g"` (#5).
- **The gateway registry rejects inherited `Object.prototype` keys** (#6).
  `getGateway("constructor")` resolved to `{}` and cached it as an adapter.

### Fixed — reliability

- Request **timeouts** (15s default) with `AbortSignal` passthrough (#7).
- Network failures are wrapped as `NETWORK_ERROR`; idempotent requests **retry** twice
  with backoff on 5xx/429. `createOrder` is never retried automatically (#8).
- Pathao **caches its access token** with TTL, in-flight de-duplication and 401
  invalidation. Three orders previously cost three token grants (#9).
- `originalError` is now populated at every wrap site and surfaces as `cause`; errors
  carry `statusCode` and a redacted `responseBody` (#10).
- `console.error` removed from library code (#13); enforced by a test.

### Fixed — API surface

- Unsupported operations throw `DeliveryError` with `UNSUPPORTED_OPERATION`, not a bare
  `Error` (#15).
- **Phone numbers are normalized on every gateway**, not just Pathao, and invalid numbers
  are rejected rather than forwarded (#16).
- Steadfast and Paperfly status values are mapped onto a canonical vocabulary, with the
  provider's own value preserved as `providerStatus` (#20).
- Paperfly's `cancelOrder` now sends the same headers as its sibling methods (#26).
- The `"Wrong Store"` string coupling is isolated in a named constant and pinned by a
  test (#23).

### Added

- `DeliveryClient` — an isolated credential store, for processes serving several
  merchants. The global `configure()` is a singleton; the last call used to win for every
  concurrent request (#17).
- `callGateway({ gateway, method, ... })` — reaches Steadfast's eight previously
  unreachable operations (`getBalance`, `createReturnRequest`, …) and Pathao's
  `getStores`, through an allow-list (#14).
- `getGatewayCapabilities(gateway)` — branch before calling rather than catching.
- `unconfigure(gateway)` and `clearTokenCaches()`.
- `STATUS` — the canonical status enum, also exported as the `DeliveryStatus` type.
- `ValidationError`, thrown before any network call.
- `paperflyKey` is now a first-class credential, settable via `PAPERFLY_KEY`.
- `storeId` is now a Pathao credential, settable via `PATHAO_STORE_ID`.
- `baseUrl`, `timeoutMs`, `retries` and `signal` accepted per gateway and per call.
- `.github/workflows/ci.yml`, `tsconfig.json`, `CHANGELOG.md`.

### Changed — breaking

These are the changes a working caller could notice. Every affected path was already
broken, which is why this is a minor rather than a major bump.

- **Incomplete orders now throw `ValidationError`** instead of being submitted. If you
  were relying on a "successful" empty order, it was never delivered.
- **`steadfast.cancelOrder()` throws `NOT_SUPPORTED`** instead of returning
  `{ status: "cancelled" }`. Use `callGateway({ method: "createReturnRequest" })` or the
  merchant panel.
- **`paperflyKey` is required.** The previous hardcoded fallback meant a misconfigured
  merchant silently authenticated as somebody else. Set it via config or `PAPERFLY_KEY`.
- **`sandbox: true` throws for Steadfast and Paperfly.** Both previously accepted the
  flag and sent the request to production anyway — the worst possible outcome. Neither
  publishes a sandbox host; use `baseUrl` to point at a test endpoint.
- **`trackOrder` returns canonical `status` values.** Steadfast previously returned its
  raw `delivery_status`, and Pathao fell back to a raw slug when no substring matched.
  The provider's value is now in `providerStatus`.
- **`createOrder` returns `status: "pending"`**, not `"created"` — `"created"` was in no
  provider's vocabulary.
- **`resolveConfig()` reads only recognized credential and transport keys** from per-call
  options. Order fields (and the customer PII in them) no longer land in the credential
  object, and an order field can no longer shadow a credential.
- **Per-gateway option types lost their `[key: string]: any` index signature**, so a
  field meant for another gateway is now a TypeScript error — which is what the docs
  always claimed. Use `extra` for anything unmodelled.
- **`package.json` declares `exports`.** Deep imports such as
  `bddeliveries/src/gateways/steadfast.js` no longer resolve; use `callGateway` instead.
- Invalid input to `configure()` throws `ConfigurationError` rather than a raw
  `TypeError`, and unknown gateway names are rejected at the point of the typo.

### Unverified against live gateways

Implemented from published documentation; confirm against a merchant account before
relying on them:

- **Steadfast has no cancellation endpoint** (#3) — from the published API list, not an
  observed failure. If one exists, implement it rather than throwing.
- **Steadfast and Paperfly sandbox hosts** (#11) — assumed not to exist. Both now throw
  on `sandbox: true` rather than silently using production, which is safe either way.
- **Paperfly's `/api/v1/cancel-order`** (#26) — the endpoint shape does not match its
  siblings and may never have worked.
- **The previously hardcoded `paperflykey`** (#21) — if it was a real merchant key rather
  than a public demo key, it is in git history and should be rotated.

## [1.0.0] — 2026-06-06

Initial release: Pathao, Steadfast and Paperfly adapters behind a unified
`createOrder`/`trackOrder`/`cancelOrder` API.
