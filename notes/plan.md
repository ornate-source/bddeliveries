# BDDeliveries — Code & Docs Audit + Fix Plan

> **STATUS: all 26 findings implemented in v1.1.0** (2026-07-23). See `CHANGELOG.md`.
> `npm run check` → 87 tests passing, typecheck clean, `npm pack` shows no leakage.
>
> Every finding was **reproduced locally** against the pre-fix tree with a mocked `fetch`
> before being written up; the observed output is quoted inside each finding, and each now
> has a named regression test.
>
> Four items are **implemented but unverified against live gateways**, because that needs
> merchant credentials this environment does not have:
> - **#3 (Steadfast cancel)** — that Steadfast exposes no cancellation endpoint comes from
>   the published API list, not from a failed live call. Throwing `NOT_SUPPORTED` is safe
>   either way; if a cancel endpoint *does* exist, implement it rather than throwing.
> - **#11 (Steadfast/Paperfly sandbox)** — whether either gateway has a sandbox host at all
>   is unconfirmed. Both now reject `sandbox: true` and point at `baseUrl`, which fails
>   loudly in either direction rather than silently using production.
> - **#21 (Paperfly key)** — the hardcoded `paperflykey` may be Paperfly's public demo key
>   or a real merchant key that leaked into source. The fallback is gone and the key is now
>   required, but **it is still in git history** — rotate it if it was ever real.
> - **#26 (Paperfly cancel)** — `/api/v1/cancel-order` does not match the `.php` endpoint
>   shape of its siblings and may never have worked. Headers are now consistent; the
>   endpoint itself is unchanged and unconfirmed.
>
> Confirm all four against a merchant account before releasing.

**Reviewed:** v1.0.0 @ `b2c0964` · Node v24.14.0 · 2026-07-23
**Scope:** `src/**` (7 files, ~700 LOC), `tests/**`, `docs/**`, `README.md`, `package.json`

**Verdict:** the architecture — lazy gateway registry, metadata-driven 3-tier config
resolution, shared `request()` helper, normalized error hierarchy — is sound, and the
Open/Closed extension story in `docs/index.md` genuinely holds. The defects are concentrated
one layer below it, in three clusters: **data correctness** (there is no input validation
anywhere, and an order can be silently corrupted or fabricated), **false success** (a
`cancelOrder` that cancels nothing and reports `"cancelled"`), and **operational safety**
(no timeouts, no retries, no token cache, unencoded URL parameters).

The existing 2-test suite passes and catches none of it.

---

## Severity summary

All 26 fixed in v1.1.0. "Fix landed" points at the code as it stands now — where that
differs from the snippet in the detailed finding below, the code is authoritative.

| # | Severity | Area | Issue | Fix landed | Guarded by |
|---|----------|------|-------|------------|------------|
| 1 | 🔴 Critical | all | No input validation — an empty order is submitted and returned as `status: "created"` | `validation.js` + all 3 adapters | `pathao/steadfast/paperfly.test.js` — "rejects an incomplete order before any network call", "rejects non-numeric weights and amounts" |
| 2 | 🔴 Critical | pathao | Address is space-padded to fake Pathao's 10-char minimum | `pathao.js:194` `requireLength()` | `pathao.test.js` — "rejects a short address instead of padding it" |
| 3 | 🔴 Critical | steadfast | `cancelOrder()` reports `"cancelled"` after **zero** network calls | `steadfast.js:283` | `steadfast.test.js` — "does not claim an order was cancelled" |
| 4 | 🔴 Critical | steadfast, pathao | Unencoded path params — an invoice can redirect the request to another endpoint | `utils.js:78` `pathSegment()`, 6 call sites | `steadfast.test.js` — "encodes invoice numbers into a single path segment"; `pathao.test.js` — same for tracking ids |
| 5 | 🔴 Critical | http | `request()` throws a raw `TypeError` on `null` error bodies, escaping `DeliveryError` | `utils.js:205,221` + `extractErrorMessage` at `:95` | `request.test.js` — "wraps a null error body as a DeliveryError", "handles an errors field that is a string" |
| 6 | 🔴 Critical | registry | `getGateway("constructor")` resolves to `{}` and poisons the cache | `gateways/index.js:9,33` | `index.test.js` — "rejects inherited Object.prototype keys", "rejects non-string gateway names" |
| 7 | 🟠 High | http | No request timeout — a hung courier API hangs the caller forever | `utils.js:133` `attempt()` | `request.test.js` — "aborts a slow request", "honours a caller-supplied AbortSignal" |
| 8 | 🟠 High | http | Network errors unwrapped; no retry on transient failures | `utils.js:245` `request()` | `request.test.js` — "wraps a network failure as NETWORK_ERROR", "does not retry a POST" |
| 9 | 🟠 High | pathao | Re-authenticates on every call — 3 orders → 3 token requests | `pathao.js:101` `getAccessToken()` | `pathao.test.js` — "reuses a cached access token", "de-duplicates concurrent token grants", "does not share a cached token between two merchants" |
| 10 | 🟠 High | errors | `originalError` accepted at 20+ throw sites, populated at none | `errors.js:44` | `index.test.js` — "preserves the original error as cause", "error subclasses report their own name" |
| 11 | 🟠 High | steadfast, paperfly | `sandbox` is configurable and silently ignored → live parcels while "testing" | `steadfast.js:41`, `paperfly.js:32` | `steadfast/paperfly.test.js` — "never sends a sandbox request to production" |
| 12 | 🟠 High | docs | `docs/index.md` example uses field names no adapter reads | `docs/index.md` rewritten | `hygiene.test.js` — "docs use field names the adapters actually read" |
| 13 | 🟠 High | pathao | Library writes to `console.error` and swallows the failure | `pathao.js:155` `getStores()` | `hygiene.test.js` — "no console.* calls in src/" |
| 14 | 🟡 Medium | api | 8 Steadfast functions unreachable through the public API | `index.js:96` `callGateway()` | `steadfast.test.js` — "callGateway exposes gateway-specific operations", "rejects a method outside the allow-list" |
| 15 | 🟡 Medium | index | `does not support X()` throws a bare `Error`, not a `DeliveryError` | `index.js:44` `runOperation()` | `index.test.js` — "throws DeliveryError, not a bare Error, for an unsupported operation" |
| 16 | 🟡 Medium | utils | Phone normalization applied to 1 of 3 gateways, and incomplete | `utils.js:47` + all 3 adapters | `request.test.js` — "normalizes every Bangladeshi country-code form", "rejects a number that is not a Bangladeshi mobile" |
| 17 | 🟡 Medium | config | Global mutable singleton — no multi-tenant isolation, `configure(null)` throws `TypeError` | `config.js:35`, `index.js:162` `DeliveryClient` | `index.test.js` — "two clients keep their credentials isolated", "configure rejects non-object input" |
| 18 | 🟡 Medium | pkg | No `files` / `exports` — `docs/`, `tests/` publish; every internal path is public API | `package.json` `files`/`exports` | CI `npm pack --dry-run` leak check |
| 19 | 🟡 Medium | types | Everything returns `Promise<any>`; index signature defeats excess-property checks | `index.d.ts` rewritten | `types.check.ts` — 11 `@ts-expect-error` cases via `tsc --noEmit` |
| 20 | 🟡 Medium | all | Status normalization differs per gateway; Pathao leaks raw provider strings | `status.js` + all 3 adapters | all three adapter suites — "maps provider statuses onto the canonical vocabulary", "reports unknown for an unrecognized provider status" |
| 21 | 🟡 Medium | security | Paperfly ships a hardcoded API key; no redaction of credentials in errors | `paperfly.js:15` META, `errors.js:28` `redact()` | `paperfly.test.js` — "requires paperflyKey rather than falling back"; `index.test.js` — "serializing an error does not leak credentials" |
| 22 | 🟢 Low | tests | ~2% coverage; state leaks between tests; dead try/catch in the mock | `tests/` rebuilt, `helpers/mock-fetch.js` | 2 → 87 tests |
| 23 | 🟢 Low | pathao | Retry logic keyed on the English substring `"Wrong Store"` | `pathao.js:32` `WRONG_STORE_MARKER` | `pathao.test.js` — "a wrong-store error lists the available stores" |
| 24 | 🟢 Low | api | `recipient_name` (snake) beside `trackingId`/`storeId` (camel); no convention | `utils.js:27` `pick()` + all adapters | `pathao.test.js` — "accepts legacy snake_case field names" |
| 25 | 🟢 Low | config | `resolveConfig()` folds the whole order payload — PII + secrets in one object | `config.js:119` | `index.test.js` — "does not copy order fields into the credential object" |
| 26 | 🟢 Low | paperfly | `cancelOrder` omits `paperflykey` and uses an endpoint shape unlike its siblings | `paperfly.js:52` `getHeaders()` | `paperfly.test.js` — "sends consistent headers on every call" |

