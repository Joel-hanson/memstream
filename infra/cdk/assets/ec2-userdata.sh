#!/bin/bash
set -euxo pipefail
exec > >(tee /var/log/memstream-userdata.log) 2>&1

dnf install -y tar gzip awscli python3
# AL2023 ships curl-minimal (provides `curl`); do not install curl — it conflicts.
# AL2023 default nodejs is 18; Memstream / Next 15 need >=20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
node -v
npm -v

install -d -m 0755 /opt/memstream
aws s3 cp "s3://${CdcS3Bucket}/${DeployObjectKey}" /tmp/memstream-prebuilt.tgz
tar -xzf /tmp/memstream-prebuilt.tgz -C /opt/memstream
cd /opt/memstream

if [[ ! -f /opt/memstream/PREBUILT ]]; then
  echo "ERROR: expected prebuilt artifact (PREBUILT marker missing)" >&2
  ls -la /opt/memstream >&2 || true
  exit 1
fi
if [[ ! -f /opt/memstream/web/apps/web/server.js ]] && [[ ! -f /opt/memstream/web/server.js ]]; then
  echo "ERROR: Next standalone server.js not found" >&2
  find /opt/memstream/web -name 'server.js' >&2 || true
  exit 1
fi

# AL2023 / modern accounts often require IMDSv2 (token). Plain GET returns empty.
imds_get() {
  local path="$1"
  local token="$2"
  if [[ -n "$token" ]]; then
    curl -fsS --max-time 3 -H "X-aws-ec2-metadata-token: ${!token}" \
      "http://169.254.169.254/latest/meta-data/${!path}" 2>/dev/null || true
  else
    curl -fsS --max-time 3 "http://169.254.169.254/latest/meta-data/${!path}" 2>/dev/null || true
  fi
}

# Public IPv4 drives free sslip.io hostnames (no paid domain):
#   https://<ip>.sslip.io/          → console
#   https://shop.<ip>.sslip.io/     → shop
# IMDS can lag behind address assignment on first boot — retry before failing.
PUBLIC_IP=""
IMDS_TOKEN=""
for i in $(seq 1 40); do
  IMDS_TOKEN="$(curl -fsS --max-time 3 -X PUT \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
    http://169.254.169.254/latest/api/token 2>/dev/null || true)"
  PUBLIC_IP="$(imds_get public-ipv4 "$IMDS_TOKEN")"
  if [[ -n "$PUBLIC_IP" ]]; then
    echo "Resolved public IPv4 from IMDS: ${!PUBLIC_IP} (attempt ${!i})"
    break
  fi
  echo "Waiting for public IPv4 from IMDS (${!i}/40)…"
  sleep 3
done
if [[ -z "$PUBLIC_IP" ]]; then
  echo "ERROR: could not resolve public IPv4 from IMDS (needed for sslip.io HTTPS)" >&2
  exit 1
fi
CONSOLE_HOST="${!PUBLIC_IP}.sslip.io"
SHOP_HOST="shop.${!PUBLIC_IP}.sslip.io"
CONSOLE_PUBLIC_URL="https://${!CONSOLE_HOST}"
SHOP_PUBLIC_URL="https://${!SHOP_HOST}"

# Secrets Manager / CLI calls need an explicit region (ARN alone is not enough on AL2023 awscli).
export AWS_DEFAULT_REGION="${AWS::Region}"
export AWS_REGION="${AWS::Region}"

cat > /opt/memstream/.env <<'ENVEOF'
AWS_REGION=${AWS::Region}
AWS_DEFAULT_REGION=${AWS::Region}
CDC_S3_BUCKET=${CdcS3Bucket}
CDC_S3_PREFIX=${CdcS3Prefix}
BEDROCK_EMBED_MODEL=${BedrockEmbedModel}
MEMORY_PROFILE=${MemoryProfile}
MEMSTREAM_EMBEDDER=bedrock
MEMSTREAM_STORE=cockroach
MEMSTREAM_SOURCE=s3
MEMSTREAM_WATCH=true
MEMSTREAM_POLL_INTERVAL=5
MEMSTREAM_PREBUILT=1
MEMSTREAM_ROOT=/opt/memstream
MEMSTREAM_WORKER_COMPUTE=${MemstreamWorkerCompute}
MEMSTREAM_CDC_SINK=keys
SHOP_BACKEND=cockroach
NODE_ENV=production
PGSSLROOTCERT=/opt/memstream/certs/root.crt
MEMSTREAM_SSLROOTCERT=/opt/memstream/certs/root.crt
CONFIG_SECRET_ARN=${ConfigSecretArn}
CDC_SINK_SECRET_ARN=${CdcSinkSecret}
MEMSTREAM_DEMO_USER=demo
MEMSTREAM_DEMO_PASSWORD=demo
MEMSTREAM_AUTH_REQUIRED=1
ENVEOF

