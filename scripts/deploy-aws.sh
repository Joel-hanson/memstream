#!/usr/bin/env bash
# Package prebuilt linux artifact → S3, then create/update the Memstream EC2 stack.
# Prefer Enable in the Next console (in-app AWS SDK). Keep this script for CLI/ops.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Prefer console/session env when set; otherwise repo .env
ENV_FILE="${MEMSTREAM_ENV_FILE:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ENV_FILE"
  set +a
fi

: "${MEMSTREAM_DATABASE_URL:?Set MEMSTREAM_DATABASE_URL in .env (platform DB)}"
: "${CDC_S3_BUCKET:?Set CDC_S3_BUCKET in .env}"
: "${AWS_REGION:=us-east-1}"

if [[ -z "${MEMSTREAM_SECRETS_KEY:-}" ]]; then
  echo "WARN: MEMSTREAM_SECRETS_KEY unset — Connect/Enable on EC2 cannot encrypt connection secrets" >&2
  echo "      Set MEMSTREAM_SECRETS_KEY=\$(openssl rand -hex 32) in .env before deploy" >&2
fi

# Match prebuild platform to EC2 arch. arm64 Colima + qemu amd64 crashes next build (SIGSEGV).
DOCKER_ARCH="$(docker info --format '{{.Architecture}}' 2>/dev/null || true)"
if [[ -z "${MEMSTREAM_DEPLOY_PLATFORM:-}" ]]; then
  if [[ "$DOCKER_ARCH" == "aarch64" || "$DOCKER_ARCH" == "arm64" ]]; then
    export MEMSTREAM_DEPLOY_PLATFORM=linux/arm64
  else
    export MEMSTREAM_DEPLOY_PLATFORM=linux/amd64
  fi
fi
if [[ -z "${INSTANCE_TYPE:-}" ]]; then
  if [[ "$MEMSTREAM_DEPLOY_PLATFORM" == "linux/arm64" ]]; then
    export INSTANCE_TYPE=t4g.micro
  else
    export INSTANCE_TYPE=t3.micro
  fi
fi
case "$INSTANCE_TYPE" in
  t4g.*)
    if [[ "$MEMSTREAM_DEPLOY_PLATFORM" != "linux/arm64" ]]; then
      echo "error: ${INSTANCE_TYPE} is arm64 but MEMSTREAM_DEPLOY_PLATFORM=${MEMSTREAM_DEPLOY_PLATFORM}" >&2
      echo "Use MEMSTREAM_DEPLOY_PLATFORM=linux/arm64 (or unset INSTANCE_TYPE)" >&2
      exit 1
    fi
    ;;
  t3.*|t2.*)
    if [[ "$MEMSTREAM_DEPLOY_PLATFORM" != "linux/amd64" ]]; then
      echo "error: ${INSTANCE_TYPE} is x86_64 but MEMSTREAM_DEPLOY_PLATFORM=${MEMSTREAM_DEPLOY_PLATFORM}" >&2
      echo "Use INSTANCE_TYPE=t4g.micro with linux/arm64, or MEMSTREAM_DEPLOY_PLATFORM=linux/amd64" >&2
      exit 1
    fi
    ;;
esac
echo "Deploy target: platform=${MEMSTREAM_DEPLOY_PLATFORM} instance=${INSTANCE_TYPE}"

# Application URL is optional: Connect UI stores it in memstream_connections.
# If DATABASE_URL is unset, try the active Connect row (for baking a fallback on EC2).
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL unset — loading active Connect application URL (if any)…"
  npm run build -w @memstream/engine --silent
  DATABASE_URL="$(
    node --input-type=module -e '
      import { getActiveConnection } from "./packages/engine/dist/connections.js";
      const c = await getActiveConnection();
      if (c?.database_url) process.stdout.write(c.database_url);
    '
  )" || true
  if [[ -n "${DATABASE_URL}" ]]; then
    export DATABASE_URL
    echo "Using Connect application URL"
  else
    echo "No Connect application URL yet — EC2 will resolve via MEMSTREAM_DATABASE_URL"
  fi
fi

STACK_NAME="${STACK_NAME:-memstream-demo}"
DEPLOY_KEY="${DEPLOY_OBJECT_KEY:-deploy/memstream-prebuilt.tgz}"
TEMPLATE="$ROOT/infra/ec2.yaml"
PARAMS_FILE="$(mktemp)"
cleanup() {
  rm -f "$PARAMS_FILE"
  if [[ -n "${TARBALL:-}" && -f "${TARBALL:-}" ]]; then
    rm -f "$TARBALL"
  fi
}
trap cleanup EXIT

# Bundle Cockroach CA so EC2 uses PGSSLROOTCERT=/opt/memstream/certs/root.crt
CERT_SRC="${MEMSTREAM_SSLROOTCERT:-${PGSSLROOTCERT:-}}"
if [[ -z "$CERT_SRC" || ! -f "$CERT_SRC" ]]; then
  CERT_SRC=""
  for url_var in DATABASE_URL MEMSTREAM_DATABASE_URL; do
    url_val="${!url_var:-}"
    if [[ -n "$url_val" ]]; then
      CERT_SRC="$(
        URL="$url_val" python3 - <<'PY'
import os, re, urllib.parse
url = os.environ.get("URL", "")
m = re.search(r"[?&]sslrootcert=([^&]*)", url, re.I)
if m:
    p = urllib.parse.unquote(m.group(1))
    print(p)
