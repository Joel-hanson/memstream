# Memstream

Notes for the CockroachDB × AWS hackathon. Source of truth for what we are building and why.

**Memstream** is live agent memory for apps on CockroachDB.

**Post-hackathon target** (data residency, SaaS + optional self-host, dual-track refactor): [docs/TARGET_ARCHITECTURE.md](docs/TARGET_ARCHITECTURE.md).

## Product direction (current)

We are building Memstream as a **product**, not only a demo pipeline:

> Any team on CockroachDB can connect their cluster, configure memory from **their application schema** (or start from a template), and turn on live change memory — without hand-wiring CDC, embeddings, and vector search.

**Hackathon shape:** a credible **single-tenant product slice** — one Live console page (memory proof) + modals for setup, on top of a working memory fabric. Not a multi-page control plane or full multi-tenant SaaS.

| Layer | What judges see | What we run |
| --- | --- | --- |
| Product | “Memstream for Cockroach customers” | Next.js console (TypeScript + shadcn) |
| Home | Memory is live — chunks + status + test loop | Single main page (not sidebar apps) |
| Configure | Inspect app DB → propose/edit memory profile | Modal: schema discover + YAML profile |
| Enable | One click after profile chosen | Modal: schema + changefeed + optional EC2 |
| Observe / test | Write in shop → memory appears | Chunk count, recent chunks, shop link |
| Ask | Agent answers from live memory | Memstream MCP + Cockroach Cloud MCP |
| Demo traffic | Shop writes | Shop UI (same Next app or thin page) |

**UX principle:** customers want **memory stored** and a **way to see it working**. S3 / CDC / stack names are engine plumbing — required for enable, not first-class product UI.

## One-line pitch

Apps keep writing to CockroachDB as usual. Memstream turns those writes into searchable memory in the same database. Customers connect in the console, configure what to remember from **their app schema**, enable the fabric, and agents ask through MCP.

## Problem

Agents and RAG systems often work off stale copies: nightly exports, docs, or a separate vector store that drifts from production. DIY live memory means changefeeds, sinks, embedders, vector stores, and prompt glue. Memstream makes **live memory a product surface** on the database of record.

## What we build

### 1. Memory fabric (engine)

1. Apps write to normal tables.
2. Changefeeds → **S3**.
3. Indexer applies a **profile** (tables, when to chunk, wording).
4. **Bedrock** embeddings → Cockroach **vector index** (`agent_memory_chunks`).
5. Ask: **Memstream MCP** (`search_memory`) + **Cockroach Cloud MCP** (SQL). No hosted chat LLM.

### 2. Product surface (Next.js console)

**One main page = Live (the receipt).** Setup is modals, not separate nav pages.

| Surface | Role |
| --- | --- |
| **Live (home)** | Status (idle → enabling → live), metrics that move, **recent memory chunks**, CTA to test (shop write), hint to ask via MCP |
| **Connect (modal)** | Application `DATABASE_URL` (+ region). S3 bucket/prefix from `.env` (`CDC_S3_*`), not Connect UI. Memstream DB is **not** here — `.env` only |
| **Configure (modal)** | Template **or** scan schema → toggle rules → save. Differentiator — keep prominent |
| **Enable (modal)** | Summary of profile + tables; one **Enable** CTA; job log; shop URL when ready. EC2 / stack under Advanced |
| **Ask** | Cursor/Claude via MCP — console ≠ chat |

Do **not** ship a four-page sidebar (Overview / Connect / Configure / Enable) as peer apps. Idle Cloudflare-style empty dashboards before enable are waste.

## Platform decision: TypeScript + Next.js + shadcn

**Direction:** move the product UI (and, over the migration, the stack we show judges) to **TypeScript**, with the console built in **Next.js (App Router) + shadcn/ui**.

| Layer | Target | Notes |
| --- | --- | --- |
| Console + shop UI | **Next.js + TypeScript + shadcn** | Live home + setup modals + demo shop |
| API for console | Next.js Route Handlers / server actions | Talk to Cockroach, S3, Bedrock, CFN |
| Memory worker / indexer | **TypeScript** (port from Python) | Same profile → chunk → embed → store loop |
| Memstream MCP | TypeScript MCP server (or keep thin Python until ported) | `search_memory` |
| Infra | CloudFormation (`infra/`) | Unchanged idea; userdata runs TS worker |
| Config | YAML profiles under `profiles/` | Shared contract |