# Public cross-links (console ↔ shop) — HTTPS via Caddy + sslip.io.
# Use Fn::Sub bang-escape for shell vars (exclamation after the brace).
{
  echo "PUBLIC_IP=${!PUBLIC_IP}"
  echo "CONSOLE_HOST=${!CONSOLE_HOST}"
  echo "SHOP_HOST=${!SHOP_HOST}"
  echo "NEXT_PUBLIC_SHOP_URL=${!SHOP_PUBLIC_URL}"
  echo "NEXT_PUBLIC_MEMSTREAM_URL=${!CONSOLE_PUBLIC_URL}"
  echo "MEMSTREAM_MCP_PUBLIC_URL=${!CONSOLE_PUBLIC_URL}"
  echo "MEMSTREAM_MCP_ALLOWED_HOSTS=${!CONSOLE_HOST}:*"
} >> /opt/memstream/.env

# Secrets from Secrets Manager (preferred) or legacy CFN params (empty in new deploys)
python3 <<'PY'
import json, os, subprocess
env_path = "/opt/memstream/.env"
arn = "${ConfigSecretArn}".strip()
cdc_arn = "${CdcSinkSecret}".strip()
region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "${AWS::Region}"
values = {
  "DATABASE_URL": """${DatabaseUrl}""",
  "MEMSTREAM_DATABASE_URL": """${MemstreamDatabaseUrl}""",
  "MEMSTREAM_SECRETS_KEY": """${MemstreamSecretsKey}""",
}

def load_secret(secret_id):
  out = subprocess.check_output(
    ["aws", "secretsmanager", "get-secret-value",
     "--secret-id", secret_id, "--region", region,
     "--query", "SecretString", "--output", "text"],
    text=True,
  )
  return json.loads(out)

if arn:
  try:
    parsed = load_secret(arn)
    for k in ("DATABASE_URL", "MEMSTREAM_DATABASE_URL", "MEMSTREAM_SECRETS_KEY",
              "DEMO_APPLICATION_DATABASE_URL", "MEMSTREAM_DEMO_USER",
              "MEMSTREAM_DEMO_PASSWORD"):
      if parsed.get(k):
        values[k] = str(parsed[k])
  except Exception as e:
    print(f"WARN: could not load ConfigSecretArn: {e}", flush=True)
if cdc_arn:
  try:
    parsed = load_secret(cdc_arn)
    for k in ("MEMSTREAM_CDC_ACCESS_KEY_ID", "MEMSTREAM_CDC_SECRET_ACCESS_KEY"):
      if parsed.get(k):
        values[k] = str(parsed[k])
  except Exception as e:
    print(f"WARN: could not load CdcSinkSecret: {e}", flush=True)
with open(env_path, "a", encoding="utf-8") as f:
  for k, v in values.items():
    if not v:
      continue
    esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
    f.write(f'{k}="{esc}"\n')
PY
chmod 600 /opt/memstream/.env
if ! grep -q '^MEMSTREAM_DATABASE_URL=' /opt/memstream/.env; then
  echo "ERROR: MEMSTREAM_DATABASE_URL missing after ConfigSecretArn load — console will be unhealthy" >&2
  exit 1
fi
if [[ ! -f /opt/memstream/certs/root.crt ]]; then
  echo "WARN: certs/root.crt missing from package — Cockroach TLS may fail" >&2
fi

# Next apps listen on localhost only; Caddy terminates TLS on :443 and proxies by hostname.
cat > /usr/local/bin/memstream-console-run <<'EOF'
#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /opt/memstream/.env
set +a
export HOSTNAME=127.0.0.1
export PORT=3000
cd /opt/memstream/web
if [[ -f apps/web/server.js ]]; then
  exec node apps/web/server.js
fi
if [[ -f server.js ]]; then
  exec node server.js
fi
echo "ERROR: Next standalone server.js not found under /opt/memstream/web" >&2
exit 1
EOF
chmod +x /usr/local/bin/memstream-console-run

cat > /usr/local/bin/memstream-shop-run <<'EOF'
#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /opt/memstream/.env
set +a
export HOSTNAME=127.0.0.1
export PORT=3001
cd /opt/memstream/shop
if [[ -f examples/shop/server.js ]]; then
  exec node examples/shop/server.js
