# Waysdrop webhooks v2 (apiVersion `2026-11-25`)

Normative for the six SDKs and `waysdrop-docs`. Server source: `src/modules/partner-webhooks` (branch `v2-webhooks`), contract `.v2-review/v2/contracts/webhooks.md` v0.2. Dark behind the server flag `PARTNER_WEBHOOKS_V2`, evaluated per partner account.

| File | What it is |
| --- | --- |
| `envelope.json` | The envelope every v2 event shares (any type) |
| `<type>.v1.json` | One self-contained schema per event type: the envelope plus the exact `data.object` |
| `catalogue.json` | Machine-readable list: type, object kind, description, emitted-when, `status`, schema and fixture |
| `../../../fixtures/webhooks/v2/<type>.json` | One example event per type; CI validates each against its schema |
| `../../../fixtures/webhooks/v2/signature.json` | Signing and verification vectors every SDK must pass |

The legacy `{ event, data }` format (`../envelope.json`, `../events.json`) stays valid per endpoint until the partner switches that endpoint to `format: "v2"`.

## Request

`POST <your https endpoint>`, body = the envelope (UTF-8 JSON, no trailing newline).

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `Waysdrop-Webhooks/2.0` |
| `Waysdrop-Event-Id` | `evt_<uuidv7>`, equal to the body `id` (the dedupe key) |
| `Waysdrop-Event-Type` | for example `delivery.collected` |
| `Waysdrop-Delivery-Id` | UUID of this delivery attempt series (one event to one endpoint); stable across retries |
| `Waysdrop-Delivery-Attempt` | `1`, `2`, … |
| `Waysdrop-Signature` | `t=<unix seconds>,v1=<hex>[,v1=<hex>]` |

## Envelope

```json
{
  "id": "evt_0193b2f4-1c2d-7a3b-9c4d-5e6f7a8b9c0d",
  "type": "delivery.collected",
  "apiVersion": "2026-11-25",
  "createdAt": "2026-11-25T10:00:00.000Z",
  "livemode": true,
  "account": { "id": "<partner account (user) id>" },
  "sequence": 3,
  "data": { "object": { "object": "delivery", "id": "…" }, "previous": { "status": "…" } }
}
```

- **At least once.** Store `id` and ignore a repeat.
- **Ordering is best effort.** `sequence` is monotonic per resource (`data.object.object` + `data.object.id`) and follows commit order. Keep the highest value applied per resource and drop anything lower.
- `livemode` is `true` on the live API and `false` on staging. There are no test keys on live: staging is the test environment.
- `data.object` is the full snapshot at the time of the event; `data.previous` holds only the changed fields, when known.
- **Money** is always `{ "amountMinor": "150000", "currency": "NGN" }`: integer minor units **as a decimal string** (it can exceed 2^53). Parse it with a big-integer or decimal type, never a float.
- **Addresses** are a fixed 17-field projection (`$defs/Address`): `city` (from the stored `lgaOrCity`) and `lng` (from `lon`). They are not the `PartnerAddress` shape of the REST API and legacy webhooks.
- Payloads never contain proof, collection or delivery codes, proof images, IP addresses, courier contact details, or personal data beyond the contact fields the partner itself supplied.

## Signature

```
signed_payload = t + "." + rawBody
v1             = lowercase hex( HMAC-SHA256( key = endpoint secret "whsec_…", message = signed_payload ) )
Waysdrop-Signature: t=1764064800,v1=<current secret>,v1=<previous secret, during a rotation only>
```

Verification, in this order (each failure has a stable code; see `signature.json`):

1. Header absent or empty → `MISSING_HEADER`.
2. No non-empty secret configured → `NO_SECRETS`.
3. Parse comma-separated `key=value` pairs. `t` must be 1–12 digits, else `MALFORMED_HEADER`. Keep `v1` values that are 64 lowercase hex characters (at most 8); ignore any other key (a future `v2=` scheme). Header over 1024 characters, or no `t`, or no usable `v1` → `MALFORMED_HEADER`.
4. `|now − t| > tolerance` (default 300 s, inclusive boundary) → `TIMESTAMP_OUT_OF_TOLERANCE`.
5. Compute the HMAC over the **raw body bytes** for every configured secret and compare against every `v1` in constant time, without stopping at the first match. None match → `SIGNATURE_MISMATCH`.
6. Parse the body as JSON → else `INVALID_JSON`.

Never verify a re-serialised body: frameworks that parse JSON first must expose the raw bytes. SDK surface (identical in all six): `verifyWebhook(rawBody, signatureHeader, secrets[], toleranceSec = 300, now?) → Event`, raising a typed error carrying one of the six codes.

**Secrets.** Format `whsec_` + 43 base64url characters. Shown once, on create, on rotate, and when a legacy endpoint is switched to `v2`. A rotation keeps the previous secret signing for `expiresInSeconds` (default 86400, max 604800, `0` stops it at once), so configure both secrets during the window.

## Responses and retries

| Your response | Result |
| --- | --- |
| any 2xx within 10 s | success |
| `410 Gone` | endpoint disabled (`disabledReason: "gone"`), account emailed, no more attempts |
| other 3xx, 4xx or 5xx, timeout, DNS, TLS or connect error | retried |

- Redirects are not followed. Only the first 64 KiB of your response is read; the first 1 KiB is kept in the delivery log.
- Backoff with full jitter: attempt *n* waits `uniform(5 s, cap)` with caps 1 min, 5 min, 30 min, 2 h, then 6 h, for up to 3 days from the first attempt (about 25 attempts, hard cap 40). Then the delivery is `failed`.
- An endpoint that fails continuously for 3 days is disabled (`disabledReason: "failing"`). Re-enable it with `PATCH /v2/webhooks/endpoints/{id}` `{"status":"enabled"}`, then replay.
- At most 4 concurrent requests per endpoint.
- Endpoint URLs must be `https`, without credentials, on port 443 or 1024–65535. The host is resolved at send time; loopback, private, link-local, CGNAT, multicast, reserved and cloud-metadata addresses are refused (`URL_REFUSED`, final).

Endpoints, secrets, delivery logs, resend, replay and ping are managed through `/v2/webhooks/*` in `openapi/partner-api.yaml`.
