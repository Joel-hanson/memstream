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

cat > /opt/memstream/.env <<'ENVEOF'
AWS_REGION=${AWS::Region}
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
SHOP_BACKEND=cockroach
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
PGSSLROOTCERT=/opt/memstream/certs/root.crt
MEMSTREAM_SSLROOTCERT=/opt/memstream/certs/root.crt
CONFIG_SECRET_ARN=${ConfigSecretArn}
ENVEOF
# Secrets from Secrets Manager (preferred) or legacy CFN params (empty in new deploys)
python3 <<'PY'
import json, subprocess
env_path = "/opt/memstream/.env"
arn = "${ConfigSecretArn}".strip()
values = {
  "DATABASE_URL": """${DatabaseUrl}""",
  "MEMSTREAM_DATABASE_URL": """${MemstreamDatabaseUrl}""",
  "MEMSTREAM_SECRETS_KEY": """${MemstreamSecretsKey}""",
}
if arn:
  try:
    out = subprocess.check_output(
      ["aws", "secretsmanager", "get-secret-value",
       "--secret-id", arn, "--query", "SecretString", "--output", "text"],
      text=True,
    )
    parsed = json.loads(out)
    for k in ("DATABASE_URL", "MEMSTREAM_DATABASE_URL", "MEMSTREAM_SECRETS_KEY"):
      if parsed.get(k):
        values[k] = str(parsed[k])
  except Exception as e:
    print(f"WARN: could not load ConfigSecretArn: {e}", flush=True)
with open(env_path, "a", encoding="utf-8") as f:
  for k, v in values.items():
    if not v:
      continue
    esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
    f.write(f'{k}="{esc}"\n')
PY
chmod 600 /opt/memstream/.env
if [[ ! -f /opt/memstream/certs/root.crt ]]; then
  echo "WARN: certs/root.crt missing from package — Cockroach TLS may fail" >&2
fi

cat > /usr/local/bin/memstream-shop-run <<'EOF'
#!/bin/bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /opt/memstream/.env
set +a
export HOSTNAME=0.0.0.0
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

cat > /etc/systemd/system/memstream-shop.service <<'EOF'
[Unit]
Description=Memstream Next.js console + shop (prebuilt)
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

systemctl daemon-reload
systemctl enable --now memstream-shop.service
systemctl enable --now memstream-watch.service

for i in $(seq 1 36); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/shop; then
    echo "memstream shop healthy on :3000"
    break
  fi
  if [[ "$i" -eq 36 ]]; then
    echo "ERROR: shop did not become healthy; journalctl -u memstream-shop -n 80" >&2
    systemctl status memstream-shop --no-pager -l || true
    journalctl -u memstream-shop -n 80 --no-pager || true
    exit 1
  fi
  sleep 2
done

echo "memstream userdata complete"