**Why:** one language for product UI + APIs; shadcn fits a serious SaaS console; easier to ship configure-from-DB + pipeline UX than the interim FastAPI HTML console.

**Migration stance:** product surface is TypeScript (`apps/web`, `packages/engine`, `packages/mcp`). Python `src/memstream` has been removed.

### Interim vs target

| Now | Target |
| --- | --- |
| Next Route Handlers + `@memstream/engine` | same |
| `/shop` in `apps/web` | same |
| TS worker + MCP | same |
| Docs: MCP + AWS + deploy + changefeed | same |

Python `src/memstream` has been **removed**.

## Cleanup (remove after / as we migrate)

Given the product direction, we **should delete or stop investing in** clutter that exists only for the old “many entrypoints / Python web” shape.

### Remove or replace

| Area | Status |
| --- | --- |
| Python `src/memstream` (engine, console, shop, CLIs) | **Removed** |
| FastAPI HTML + JSON API process | **Removed** (Next owns APIs) |
| Duplicate Python scripts / Make targets | **Removed** |

### Keep (core)

| Area | Why |
| --- | --- |
| `profiles/`, `sql/`, `infra/` | Templates, schema, EC2 |
| `packages/engine`, `packages/mcp` | Worker + ask path + console libs |
| `apps/web` | Product console + shop |
| `docs/AWS.md`, `docs/DEMO_SCRIPT.md` | Judges + setup / video ask |

## Hybrid retrieval

Do not sell "RAG instead of SQL."

| Kind of question | Prefer |
| --- | --- |
| Exact state, counts, joins | SQL via Cockroach MCP |
| Narrative / similarity | Vector search over change chunks |
| Best answers | Both |

Demo questions should need history or similarity, then SQL grounding.

## Ask path: MCP first

Console configures and observes. Insights stay in the agent.

| Piece | Owner |
| --- | --- |
| Live home + setup modals | Next.js console |
| Changefeed → chunk → embed | Worker |
| Vector memory in Cockroach | Us |
| Q&A | Agent LLM + Memstream MCP + Cockroach MCP |

## Target stack (cost-aware)

| Piece | Choice | Role |
| --- | --- | --- |
| Product UI | **Next.js + TypeScript + shadcn** | Live console + shop |
| DB (platform) | CockroachDB — **Memstream DB** | From `.env` (`MEMSTREAM_DATABASE_URL`): runs / console meta |
| DB (app) | CockroachDB — **application DB** | From console Connect (`DATABASE_URL`): app tables + memory chunks |
| CDC | Changefeed → S3 | Event pipe |
| Worker | TypeScript indexer | Profile → embed → store |
| Embeddings | Bedrock (Titan embed; on by default) | Vectors |
| Ask | Memstream MCP + Cockroach Cloud MCP | RAG + SQL |
| Config | YAML + console from app schema | Templates + discover |
| Compute | CloudFormation → **EC2** (default) or **Lambda** worker | `MEMSTREAM_WORKER_COMPUTE=ec2\|lambda` in `.env`; destroy after |

Avoid: Fargate/NAT default, Bedrock Agents/KB, full multi-tenant SaaS, investing further in the FastAPI console.

## Architecture

```
  .env ──► MEMSTREAM_DATABASE_URL ──► Cockroach [Memstream DB]
                                         └── memstream_runs (enable / live history)

                 ┌──────────────────────────────────┐
                 │  apps/web (Next.js + shadcn)     │
                 │  Live home · setup modals · shop │
                 └────────────────┬─────────────────┘
                                  │ Connect modal → DATABASE_URL
                                  ▼
[Customer app / shop] ──writes──► Cockroach [application DB]
                                  │
                                  ├── app tables (orders, stock, …) + seed
                                  ├── agent_memory_chunks  ◄── Bedrock embed
                                  │
                                  ├── changefeed ──► S3 ──► TS worker ──► Bedrock
                                  │
                                  └── MCP (Cursor) ──► search_memory + SQL
```

S3 stays in the **engine** path. Console product language is “live memory,” not “CDC bucket.”