**Not covered by an automated test:** #18 has a CI check but no unit test. #26's header
consistency is tested; the endpoint URL itself is unverified and cannot be tested without
live access.

---

## Detailed findings

### 1. 🔴 No input validation — empty orders are submitted and reported as successful — ✅ FIXED

> **Fixed in v1.1.0.** `src/validation.js` — `requireFields()` / `toNumber()` / `requireLength()`, wired into all three adapters per the table below.

`src/gateways/pathao.js:82-99`, `steadfast.js:29-41`, `paperfly.js:39-48`

The example straight out of `docs/index.md` produces a completely empty order, and the
library returns success. Reproduced:

```js
await createOrder({ gateway: "pathao", recipientName: "John Doe", address: "Dhaka" });
```
```
payload sent →  recipient_name:    undefined   (key dropped by JSON.stringify entirely)
                recipient_address: "          " (ten spaces — see #2)
                recipient_phone:   ""
                merchant_order_id: ""
returned     →  { status: "created", trackingId: "C1" }
```

The docs use `recipientName`/`address`; every adapter reads `recipient_name`/
`recipient_address` (see #12). Nothing anywhere catches the mismatch.

Non-numeric numerics are equally unguarded — also reproduced:

```js
createOrder({ gateway: "pathao", item_weight: "heavy", cod_amount: "abc", ... })
→ item_weight: null, amount_to_collect: null
```

`parseFloat("heavy")` → `NaN` → `JSON.stringify` emits `null`. A COD amount that silently
becomes `null` is a financial defect, not a formatting one.

**Fix** — a shared validator run before any network call:

```js
// src/validation.js
export function requireFields(gateway, options, fields) {
  const missing = fields.filter((f) => {
    const v = options[f];
    return v === undefined || v === null || String(v).trim() === "";
  });
  if (missing.length) {
    throw new DeliveryError(
      `Missing required field(s) for ${gateway}: ${missing.join(", ")}`,
      gateway, "VALIDATION_ERROR"
    );
  }
}

export function toNumber(gateway, field, value, { min, max, fallback } = {}) {
  const n = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(n)) {
    throw new DeliveryError(
      `"${field}" must be a number, got ${JSON.stringify(value)}`,
      gateway, "VALIDATION_ERROR"
    );
  }
  if (min !== undefined && n < min) {
    throw new DeliveryError(`"${field}" must be >= ${min}, got ${n}`, gateway, "VALIDATION_ERROR");
  }
  if (max !== undefined && n > max) {
    throw new DeliveryError(`"${field}" must be <= ${max}, got ${n}`, gateway, "VALIDATION_ERROR");
  }
  return n;
}
```

Wire per adapter:

| Adapter | Required |
|---|---|
| pathao.createOrder | `recipient_name`, `recipient_phone`, `recipient_address` (≥10 real chars), `storeId`, `invoice`/`merchant_order_id` |
| pathao.trackOrder | `trackingId` |
| steadfast.createOrder | `invoice`, `recipient_name`, `recipient_phone`, `recipient_address`, `cod_amount` |
| steadfast.trackOrder | one of `trackingId` / `invoice` / `trackingCode` |
| paperfly.createOrder | `invoice`/`merchantOrderReference`, `customerName`, `customerPhone`, `customerAddress` |
| paperfly.track/cancel | `trackingId` |

Numeric coercion via `toNumber`: `item_weight` (min 0.5, max 10), `cod_amount` (min 0),
`item_quantity` (min 1), `store_id`, `city_id`/`zone_id`/`area_id`.

*Exit criteria:* the `docs/index.md` example throws `VALIDATION_ERROR` naming
`recipient_name, recipient_phone, recipient_address` — before any network call.

---

### 2. 🔴 Pathao address is space-padded to defeat the length requirement — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/pathao.js:194` — short addresses throw `VALIDATION_ERROR`; the padding is gone.

`src/gateways/pathao.js:84`

```js
if (address.length < 10) address = address.padEnd(10, " ");
```

Reproduced: `recipient_address: "Dhaka"` is transmitted as `"Dhaka     "` (len 10).

This defeats Pathao's minimum-length validation rather than satisfying it. The rider
receives a useless address, the merchant is never told the data was altered, and an *empty*
address becomes ten spaces and passes. Silently mutating user data to get past a remote
validator is never the right trade.

**Fix**

```js
const address = String(options.recipient_address ?? "").trim();
if (address.length < 10) {
  throw new DeliveryError(
    `recipient_address must be at least 10 characters (got ${address.length})`,
    "pathao", "VALIDATION_ERROR"
  );
}
```

---

### 3. 🔴 `steadfast.cancelOrder()` reports success without doing anything — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/steadfast.js:283` — throws `NOT_SUPPORTED`, matching Pathao. No network call, no false success.

`src/gateways/steadfast.js:196-199`

```js
export async function cancelOrder(config, options) {
  if (!options.trackingId) throw new DeliveryError(...);
  return { gateway: "steadfast", status: "cancelled", trackingId: options.trackingId };
}
```

Reproduced:

```
cancelOrder({ gateway: "steadfast", trackingId: "CID-999", ... })
→ { "gateway": "steadfast", "status": "cancelled", "trackingId": "CID-999" }
→ network calls made: 0
```

The caller marks the order cancelled in their own database; the parcel still ships. This is
the highest-cost defect in the repo — it silently desynchronizes the merchant's system from
physical reality, and does so in the one direction that loses money.

Contrast `pathao.cancelOrder` (`pathao.js:179`), which correctly throws `NOT_SUPPORTED`.
The honest behaviour already exists in the codebase; Steadfast just doesn't use it.

**Fix** — mirror Pathao:

```js
export async function cancelOrder(config, options) {
  throw new DeliveryError(
    "Steadfast does not expose an order-cancellation endpoint. " +
    "Use createReturnRequest() or cancel via the Steadfast merchant panel.",
    "steadfast", "NOT_SUPPORTED"
  );
}
```

⚠️ Confirm against current Steadfast merchant docs. If a cancel endpoint *does* exist,
implement it properly. Delegating to `createReturnRequest` is **not** an acceptable
substitute — a return is not a cancellation, and conflating them repeats this bug in a
subtler form. Audit for the same stub pattern elsewhere before release.

---

### 4. 🔴 Unencoded path parameters allow endpoint redirection — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:78` `pathSegment()`, applied at all six interpolation sites in `steadfast.js` and `pathao.js`.

`src/gateways/steadfast.js:83, 86, 89, 147, 178` and `pathao.js:147`

```js
url = `${BASE_URL}/status_by_invoice/${options.invoice}`;
```

Reproduced:

```
invoice = "../get_balance"  → https://portal.packzy.com/api/v1/status_by_invoice/../get_balance
invoice = "INV 1#x?y=2"     → https://portal.packzy.com/api/v1/status_by_invoice/INV 1#x?y=2
```

`fetch` normalizes the `..` segment, so the first request actually hits
`/api/v1/get_balance` — a **different endpoint, with the merchant's credentials attached**,
returning account balance to a caller who asked for order status. The second shows that any
invoice containing a space, `#` or `?` silently truncates or corrupts the request.

Invoice numbers are routinely user- or ERP-supplied, so this is reachable input, not a
theoretical one.

**Fix**

```js
// src/utils.js
export function pathSegment(gateway, field, value) {
  const s = String(value ?? "").trim();
  if (!s) throw new DeliveryError(`${field} is required`, gateway, "MISSING_PARAM");
  return encodeURIComponent(s);
}
```

Apply at all six call sites:

```js
url = `${BASE_URL}/status_by_invoice/${pathSegment("steadfast", "invoice", options.invoice)}`;
```

*Exit criteria:* a test asserting `invoice: "../get_balance"` still produces a URL under
`/status_by_invoice/`.

---

### 5. 🔴 `request()` throws a raw `TypeError` on `null` error bodies — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:205,221` — `null`/non-object bodies normalized; `extractErrorMessage()` at `:95`, shared with `pathao.js:59`.

`src/utils.js:45-50`

```js
if (!response.ok) {
  const validationErrors = data.errors ? Object.values(data.errors).flat().join(", ") : null;
```

Three distinct failures reproduced:

```
ok:false, body "null"      → TypeError: Cannot read properties of null (reading 'errors')
ok:true,  body "null"      → request() returns null  → adapter crashes on data.status
{ errors: "a string" }     → DeliveryError: "a,  , s, t, r, i, n, g"
```

`JSON.parse("null")` *succeeds* and yields `null`, so the `try/catch` around parsing never
fires. The raw `TypeError` escapes the `DeliveryError` contract entirely; the adapter catch
blocks then re-wrap it as a generic `API_ERROR` reading *"Cannot read properties of null"* —
which is what an on-call engineer sees instead of the actual API failure.

The third case is `Object.values("a string")` spreading the string into characters.

**Fix**

```js
const isObject = (v) => v !== null && typeof v === "object";

function extractErrorMessage(data, fallback) {
  if (!isObject(data)) return fallback;
  if (isObject(data.errors)) {
    const flat = Object.values(data.errors).flat().filter(Boolean);
    if (flat.length) return flat.join(", ");
  }
  if (typeof data.errors === "string" && data.errors) return data.errors;
  return data.message || data.error?.message || fallback;
}
```

Use it in the `!response.ok` branch **and** at `pathao.js:26`, which carries the identical
`Object.values(data.errors)` bug. Guard every adapter read with `isObject(data)` or `data?.`.

---

### 6. 🔴 Gateway registry resolves inherited `Object.prototype` keys — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/index.js:9` — null-prototype registry + `Object.hasOwn`, and the cache now stores the import promise.

`src/gateways/index.js:6, 28`

```js
const gateways = { pathao: ..., steadfast: ..., paperfly: ... };
if (!normalized || !gateways[normalized]) throw new GatewayNotFoundError(name);
```

`gateways` is an object literal, so prototype members pass the truthiness check.
Reproduced:

```
getGateway("constructor")    → RESOLVED: {}          ← invoked Object(), cached as an adapter
getGateway("__proto__")      → TypeError: undefined  ← wrong error type, escapes DeliveryError
getGateway("toString")       → GatewayNotFoundError  ← correct, but only by luck
getGateway("hasOwnProperty") → GatewayNotFoundError  ← ditto
```

`getGateway("constructor")` calls `Object()`, gets `{}`, **caches it under the key
`constructor`**, and returns it as a gateway adapter. The caller then gets
`Gateway "constructor" does not support createOrder()` from `index.js:23` — a misleading
error instead of `GatewayNotFoundError`. `__proto__` leaks a raw `TypeError`.

**Fix** — null-prototype registry plus `Object.hasOwn`, and cache the *promise* so
concurrent first-calls don't trigger duplicate dynamic imports:

```js
const gateways = Object.assign(Object.create(null), {
  pathao:    () => import("./pathao.js"),
  steadfast: () => import("./steadfast.js"),
  paperfly:  () => import("./paperfly.js"),
});

export async function getGateway(name) {
  const normalized = typeof name === "string" ? name.toLowerCase().trim() : "";
  if (!normalized || !Object.hasOwn(gateways, normalized)) {
    throw new GatewayNotFoundError(name);
  }
  if (!cache.has(normalized)) cache.set(normalized, gateways[normalized]());
  return cache.get(normalized);
}
```

`typeof name === "string"` also fixes the non-string case, which currently relies on
optional chaining returning `undefined` by accident.

---

### 7. 🟠 No request timeout — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:133` — 15s default, per-gateway `timeoutMs`, `TIMEOUT`/`ABORTED` codes, caller `AbortSignal` honoured.

`src/utils.js:30` — `await fetch(url, options)` with no `AbortSignal`. Node's fetch has
**no default timeout**. A courier API that accepts the TCP connection and never responds
pins the request until the socket dies. In an Express handler that is a leaked request for
minutes, and courier APIs are exactly the kind of dependency that stalls under load.

**Fix**

```js
export async function request(url, options = {}, gateway, contextMessage, { timeoutMs = 15_000 } = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new DeliveryError(
      error.name === "TimeoutError"
        ? `${gateway} request timed out after ${timeoutMs}ms`
        : `${gateway} network request failed: ${error.message}`,
      gateway,
      error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
      error
    );
  }
  ...
}
```

Make `timeoutMs` overridable per gateway (`configure({ pathao: { timeoutMs: 8000 } })`) and
thread a caller-supplied `AbortSignal` through the public API — `createOrder({ signal })` —
so consumers can cancel.

---

### 8. 🟠 Network errors unwrapped; no retry on transient failures — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:245` — `NETWORK_ERROR` wrapping plus bounded retry with jitter for idempotent requests only.

`src/utils.js:30`

A DNS failure or `ECONNRESET` throws a bare `TypeError: fetch failed`, which escapes
`request()` unwrapped and is re-thrown by adapters as a generic `API_ERROR` with an
unhelpful message. Nothing distinguishes "the courier is down" from "your payload is
invalid", so callers cannot build retry logic on top.

**Fix**

1. Wrap network failures as `DeliveryError(..., "NETWORK_ERROR", err)` — covered by #7's
   `catch`.
2. Add bounded retry with exponential backoff + jitter for **idempotent requests only**:
   `GET` and Pathao token issuance.
3. Retry on `5xx`, `429` (honour `Retry-After`), and network errors. Default 2 retries.

```js
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
```

**Never auto-retry `createOrder`.** Without an idempotency key that ships duplicate parcels
— the delivery analogue of a double charge. Neither Pathao, Steadfast nor Paperfly exposes
an idempotency header; the natural keys are `merchant_order_id` / `invoice` /
`merchantOrderReference` respectively. Document that per gateway rather than pretending the
guarantee is uniform.

---

### 9. 🟠 Pathao re-authenticates on every single call — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/pathao.js:101` — TTL cache keyed on host+credentials, in-flight de-dup, retry-on-401 via `withAuth()`.

`src/gateways/pathao.js:33-51`, called from `:74` and `:144`

Reproduced: three `createOrder` calls issued **three** `/issue-token` requests. Every
`createOrder` and `trackOrder` costs two round-trips instead of one.

Pathao access tokens carry an `expires_in` (typically ~5 days) and a `refresh_token`, both
discarded at `pathao.js:50` which returns only `data.access_token`. At volume this doubles
latency and invites auth rate-limiting — which becomes the failure mode precisely when
traffic is highest.

**Fix** — module-level cache keyed by a credential fingerprint, so multiple merchants in one
process never share a token, with in-flight de-duplication:

```js
const tokenCache = new Map(); // key -> { token, expiresAt, inflight }

const cacheKey = (config) => `${getBaseUrl(config)}|${config.clientId}|${config.username}`;

async function getAccessToken(config) {
  const key = cacheKey(config);
  const entry = tokenCache.get(key);
  if (entry?.token && Date.now() < entry.expiresAt) return entry.token;
  if (entry?.inflight) return entry.inflight;              // de-dupe concurrent grants

  const inflight = issueToken(config).then((data) => {
    const ttlMs = (Number(data.expires_in) || 3600) * 1000;
    tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 });
    return data.access_token;
  }).catch((err) => { tokenCache.delete(key); throw err; });

  tokenCache.set(key, { ...entry, inflight });
  return inflight;
}
```

`issueToken` must return the whole payload (for `expires_in` / `refresh_token`), not just
the token. On a `401` from a business call, invalidate the entry and retry once. Export
`clearTokenCache()` for tests and call it from `clearConfig()`.

---

### 10. 🟠 `originalError` is accepted everywhere and populated nowhere — ✅ FIXED

> **Fixed in v1.1.0.** `src/errors.js:44` — `cause`, `new.target.name`, `captureStackTrace`, plus `statusCode`/`responseBody` and a redacting `toJSON()`.

`src/errors.js:11` plus all three adapters

The 4th constructor parameter exists and is documented, but all 20+ throw sites do:

```js
throw new DeliveryError(error.message, "steadfast", "API_ERROR");
```

The original stack is discarded at every layer boundary. Debugging a production failure
means reading a one-line message with no trace and no HTTP context.

**Fix**

1. Pass the cause at every wrap site:
   `new DeliveryError(error.message, gw, "API_ERROR", error)`.
2. Set the standard `cause` and capture a clean stack:

```js
constructor(message, gateway, code, originalError = null) {
  super(message, { cause: originalError ?? undefined });
  this.name = new.target.name;          // subclasses get the right name for free
  this.gateway = gateway;
  this.code = code;
  this.originalError = originalError;
  Error.captureStackTrace?.(this, new.target);
}
```

`this.name = new.target.name` also removes the manual `this.name = ...` line from both
subclasses (`errors.js:33, 52`).

3. Attach HTTP context so callers can build retry logic: `this.statusCode`,
   `this.responseBody` — **redacted** per #21.

---

### 11. 🟠 `sandbox` is configurable for Steadfast and Paperfly and silently ignored — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/steadfast.js:41` and `paperfly.js:32` — `sandbox: true` throws `ConfigurationError`; `baseUrl` is the documented alternative.

`src/gateways/steadfast.js:4, 10` and `paperfly.js:4, 11`

Both declare `sandbox` in `META.envMap` and both hardcode `const BASE_URL`. Reproduced:

```
resolveConfig("steadfast", { apiKey, secretKey, sandbox: true })
→ { sandbox: true, ... }   — and the request still goes to portal.packzy.com
```

A merchant setting `STEADFAST_SANDBOX=true` believes they are testing while creating **real
parcels against their live account**. Pathao handles this correctly (`pathao.js:15-19`); the
other two accept the flag and discard it, which is worse than not offering it.

**Fix** — give every adapter a `getBaseUrl(config)`:

```js
function getBaseUrl(config) {
  if (config.baseUrl) return config.baseUrl;
  if (config.sandbox) return SANDBOX_URL;
  return PRODUCTION_URL;
}
```

⚠️ If a gateway genuinely has no sandbox, **throw** rather than silently using production:

```js
if (config.sandbox) {
  throw new ConfigurationError(
    "Paperfly has no public sandbox; set baseUrl explicitly to point at a test host.", ...
  );
}
```

…and remove `sandbox` from that gateway's `envMap`. Silent-ignore is the one unacceptable
option. Promote `baseUrl` to a documented first-class config key for all three gateways.

---

### 12. 🟠 The documented example does not work — ✅ FIXED

> **Fixed in v1.1.0.** `docs/index.md` rewritten with a working example, a per-gateway field table, the status vocabulary and the error-code table.

`docs/index.md:25-31`

```js
const order = await createOrder({
  gateway: "pathao",
  recipientName: "John Doe",     // adapters read recipient_name
  address: "Dhaka",              // adapters read recipient_address
});
```

Reproduced in #1: produces an empty order that is accepted and returned as successful. This
is the first thing a new user copies, and today it fails silently rather than loudly.

**Fix** — correct the example, and add a per-gateway field-reference table to the docs.
Once #1 lands this snippet throws loudly, but the docs must still be fixed. Add a doc test
that executes the README and `docs/index.md` snippets against a mocked `fetch` so examples
cannot drift from the code again.

`README.md:13` also points at `docs/` as the sole usage reference, so this is the entire
documented onboarding path.

---

### 13. 🟠 Library writes to `console.error` and swallows the failure — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/pathao.js:155` — `getStores()` returns `{ stores, error }` instead of logging; a test bans `console.*` in `src/`.

`src/gateways/pathao.js:66-69`

```js
} catch (e) {
  console.error("Failed to fetch stores list:", e);
}
```

A library must not write to the host's stdout/stderr — it bypasses the application's logger,
its redaction, and its log levels. The logged object is a `DeliveryError` that will carry
request context once #10 lands. The failure is then swallowed and `[]` returned, so the
caller gets the generic "Wrong Store" error with no store list and no explanation.

**Fix** — remove the `console.error`. Either let the caller opt into a logger
(`configure({ logger })`, defaulting to a no-op), or attach the diagnostic to the rethrown
error:

```js
} catch (e) {
  storeListError = e;   // surface on the rethrown DeliveryError instead of logging
}
```

Add a lint rule banning `console.*` in `src/` (the repo has no lint config at all today).

---

### 14. 🟡 Eight Steadfast functions are unreachable through the public API — ✅ FIXED

> **Fixed in v1.1.0.** `src/index.js:96` `callGateway()` with an `ALLOWED_METHODS` allow-list, plus `getGatewayCapabilities()` at `:114`.

`src/index.js` and `src/gateways/steadfast.js:60-194`

`createBulkOrder`, `getBalance`, `createReturnRequest`, `getReturnRequest`,
`getReturnRequests`, `getPayments`, `getPayment`, `getPoliceStations` are all implemented,
covered by no test, and exported from a module the package never re-exports. `index.js`
surfaces only `createOrder`/`trackOrder`/`cancelOrder`, and `getGateway` is not exported.

They are reachable *only* via undocumented deep import
(`bddeliveries/src/gateways/steadfast.js`) — which works today solely because `package.json`
has no `exports` field (#18), and breaks the moment one is added.

**Fix** — one generic escape hatch, so per-gateway extras don't cause API drift:

```js
export async function callGateway({ gateway, method, ...options }) {
  const adapter = await getGateway(gateway);
  if (!ALLOWED_METHODS.has(method) || typeof adapter[method] !== "function") {
    throw new DeliveryError(
      `Gateway "${gateway}" does not support ${method}()`,
      gateway, "UNSUPPORTED_OPERATION"
    );
  }
  return adapter[method](resolveConfig(gateway, options, adapter.META), options);
}
```

The `ALLOWED_METHODS` allow-list is not optional — without it this becomes arbitrary
property invocation on the adapter module (`callGateway({ method: "META" })` and worse).
Document the capability matrix per gateway, and resolve this **before** #18 adds `exports`.

---

### 15. 🟡 Unsupported-operation errors are bare `Error`s — ✅ FIXED

> **Fixed in v1.1.0.** `src/index.js:44` `runOperation()` — the three duplicated method bodies collapsed into one factory.

`src/index.js:23, 40, 57`

```js
throw new Error(`Gateway "${gateway}" does not support createOrder()`);
```

Three of the library's own error paths throw a plain `Error`, breaking the documented
promise that everything is a `DeliveryError` with `.gateway` and `.code`. A caller doing
`catch (e) { if (e instanceof DeliveryError) ... }` misses these entirely and re-throws.

**Fix** — throw `DeliveryError(..., "UNSUPPORTED_OPERATION")`, and collapse the three
near-identical method bodies while there:

```js
function makeOperation(method) {
  return async function ({ gateway, ...options }) {
    const adapter = await getGateway(gateway);
    if (typeof adapter[method] !== "function") {
      throw new DeliveryError(
        `Gateway "${gateway}" does not support ${method}()`,
        gateway, "UNSUPPORTED_OPERATION"
      );
    }
    return adapter[method](resolveConfig(gateway, options, adapter.META), options);
  };
}

export const createOrder = makeOperation("createOrder");
export const trackOrder  = makeOperation("trackOrder");
export const cancelOrder = makeOperation("cancelOrder");
```

Also expose `getGatewayCapabilities(name) → { createOrder, trackOrder, cancelOrder }` so
callers can branch before calling rather than catching.

---

### 16. 🟡 Phone normalization applied to one gateway out of three — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:47` — `+880`/`880` handled before the 2-char forms, separators stripped, invalid numbers rejected. Applied in all three adapters.

`src/gateways/pathao.js:82`; absent in `steadfast.js:32` and `paperfly.js:47`

Only Pathao calls `normalizePhone`. The same `+8801711111111` reaches Steadfast and Paperfly
unnormalized, so identical caller input produces different upstream behaviour per gateway —
which defeats the "unified API" premise in `README.md:7`.

`normalizePhone` itself (`utils.js:9-17`) is also incomplete:

- Strips whitespace but not `-`, `(`, `)` or `.` — `017-1111-1111` passes straight through.
- No format validation; `normalizePhone("hello")` returns `"hello"`.
- `(phone || "")` maps a numeric `0` to `""`.
- The `+88` branch is right only by coincidence: `+8801711111111` → slice(3) →
  `01711111111` works, but a `+880171…` form written without the leading `0` breaks.

**Fix**

```js
export function normalizePhone(phone, { gateway, field = "phone" } = {}) {
  let p = String(phone ?? "").replace(/[\s\-().]/g, "");
  if (p.startsWith("+880")) p = "0" + p.slice(4);
  else if (p.startsWith("880")) p = "0" + p.slice(3);
  else if (p.startsWith("+88")) p = p.slice(3);
  else if (p.startsWith("88") && p.length > 11) p = p.slice(2);
  if (!/^01[3-9]\d{8}$/.test(p)) {
    throw new DeliveryError(
      `Invalid Bangladeshi mobile number for ${field}: ${phone}`,
      gateway, "VALIDATION_ERROR"
    );
  }
  return p;
}
```

Handling `+880`/`880` explicitly *before* the 2-char cases is what fixes the ordering bug.
Apply in all three adapters.

---

### 17. 🟡 Global mutable config with no per-tenant isolation — ✅ FIXED

> **Fixed in v1.1.0.** `src/config.js:35` validates input and gateway names; `src/index.js:162` `DeliveryClient` owns an isolated store. `unconfigure()` added.

`src/config.js:7, 13`

`globalConfig` is a module-level `Map` — one shared singleton per process. A marketplace
serving multiple merchants cannot hold two Pathao credential sets at once; the last
`configure()` wins, and a concurrent request can be authenticated with the wrong merchant's
credentials. `clearConfig()` is all-or-nothing; there is no `unconfigure(gateway)`.

`configure()` has no input validation either: `configure(null)` throws a raw
`TypeError: Cannot convert undefined or null to object` from `Object.entries`, and unknown
gateway names are silently accepted — so `configure({ pathoa: {...} })` (a typo) fails much
later with a confusing `ConfigurationError` about missing credentials.

**Fix** — keep the global API for the simple case, add a client class for the real one:

```js
export class DeliveryClient {
  constructor(config = {}) { this.config = config; }
  createOrder(options) { /* resolves against this.config, not the module singleton */ }
}
```

Refactor `resolveConfig` to take an explicit config source rather than reading the module
singleton, then implement the global functions on top of a default instance. Also: validate
`configure()` input against the known gateway list and throw `ConfigurationError` listing
valid names; add `unconfigure(gateway)`; document merge-vs-replace semantics (today it
replaces a gateway's entry wholesale — defensible, but undocumented).

---

### 18. 🟡 `package.json` is not publish-ready — ✅ FIXED

> **Fixed in v1.1.0.** `package.json` — `files`, `exports`, `sideEffects`, `repository`/`bugs`/`homepage`. Landed after #14, so nothing depended on the deep-import path.

- **No `exports` map** → the entire package tree is importable, so every internal path is
  implicitly public API and cannot be refactored without a breaking change.
- **No `files` field** → `npm publish` ships `tests/`, `docs/`, `notes/` and any untracked
  leftovers.
- `types` is a top-level key; modern resolvers want it inside `exports`.
- No `repository`, `bugs` or `homepage`.
- ESM-only with no CJS build — a fine decision, but it should be a documented one.

```jsonc
"files": ["src", "README.md"],
"exports": {
  ".": { "types": "./src/index.d.ts", "import": "./src/index.js", "default": "./src/index.js" },
  "./package.json": "./package.json"
},
"sideEffects": false,
"repository": { "type": "git", "url": "git+https://github.com/<org>/BDDeliveries.git" },
"bugs": { "url": "https://github.com/<org>/BDDeliveries/issues" }
```

Resolve **#14 first** — adding `exports` severs the deep-import path those eight functions
currently depend on.

---

### 19. 🟡 `index.d.ts` types almost nothing — ✅ FIXED

> **Fixed in v1.1.0.** `src/index.d.ts` rewritten — `DeliveryResult`, `DeliveryStatus`, a discriminated union on `gateway`, and no index signature on the per-gateway option types.

`src/index.d.ts`

Every operation returns `Promise<any>`. `BaseOptions` has `[key: string]: any` (`:24`),
which defeats excess-property checking entirely — so `recipientName` (the wrong field name
from #12) type-checks cleanly, which is exactly the mistake types should have caught. None
of the Steadfast extras are declared. The normalized result shape
`{ gateway, status, trackingId, raw }` — the library's core contract — is never expressed.

**Fix**

```ts
export type DeliveryStatus =
  | "pending" | "picked_up" | "in_transit"
  | "delivered" | "returned" | "cancelled" | "unknown";

export interface DeliveryResult<TRaw = unknown> {
  gateway: string;
  status: DeliveryStatus;
  providerStatus?: string;
  trackingId?: string;
  providerTrackingNumber?: string;
  raw: TRaw;
}

export interface PathaoCreateOptions {
  gateway: "pathao";
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  storeId?: string | number;
  cod_amount?: number;
  /* … */
}

export type CreateOrderOptions =
  | PathaoCreateOptions | SteadfastCreateOptions | PaperflyCreateOptions;

export function createOrder(options: CreateOrderOptions): Promise<DeliveryResult>;
```

A discriminated union on `gateway` gives real per-gateway narrowing. Drop the index
signature from the specific option types (keep it only on an explicit `extra` escape hatch)
— that is what makes cross-gateway fields an error. Add `tests/types.check.ts` with
`@ts-expect-error` cases, compiled by `tsc --noEmit` in CI, so the declarations can't drift.

---

### 20. 🟡 Status normalization is inconsistent and lossy — ✅ FIXED

> **Fixed in v1.1.0.** `src/status.js` — canonical `STATUS`, per-gateway lookup tables, `mapStatus()`/`mapPaperflyStatus()`. Every result carries `providerStatus` alongside.

`pathao.js:155-161`, `steadfast.js:105`, `paperfly.js:89-94`

Three different strategies:

- **Pathao** — substring matching on a slug, falling through to the **raw provider string**
  when nothing matches. So `status` is sometimes normalized and sometimes not, and the
  caller cannot tell which.
- **Steadfast** — `status: data.delivery_status`, entirely raw. No normalization at all.
- **Paperfly** — boolean flags on `trackingStatus[0]`, defaulting to `processing`.

A caller switching gateways gets a different `status` vocabulary, which is the one thing the
abstraction exists to prevent. `createOrder` returns the literal `"created"`, which is in no
provider's vocabulary. Ordering is accidental too: Pathao checks `return` before `transit`,
so `returned_in_transit` maps to `returned` — probably correct, but by luck.

Related dead code at `steadfast.js:98`: `if (data.status === 404 || !data.delivery_status)`
— a real 404 makes `response.ok` false, so `request()` already threw; and
`!data.delivery_status` throws `NOT_FOUND` for any valid response that merely omits the
field.

**Fix** — `src/status.js` with a canonical enum and an explicit per-gateway lookup table:

```js
export const STATUS = {
  PENDING: "pending", PICKED_UP: "picked_up", IN_TRANSIT: "in_transit",
  DELIVERED: "delivered", RETURNED: "returned", CANCELLED: "cancelled",
  ON_HOLD: "on_hold", UNKNOWN: "unknown",
};

export const mapStatus = (map, raw) => map[raw] ?? STATUS.UNKNOWN;
```

Always return **both** `status` (canonical) and `providerStatus` (raw), so normalization is
never lossy. `UNKNOWN` beats leaking a provider string into a field callers `switch` on.

---

### 21. 🟡 Paperfly ships a hardcoded API key; credentials risk landing in error bodies — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/paperfly.js:15` — `paperflyKey` required and env-mappable, fallback deleted; `src/errors.js:28` `redact()` applied to every error body.

`src/gateways/paperfly.js:27`

```js
paperflykey: config.paperflyKey || "Paperfly_~La?Rj73FcLm",
```

A shared secret committed to source. ⚠️ Even if this is Paperfly's public demo key, the
fallback means a misconfigured merchant silently authenticates as the demo tenant instead of
getting a clear configuration error — the failure is invisible until orders go missing.

`paperflyKey` is also absent from `META.envMap` and `META.requiredKeys`, so unlike every
other credential in the library it cannot be supplied by environment variable.

Related: once `responseBody` is attached to errors (#10), request/response snapshots must be
redacted or credentials end up in log aggregators.

**Fix**

1. Add `paperflyKey: "PAPERFLY_KEY"` to `envMap` and to `requiredKeys`; delete the fallback.
2. Add `redact(obj)` to `utils.js` with a deny-list — `Authorization`, `Api-Key`,
   `Secret-Key`, `paperflykey`, `password`, `client_secret`, `clientSecret` — and apply it
   to anything attached to an error or handed to a logger. Consider a non-enumerable
   `toJSON()` / `Symbol.for("nodejs.util.inspect.custom")` on the resolved config so a stray
   `console.log(err)` cannot dump live credentials.
3. If the key is confirmed to be a real merchant key, **rotate it** — it is in git history.
4. Note in the changelog that `paperflyKey` becomes required: it is a breaking change.

---

### 22. 🟢 Test suite covers ~2% of the surface — ✅ FIXED

> **Fixed in v1.1.0.** `tests/` rebuilt: `helpers/mock-fetch.js` with a call log, `beforeEach(clearConfig)` isolation, adapter suites, `hygiene.test.js`, `types.check.ts`. 2 → 87 tests.

`tests/index.test.js` — two tests: one Pathao happy path, one missing-param check. No
coverage of Steadfast, Paperfly, config precedence, error paths, or `GatewayNotFoundError`.
**Every finding in this document survived the suite.**

- `:49` — `configure()` is called in test 1 and never cleared, so results depend on test
  ordering. `clearConfig()` exists and is unused.
- `:19-21` — the `try { … } catch (err) { throw err; }` in `mockFetch` is dead code.
- The mock returns a bare object, not a `Response`, so it cannot catch anything that depends
  on real `Response` semantics.

**Plan:** `beforeEach(clearConfig)` plus a token-cache reset (#9). Extract the fetch mock
into `tests/helpers/mock-fetch.js` with call-log assertions (several findings here need
"how many requests were made" and "what URL", which the current mock cannot express). Add a
regression test for every finding — each has a concrete repro in this document. Minimum
matrix: 3 adapters × create/track/cancel × (happy path, gateway business failure, non-2xx,
malformed/empty body, missing required option). Target ~30 tests, every `throw new
DeliveryError` site executed at least once. Add
`node --test --experimental-test-coverage` with a threshold.

---

### 23. 🟢 Retry logic keyed on an English substring — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/pathao.js:32` `WRONG_STORE_MARKER` — isolated, commented, and pinned by a test.

`src/gateways/pathao.js:116`

```js
if (error instanceof DeliveryError && error.message.includes("Wrong Store"))
```

Breaks the moment Pathao rewords, localizes or capitalizes the message differently — and
fails *silently*, degrading to a generic error with no store list. Match on a response error
code if one exists; if not, isolate the string in a named constant with a comment recording
why, and add a test pinning the assumption so the coupling is at least visible.

---

### 24. 🟢 Inconsistent field naming across the public API — ✅ FIXED

> **Fixed in v1.1.0.** `src/utils.js:27` `pick()` — camelCase is canonical, snake_case accepted throughout.

Callers pass `recipient_name` (snake_case) alongside `trackingId`, `storeId`, `clientId`
(camelCase). Some adapters accept both spellings (`paperfly.js:42-47` —
`options.item_description || options.productBrief`), some don't. This is also the root cause
of #12: with no convention, the docs drifted from the code and nothing noticed.

Pick one — camelCase for a JS library — accept the legacy snake_case spellings with a
deprecation path, and translate to provider naming inside each adapter. This is what makes
the "unified API" claim in `README.md:7` real; today the caller must still know each
provider's field names, so the abstraction only unifies the *function* names.

---

### 25. 🟢 `resolveConfig()` folds the entire order payload into the credential object — ✅ FIXED

> **Fixed in v1.1.0.** `src/config.js:119` — only `envMap` keys plus `TRANSPORT_KEYS` are lifted from call options.

`src/config.js:56` — `{ ...envConfig, ...globalCfg, ...callOptions }`. Reproduced:

```
resolveConfig("pathao", { clientId, clientSecret, username, password,
                          recipient_name: "Jane", recipient_phone: "0171", cod_amount: 5000 })
→ keys: clientId, clientSecret, username, password,
        recipient_name, recipient_phone, cod_amount, sandbox
```

Two consequences: (a) credentials and customer PII end up in one object that is passed to
every adapter — a prime candidate for accidental logging, and directly at odds with #21;
(b) an order field named like a credential **silently overrides** the configured credential
for that call, so an order legitimately carrying a `username` or `password` key breaks auth.

**Fix** — lift only known credential keys out of the call options:

```js
export function resolveConfig(gatewayName, callOptions = {}, adapterMeta = {}) {
  const allowed = [...Object.keys(adapterMeta.envMap || {}), "baseUrl", "timeoutMs", "storeId"];
  const overrides = Object.fromEntries(
    allowed.filter((k) => callOptions[k] !== undefined).map((k) => [k, callOptions[k]])
  );
  const merged = { ...readEnvConfig(adapterMeta.envMap), ...(globalConfig.get(gatewayName) || {}), ...overrides };
  ...
}
```

The payload is already passed to adapters separately as the second argument, so nothing
needs it in `config`.

---

### 26. 🟢 Paperfly `cancelOrder` is inconsistent with its siblings — ✅ FIXED

> **Fixed in v1.1.0.** `src/gateways/paperfly.js:52` — `getHeaders()` used by all three methods, and `assertPaperflyOk()` unified. ⚠️ The endpoint URL itself remains unverified.

`src/gateways/paperfly.js:114-119`

`cancelOrder` builds headers inline and omits `paperflykey`, unlike `getHeaders()` used by
`createOrder` and `trackOrder`. The URL shape also differs — `/api/v1/cancel-order` versus
`/merchant/api/service/new_order_v2.php` — suggesting it was written against a different API
version or never exercised. The response-code check at `:123` differs from `:56` and `:85`
for no stated reason.

⚠️ Confirm the endpoint against current Paperfly documentation before changing anything; if
it is wrong, this method has never worked. Then use `getHeaders(config)` consistently and
unify the response-code check across all three methods.

---

## Execution plan

### Phase 1 — Correctness (shipped as `1.1.0`) ✅
1. `src/validation.js` + wire required-field / numeric checks into all 3 adapters (#1) —
   **do this first, it is the data-integrity bug**.
2. Remove the Pathao address padding; validate instead (#2).
3. Fix `steadfast.cancelOrder` to throw `NOT_SUPPORTED` (#3) — **the false-success bug**.
4. `pathSegment()` encoding at all 6 interpolation sites (#4).
5. Harden `request()` against `null` / non-object bodies; share `extractErrorMessage` with
   `pathao.js:26` (#5).
6. Null-prototype gateway registry + promise caching (#6).

*Exit criteria:* the `docs/index.md` example throws `VALIDATION_ERROR`;
`cancelOrder({gateway:"steadfast"})` throws; no raw `TypeError` escapes any public entry
point; a regression test exists for each of the six.

### Phase 2 — Reliability ✅
7. `request()` timeout + `AbortSignal` passthrough (#7).
8. Network-error wrapping + bounded retry for idempotent requests only (#8).
9. Pathao token cache with TTL, in-flight de-dup and 401 invalidation (#9).
10. Thread `originalError` / `cause` through every throw site; attach `statusCode` (#10).
11. Fix or remove `sandbox` for Steadfast and Paperfly (#11).
12. Fix the docs example; add a per-gateway field table (#12).
13. Remove `console.error`; add the lint rule (#13).

*Exit criteria:* adapter test suite green over mocked `fetch`, covering every `throw` site;
no unhandled network path.

### Phase 3 — API surface & security ✅
14. `callGateway()` escape hatch with an allow-list (#14).
15. Collapse the three duplicated `index.js` methods; `DeliveryError` for unsupported ops;
    `getGatewayCapabilities()` (#15).
16. Unify phone normalization across all three adapters (#16).
17. `DeliveryClient` for multi-tenant use; validate `configure()` input (#17).
18. `files` / `exports` / `sideEffects` / repo metadata (#18) — **after #14**.
19. Real `.d.ts` with a discriminated union; drop the index signature (#19).
20. `src/status.js` canonical status mapping + `providerStatus` passthrough (#20).
21. Require `paperflyKey`; add `redact()` and credential-safe error serialization (#21).
25. Scoped credential resolution — stop folding the payload into config (#25).

### Phase 4 — Tests, CI, docs ✅
22. `tests/gateways/*.test.js` with a call-logging mock; `clearConfig` isolation;
    `tests/types.check.ts` (#22).
23. Replace the `"Wrong Store"` substring coupling (#23).
24. Naming convention + deprecation path for legacy spellings (#24).
26. Verify and fix the Paperfly cancel endpoint (#26).
27. GitHub Actions: matrix Node 18/20/22/24 → `npm ci`, `npm test`, `tsc --noEmit`,
    `npm pack --dry-run` leak check. Add `CHANGELOG.md`.

---

## Suggested commit sequence

```
feat(validation): reject incomplete orders before any network call
fix(pathao): validate short addresses instead of padding them with spaces
fix(steadfast): stop reporting success for an order that was never cancelled
fix(http): encode path parameters so an invoice cannot redirect the request
fix(http): wrap null and non-object error bodies as DeliveryError
fix(registry): reject inherited Object.prototype keys as gateway names
feat(http): add request timeouts and AbortSignal passthrough
feat(http): wrap network failures and retry idempotent requests
perf(pathao): cache access tokens with TTL and in-flight de-duplication
fix(errors): preserve the original error as cause across every wrap site
fix(config): honour sandbox for steadfast and paperfly, or reject it
docs: correct the createOrder example and document per-gateway fields
refactor(pathao): remove console.error from library code
feat(api): expose gateway-specific operations via callGateway()
fix(index): throw DeliveryError for unsupported operations
fix(utils): normalize phone numbers consistently across all gateways
feat(config): add DeliveryClient for per-tenant credential isolation
chore(pkg): add files/exports and repository metadata
fix(types): model the result envelope and per-gateway option unions
feat(status): normalize delivery status across gateways
fix(paperfly): require paperflyKey and redact credentials in errors
refactor(config): resolve only known credential keys
test: adapter coverage with a call-logging fetch mock
ci: node matrix, tsc --noEmit, npm pack leak check
```

---

## Open questions

Questions 5 and 6 were decided during implementation. Questions 1–4 need a merchant
account and remain open; the code ships in the safest position for each.

1. **Steadfast cancellation** ⏸️ — does the merchant API expose a cancel endpoint at all?
   #3 assumes not and throws `NOT_SUPPORTED`. Safe either way, but if one exists it should
   be implemented rather than thrown. Needs merchant-panel or doc confirmation.
2. **Sandbox hosts** ⏸️ — do Steadfast or Paperfly have sandbox environments? Both now
   reject `sandbox: true` with a message pointing at `baseUrl`, so a merchant cannot end up
   on production while believing they are testing. If a real host exists, wire it into
   `getBaseUrl()` and drop the throw.
3. **The Paperfly key** ⏸️ — is `Paperfly_~La?Rj73FcLm` a public demo key or a leaked
   merchant key? The fallback is deleted and `paperflyKey` is now required either way, but
   **the value is in git history**. If it was ever real, rotate it.
4. **Paperfly `/api/v1/cancel-order`** ⏸️ — has this endpoint ever been exercised against
   the live API? Headers are now consistent with its siblings (#26); the URL is unchanged
   and unconfirmed.
5. **Semver — shipped as `1.1.0`.** ✅ Minor rather than major, because although several
   changes are technically breaking (empty orders now throw, `steadfast.cancelOrder` throws,
   `paperflyKey` required, `sandbox` rejected, `exports` severs deep imports), every
   affected path was already broken. No *working* caller behaviour changes. All of them are
   listed under "Changed — breaking" in `CHANGELOG.md`.
6. **Multi-tenant requirement — implemented.** ✅ `DeliveryClient` ships alongside the
   global API rather than replacing it, so the single-merchant case is unchanged and the
   refactor cost nothing at the call site. `resolveConfig()` takes an explicit store; the
   global functions are a thin wrapper over a default one.

---

## What actually shipped

| Phase | Status | Findings |
|-------|--------|----------|
| 1 — Correctness | ✅ | #1, #2, #3, #4, #5, #6 |
| 2 — Reliability | ✅ | #7, #8, #9, #10, #11, #12, #13 |
| 3 — API surface & security | ✅ | #14, #15, #16, #17, #18, #19, #20, #21, #25 |
| 4 — Tests, CI, docs | ✅ | #22, #23, #24, #26 |

**New files:** `src/validation.js`, `src/status.js`, `src/caches.js`, `tsconfig.json`,
`CHANGELOG.md`, `.github/workflows/ci.yml`, `tests/helpers/mock-fetch.js`,
`tests/gateways/{pathao,steadfast,paperfly}.test.js`, `tests/request.test.js`,
`tests/hygiene.test.js`, `tests/types.check.ts`.

**Rewritten:** every file in `src/`, `tests/index.test.js`, `docs/index.md`, `README.md`,
`package.json`.

**Test coverage:** 2 → 87 tests. Every `throw new DeliveryError` site in the adapters is
exercised, and each of the six critical findings has a named test that fails against the
1.0.0 logic.

**Verification performed:**

```
npm run check        # 87 pass, 0 fail; tsc --noEmit clean
npm pack --dry-run   # 15 files, no docs/ tests/ notes/ leakage
```

The eleven `@ts-expect-error` cases in `tests/types.check.ts` compile-fail as intended,
which is what proves #19 is really fixed — dropping the `[key: string]: any` index
signature from the per-gateway option types is what makes a cross-gateway field an error,
and an unused `@ts-expect-error` is itself a compile error, so they cannot silently rot.

---

## Still outstanding

- **CI matrix unexercised.** `.github/workflows/ci.yml` was verified locally on Node
  v24.14.0 only. The Node 18/20/22 legs have never run. Node 18 is the risk: `npm test`
  uses explicit globs (`tests/*.test.js tests/gateways/*.test.js`) rather than directory
  recursion precisely because `node --test tests/` fails on this Node build, but the
  18-specific behaviour of `AbortController` wiring in `src/utils.js` is untested.
- **No `package-lock.json` regeneration.** The lockfile predates this release; CI has a
  drift check but it has never run.
- **Gateway sandbox verification**, per open questions 1–4 above. Before going live,
  exercise against a merchant account: a Pathao create → track cycle on the sandbox host,
  a Steadfast create → track → return-request cycle, and one Paperfly create → track →
  cancel to confirm whether `/api/v1/cancel-order` responds at all.

---

## Appendix — original reproductions

These are the pre-fix observations, kept as the record of what each finding actually was.
Reproduced by executing the real modules at `b2c0964` against a mocked `globalThis.fetch`
on Node v24.14.0. Baseline at the time: `npm test` → 2 pass, 0 fail.

| # | Input | Observed |
|---|---|---|
| 1 | `createOrder({gateway:"pathao", recipientName:"John Doe", address:"Dhaka"})` | success, `trackingId:"C1"`, `recipient_name: undefined`, `recipient_phone: ""` |
| 1 | `item_weight:"heavy"`, `cod_amount:"abc"` | serialized as `null`, `null` |
| 2 | `recipient_address:"Dhaka"` | transmitted as `"Dhaka     "` (len 10) |
| 3 | `cancelOrder({gateway:"steadfast", trackingId:"CID-999"})` | `status:"cancelled"`, **0 fetch calls** |
| 4 | `invoice:"../get_balance"` | `…/status_by_invoice/../get_balance` → resolves to `/get_balance` |
| 4 | `invoice:"INV 1#x?y=2"` | unescaped space and `#` in the URL |
| 5 | `ok:false`, body `"null"` | `TypeError: Cannot read properties of null` |
| 5 | `ok:true`, body `"null"` | `request()` returns `null` |
| 5 | `{errors:"a string"}` | message `"a,  , s, t, r, i, n, g"` |
| 6 | `getGateway("constructor")` | resolves to `{}`, cached under that key |
| 6 | `getGateway("__proto__")` | raw `TypeError` |
| 9 | 3× `createOrder` (pathao) | 3× `/issue-token` |
| 11 | `resolveConfig("steadfast", {sandbox:true})` | `sandbox: true`, request still hits production |
| 25 | `resolveConfig("pathao", {...creds, ...order})` | config contains secrets **and** PII |
