# Changelog

## 3.0.0 — Waysdrop V2 (D22): partner changelog

- **Published:** 2026-11-17 (spec branch `v2-spec`).
- **Cutover date on live: `<CUTOVER DATE — CTO to fill>`.** Staging has the new contract from `<STAGING DATE — CTO to fill>`.
- **Who:** every API-key integration (the single live partner), the six official SDKs, the Shopify channel app and the widget.
- **Why:** V2 is a force-update release. No v1 shim is kept after cutover. Everything below that is marked **Breaking** needs a change on your side before the cutover date. Everything **Additive** is safe to ignore until you want it.
- **Feature flags:** the `/v2` features ship dark behind flags that are enabled per partner account (`x-feature-flag` in the spec). Until yours is on, those operations answer 404 `FEATURE_DISABLED`.

### Breaking

1. **Legacy webhook `delivery.collected` no longer carries the recipient's delivery code.** `data.deliveryCode` is now always `null`; the key is kept so your parser still sees it.
   - *Why:* a partner should never hold the code that completes a drop-off (security fix).
   - *Migrate:* stop reading `deliveryCode`. The recipient gets the code from Waysdrop directly.
2. **Legacy webhook `delivery.collected.status` can be `ORDER_COLLECTED`** (store-order deliveries), not only `PACKAGE_COLLECTED`.
   - *Migrate:* accept both values.
3. **OAuth discovery lives at `/oauth/.well-known/openid-configuration`.** The spec previously said `/.well-known/openid-configuration`. That path never existed on the server, so this corrects the documentation.
   - *Migrate:* point OIDC discovery at the `/oauth/` URL, and read the endpoint URLs from the document.
4. **The PKCE test vector changed** to RFC 7636 Appendix B. The old verifier was 42 characters, below the RFC minimum of 43.
   - *Migrate:* re-vendor `fixtures/oauth-pkce.json` and generate verifiers of 43–128 characters.
5. **`POST /profile` with an API key no longer returns `accessToken`** (V2 auth AS-3; not a documented partner route).
   - *Migrate:* do not depend on it.
6. **Legacy error bodies lose `ip` and `environment`, and `url` loses its query string,** when the V2 auth work (AS-9) ships. Both fields are now marked deprecated in `ApiErrorResponse`.
   - *Migrate:* use `correlationId`, `statusCode`, `message` and `details.code`.
7. **429 quota errors: the quota object is `details.quota`, not a top-level `quota`.** The server has always sent it this way; the old spec and `fixtures/error-quota.json` were wrong.
   - *Migrate:* read `details.quota` (`QuotaExceededDetails`: `limit`, `remaining`, `resetAt`, `resetIn`).

### Additive

1. **Webhooks v2** (`PARTNER_WEBHOOKS_V2`).
   - **Envelope:** a versioned envelope with `apiVersion` `2026-11-25`, `id` as the dedupe key, `sequence` per resource, `livemode`, and `data.object` / `data.previous`.
   - **Catalogue:** 24 event types (`schemas/webhooks/v2/catalogue.json`), each with a JSON Schema and a fixture.
   - **Signatures:** timestamped HMAC `Waysdrop-Signature: t=…,v1=…` with two-secret rotation (`schemas/webhooks/v2/README.md`, vectors in `fixtures/webhooks/v2/signature.json`).
   - **Delivery:** multiple endpoints per account with event subscriptions; at-least-once delivery with backoff for up to 3 days.
   - **Management:** delivery logs, resend, replay and ping through `/v2/webhooks/*` (12 operations).
   - Money in v2 events is `{ amountMinor: "<integer string>", currency }`.
   - *Migrate (per endpoint, when ready):*
     1. Create a v2 endpoint, or switch your migrated legacy endpoint with `PATCH /v2/webhooks/endpoints/{id}` `{ "format": "v2" }`, and store the `whsec_` secret it returns.
     2. Verify `Waysdrop-Signature` against the raw body, and dedupe on `id`.
     3. Map the event names (`p2p.delivery.created`/`errand.delivery.created` → `delivery.created`, `delivery.request.accepted` → `delivery.assigned`, `delivery.in.transit` → `delivery.in_transit`, `order.confirmed` → `order.accepted`, `payment.received` → `payment.succeeded`, `refund.processed` → `payment.refunded`).
     4. Until you switch, your existing URL keeps receiving the legacy `{event, data}` format and `x-waysdrop-signature`.
