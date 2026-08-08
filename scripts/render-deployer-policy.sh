#!/usr/bin/env bash
# Render deployer IAM policy and attach as a customer managed policy.
#
# Do not use put-user-policy: IAM users share a 2048-byte total for all inline
# policies; this document is ~3.5KB. Managed policies allow 6KB.
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

USER_NAME="${MEMSTREAM_IAM_USER:-memstream-dev}"
POLICY_NAME="${MEMSTREAM_DEPLOYER_POLICY_NAME:-MemstreamDeployer}"

# shellcheck disable=SC2016
sed "s/\${CDC_S3_BUCKET}/${BUCKET}/g" \
  infra/deployer-policy.json.template >infra/deployer-policy.json

bytes="$(wc -c <infra/deployer-policy.json | tr -d ' ')"
echo "Wrote infra/deployer-policy.json ($bytes bytes) for s3://${BUCKET}"
echo ""
echo "Attach as a customer managed policy:"
echo ""
echo "  ACCOUNT=\$(aws sts get-caller-identity --query Account --output text)"
echo "  POLICY_ARN=\"arn:aws:iam::\${ACCOUNT}:policy/${POLICY_NAME}\""
echo "  if aws iam get-policy --policy-arn \"\$POLICY_ARN\" >/dev/null 2>&1; then"
echo "    aws iam create-policy-version --policy-arn \"\$POLICY_ARN\" \\"
echo "      --policy-document file://infra/deployer-policy.json --set-as-default"
echo "  else"
echo "    aws iam create-policy --policy-name ${POLICY_NAME} \\"
echo "      --policy-document file://infra/deployer-policy.json"
echo "  fi"
echo "  aws iam attach-user-policy --user-name ${USER_NAME} --policy-arn \"\$POLICY_ARN\""
echo ""
echo "Or: MEMSTREAM_ATTACH_DEPLOYER_POLICY=1 bash scripts/render-deployer-policy.sh"
echo ""

if [[ "${MEMSTREAM_ATTACH_DEPLOYER_POLICY:-}" == "1" ]]; then
  echo "MEMSTREAM_ATTACH_DEPLOYER_POLICY=1 — attaching now…"
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  POLICY_ARN="arn:aws:iam::${ACCOUNT}:policy/${POLICY_NAME}"

  if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
    aws iam create-policy-version \
      --policy-arn "$POLICY_ARN" \
      --policy-document file://infra/deployer-policy.json \
      --set-as-default
  else
    aws iam create-policy \
      --policy-name "$POLICY_NAME" \
      --policy-document file://infra/deployer-policy.json
  fi

  aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"
  echo "Attached $POLICY_ARN → user $USER_NAME"
fi
