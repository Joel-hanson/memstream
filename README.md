# Memstream

Turn CockroachDB writes into searchable agent memory, stored in the same database as your app.

Your app already writes rows to CockroachDB. An agent can query those tables with SQL or Cockroach MCP, but it still has to stitch several lookups together to understand what happened over time. Memstream watches table changes, turns selected columns into plain sentences, embeds them with AWS Bedrock, and stores the vectors back in CockroachDB next to your app tables. There is no separate vector database.

## How it works

```text
App writes rows
    -> CockroachDB (your tables)
    -> changefeed copies changes to S3
    -> worker (Lambda, EC2, or your laptop) reads S3
    -> Bedrock turns text into embeddings
    -> vectors saved in agent_memory_chunks (same CockroachDB)
    -> agent searches memory via MCP
```

Memory lives in `agent_memory_chunks` in your application database (`sql/application.sql`). The Memstream console is the control plane: connect your DB, choose a profile, enable the pipeline, and watch memory land live.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Deploy and operate: [docs/AWS.md](docs/AWS.md).

## What you need

| Thing | Why |
| --- | --- |
| Node.js 20+ | Run the console and scripts |
| CockroachDB cluster | Application data and memory chunks |
| AWS account | S3 for changefeed objects, Bedrock for embeddings, optional Lambda or EC2 worker |

## Quick start

### Local UI only

Console and demo shop, no Cockroach or AWS:

```bash
make install-js
make web
make shop
```

- Console: `http://127.0.0.1:3000`
- Shop: `http://127.0.0.1:3001`

Connect and Enable still need a real CockroachDB and AWS setup.

### Real pipeline

1. Copy `.env.example` to `.env`.
2. Set up AWS, an S3 bucket, and Bedrock access.
3. Run `make setup-db` and `make cockroach-ca`.
4. Start the console with `make web`.
5. In the browser: Connect, Configure, Enable.
6. Run one worker: Managed Lambda, `make watch-cloud`, or `make deploy-aws`.

Details: [docs/AWS.md](docs/AWS.md).

## Worker options

| Path | Use when | Notes |
| --- | --- | --- |
| Managed Lambda | Default for cloud | Leave the managed worker on in Enable |
| Laptop worker | Debugging | `make watch-cloud` |
| EC2 demo box | Demo or simple self-host | `make deploy-aws` |

Do not run two workers against the same CDC bucket and prefix.

## MCP

Memstream exposes `search_memory` over MCP. With the console running, use Copy Memstream MCP from Live, or run:

```bash
make mcp
```

Demo flow with Cockroach MCP next to Memstream MCP: [docs/AWS.md](docs/AWS.md#7-worker-options).

## Common commands

| Target | What |
| --- | --- |
| `install-js` | Install npm workspaces |
| `web` | Run the Memstream console |
| `shop` | Run the example Acme shop |
| `setup-db` | Create the platform DB and apply `sql/memstream.sql` |
| `cockroach-ca` | Download the Cockroach Cloud CA |
| `watch-cloud` | Run the laptop worker |
| `deploy-aws` / `destroy-aws` | Create or remove the EC2 demo stack |
| `synth-infra` | Generate `infra/ec2.yaml` and `infra/lambda.yaml` |
| `demo-reset` | Reset shop, memory, S3 prefix, and changefeed |
| `mcp` | Run the Memstream MCP server |

Run `make help` for the full list.

## Repository layout

```text
apps/web/         Memstream console and APIs
examples/shop/    Example customer app
packages/engine/  Worker, CDC, deploy, and indexing logic
packages/mcp/     Memstream MCP server
profiles/ sql/ docs/ examples/ scripts/ infra/
```

## Docs

| Doc | What it covers |
| --- | --- |
| [docs/AWS.md](docs/AWS.md) | Deploy, operate, and self-host |
| [docs/SELF_HOST.md](docs/SELF_HOST.md) | Short self-host notes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Product model and topology |
| [docs/AWS.md](docs/AWS.md) | Deploy, operate, self-host, and demo walkthrough |
