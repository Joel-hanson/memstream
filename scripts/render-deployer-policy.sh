#!/usr/bin/env bash
# Render infra/deployer-policy.json from template using CDC_S3_BUCKET.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a
fi

BUCKET="${CDC_S3_BUCKET:-}"
if [[ -z "$BUCKET" ]]; then
  echo "Set CDC_S3_BUCKET in the environment or .env" >&2
  exit 1
fi
if [[ ! "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "CDC_S3_BUCKET looks invalid: $BUCKET" >&2
  exit 1
fi

# shellcheck disable=SC2016
sed "s/\${CDC_S3_BUCKET}/${BUCKET}/g" \
  infra/deployer-policy.json.template > infra/deployer-policy.json

echo "Wrote infra/deployer-policy.json for bucket s3://${BUCKET}"
echo "Attach with: aws iam put-user-policy --user-name YOUR_USER --policy-name memstream-deployer --policy-document file://infra/deployer-policy.json"
