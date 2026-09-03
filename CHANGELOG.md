# Changelog

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