2. **Multi-store checkout** (`COMMERCE_V2`): `/v2/checkout-sessions` (create, list, get, update, payment preview, confirm) and `POST /v2/orders/{orderId}/cancel`, for the account that owns the API key. A wallet confirm debits the account's wallet.
3. **New legacy webhook `checkout.paid`** `{checkoutSessionId, orderIds, amount, reference}`. `order.created` and `order.cancelled` may carry `checkoutSessionId`. `refund.processed` is now in the `WebhookEventName` enum (it was already sent).
4. **Error model.**
   - `/v2` errors are RFC 9457-style `Problem` bodies: switch on `code`.
   - `ErrorCode` lists every machine-readable code, and each operation lists its own in `x-error-codes`.
   - `/api/*` keeps its error body, with `details.code` where one exists (`ADDRESS_PIN_MISMATCH`).
5. **Idempotency** on `/v2` writes (`Idempotency-Key`). Keys are scoped per account and API key and replayed for 24 h.
6. **Keyset pagination** on `/v2` lists (`limit` + `cursor` → `page.nextCursor`).
7. **Documented behaviour** that was always true but never written down:
   - **Rate limits:** a global 180/min per IP with `X-RateLimit-*` and `Retry-After`; quotas; the public-key limit (60/min per key and IP).
   - **Unpaid usage:** 402 when API usage is unpaid.
   - **Maintenance:** 400 in maintenance and read-only mode.
   - **Correlation ids:** `X-Correlation-Id` / `X-Request-Id`.
   - **Request bodies:** unknown body fields are stripped.
   - **Test vs live:** staging keys work only on staging, live keys only on live; there is no test mode on live.
8. Every `/api/*` operation now has typed request and response schemas (see below).

### Not exposed to partners in V2 (verified on the server)
- **Multi-stop deliveries** (N pickups → N drop-offs, `/v2/deliveries`) are first-party only at launch. `/api/request` stays one pickup → one drop-off, with no `stops[]`.
- **Negotiation** (offers and counter-offers) and its events are first-party only (planned for V2.1).
- **`/v2/cart`** does not accept API keys. Use `BUY_NOW` checkout sessions.

### `/api/*` operation changes
No `/api/*` route or `operationId` changed, and the server behaviour is unchanged. The spec now types every request and response exactly as the server handles them, which corrects several old entries. **Treat the corrections as breaking only if your code relied on the old, wrong spec.**

- **`DeliveryStatus` corrected (breaking for typed clients).**
  - `ACCEPTED` never existed and is removed.
  - Added `REASSIGNING`, `ORDER_ASSIGNED`, `ORDER_CONFIRMED`, `ORDER_COLLECTED`, `AWAITING_CONFIRMATION` and `PACKAGE_ASSIGNED`.
  - *Migrate:* accept every value; new values may be added.
- **`DeliveryPackageSize`:** `EXTRA_LARGE` never existed and is removed (`SMALL | MEDIUM | LARGE`).
- **`POST /api/package`:** `weight` is not accepted; the server derives it from `size` (2/7/15 kg). `quantity` is an integer from 1 to 999.
- **`POST /api/request`:**
  - The body is `ApiGetRouteData` plus the request fields. The pricing-only fields (`totalWeight`, `totalValue`, `packageType`, `items`, `slot`, `courierProfileId`) are ignored there.
  - Adds `currency` and `externalReference` (duplicate references return the stored delivery).
  - `paymentMethodType`: use `WALLET` or `CHECKOUT`.
  - The response is one of three typed shapes: wallet, checkout or replay.
