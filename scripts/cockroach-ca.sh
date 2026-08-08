#!/usr/bin/env bash
# Download Cockroach Cloud CA → ~/.postgresql/root.crt
set -euo pipefail

CLUSTER_ID="${COCKROACH_CLUSTER_ID:-}"
if [[ -z "$CLUSTER_ID" && -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && . ./.env && set +a
  CLUSTER_ID="${COCKROACH_CLUSTER_ID:-}"
fi

if [[ -z "$CLUSTER_ID" ]]; then
  echo "Set COCKROACH_CLUSTER_ID (Cluster → Overview in Cockroach Cloud)." >&2
  exit 1
fi

DEST="${PGSSLROOTCERT:-$HOME/.postgresql/root.crt}"
mkdir -p "$(dirname "$DEST")"
URL="https://cockroachlabs.cloud/clusters/${CLUSTER_ID}/cert"
echo "Downloading CA → ${DEST}"
curl --fail --create-dirs -o "$DEST" "$URL"
chmod 644 "$DEST"
echo "OK. Set PGSSLROOTCERT=${DEST} (or rely on ~/.postgresql/root.crt)."
echo "Connect URLs should use sslmode=verify-full without sslrootcert=."
