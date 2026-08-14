# Memstream

Turn CockroachDB writes into searchable agent memory, in the same database.

If your application uses CockroachDB, that structured data is already there. Cockroach MCP can query the live tables. What an agent still does not have is meaning: what a row actually meant, and what happened over time. Getting that from SQL takes several lookups, and you still do not have a sentence you can search later.

Memstream watches the writes (changefeeds), turns selected columns into plain-language memory, embeds them on AWS with Bedrock, and stores the vectors back in the same Cockroach database, next to the app tables. No separate vector database. As the app keeps writing, memory grows with it.

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
make web           # http://127.0.0.1:3000  console
make shop          # http://127.0.0.1:3001  example Acme shop (customer app)
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
| `demo-reset` | Full reset to demo start (shop + platform clutter + S3 CDC prefix + cancel changefeed jobs) |
| `demo-reset-shop` | Shop + memory only (narrow) |
| `mcp` | Memstream MCP |
| `test-engine` | vitest |

## Layout

```
apps/web/         Memstream console
examples/shop/    Example customer app (Acme Supply)
packages/engine/  worker, CDC, shop libs
packages/mcp/     Memstream MCP (search_memory + profile suggest)
profiles/ sql/ docs/ examples/ scripts/ infra/cdk/ infra/
```

Design notes: [PLAN.md](PLAN.md). Target architecture: [docs/TARGET_ARCHITECTURE.md](docs/TARGET_ARCHITECTURE.md) · [architecture diagram](docs/architecture-diagram.png). Self-host: [docs/SELF_HOST.md](docs/SELF_HOST.md).
