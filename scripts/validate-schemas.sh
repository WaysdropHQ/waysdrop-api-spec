#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEC="$ROOT/openapi/partner-api.yaml"
EVENTS="$ROOT/schemas/enums.json"

required_paths=(
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
)

echo "Validating partner-api.yaml paths..."
for path in "${required_paths[@]}"; do
  if ! grep -q "$path:" "$SPEC"; then
    echo "MISSING path: $path"
    exit 1
  fi
done

echo "Validating webhook event catalog..."
event_count=$(node -e "
  const e = require('$EVENTS');
  console.log(e.definitions.WebhookEventName.enum.length);
")
if [[ "$event_count" -lt 19 ]]; then
  echo "Expected at least 19 webhook events, found $event_count"
  exit 1
fi

echo "Contract validation passed."