- **`POST /api/pricing`:** documents `packageType`, `items[]` and `courierIds`. The response is one of two typed shapes, packages mode or totals mode.
- **`POST /api/payments/checkout`:** documents `externalReference` and `inputCurrency`; `amount` uses the 3.1 `exclusiveMinimum: 0`.
- **`GET /api/countries|states|cities`:** `limit` is ignored by the server and has been removed from the spec. Results are capped at 100.
- **`GET /api/deliveries`:** documents the `externalReference` filter. `page`/`limit` are clamped (`limit` ≤ 100), not rejected. The response is `data: { data: [...], meta }` (nested `data`).
- **`DisplayMoney.local`** documents `isStale` and `fromSnapshot`.
- **`?currency=`** is trimmed and upper-cased, then must be 3 letters (400 otherwise).
- **Errors:**
  - Validation 400 `message` is a single string (messages joined with "; ").
  - 503 `MAPS_UPSTREAM_UNAVAILABLE` on route, pricing and request.
  - 400 `DELIVERY_PRICING_BLOCKED` (`details.fleetTypeId`, `details.reason`) on pricing and request.
  - 409 `UPGRADE_REQUIRED` on cancel for a V2 job.
  - 402 when API usage is unpaid.

### Address precision (Maps work, MG-6), carried into 3.0.0

Address precision (Maps work, plan item MG-6). All changes are additive and document behaviour the server already has.

- **Partner address shape, frozen per D26 #14.** New `PartnerAddress` schema (`openapi/partner-api.yaml`, `schemas/common.json`) lists the exact address object sent in webhooks and in `/api/*` responses: the 50 pre-2026-11 `Address` columns, with types and nullability. No other key is ever sent; new address columns (landmark, delivery instructions, Plus Code, pin metadata) reach partners only through a versioned payload. Webhook `origin` / `destination` (`schemas/webhooks/events.json`) now reference it instead of `{ "type": "object" }`, and `GeoLocation` in `schemas/responses.json` is a deprecated alias of it. CTO sign-off: frozen per D26 #14.
- **`RoutePoint` input** (`POST /api/route`, `/api/pricing`, `/api/request`): `origin` / `destination` accept a plain string (max 255) or a `RoutePoint`. Documented range checks: `lat` in [-90, 90], `lon` in [-180, 180], `googlePlaceId` matching `^[A-Za-z0-9_-]{10,512}$`. New optional fields: `pinSource` (`CONFIRMED_PIN | GPS | PLACE | GEOCODE`, also in `schemas/enums.json`), `gpsAccuracyM` (0 to 5000, rounded), `gpsFixAt`, `landmark` (max 120), `deliveryInstructions` (max 500).
- **422 `ADDRESS_PIN_MISMATCH`** on `POST /api/route`, `/api/pricing` and `/api/request`: `details` = `{ code, field: "origin" | "destination", distanceM, suggested: { lat, lng, formattedAddress } }`. New schemas `AddressPinMismatchError`, `AddressPinMismatchDetails`, `SuggestedLocation`.
- `ApiErrorResponse` lists the remaining envelope fields the server already sends (`correlationId`, `method`, `timestamp`, `url`, `environment`, `ip`, `health`).
- Fixtures: `fixtures/partner-address.json`, `fixtures/error-address-pin-mismatch.json`.

### Tooling (spec repo)
- Zero-dependency CI gates:
  - `scripts/selftest.js` tests the validators themselves.
  - `scripts/lint-openapi.js` checks refs, operationIds, path params, security, error-code coverage and response examples.
  - `scripts/validate-fixtures.js` validates every fixture against its schema through `fixtures/manifest.json`, and fails on any unlisted fixture.
  - `scripts/compute-signature-fixture.js` now **verifies** by default; pass `--write` to regenerate.
- New fixtures:
  - `fixtures/problem-*.json`
  - the corrected `fixtures/error-quota.json`
  - `fixtures/webhooks/v2/*`

## 2.1.0

- Public API key prefix (`wsp_pub_live_` / `wsp_pub_staging_`)
- `externalReference` on deliveries and payments
- `GET /api/payments/by-external-reference/{externalReference}`
- Webhook event `refund.processed`

## 2.0.0

- OAuth protocol OpenAPI (`openapi/oauth-protocol.yaml`)
- OAuth JSON Schemas (`schemas/oauth/`)
- OAuth fixtures including shared PKCE test vector

## 1.0.0

- Initial Partner API OpenAPI spec and webhook JSON Schemas
- Shared test fixtures for all SDKs