fi
if [[ -f server.js ]]; then
  exec node server.js
fi
echo "ERROR: Next standalone server.js not found under /opt/memstream/shop" >&2
exit 1
EOF
chmod +x /usr/local/bin/memstream-shop-run

cat > /usr/local/bin/memstream-watch-run <<'EOF'
#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /opt/memstream/.env
set +a
cd /opt/memstream/worker
EXTRA=()
if [[ -n "${!DATABASE_URL:-}" ]]; then
  EXTRA+=(--database-url "$DATABASE_URL")
fi
if [[ -n "${!CDC_S3_BUCKET:-}" ]]; then
  EXTRA+=(--s3-bucket "$CDC_S3_BUCKET")
fi
if [[ -n "${!CDC_S3_PREFIX:-}" ]]; then
  EXTRA+=(--s3-prefix "$CDC_S3_PREFIX")
fi
exec node dist/cli.js \
  --profile "${!MEMORY_PROFILE:-commerce}" \
  --source s3 \
  --embedder bedrock \
  --store cockroach \
  --aws-region "${!AWS_REGION:-us-east-1}" \
  "${!EXTRA[@]}" \
  --watch \
  --poll-interval "${!MEMSTREAM_POLL_INTERVAL:-5}"
EOF
chmod +x /usr/local/bin/memstream-watch-run

# Install Caddy (free Let's Encrypt TLS) — arch matches t3 (amd64) / t4g (arm64).
CADDY_VER=2.9.1
case "$(uname -m)" in
  aarch64|arm64) CADDY_ARCH=arm64 ;;
  x86_64) CADDY_ARCH=amd64 ;;
  *)
    echo "ERROR: unsupported arch for Caddy: $(uname -m)" >&2
    exit 1
    ;;
esac
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${!CADDY_VER}/caddy_${!CADDY_VER}_linux_${!CADDY_ARCH}.tar.gz" \
  -o /tmp/caddy.tgz
tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy
chmod +x /usr/local/bin/caddy
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
install -d -o caddy -g caddy -m 0755 /var/lib/caddy /etc/caddy

# Bang-escape shell vars for Fn::Sub; unquoted heredoc expands them at boot.
cat > /etc/caddy/Caddyfile <<EOF
{
	email memstream-demo@sslip.io
}

${!CONSOLE_HOST} {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}

${!SHOP_HOST} {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
EOF

cat > /etc/systemd/system/memstream-console.service <<'EOF'
[Unit]
Description=Memstream Next.js console (127.0.0.1:3000)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/memstream
ExecStart=/usr/local/bin/memstream-console-run
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/memstream/.env

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/memstream-shop.service <<'EOF'
[Unit]
Description=Memstream example Acme shop (127.0.0.1:3001)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/memstream
ExecStart=/usr/local/bin/memstream-shop-run
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/memstream/.env

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/memstream-watch.service <<'EOF'
[Unit]
Description=Memstream S3 CDC watcher (prebuilt)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/memstream/worker
ExecStart=/usr/local/bin/memstream-watch-run
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/memstream/.env

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy HTTPS reverse proxy (sslip.io)
After=network-online.target memstream-console.service memstream-shop.service
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Environment=HOME=/var/lib/caddy
WorkingDirectory=/var/lib/caddy

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now memstream-console.service
systemctl enable --now memstream-shop.service
systemctl enable --now memstream-watch.service

for i in $(seq 1 36); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/login && curl -fsS -o /dev/null http://127.0.0.1:3001/; then
    echo "memstream backends healthy on :3000 and :3001"
    break
  fi
  if [[ "$i" -eq 36 ]]; then
    echo "ERROR: console/shop backends did not become healthy" >&2
    systemctl status memstream-console memstream-shop --no-pager -l || true
    journalctl -u memstream-console -u memstream-shop -n 80 --no-pager || true
    exit 1
  fi
  sleep 2
done

systemctl enable --now caddy.service

# First Let's Encrypt issuance can take a bit; require HTTPS on both hostnames.
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "${!CONSOLE_PUBLIC_URL}/login" \
    && curl -fsS -o /dev/null "${!SHOP_PUBLIC_URL}/"; then
    echo "memstream HTTPS healthy: ${!CONSOLE_PUBLIC_URL} and ${!SHOP_PUBLIC_URL}"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: Caddy HTTPS did not become healthy" >&2
    systemctl status caddy --no-pager -l || true
    journalctl -u caddy -n 80 --no-pager || true
    exit 1
  fi
  sleep 2
done

echo "memstream userdata complete"
