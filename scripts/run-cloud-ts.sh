#!/usr/bin/env bash
# Cloud path via TypeScript worker.
# Prefers active memstream_connections (MEMSTREAM_DATABASE_URL) for app DB + CDC.
# Env CDC_S3_BUCKET / DATABASE_URL remain legacy fallbacks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${AWS_REGION:=us-east-1}"

if [[ -z "${MEMSTREAM_DATABASE_URL:-}" && -z "${DATABASE_URL:-}" ]]; then
  echo "Set MEMSTREAM_DATABASE_URL (with a Connect-saved connection) or DATABASE_URL" >&2
  exit 1
fi

if [[ ! -d node_modules/@memstream ]]; then
  npm install --no-fund --no-audit
fi

WATCH_ARGS=()
if [[ "${MEMSTREAM_WATCH:-}" =~ ^(1|true|yes)$ ]]; then
  WATCH_ARGS+=(--watch --poll-interval "${MEMSTREAM_POLL_INTERVAL:-5}")
fi

# Optional legacy overrides — CLI fills from memstream_connections when unset.
EXTRA=()
if [[ -n "${DATABASE_URL:-}" ]]; then
  EXTRA+=(--database-url "$DATABASE_URL")
fi
if [[ -n "${CDC_S3_BUCKET:-}" ]]; then
  EXTRA+=(--s3-bucket "$CDC_S3_BUCKET")
fi
if [[ -n "${CDC_S3_PREFIX:-}" ]]; then
  EXTRA+=(--s3-prefix "$CDC_S3_PREFIX")
fi
# Force file cursor only when explicitly set (normally Memstream DB).
if [[ -n "${MEMSTREAM_STATE_FILE:-}" ]]; then
  EXTRA+=(--state-file "$MEMSTREAM_STATE_FILE")
fi

npm run worker -- \
  --profile "${MEMORY_PROFILE:-commerce}" \
  --source s3 \
  --embedder bedrock \
  --store cockroach \
  --aws-region "$AWS_REGION" \
  "${EXTRA[@]}" \
  "${WATCH_ARGS[@]}"
