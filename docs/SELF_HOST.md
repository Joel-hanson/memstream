# Self-host Memstream

Run the Memstream control plane and worker in your own account. Application tables and `agent_memory_chunks` still live in your Cockroach database.

Operator steps: [AWS.md](./AWS.md). Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What you run

- Platform DB via `MEMSTREAM_DATABASE_URL`
- Console host (`apps/web`)
- One worker: laptop, Lambda, or EC2
- Your AWS bucket, IAM, and Bedrock access

There is no separate vector database. Memory is written back into the application database.

---

## Steps

1. Follow [AWS.md](./AWS.md) through AWS account setup, bucket creation, `.env`, and database setup.
2. Start the control plane:

```bash
make install-js
make web
```

3. In the console: Connect the application DB, Configure a profile, Enable the pipeline.
4. Pick one worker path from [AWS.md](./AWS.md#7-worker-options).

Optional demo shop:

```bash
make shop
```

Health probe:

```bash
curl -s http://localhost:3000/api/health
```

---

## Worker defaults

- Managed Lambda for cloud
- Laptop worker for debugging (`make watch-cloud`)
- EC2 for the demo box or a simple single-box self-host

Do not run two workers against the same S3 prefix.

---

## MCP

Once the console is up, use Copy Memstream MCP from Live or run:

```bash
make mcp
```

Demo flow with Cockroach MCP next to Memstream MCP: [AWS.md](./AWS.md#7-worker-options).

---

## Same packages as SaaS

```text
apps/web/         control plane UI + APIs (+ demo shop)
packages/engine/  CDC, profile, embed, store, enable, deploy
packages/mcp/     search_memory
sql/              memstream.sql (platform) · application.sql (app + chunks)
infra/cdk/        AWS CDK source of truth
infra/*.yaml      Generated CloudFormation used by Enable / deploy-aws
```

SaaS and self-host use the same monorepo. You operate the control plane in self-host; Memstream operates it in SaaS.