## Data layout & persistence (decision)

**Two connection targets, two jobs:**

| Target | Configured how | Holds |
| --- | --- | --- |
| **Memstream DB** (platform) | **`.env` only** — `MEMSTREAM_DATABASE_URL` (not the Connect form) | `memstream_runs` and any future console meta |
| **Application DB** (customer / demo) | **Console Connect** — encrypted in `memstream_connections`; optional Advanced S3/region | App/demo tables + `agent_memory_chunks` |

**Product rule:** searchable memory (`agent_memory_chunks`) lives in the **application** database the user connects in the console — same cluster/DB as their app writes. Do **not** put embeddings in the Memstream platform DB (that would be a side vector store and fight the pitch).

Same Cockroach **cluster** can host both as separate databases (e.g. `memstream` + `defaultdb` / `demo`) with two URLs. What matters is two configs, not necessarily two Cloud clusters.

### What lives where

| Data | Store | Configured via |
| --- | --- | --- |
| Enable / live **run history** (`memstream_runs`) | **Memstream DB** | `.env` → `MEMSTREAM_DATABASE_URL` |
| Encrypted application connection (`memstream_connections`) | **Memstream DB** | Connect → `PUT /api/connection` |
| **CDC processed keys** (`memstream_cdc_keys`) | **Memstream DB** | Worker cursor per connection / CDC scope |
| Demo / app tables (`customers`, `orders`, `stock`, …) | **Application DB** | Connection stored in Memstream DB |
| Memory chunks (`agent_memory_chunks` + vector index) | **Application DB** (same as app tables) | Same connection |
| Local worker env bridge | `session.env` (file, mode `0600`) | Written on Enable from stored connection (not source of truth) |
| AWS / CDC bucket / region | `.env` (`CDC_S3_BUCKET`, `CDC_S3_PREFIX`, `AWS_REGION`) | Prefill into connection on Connect save; not editable in Connect UI |
| Local JSON CDC cursor | `.memstream-state/*` or `MEMSTREAM_STATE_FILE` | Offline / tests only when platform DB unset |
| Memory profiles | `profiles/*.yaml` | Configure modal |
| Enable job progress (in-flight log) | In-memory `JobStore` **plus** mirror to `memstream_runs` | Memstream DB |

### Env vs console (contract)

```bash
# .env — platform / ops only
MEMSTREAM_DATABASE_URL=postgresql://...@.../memstream   # required
MEMSTREAM_SECRETS_KEY=...   # optional; openssl rand -hex 32
CDC_S3_BUCKET=...           # optional Advanced prefill
AWS_REGION=us-east-1
MEMSTREAM_WORKER_COMPUTE=ec2  # or lambda — cloud worker when Enable deploys

# Console Connect — application DB (encrypted in memstream_connections)
# Not read from .env by the console.
```

- **`MEMSTREAM_DATABASE_URL`:** console APIs read this from env/file only. Never overwrite from the Connect form. Apply `sql/memstream.sql` at boot or first API use.
- **Application `DATABASE_URL`:** set in Connect; persisted encrypted to `memstream_connections`. Shop / pipeline / Enable load it from Memstream DB (or request body). Do **not** store plaintext application URLs in `.env` for the console path.
- Do **not** reuse one URL for both roles in code paths: run/connection helpers use Memstream DB; schema/changefeed/memory/shop use application DB from the stored connection.

### Explicit non-goals (hackathon)

- Storing `agent_memory_chunks` in the Memstream platform DB
- Multi-tenant SaaS control-plane beyond a single Memstream DB + single connected app
- Full audit UI / run browser as a product page
- Replacing Cockroach memory with an external vector DB
- Asking judges to configure Memstream meta URL in the Connect UI

### Why this split

| Split | Verdict |
| --- | --- |
| App DB (console) + memory in same app DB; runs in Memstream DB (`.env`) | **Yes** — pitch intact; console can hydrate runs without Connect drama |
| Demo DB + separate DB only for embeddings | **No** — weakens pitch |
| Everything in one URL | OK as a shortcut, but **not** the target — conflates platform and customer |

Demo application data **must** live in the application DB (Connect) when showing the real path. In-memory shop is only a local fallback when application `DATABASE_URL` is unset.

