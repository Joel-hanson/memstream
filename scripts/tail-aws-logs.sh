#!/usr/bin/env bash
# Stream Memstream AWS logs into one terminal (Heroku/Fly-style).
# Sources (whichever exist):
#   - Lambda worker → CloudWatch /aws/lambda/<stack>-lambda-worker
#   - EC2 shop/watch → journalctl via SSM (no CloudWatch agent required)
#
# Usage:
#   make logs
#   make logs LOGS=lambda
#   make logs LOGS=ec2
#   bash scripts/tail-aws-logs.sh [--lambda|--ec2|--all]
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
LAMBDA_STACK="${LAMBDA_STACK_NAME:-${STACK_NAME}-lambda}"
MODE="${LOGS:-all}"

usage() {
  cat <<'EOF'
Usage: bash scripts/tail-aws-logs.sh [--all|--lambda|--ec2] [-h]

Streams Lambda CloudWatch + EC2 journalctl into one terminal with prefixes.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) MODE=all ;;
    --lambda) MODE=lambda ;;
    --ec2) MODE=ec2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  all|lambda|ec2) ;;
  *)
    echo "LOGS must be all, lambda, or ec2 (got: $MODE)" >&2
    exit 1
    ;;
esac

cfn_output() {
  local stack="$1" key="$2"
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue | [0]" \
    --output text 2>/dev/null || true
}

stack_exists() {
  local stack="$1" status
  status="$(aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$stack" \
    --query 'Stacks[0].StackStatus' \
    --output text 2>/dev/null || true)"
  [[ -n "$status" && "$status" != "None" && ! "$status" =~ ^DELETE_ ]]
}

prefix_lines() {
  local tag="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Session Manager plugin noise
    case "$line" in
      Starting\ session\ with\ SessionId:*|Exiting\ session\ with\ sessionId:*) continue ;;
    esac
    printf '%s %s\n' "$tag" "$line"
  done
}

cleanup() {
  trap - EXIT INT TERM
  # Tear down pipeline children (aws + sed/prefix) in this process group.
  local pid
  for pid in $(jobs -pr 2>/dev/null); do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

STARTED=0

# --- Lambda (CloudWatch) ---
if [[ "$MODE" == "all" || "$MODE" == "lambda" ]]; then
  LAMBDA_FN=""
  if stack_exists "$LAMBDA_STACK"; then
    LAMBDA_FN="$(cfn_output "$LAMBDA_STACK" FunctionName)"
  fi
  if [[ -z "$LAMBDA_FN" || "$LAMBDA_FN" == "None" ]]; then
    LAMBDA_FN="${STACK_NAME}-lambda-worker"
  fi
  LAMBDA_GROUP="/aws/lambda/${LAMBDA_FN}"

  if aws logs describe-log-groups \
    --region "$AWS_REGION" \
    --log-group-name-prefix "$LAMBDA_GROUP" \
    --query "logGroups[?logGroupName=='${LAMBDA_GROUP}'].logGroupName | [0]" \
    --output text 2>/dev/null | grep -qx "$LAMBDA_GROUP"
  then
    echo "→ lambda  ${LAMBDA_GROUP}" >&2
    aws logs tail "$LAMBDA_GROUP" \
      --region "$AWS_REGION" \
      --follow \
      --format short \
      2>&1 | prefix_lines "lambda |" &
    STARTED=1
  else
    echo "· lambda  (no log group yet: ${LAMBDA_GROUP})" >&2
  fi
fi

# --- EC2 (SSM → journalctl) ---
if [[ "$MODE" == "all" || "$MODE" == "ec2" ]]; then
  INSTANCE_ID=""
  if stack_exists "$STACK_NAME"; then
    INSTANCE_ID="$(cfn_output "$STACK_NAME" InstanceId)"
  fi
  if [[ -n "$INSTANCE_ID" && "$INSTANCE_ID" != "None" ]]; then
    if ! command -v session-manager-plugin >/dev/null 2>&1; then
      echo "· ec2     instance ${INSTANCE_ID} found, but session-manager-plugin is missing." >&2
      echo "         Install: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" >&2
      echo "         Or: aws ssm start-session --target ${INSTANCE_ID} --region ${AWS_REGION}" >&2
      echo "         then: sudo journalctl -u memstream-shop -u memstream-watch -f" >&2
    else
      echo "→ ec2     ${INSTANCE_ID} (memstream-shop, memstream-watch)" >&2
      # SSM runs as ssm-user (no journal ACL); sudo is required. -o cat drops metadata.
      aws ssm start-session \
        --target "$INSTANCE_ID" \
        --region "$AWS_REGION" \
        --document-name AWS-StartNonInteractiveCommand \
        --parameters '{"command":["sudo journalctl -u memstream-shop -u memstream-watch -f --no-pager -o cat"]}' \
        2>&1 | prefix_lines "ec2    |" &
      STARTED=1
    fi
  else
    echo "· ec2     (no running stack ${STACK_NAME})" >&2
  fi
fi

if [[ "$STARTED" -eq 0 ]]; then
  echo "No log sources available. Deploy Lambda and/or EC2 first (see docs/AWS.md)." >&2
  exit 1
fi

echo "Streaming… Ctrl-C to stop" >&2
wait
