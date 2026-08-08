#!/usr/bin/env bash
# Local offline demo: no Cockroach, AWS, or .env required.
# Indexes sample CDC events with a fake embedder into a JSON dump.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d node_modules/@memstream ]]; then
  npm install --no-fund --no-audit
fi

EVENTS="${MEMSTREAM_DEMO_EVENTS:-examples/demo-events.jsonl}"
if [[ ! -f "$EVENTS" ]]; then
  echo "error: missing $EVENTS" >&2
  exit 1
fi

rm -f .memstream-fs-state.json

# Force file profile + local state even when .env points at a remote cluster.
npm run worker -- \
  --profile profiles/commerce.yaml \
  --source jsonl \
  --events "$EVENTS" \
  --embedder fake \
  --store memory \
  --state-file .memstream-fs-state.json \
  --dump-store data/memstream-chunks-ts.json

echo ""
echo "OK — wrote data/memstream-chunks-ts.json"
echo "Next: make web  →  http://127.0.0.1:3000/shop  (in-memory shop, no DB)"
echo "Cloud path: copy .env.example → .env, then docs in README (Cloud path)."