PY
      )"
      if [[ -n "$CERT_SRC" && -f "$CERT_SRC" ]]; then
        break
      fi
      CERT_SRC=""
    fi
  done
fi
if [[ -z "$CERT_SRC" || ! -f "$CERT_SRC" ]]; then
  CERT_SRC="${HOME}/.postgresql/root.crt"
fi
if [[ -f "$CERT_SRC" ]]; then
  mkdir -p "$ROOT/certs"
  cp "$CERT_SRC" "$ROOT/certs/root.crt"
  echo "Bundled CA → certs/root.crt (from ${CERT_SRC})"
else
  echo "WARN: no Cockroach CA at PGSSLROOTCERT / ~/.postgresql/root.crt — run make cockroach-ca" >&2
fi

# Prefer open demo access unless the user set SHOP_CIDR (e.g. YOUR_IP/32).
: "${SHOP_CIDR:=0.0.0.0/0}"
export SHOP_CIDR
echo "Shop security group CIDR: ${SHOP_CIDR}"

echo "Packaging prebuilt artifact → s3://${CDC_S3_BUCKET}/${DEPLOY_KEY}"
TARBALL="$(bash "$ROOT/scripts/package-prebuilt.sh")"
aws s3 cp "$TARBALL" "s3://${CDC_S3_BUCKET}/${DEPLOY_KEY}" --region "$AWS_REGION"

python3 - <<PY >"$PARAMS_FILE"
import json, os
params = [
  {"ParameterKey": "CdcS3Bucket", "ParameterValue": os.environ["CDC_S3_BUCKET"]},
  {"ParameterKey": "CdcS3Prefix", "ParameterValue": os.environ.get("CDC_S3_PREFIX", "cdc/")},
  {"ParameterKey": "DeployObjectKey", "ParameterValue": os.environ.get("DEPLOY_OBJECT_KEY", "deploy/memstream-prebuilt.tgz")},
  {"ParameterKey": "DatabaseUrl", "ParameterValue": os.environ.get("DATABASE_URL", "")},
  {"ParameterKey": "MemstreamDatabaseUrl", "ParameterValue": os.environ.get("MEMSTREAM_DATABASE_URL", "")},
  {"ParameterKey": "MemstreamSecretsKey", "ParameterValue": os.environ.get("MEMSTREAM_SECRETS_KEY", "")},
  {"ParameterKey": "MemstreamWorkerCompute", "ParameterValue": "lambda" if os.environ.get("MEMSTREAM_WORKER_COMPUTE", "").strip().lower() == "lambda" else "ec2"},
  {"ParameterKey": "BedrockEmbedModel", "ParameterValue": os.environ.get("BEDROCK_EMBED_MODEL", "amazon.titan-embed-text-v2:0")},
  {"ParameterKey": "MemoryProfile", "ParameterValue": os.environ.get("MEMORY_PROFILE", "commerce")},
  {"ParameterKey": "InstanceType", "ParameterValue": os.environ.get("INSTANCE_TYPE", "t3.micro")},
  {"ParameterKey": "ShopCidr", "ParameterValue": os.environ.get("SHOP_CIDR", "0.0.0.0/0")},
]
if os.environ.get("KEY_NAME"):
  params.append({"ParameterKey": "KeyName", "ParameterValue": os.environ["KEY_NAME"]})
print(json.dumps(params))
PY

status="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || true)"

if [[ -z "$status" || "$status" == "DELETE_COMPLETE" ]]; then
  echo "Creating stack ${STACK_NAME} in ${AWS_REGION}"
  aws cloudformation create-stack \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --template-body "file://${TEMPLATE}" \
    --capabilities CAPABILITY_IAM \
    --parameters "file://${PARAMS_FILE}"
  aws cloudformation wait stack-create-complete \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME"
else
  echo "Updating stack ${STACK_NAME} (status=${status})"
  rc=0
  set +e
  out="$(aws cloudformation update-stack \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --template-body "file://${TEMPLATE}" \
    --capabilities CAPABILITY_IAM \
    --parameters "file://${PARAMS_FILE}" 2>&1)"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    if echo "$out" | grep -qi 'No updates are to be performed'; then
      echo "No stack updates needed (prebuilt tarball refreshed in S3)."
      echo "Replace the instance to pick up new code: make destroy-aws && make deploy-aws"
    else
      echo "$out" >&2
      exit "$rc"
    fi
  else
    aws cloudformation wait stack-update-complete \
      --region "$AWS_REGION" \
      --stack-name "$STACK_NAME"
  fi
fi

echo
echo "Outputs:"
aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' \
  --output table

SHOP_URL="$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ShopUrl`].OutputValue' \
  --output text)"

echo
echo "Shop URL: ${SHOP_URL}"
echo "Waiting for prebuilt boot (Node install + start — usually ~1–2 min)…"
ready=0
for i in $(seq 1 36); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 "$SHOP_URL" 2>/dev/null || true)"
  if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then
    echo "Shop is up (HTTP ${code}): ${SHOP_URL}"
    ready=1
    break
  fi
  printf "  attempt %s/36 — HTTP %s\n" "$i" "${code:-000}"
  sleep 5
done
if [[ "$ready" -ne 1 ]]; then
  INSTANCE_ID="$(aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
    --output text)"
  echo "WARN: Shop not reachable yet at ${SHOP_URL}" >&2
  echo "Check userdata: aws ec2 get-console-output --instance-id ${INSTANCE_ID} --region ${AWS_REGION} --latest --output text | tail -80" >&2
  exit 1
fi