### Schema: `memstream_runs` (Memstream DB)

Add as **`sql/memstream.sql`** (applied against `MEMSTREAM_DATABASE_URL`, not the app schema apply on Enable):

```sql
CREATE TABLE IF NOT EXISTS memstream_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status STRING NOT NULL,              -- queued | running | succeeded | failed
  profile_path STRING NOT NULL,
  tables STRING NOT NULL,
  bucket STRING,
  region STRING,
  prefix STRING,
  stack_name STRING,
  shop_url STRING,
  job_id STRING,                       -- correlates with in-memory JobStore id
  -- Optional non-secret pointer to which app was enabled (host/db name only — never password)
  app_database_label STRING,
  log STRING[] NOT NULL DEFAULT ARRAY[],
  error STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  INDEX memstream_runs_created_idx (created_at DESC)
);
```

Application schema (`sql/application.sql` — tables + seed; `vector_index.sql` fallback) still applies to the **application** DB on Enable (unchanged idea).

Do **not** store plaintext application `DATABASE_URL` / passwords in `memstream_runs`. Credentials live in **`memstream_connections.database_url_ciphertext`** (AES-256-GCM). Runs keep `app_database_label` + optional `connection_id` only.

### Schema: `memstream_connections` (Memstream DB)

```sql
CREATE TABLE IF NOT EXISTS memstream_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name STRING NOT NULL DEFAULT 'default',
  database_url_ciphertext BYTES NOT NULL,  -- AES-256-GCM
  database_label STRING,
  bucket STRING,
  region STRING,
  prefix STRING,
  is_active BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Application schema (`sql/application.sql` — tables + seed; `vector_index.sql` fallback) still applies to the **application** DB on Enable (unchanged idea).

### Console behavior (target)

| Moment | Behavior |
| --- | --- |
| Console boots | Ensure Memstream schema on `MEMSTREAM_DATABASE_URL`; load latest run for hydrate |
| Connect | User sets **application** `DATABASE_URL` (+ Advanced). Does not edit Memstream DB URL |
| Enable starts | Insert `memstream_runs` on **Memstream DB**; keep `JobStore` for live polling; write `session.env` for worker |
| Enable log lines | Append to in-memory job **and** update `log` on the Memstream run row |
| Enable finishes | Set `succeeded` / `failed`, `shop_url`, `finished_at` on Memstream DB |
| Live home load | Latest run from Memstream DB + Connect defaults + pipeline/memory against **application** DB |
| Idle (no run / no Memstream URL) | Get-started CTAs; if Memstream URL missing, show a setup hint (check `.env`) — not a Connect field |

Optional stretch (skip unless free time): list last N runs in Enable Advanced — not a sidebar “History” app.

### Implementation guide (Phase 12)

Implement in this order so each step is demo-safe:

1. **Env** — Document `MEMSTREAM_DATABASE_URL` in `.env.example` / `apps/web/.env.example`. Keep application `DATABASE_URL` as Connect (prefill allowed).
2. **Schema** — `sql/memstream.sql` (platform). `sql/application.sql` for application DB (app tables + `agent_memory_chunks` + seed).
3. **Engine helpers** (`packages/engine`) — `withMemstreamDb()` from `MEMSTREAM_DATABASE_URL`; `createRun` / `appendRunLog` / `finishRun` / `getLatestRun()` — **no** application URL required to read runs. Memory/pipeline helpers still take Connect `databaseUrl`.
4. **Boot / first use** — Apply `memstream.sql` once (lazy on first `/api/runs/*` or console defaults).
5. **Wire Enable** — Create/finish run on Memstream DB; apply app schema + changefeed on application `DATABASE_URL`; write `session.env` as today.
6. **API** — `GET /api/runs/latest` uses Memstream DB only. Pipeline/memory APIs use application URL from body/session.
7. **Console** — Connect = application only. On mount: hydrate from latest Memstream run + application defaults so refresh stays “live.”
8. **Seed** — Included in `sql/application.sql` for demo shop data.
9. **Verify** — Enable → refresh → still live (run from Memstream DB); memory still in application DB; `.env` Memstream URL never appears in Connect.

**Done when:** platform runs survive refresh/restart via `.env` Memstream DB; app + chunks stay on the Connect-configured database; no embeddings in the platform DB.

## Multi-app / configure

| Path | When |
| --- | --- |
| Template profiles | Fast demo (`commerce`, `saas-security`) |
| From application database | Scan schema → propose → edit → save |

Same engine. Console configure step = *your DB → your memory policy*.

## User journey

| Step | User | System / UI |
| --- | --- | --- |
| 1 | Open console | **Live** home — idle / get-started (no empty metric wall) |
| 2 | Connect (modal) | Credentials set; Advanced hides S3/prefix if needed |
| 3 | Configure (modal) | Template **or** scan DB → toggle rules → save |
| 4 | Enable (modal) | One click; job log; optional EC2 in Advanced |
| 5 | Stay on Live | Status → live; auto-watch metrics + recent chunks |
| 6 | Test: shop write | Chunk count ticks; new chunk body visible |
| 7 | Ask in Cursor | MCP hybrid answer (outside console) |

**Proof loop (what users care about):** enable → write → see memory → ask MCP.

## Config contract (YAML)

Profiles stay the engine contract (templates or console-generated):

```yaml
application: acme-shop
changefeed:
  tables: [orders, stock]
  sink: s3
rules:
  - name: order_status_change
    table: orders
    when: { columns_changed: [status] }
    chunk_template: |
      Order {{id}} … {{before.status}} → {{after.status}} …
    tags: [order, status]
embedding:
  model: amazon.titan-embed-text-v2:0
  table: agent_memory_chunks
  dimensions: 1024
```

## Target repo shape

```
apps/web/                 # Next.js + shadcn console (+ shop)
packages/engine/          # TypeScript: profile, CDC, embed, store, discover, runs
packages/mcp/             # Memstream MCP (search_memory) — or under apps/
profiles/                 # commerce, saas-security, discovered
sql/                      # memstream.sql (platform), application.sql (app+seed), vector_index.sql
infra/                    # ec2.yaml, deployer-policy.json
docs/                     # AWS.md, DEMO_SCRIPT.md
PLAN.md
README.md
```

Python `src/memstream/` has been deleted.

## Implementation phases

| Phase | Goal | Status |
| --- | --- | --- |
| 1–5 | Python engine, shop, MCP, CFN, CDC path | Done (bridge) |
| 6 | FastAPI console prototype (enable + pipeline) | Done — **replace, don’t extend** |
| 7 | **Scaffold Next.js + shadcn console**; port enable + pipeline UI | **Done** (`apps/web`) |
| 8 | Console: **configure from application database** | **Done** (propose + toggles + save) |
| 9 | Port worker/indexer (+ MCP) to TypeScript | **Done** (`packages/engine` + `packages/mcp`; cloud adapters included) |
| **7b** | **Console UX reshape** — Live home + Connect/Configure/Enable modals; demote S3/infra; proof/test loop | **Done** |
| 10 | Remove Python bridge; Next owns APIs + shop + EC2 | **Done** |
| **12** | **Persistence** — Memstream DB (`.env`) for runs; app DB (Connect) for tables + chunks; hydrate Live | **Done** |
| 11 | Stretch: LLM triage / insight agent | Optional |

### Phase 7b — Console UX reshape (done)

Reshape of `apps/web` `console-app`: Live home + setup modals. APIs unchanged.

| Done when | Work |
| --- | --- |
| Single home | Sidebar peer-pages removed; **Live** is the only main view |
| Setup in modals | Connect / Configure / Enable as dialogs from header or get-started |
| No idle dashboard waste | Before enable: get-started CTAs only |
| Infra demoted | S3 from `.env` (not Connect UI); stack / EC2 under Enable **Advanced** |
| No duplicate profile pick | Enable shows profile summary from Configure |
| Header scoped | Refresh / live watch only on Live after enable |
| Honest connection state | “Credentials set” — not fake Connected |
| Proof / test loop | Auto-watch after enable; shop link; chunks + recent memory; MCP hint |
| Naming | **Live memory** copy; Dialog primitive added |

### Phase 12 — Persistence & run history (todo)

See **Data layout & persistence** above for schema, non-goals, and step-by-step guide.

| Done when | Work |
| --- | --- |
| Env | `MEMSTREAM_DATABASE_URL` in `.env.example`; Connect stays application-only |
| Schema | `sql/memstream.sql` (runs); `sql/application.sql` stays app + chunks + seed |
| Engine | Memstream DB helpers for runs; app URL for memory/pipeline/enable |
| Enable | Persist run to Memstream DB; schema/CDC on application DB; `session.env` for worker |
| API | `/api/runs/latest` → Memstream DB; pipeline/memory → Connect URL |
| Live | Refresh / Next restart hydrates from Memstream runs |
| Demo data | Seed application DB for shop path |
| Guardrail | No embeddings in Memstream DB; no Memstream URL in Connect UI; no secrets in run rows |

## Setup (target day-to-day)

1. Cockroach + AWS (bucket, IAM, budgets) as today.
2. `pnpm install` / `pnpm dev` for the console.
3. Worker via TS CLI or console-managed process / EC2.
4. Ask via MCP.
5. `make destroy-aws` after demo.

## Demo arc (~2–3 min)

1. Open Live home — product frame (idle → get started).
2. Modal: connect (brief) → configure from schema (or template).
3. Modal: enable → return to Live as status goes live.
4. Shop write → chunk count / recent memory update (proof).
5. MCP ask + SQL verify.
6. Mention tear-down.

## Submission checklist

- Public repo, license
- README: Next console + MCP + cost
- Profiles + seed
- Demo URL (console / shop)
- Video: configure → enable → write → **see memory** → ask
- Cockroach (vector + MCP + changefeed) + AWS (S3, Bedrock, EC2)

## Scope: do / don't

Do:

- Next.js + TypeScript + shadcn for the product console
- **Live home + setup modals** (Phase 7b)
- Configure from application database + templates (hero of setup)
- One-click enable + proof loop (write → see memory)
- **Memstream platform DB** from `.env` (`MEMSTREAM_DATABASE_URL`) for `memstream_runs`
- **Application DB** from console Connect for demo/app tables + `agent_memory_chunks`
- Seeded demo data in the application DB for the real demo path
- Port engine to TS; then **delete** the Python web/console bridge
- Aggressive cleanup of unused scripts/docs

Don't:

- Multi-page sidebar console pretending to be a control plane
- Lead with S3 / CDC / CloudFormation as the product story
- Empty Overview dashboards before anything is enabled
- Keep growing the FastAPI HTML console
- Full multi-tenant SaaS this weekend
- Custom chat UI replacing MCP
- Bedrock Agents / Knowledge Bases
- Leave two competing UIs (Python + Next) in the submission
- **Put `agent_memory_chunks` in the Memstream platform DB** (memory stays with the app DB)
- Expose `MEMSTREAM_DATABASE_URL` in the Connect modal
- Store plaintext application `DATABASE_URL` or passwords inside `memstream_runs` (use `memstream_connections` ciphertext instead)

## Naming

**Memstream** — memory from the change stream.

- Console: Next.js **Live home** + setup modals (primary product)
- Worker / MCP: TypeScript (target)
- Pitch: live agent memory for CockroachDB — configure from your app DB, enable, see memory appear, ask through MCP.

## Open decisions

- Default Next shop is **memory** without application `DATABASE_URL`; Cockroach when Connect URL is set
- Connect prefill: `/api/defaults` reads session.env + repo `.env` (done)
- **Resolved:** Memstream DB via `.env` (`MEMSTREAM_DATABASE_URL`); application DB via console Connect; memory chunks stay on the application DB (see Data layout & persistence / Phase 12)

## Implementation status

- [x] TypeScript memory fabric + MCP (`packages/engine`, `packages/mcp`)
- [x] Next.js console with native APIs (no Python proxy)
- [x] Configure from application database
- [x] Phase 7b Live home + setup modals
- [x] Shop in Next (`/shop`) + Cockroach when `DATABASE_URL` set
- [x] Changefeed + propose CLIs in TypeScript
- [x] EC2 userdata Node-only (Next `:3000` + TS watcher)
- [x] Removed `src/memstream` Python package
- [x] Phase 12: Memstream DB (`.env`) + app DB (Connect); `memstream_runs`; hydrate Live
- [ ] Submission video + demo URL polish
