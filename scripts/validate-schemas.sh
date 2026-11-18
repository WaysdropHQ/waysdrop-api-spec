#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARTNER_SPEC="$ROOT/openapi/partner-api.yaml"
OAUTH_SPEC="$ROOT/openapi/oauth-protocol.yaml"
EVENTS="$ROOT/schemas/enums.json"

required_partner_paths=(
  "/api/countries"
  "/api/states"
  "/api/cities"
  "/api/route"
  "/api/fleet-types"
  "/api/pricing"
  "/api/request"
  "/api/package"
  "/api/packages"
  "/api/wallet"
  "/api/payments/checkout"
  "/api/account"
  "/api/exchange-rate"
  "/api/convert"
  "/api/deliveries"
  "/api/deliveries/{deliveryId}"
  "/api/request/{deliveryId}/cancel"
  "/api/package/{packageId}"
  "/api/payments/by-external-reference/{externalReference}"
  "/v2/checkout-sessions"
  "/v2/checkout-sessions/{id}"
  "/v2/checkout-sessions/{id}/confirm"
  "/v2/orders/{orderId}/cancel"
  "/v2/webhooks/endpoints"
  "/v2/webhooks/endpoints/{id}"
  "/v2/webhooks/deliveries/{id}/resend"
)

required_oauth_paths=(
  "/oauth/.well-known/openid-configuration"
  "/oauth/authorize"
  "/oauth/token"
  "/oauth/revoke"
  "/oauth/userinfo"
)

required_oauth_schemas=(
  "discovery.json"
  "token-response.json"
  "revoke-response.json"
  "userinfo-response.json"
  "error-response.json"
  "enums.json"
)

required_oauth_fixtures=(
  "oauth-discovery.json"
  "oauth-token-response.json"
  "oauth-userinfo-profile.json"
  "oauth-pkce.json"
)

echo "Validating partner-api.yaml paths..."
for path in "${required_partner_paths[@]}"; do
  if ! grep -qF "    $path:" "$PARTNER_SPEC"; then
    echo "MISSING path: $path"
    exit 1
  fi
done

echo "Validating oauth-protocol.yaml paths..."
for path in "${required_oauth_paths[@]}"; do
  if ! grep -qF "    $path:" "$OAUTH_SPEC"; then
    echo "MISSING OAuth path: $path"
    exit 1
  fi
done

echo "Validating OAuth JSON schemas..."
for schema in "${required_oauth_schemas[@]}"; do
  if [[ ! -f "$ROOT/schemas/oauth/$schema" ]]; then
    echo "MISSING OAuth schema: $schema"
    exit 1
  fi
  node -e "JSON.parse(require('fs').readFileSync('$ROOT/schemas/oauth/$schema','utf8'))"
done

echo "Validating OAuth fixtures..."
for fixture in "${required_oauth_fixtures[@]}"; do
  if [[ ! -f "$ROOT/fixtures/$fixture" ]]; then
    echo "MISSING OAuth fixture: $fixture"
    exit 1
  fi
  node -e "JSON.parse(require('fs').readFileSync('$ROOT/fixtures/$fixture','utf8'))"
done

echo "Validating PKCE fixture vector..."
node -e "
const crypto = require('crypto');
const fs = require('fs');
const pkce = JSON.parse(fs.readFileSync('$ROOT/fixtures/oauth-pkce.json','utf8'));
const digest = crypto.createHash('sha256').update(pkce.code_verifier).digest('base64url');
if (digest !== pkce.code_challenge) {
  console.error('PKCE vector mismatch');
  process.exit(1);
}
"

echo "Validating webhook event catalog..."
event_count=$(node -e "
  const e = require('$EVENTS');
  console.log(e.definitions.WebhookEventName.enum.length);
")
if [[ "$event_count" -lt 22 ]]; then
  echo "Expected at least 22 legacy webhook events, found $event_count"
  exit 1
fi

echo "Self-testing the zero-dependency validators..."
node "$ROOT/scripts/selftest.js"

echo "Linting OpenAPI documents..."
node "$ROOT/scripts/lint-openapi.js"

echo "Validating every fixture against its schema..."
node "$ROOT/scripts/validate-fixtures.js"

echo "Verifying webhook signature vectors (legacy + v2)..."
node "$ROOT/scripts/compute-signature-fixture.js"

echo "Contract validation passed."
