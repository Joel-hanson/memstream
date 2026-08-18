# Memstream — Devpost submission

Copy each section into the matching Devpost field.


## Tagline

Turn CockroachDB writes into searchable agent memory, stored in the same database as your app.


## Inspiration

Agents can already query CockroachDB. What they still do not have is meaning: what a row actually meant, and what happened over time. SQL gives you sku and status. It does not give you a sentence you can search later.

Most teams bolt on a second vector database or a nightly dump. That copy drifts from production. We wanted memory that grows with the writes, in the same Cockroach database.


## What it does

Memstream watches changefeeds, turns selected columns into plain language, embeds them with Amazon Bedrock, and stores the vectors next to the app tables. No extra vector store.

Connect a cluster, pick a memory profile (or generate one from the schema), enable the pipeline, and watch chunks show up on the Live console. Agents retrieve with Memstream MCP (`search_memory`) and check live rows with Cockroach Cloud Managed MCP.

Acme Supply is not the product. It is demo traffic: customer and staff both write the same tables, so a support agent can see history, a stale weekend preference, and the SQL that still matches.


## How we built it

The console is Next.js: Connect, Configure, Enable, then Live. Memory lives in the customer's DB as `agent_memory_chunks`, with a Cockroach vector index. Platform metadata (connections, runs, processed CDC keys) stays in a separate platform database so we are not turning Memstream into another vector SaaS.

Write path: changefeed from the app DB to Amazon S3, worker on managed Lambda (default) or EC2 for demo/self-host, Bedrock embeddings, vectors written back to Cockroach. Ask path: Memstream MCP plus Cockroach Cloud MCP in Cursor. Infra is AWS CDK, then CloudFormation. Console, engine, MCP, and CDK are all TypeScript.


## What we learned

The interesting part is not the sink. It is what you choose to remember (the profile), whether you can see it working (chunks landing as the shop writes), and how to scale. Putting memory in the application database kept residency with the customer. Vector search plus live SQL is what catches stale memory, like a weekend-only preference that is no longer true.


## Challenges we ran into

We had to keep platform metadata out of the app DB and keep vectors in the app DB without turning Memstream into another vector SaaS. CDC through S3 needed idempotent consumption, and you cannot run two workers on the same prefix. `CREATE VECTOR INDEX` on Cockroach Cloud needed schema-changer retries so Enable stays one click. The shop had to write real commerce-shaped rows (orders, tickets, case notes) or the agent ask would have been fake.


## Built with

amazon, amazon-web-services, bedrock, caddy, cdk, cloudformation, cockroachdb, cursor, docker, ec2, lambda, manager, mcp, next.js, node.js, s3, secrets, shadcn/ui, typescript
