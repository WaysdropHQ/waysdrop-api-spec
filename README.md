# Waysdrop API Spec

Canonical OpenAPI and JSON Schema artifacts for Waysdrop Partner SDKs.

Licensed under the [MIT License](LICENSE).

## Contents

- `openapi/partner-api.yaml` — Partner API (`/api/*`) OpenAPI 3.1 spec
- `schemas/` — Shared JSON Schemas (common types, enums, webhook events)
- `fixtures/` — Test vectors shared across all SDK test suites
- `scripts/` — Export and validation scripts

## Validation

```bash
chmod +x scripts/*.sh
./scripts/validate-schemas.sh
```

## Export from running server

```bash
SWAGGER_API_PASS=your_password ./scripts/export-openapi.sh
```

## Webhook signature

Waysdrop signs outbound webhooks with:

```
HMAC-SHA256(rawBody, apiKey) → hex digest
```

Header: `x-waysdrop-signature`

Verify against **raw request bytes**, never re-serialized JSON.
