# Self-host Memstream

Run the **same monorepo** as control plane + worker in your account.  
Application data and `agent_memory_chunks` stay in **your** Cockroach DB either way.

SaaS (Memstream-hosted control plane) is the product default. This runbook is the optional path.

Architecture: [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md).  
AWS account / IAM / S3 / Bedrock once: [AWS.md](./AWS.md).

---

## What you run

| Piece | Where | Notes |
| --- | --- | --- |
| Console + APIs (`apps/web`) | Your laptop or VM | `make web` (dev) or Next standalone on EC2 |
| Platform DB | Your Cockroach | `MEMSTREAM_DATABASE_URL` — orgs/runs/profiles/CDC cursor |
| Application DB | Your Cockroach | Connect URL — app tables + memory chunks |
| Worker | Laptop, EC2, or Lambda **in your AWS** | Indexes S3 CDC → embeddings → app DB |
| MCP `search_memory` | Same host as console (`/api/mcp`) or `make mcp` | Ask from Cursor |

You never put application passwords in run rows; Connect stores ciphertext in the platform DB (`MEMSTREAM_SECRETS_KEY`).

Probe the control plane: `curl -s http://localhost:3000/api/health` (platform DB required; S3 optional when `CDC_S3_BUCKET` is set).

Demo login (optional): set `MEMSTREAM_DEMO_USER` / `MEMSTREAM_DEMO_PASSWORD` — console gates at `/login`; passwords are hashed in `memstream_operators`.

---

## 1. Prerequisites

- Node.js 20+, npm
- CockroachDB Cloud (or compatible) — one cluster is enough for both DBs
- AWS account with S3 + Bedrock (and CloudFormation if Enable deploys a worker)
- `aws configure` working

Follow [AWS.md](./AWS.md) §§1–5 for IAM, bucket, Bedrock smoke test, budget.

---

## 2. Platform config (`.env`)

```bash
cp .env.example .env
```

Minimum:

```bash
CLUSTER_URL='postgresql://…/defaultdb?sslmode=verify-full'   # for make setup-db
CDC_S3_BUCKET=your-bucket
AWS_REGION=us-east-1
MEMSTREAM_WORKER_COMPUTE=lambda   # or ec2 for the demo box / on-box watch

make setup-db
# Paste printed memstream URL:
MEMSTREAM_DATABASE_URL='postgresql://…/memstream?sslmode=verify-full'
MEMSTREAM_SECRETS_KEY=$(openssl rand -hex 32)

# Optional: explicit demo application DB for "Use demo workspace".
# If omitted and MEMSTREAM_DATABASE_URL ends in /memstream, Memstream derives /application.
# DEMO_APPLICATION_DATABASE_URL='postgresql://…/application?sslmode=verify-full'

COCKROACH_CLUSTER_ID=… && make cockroach-ca
```

**Hardening (self-host / shared network):**

```bash
MEMSTREAM_CONSOLE_TOKEN=$(openssl rand -hex 24)
NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN=$MEMSTREAM_CONSOLE_TOKEN
```

Without these, console APIs are open (local DX only).

Deployer IAM (managed policy, not inline):  
`MEMSTREAM_ATTACH_DEPLOYER_POLICY=1 bash scripts/render-deployer-policy.sh`

---

## 3. Control plane

```bash
make install-js
make web
# http://127.0.0.1:3000
make shop
# http://127.0.0.1:3001 — example Acme shop
```

1. **Connect** — application DB URL (not the platform URL).
2. **Configure** — profile (e.g. `commerce`).
3. **Enable** — schema + changefeed → S3; optionally deploys the cloud worker.

Profiles and run history live in the platform DB (`memstream_profiles`, `memstream_runs`).

Production tip: put `apps/web` behind TLS and keep `MEMSTREAM_CONSOLE_TOKEN` set. Full org login is Track B (not required for a single-operator self-host).

---

## 4. Worker — pick one

Do **not** run two consumers on the same CDC bucket/prefix.

### A — Laptop (debug)

```bash
make watch-cloud
```

Polls S3 → Bedrock → `agent_memory_chunks`. Shop/console: `http://127.0.0.1:3000`.

In Enable, turn **off** “Start managed cloud worker” if you only want this path.

### B — Managed Lambda (your account)

Default Enable path when the cloud worker checkbox is on:

- Advanced → **Managed Lambda (recommended)**, or `MEMSTREAM_WORKER_COMPUTE=lambda`
- Enable deploys `${STACK_NAME}-lambda` and wires S3 → Lambda
- Secrets go to Secrets Manager (`memstream/<stack>/config`); CFN only gets the ARN

Logs (one terminal — Lambda CloudWatch + EC2 journal when both exist):

```bash
make logs
# or: make logs LOGS=lambda
```

### C — EC2 demo / self-host box

Full shop + console + optional on-box `memstream-watch`:

```bash
MEMSTREAM_WORKER_COMPUTE=ec2 make deploy-aws
# optional: SHOP_CIDR=YOUR_PUBLIC_IP/32
```

Or Enable → Advanced → **EC2 (self-host / demo)** with the cloud worker on.

- Prebuilt AMI/artifact: Enable with Lambda stops `memstream-watch` so only Lambda consumes CDC.
- SSM shell (no SSH ingress): `aws ssm start-session …` (see [AWS.md](./AWS.md))

Tear down EC2 stack: `make destroy-aws`.  
Lambda: delete the run in the console, or delete the `*-lambda` stack in CloudFormation.

---

## 5. Ask (MCP)

With `make web` running, use **Copy Memstream MCP** on Live (HTTP → `/api/mcp`).

Standalone:

```bash
make mcp    # HTTP :8765
```

Cursor + Cockroach MCP SQL for live rows: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md).

---

## 6. Checklist

| Step | Done when |
| --- | --- |
| Platform DB | `MEMSTREAM_DATABASE_URL` + `MEMSTREAM_SECRETS_KEY` set |
| CA | `make cockroach-ca` / `PGSSLROOTCERT` |
| Console | Connect → Configure → Enable succeeds |
| CDC | Objects appear under `s3://$CDC_S3_BUCKET/cdc/` after a write |
| Worker | Live shows chunks; health card not “Lagging” |
| MCP | `search_memory` returns recent chunks |

---

## Same packages as SaaS

```
apps/web/         control plane UI + APIs (+ demo shop)
packages/engine/  CDC, profile, embed, store, enable, deploy
packages/mcp/     search_memory
sql/              memstream.sql (platform) · application.sql (app + chunks)
infra/cdk/        AWS CDK (EC2 + Lambda) — source of truth
infra/*.yaml      Generated CFN (`make synth-infra`) for Enable / deploy-aws
```

Self-host = you operate `.env`, platform DB, and the worker stack.  
SaaS = Memstream operates the control plane; your app DB and memory still stay with you.

### Orgs (thin)

Console header → **Org**: create an organization, mint a single-use invite code, or join with a code.  
Active org is stored in the browser and sent as `X-Memstream-Org`. Connect workspaces are tagged with that `org_id`. Full login/SSO comes later.
