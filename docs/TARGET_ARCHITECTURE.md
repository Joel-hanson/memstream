# Memstream — Target Architecture

Locked product decisions (2026-08-08) after architecture review.  
Hackathon notes remain in [PLAN.md](../PLAN.md). Review dump: [ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md).

## Product decisions (locked)

| Decision | Choice |
| --- | --- |
| Data residency | Customers keep **application data and memory chunks** in **their** Cockroach database |
| Delivery | **SaaS primary**, with **optional self-host** of the control plane |
| Pace | **Refactor and features in parallel** — extract seams; do not freeze or big-bang rewrite |

### Explicit non-goals (unchanged)

- Putting `agent_memory_chunks` in the Memstream platform DB
- Replacing MCP ask with a hosted chat UI
- Full multi-region control plane in v1
- Merging platform + application into one URL as the product model

---

## One-line model

**Control plane** (Memstream) orchestrates connect → configure → enable → observe.  
**Data plane** (customer Cockroach) holds app tables + searchable memory.  
Workers read CDC (S3) and write embeddings back into the customer DB.

---

## Target topology

```
┌────────────── Memstream control plane (SaaS or self-host) ──────────────┐
│  Console · APIs · Auth · Orgs / workspaces · Profiles · Runs · Jobs     │
│  Platform DB: orgs, workspaces, connections*, runs, profiles, cdc_keys  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ encrypted connection pointer
                                 ▼
┌────────────── Customer Cockroach (their cluster / their DB) ────────────┐
│  App tables (unchanged)                                                 │
│  agent_memory_chunks (+ VECTOR)   ← memory stays with their data        │
│  Changefeed → S3 (customer or Memstream-managed sink on SaaS)           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 ▼
              Worker (managed SaaS | customer EC2/Lambda | laptop)
              S3 → profile rules → Bedrock → chunks → app DB
                                 ▼
              Ask: Memstream MCP (search_memory) + Cockroach MCP (SQL)
```

\*Connections store ciphertext + label only. Never put application passwords in run rows.

---

## Data contract

| Store | Owner | Configured how | Holds |
| --- | --- | --- | --- |
| **Platform DB** | Memstream (SaaS) or customer (self-host) | `MEMSTREAM_DATABASE_URL` / SaaS-managed | Orgs, workspaces, encrypted connections, runs, profiles, CDC processed keys |
| **Application DB** | Customer always | Console Connect | App tables + `agent_memory_chunks` |

### Why keep the split

Customers want data residency. Memory on the application DB keeps the pitch (“live memory next to the database of record”). The platform DB is orchestration metadata, not a side vector store.

### Workspace primitive

Today’s `connection_id` on runs / chunks is the right isolation key. Promote it in product language to **workspace** (or keep `memstream_connections` and add `org_id`). Do not invent a second tenancy model.

---

## SaaS vs self-host

Same monorepo; two deployment modes.

| Concern | SaaS | Self-host |
| --- | --- | --- |
| Control plane | Memstream-hosted | Customer runs `apps/web` (+ platform DB) |
| Platform DB | Shared multi-tenant | Their `MEMSTREAM_DATABASE_URL` |
| Application DB | Always theirs | Always theirs |
| Worker default | **Managed Lambda / queue** | EC2, Lambda, or laptop (`watch-cloud`) |
| Secrets | KMS / Secrets Manager | Customer key or KMS |
| Auth | Org login (to add) | Local / SSO later |

**EC2** stays the demo / self-host “box.” It is not the default multi-tenant SaaS worker.

---

## Current → target (honest map)

| Today (hackathon slice) | Target |
| --- | --- |
| Single operator, `.env` platform DB | Orgs + workspaces on platform DB |
| In-memory `JobStore` + `memstream_runs` | **Runs DB is source of truth**; job store is cache |
| `session.env` bridge for workers | Prefer platform connection + Secrets Manager; retire file as source of truth |
| EC2 default for cloud enable | SaaS: managed Lambda; self-host: EC2 optional |
| Secrets via env / CFN params | **Secrets Manager** (`memstream/<stack>/config`); CFN only gets ARN |
| Monolithic `console-app.tsx` | Feature modules: Connect / Configure / Enable / Live / Runs |

Engine ports (`EventSource`, `Embedder`, `MemoryStore`) stay. Package layout stays:

```
apps/web/         control plane UI + APIs (+ demo shop)
packages/engine/  fabric: CDC, profile, embed, store, enable
packages/mcp/     search_memory
sql/              memstream.sql (platform) · application.sql (app + chunks)
infra/            EC2 (self-host/demo) · Lambda (SaaS/managed worker)
```

---

## Dual-track roadmap

Every feature lands in a **new module**, not more lines in `console-app.tsx`.

**Track A** — Seams (unblocks SaaS)

1. ✅ Split console by feature (Connect / Configure / Enable / Live / Runs) + thin page shell  
2. ✅ Typed API client + shared error/`Result` type  
3. ✅ Workspace primitive (`connection_id` = workspace id, nullable `org_id`) + durable enable jobs  
4. ✅ Secrets out of CloudFormation parameters (Secrets Manager)  

### Track B — Features (ship on seams)

| Feature | Why |
| --- | --- |
| Thin orgs + invite | SaaS entry |
| Managed worker as first-class Enable path | Less AWS homework |
| Self-host runbook (same packages) | Optional path |
| ✅ Connection health + memory lag on Live | Trust |
| Profile versioning | Real rule edits |

### Suggested 6-week shape

| Weeks | Track A | Track B |
| --- | --- | --- |
| 1–2 | Console split + API client | Live / connection health polish |
| 3–4 | Workspace/`org_id` + durable jobs | Managed Lambda Enable |
| 5–6 | Secrets + health/metrics | Thin auth + self-host runbook |

---

## Review corrections

| Earlier review suggestion | Call |
| --- | --- |
| Merge platform + application DBs | **No** — split is the product |
| Dual DB is premature multi-tenancy | Premature part was missing **org/workspace**, not the split |
| EC2 as default cloud worker | **Self-host/demo**; SaaS defaults to managed Lambda/queue |
| Freeze features for refactor | **No** — dual-track |
| CDK rewrite first | Later, when infra churn hurts; seams first |

---

## Next implementation step

**Track A.1** — ✅ Extract Connect / Configure / Enable / Live / Runs from `console-app.tsx` into `apps/web/src/features/console/` (behavior unchanged; orchestrator holds state).

**Track A.2** — ✅ Typed API client (`lib/api-client.ts`) + `Result`/`ApiError` (`lib/result.ts`); console orchestrator uses `consoleApi`.

**Track A.3** — ✅ Workspace primitive (`connection_id` = workspace id, nullable `org_id`) + durable enable progress (`steps_json` on `memstream_runs`, `bindJobToRun`).

**Track A.4** — ✅ Deploy secrets via AWS Secrets Manager (`ConfigSecretArn`); CFN params for DB URLs / AES key left empty.

**Track B** — Product features (orgs, managed worker polish, self-host runbook, …).

**Track B.1** — ✅ Connection health + memory lag on Live (`pipeline.health` from `/api/pipeline`; App DB / changefeed / lag vs newest CDC object).
