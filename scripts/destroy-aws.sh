#!/usr/bin/env bash
# Delete the Memstream EC2 CloudFormation stack.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${MEMSTREAM_ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

: "${AWS_REGION:=us-east-1}"
STACK_NAME="${STACK_NAME:-memstream-demo}"

echo "Deleting stack ${STACK_NAME} in ${AWS_REGION}"
aws cloudformation delete-stack --region "$AWS_REGION" --stack-name "$STACK_NAME"
aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name "$STACK_NAME"
echo "Deleted ${STACK_NAME}"
