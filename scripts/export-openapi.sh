#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/openapi/partner-api.yaml"
BASE_URL="${WAYSDROP_API_URL:-https://staging-api.waysdrop.com}"
SWAGGER_USER="${SWAGGER_API_USER:-api}"
SWAGGER_PASS="${SWAGGER_API_PASS:-}"

if [[ -z "$SWAGGER_PASS" ]]; then
  echo "Set SWAGGER_API_PASS to export from live/staging /api-docs-json"
  echo "Using committed partner-api.yaml as fallback."
  exit 0
fi

curl -sf -u "$SWAGGER_USER:$SWAGGER_PASS" \
  "$BASE_URL/api-docs-json" \
  | node -e "
    const fs = require('fs');
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      const doc = JSON.parse(data);
      fs.writeFileSync('$OUT'.replace('.yaml', '.json'), JSON.stringify(doc, null, 2));
      console.log('Exported to openapi/partner-api.json');
    });
  "
