# Memstream

Turn CockroachDB changefeeds into agent-ready memory.

Apps keep writing to CockroachDB. Memstream turns those writes into searchable memory in the same database.

## Prerequisites

| | Local | AWS / cloud |
| --- | --- | --- |
| Node.js 20+ and npm | yes | yes |
| CockroachDB Cloud | no | yes |
| AWS (S3 + Bedrock) | no | yes |

```bash
node -v   # v20+
```

## 1. Local (no accounts)

```bash
make install-js
make demo-local    # sample events → data/memstream-chunks-ts.json
make web           # http://127.0.0.1:3000  ·  /shop
```

No `.env` needed. Shop is in-memory; console Connect/Enable need a DB (next section).

## 2. AWS / cloud

Full checklist: **[docs/AWS.md](docs/AWS.md)**. Short version:

```bash
# a. AWS once — IAM, aws configure, S3 bucket, Bedrock test, budget
#    see docs/AWS.md §1–5

cp .env.example .env
# Set (quote Cockroach URLs — & breaks unquoted source):
#   CLUSTER_URL='postgresql://.../defaultdb?sslmode=verify-full'
#   CDC_S3_BUCKET=...
#   AWS_REGION=us-east-1
#   MEMSTREAM_WORKER_COMPUTE=lambda   # default; ec2 for self-host / demo box

make setup-db
# Paste printed memstream URL → MEMSTREAM_DATABASE_URL in .env
# MEMSTREAM_SECRETS_KEY=$(openssl rand -hex 32)
# COCKROACH_CLUSTER_ID=… && make cockroach-ca

make web
# Connect — paste printed application URL
# Configure — profile commerce
# Enable — changefeed → S3; leave “Start managed cloud worker” on for Lambda

# Worker — pick one (do not run two consumers on the same bucket/prefix):
#   A  Enable with Managed Lambda (default) — no extra make target
#   B  make watch-cloud     # laptop polls S3 (turn cloud worker off in Enable)
#   C  make deploy-aws      # EC2 demo box (Docker required; optional SHOP_CIDR=YOUR_IP/32)

make destroy-aws     # EC2 stack only
# Lambda: delete the run in the console, or delete *-lambda in CloudFormation
```

Video + MCP ask: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (`make demo-reset` between takes).  
Self-host runbook: [docs/SELF_HOST.md](docs/SELF_HOST.md).

```bash
make help
```

## Make targets

| Target | What |
| --- | --- |
| `install-js` | npm workspaces |
| `cockroach-ca` | Download Cockroach Cloud CA → `~/.postgresql/root.crt` |
| `demo-local` | Offline indexer |
| `web` | Console + shop `:3000` |
| `setup-db` | Create `memstream` (+ empty `application`) + platform SQL; app schema via Enable |
| `watch-cloud` | S3 → Bedrock → Cockroach (laptop) |
| `deploy-aws` / `destroy-aws` | EC2 demo stack (Lambda via Enable, not these targets) |
| `synth-infra` | CDK → `infra/ec2.yaml` + `infra/lambda.yaml` |
| `demo-reset` | Full reset to demo start (shop + platform clutter + S3 CDC prefix) |
| `demo-reset-shop` | Shop + memory only (narrow) |
| `mcp` | Memstream MCP |
| `test-engine` | vitest |

## Layout

```
apps/web/         console + /shop
packages/engine/  worker, CDC, shop libs
packages/mcp/     search_memory MCP
profiles/ sql/ docs/ examples/ scripts/ infra/cdk/ infra/
```

Design notes: [PLAN.md](PLAN.md). Target architecture: [docs/TARGET_ARCHITECTURE.md](docs/TARGET_ARCHITECTURE.md). Self-host: [docs/SELF_HOST.md](docs/SELF_HOST.md).
