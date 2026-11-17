# Waysdrop API Spec

Canonical OpenAPI and JSON Schema artifacts for the Waysdrop **Partner API** and outbound webhooks.

This repo is the **contract hub** — not a runtime package. Partners install language SDKs; this repo defines the API shape those SDKs implement.

Licensed under the [MIT License](LICENSE).

## Contents

| Path                          | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `openapi/partner-api.yaml`    | Partner API — `/api/*` (19 ops), `/v2/checkout-sessions` + `/v2/orders` (7), `/v2/webhooks` (12); OpenAPI 3.1 |
| `openapi/oauth-protocol.yaml` | OAuth / OIDC protocol — discovery, token, userinfo, revoke |
| `schemas/common.json`         | Shared types (`DisplayMoney`, envelopes, errors)           |
| `schemas/enums.json`          | Route types, delivery status, package size, etc.           |
| `schemas/responses.json`      | Response DTO shapes                                        |
| `schemas/oauth/`              | OAuth discovery, token, userinfo, error schemas            |
| `schemas/webhooks/`           | Legacy `{event, data}` webhook envelope + event payloads   |
| `schemas/webhooks/v2/`        | Webhooks v2: envelope, catalogue, 24 per-type schemas, signature docs (`README.md`) |
| `schemas/fixtures/`           | Schemas of the shared test-vector files                    |
| `fixtures/`                   | Shared test vectors (signatures, OAuth, envelopes, errors, webhook v2 events); `manifest.json` maps each to its schema |
| `scripts/`                    | Zero-dependency validation (`selftest`, `lint-openapi`, `validate-fixtures`, signature vectors) and export helpers |

## Official SDKs

These libraries implement this spec (v1):

| Language             | Package                           | Repository                                                                 |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Node.js / TypeScript | `@waysdrop/sdk`                   | [waysdrop-node-sdk](https://github.com/WaysdropHQ/waysdrop-node-sdk)       |
| Python               | `waysdrop`                        | [waysdrop-python-sdk](https://github.com/WaysdropHQ/waysdrop-python-sdk)   |
| Go                   | `github.com/waysdrop/waysdrop-go` | [waysdrop-go-sdk](https://github.com/WaysdropHQ/waysdrop-go-sdk)           |
| PHP                  | `waysdrop/sdk`                    | [waysdrop-php-sdk](https://github.com/WaysdropHQ/waysdrop-php-sdk)         |
| Rust                 | `waysdrop`                        | [waysdrop-rust-sdk](https://github.com/WaysdropHQ/waysdrop-rust-sdk)       |
| Dart / Flutter       | `waysdrop`                        | [waysdrop-flutter-sdk](https://github.com/WaysdropHQ/waysdrop-flutter-sdk) |

OAuth (Sign in with Waysdrop) is specified in `openapi/oauth-protocol.yaml` and `schemas/oauth/`.

## Validation

```bash
chmod +x scripts/*.sh
./scripts/validate-schemas.sh            # everything below, in order
node scripts/selftest.js                 # tests the zero-dependency YAML parser and JSON Schema validator
node scripts/lint-openapi.js             # refs, operationIds, path params, security, x-error-codes ⊆ ErrorCode
node scripts/validate-fixtures.js        # every fixture against its schema (fixtures/manifest.json)
node scripts/compute-signature-fixture.js          # verify signature vectors
node scripts/compute-signature-fixture.js --write  # regenerate them (intentional changes only)
```

Node ≥ 18 and nothing else: no `npm install`. CI runs the same checks on every push and pull request.

## Export from running server

Regenerate OpenAPI from a live `waysdrop-server` instance, then diff against `openapi/partner-api.yaml`:

```bash
SWAGGER_API_PASS=your_password ./scripts/export-openapi.sh
```

Only commit changes that reflect intentional API updates.

## Webhook signatures

**v2** (endpoints with `format: "v2"`): `Waysdrop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(endpoint secret, t + "." + rawBody)>[,v1=…]`, one `v1` per active secret during a rotation, 300 s tolerance. Full rules and error codes: `schemas/webhooks/v2/README.md`; vectors: `fixtures/webhooks/v2/signature.json`.

**Legacy** (`{event, data}` endpoints): `x-waysdrop-signature` = hex `HMAC-SHA256(rawBody, apiSecretKey)`, no timestamp. Vector: `fixtures/signature.json`.

Verify against **raw request bytes**, never re-serialized JSON. Each SDK vendors the fixtures under its own `tests/` (or `test/`) directory for standalone CI.

## Proposing API changes

1. Update `openapi/partner-api.yaml` and relevant files under `schemas/`.
2. Add or update fixtures if behavior changes (especially webhook signatures).
3. Run `./scripts/validate-schemas.sh`. Add every new fixture to `fixtures/manifest.json`, list every error code an operation can return in its `x-error-codes` and in `components.schemas.ErrorCode` (enum + `x-enum-descriptions`); the lint fails when they drift.
4. Open a PR in this repo; tag a spec release (`v1.x.x`) when merged.
5. Update affected SDKs and publish new SDK patch versions.

**Rule:** spec first, SDKs second. Never ship SDK typing or method changes without a matching spec change (or a documented exception in CHANGELOG).

## Versioning

Spec releases use git tags: `v1.0.0`, `v1.1.0`, `v2.0.0` (OAuth).

| Spec tag | Scope                            |
| -------- | -------------------------------- |
| v1.x     | Partner API + webhooks           |
| v2.x     | OAuth protocol schemas           |
| v3.x     | Waysdrop V2 (D22): `/v2` operations, webhooks v2, error model |

See [CHANGELOG.md](CHANGELOG.md).
