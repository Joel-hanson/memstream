#!/usr/bin/env bash
# Build a linux prebuilt tarball (Next standalone + worker) via Docker.
# Writes path of the tarball to stdout (last line); progress on stderr.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to prebuild the EC2 artifact" >&2
  echo "Install/start Docker (Colima, OrbStack, or Docker Desktop), then re-run make deploy-aws" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "error: docker daemon is not running" >&2
  echo "Start your Docker engine (e.g. colima start), then re-run make deploy-aws" >&2
  exit 1
fi

# Prefer native platform: qemu-emulated linux/amd64 next build often SIGSEGV on arm64 Colima.
DOCKER_ARCH="$(docker info --format '{{.Architecture}}' 2>/dev/null || true)"
if [[ -z "${MEMSTREAM_DEPLOY_PLATFORM:-}" ]]; then
  if [[ "$DOCKER_ARCH" == "aarch64" || "$DOCKER_ARCH" == "arm64" ]]; then
    MEMSTREAM_DEPLOY_PLATFORM=linux/arm64
  else
    MEMSTREAM_DEPLOY_PLATFORM=linux/amd64
  fi
fi
PLATFORM="$MEMSTREAM_DEPLOY_PLATFORM"
echo "Docker arch=${DOCKER_ARCH:-unknown} → platform=${PLATFORM}" >&2

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/memstream-prebuilt.XXXXXX")"
TARBALL="$(mktemp -t memstream-prebuilt.XXXXXX.tgz)"
IMAGE="memstream-prebuilt:local"
CTR="memstream-prebuilt-ctr-$$"

cleanup() {
  docker rm -f "$CTR" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT

echo "Building ${PLATFORM} prebuilt image (on your machine, not EC2)…" >&2
docker build \
  --platform "$PLATFORM" \
  -f Dockerfile.deploy \
  --target build \
  -t "$IMAGE" \
  "$ROOT" >&2

docker create --name "$CTR" --platform "$PLATFORM" "$IMAGE" >/dev/null
mkdir -p "$STAGE"
docker cp "$CTR:/out/." "$STAGE/"

# Bundle Cockroach CA if the caller staged it at certs/root.crt
if [[ -f "$ROOT/certs/root.crt" ]]; then
  mkdir -p "$STAGE/certs"
  cp "$ROOT/certs/root.crt" "$STAGE/certs/root.crt"
  echo "Included certs/root.crt in prebuilt artifact" >&2
fi

if [[ ! -f "$STAGE/PREBUILT" ]]; then
  echo "error: prebuilt artifact missing PREBUILT marker" >&2
  exit 1
fi
if [[ ! -f "$STAGE/web/apps/web/server.js" ]] && [[ ! -f "$STAGE/web/server.js" ]]; then
  echo "error: Next standalone server.js not found under web/" >&2
  find "$STAGE/web" -name 'server.js' >&2 || true
  exit 1
fi
if [[ ! -f "$STAGE/shop/examples/shop/server.js" ]] && [[ ! -f "$STAGE/shop/server.js" ]]; then
  echo "error: Next standalone server.js not found under shop/" >&2
  find "$STAGE/shop" -name 'server.js' >&2 || true
  exit 1
fi
if [[ ! -f "$STAGE/worker/dist/cli.js" ]]; then
  echo "error: worker dist/cli.js missing" >&2
  exit 1
fi

# Record platform so EC2 / ops can verify arch match
printf 'prebuilt=1\nplatform=%s\n' "$PLATFORM" > "$STAGE/PREBUILT"

# Lambda Enable-from-EC2: template + prebuilt zip (no Docker/esbuild on the box)
mkdir -p "$STAGE/infra" "$STAGE/deploy"
# Ensure generated CFN templates are fresh (CDK source of truth under infra/cdk)
npm run synth -w @memstream/infra >&2
cp "$ROOT/infra/lambda.yaml" "$STAGE/infra/lambda.yaml"
if ! command -v zip >/dev/null 2>&1; then
  echo "error: zip is required to package the Lambda worker (e.g. brew install zip)" >&2
  exit 1
fi
node "$ROOT/packages/engine/scripts/package-lambda-zip.mjs" \
  "$STAGE/deploy/memstream-lambda.zip" \
  "$STAGE" \
  "$STAGE/worker/dist/lambda-handler.js" >&2

export COPYFILE_DISABLE=1
tar -czf "$TARBALL" -C "$STAGE" .
# Keep tarball; caller owns it. Don't delete on EXIT.
trap 'docker rm -f "$CTR" >/dev/null 2>&1 || true; rm -rf "$STAGE"' EXIT

echo "$TARBALL"
