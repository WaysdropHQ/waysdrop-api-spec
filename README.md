# Waysdrop API Spec

Canonical OpenAPI and JSON Schema artifacts for the Waysdrop **Partner API** and outbound webhooks.

This repo is the **contract hub** — not a runtime package. Partners install language SDKs; this repo defines the API shape those SDKs implement.

Licensed under the [MIT License](LICENSE).

## Contents

| Path                          | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `openapi/partner-api.yaml`    | Partner API (`/api/*`) — 18 endpoints, OpenAPI 3.1         |
| `openapi/oauth-protocol.yaml` | OAuth / OIDC protocol — discovery, token, userinfo, revoke |
| `schemas/common.json`         | Shared types (`DisplayMoney`, envelopes, errors)           |
| `schemas/enums.json`          | Route types, delivery status, package size, etc.           |
| `schemas/responses.json`      | Response DTO shapes                                        |
| `schemas/oauth/`              | OAuth discovery, token, userinfo, error schemas            |
| `schemas/webhooks/`           | Webhook envelope + 19 event payloads                       |
| `fixtures/`                   | Shared test vectors (signature, OAuth, envelopes, errors)  |
| `scripts/`                    | Validation and export helpers                              |

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

OAuth (Sign in with Waysdrop) schemas will land here in **v2** before SDK OAuth modules ship.

## Validation

```bash
chmod +x scripts/*.sh
./scripts/validate-schemas.sh
node scripts/compute-signature-fixture.js
```

CI runs the same checks on every push to `main`.

## Export from running server

Regenerate OpenAPI from a live `waysdrop-server` instance, then diff against `openapi/partner-api.yaml`:

```bash
SWAGGER_API_PASS=your_password ./scripts/export-openapi.sh
```

Only commit changes that reflect intentional API updates.

## Webhook signature

Waysdrop signs outbound webhooks with:

```
HMAC-SHA256(rawBody, apiKey) → hex digest
```

Header: `x-waysdrop-signature`

Verify against **raw request bytes**, never re-serialized JSON. The canonical test vector is `fixtures/signature.json`. Each SDK vendors a copy under its own `tests/` (or `test/`) directory for standalone CI.

## Proposing API changes

1. Update `openapi/partner-api.yaml` and relevant files under `schemas/`.
2. Add or update fixtures if behavior changes (especially webhook signatures).
3. Run `./scripts/validate-schemas.sh`.
4. Open a PR in this repo; tag a spec release (`v1.x.x`) when merged.
5. Update affected SDKs and publish new SDK patch versions.

**Rule:** spec first, SDKs second. Never ship SDK typing or method changes without a matching spec change (or a documented exception in CHANGELOG).

## Versioning

Spec releases use git tags: `v1.0.0`, `v1.1.0`, `v2.0.0` (OAuth).

| Spec tag | Scope                            |
| -------- | -------------------------------- |
| v1.x     | Partner API + webhooks           |
| v2.x     | OAuth protocol schemas (planned) |

See [CHANGELOG.md](CHANGELOG.md).
