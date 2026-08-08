# Memstream demo script (video + ask)

Print the talk track. Keep it next to the keyboard. About three minutes on camera.

Story: ship an order, open a complaint ticket, then let the agent explain why Alex is upset.

Cloud setup: [AWS.md](AWS.md). Overview: [README](../README.md).

---

## MCP setup (off camera)

Hybrid ask: Memstream `search_memory` + Cockroach Cloud MCP (SQL).

1. Keep `make web` running.
2. **Copy Memstream MCP** in Live or `/shop` → Cursor Settings → MCP:

```json
{
  "mcpServers": {
    "memstream": {
      "url": "http://127.0.0.1:3000/api/mcp"
    }
  }
}
```

3. Cockroach Cloud console → MCP → add next to Memstream (prefer read-only).

Alternatives: `make mcp` (`:8765`) or `make mcp-stdio`.
---

## Before you hit record

- [ ] `make web` is running (console + shop)
- [ ] Cloud path is live (changefeed on orders, stock, tickets; worker on EC2/Lambda or `make watch-cloud`)
- [ ] Cursor has Memstream MCP and Cockroach Cloud MCP
- [ ] Profile is `commerce` (Configure / Enable)
- [ ] Reset:

```bash
make demo-reset
```

- [ ] On `/shop`, order 100 is pending for SKU-12
- [ ] Live shows few or no recent demo chunks

Bad take? `make demo-reset` again, wait for Live to settle, restart from Beat 1.

---

## What to show

| Beat | Window |
| --- | --- |
| Hook | Live console |
| App + drama | `/shop` |
| Memory | Live console (new chunks) |
| Wow | Cursor chat |
| Close | Live + agent answer side by side |

---

## Talk track

Say the quoted lines out loud.

### Beat 0. Hook (0:00-0:20)

Screen: Live console

> "Apps keep writing to CockroachDB. Agents usually get a stale copy. Memstream turns those writes into live agent memory in the same database, running on AWS."

Point at live status or recent chunks. Skip S3 for now.

### Beat 1. The app (0:20-0:50)

Screen: http://127.0.0.1:3000/shop

> "This is a normal shop. Alex has an order for SKU-12. When we ship it, that write goes straight into Cockroach."

Action: ship order 100. Wait until the shop banner or Live shows it landed.

> "Production status just changed."

### Beat 2. The drama (0:50-1:20)

Screen: shop, open complaint

> "Shipping is only half of it. Alex opens a ticket: SKU-12 arrived damaged."

Action: click Open complaint ticket.

> "You get three events: ship, inventory, complaint. SQL shows current state. Memory is what tells you what happened."

### Beat 3. Memory (1:20-1:40)

Screen: Live console, new chunks

> "Memstream wrote those changes into Cockroach vector memory. Bedrock embeds them. They sit next to the app tables, so you do not need a separate vector database."

Optional: five seconds on `VECTOR INDEX` for `agent_memory_chunks`.

### Beat 4. The wow (1:40-2:40)

Screen: Cursor chat. Use **Copy ask prompt** on the shop, or paste:

```text
Why is Alex upset about SKU-12?
1) Call Memstream search_memory first and cite the chunks.
2) Then use Cockroach Cloud MCP SQL to confirm the live order 100 status, SKU-12 stock, and any ticket for that order.
Answer in 3 short bullets: what happened, what memory shows, what SQL confirms.
```

While it runs:

> "The agent hits Cockroach twice: semantic search over the change story, then SQL to check the live rows."

On camera:

- [ ] Cites the ticket or ship memory (Alex, damaged, order 100)
- [ ] Confirms with SQL (shipped, ticket, and/or stock)
- [ ] Does more than "order 100 is shipped"

### Beat 5. Close (2:40-3:00)

Screen: Live chunks and the agent answer together

> "So Cockroach is the persistent memory layer, AWS runs the live pipeline, and the agent can answer what happened, not only what the row looks like right now."

Stop. No architecture slides after this.

---

## Optional Path B (Q&A)

Same shop, `commerce` profile. Skip in the hero take unless you have time.

1. `/shop` → **Drop SKU-12 by 1** once or twice.
2. Wait for an inventory chunk in Live.
3. **Copy similarity ask**, or:

```text
Have we seen stock drops like SKU-12 before?
1) Call Memstream search_memory and cite similar inventory chunks.
2) Then use Cockroach Cloud MCP SQL to confirm current SKU-12 quantity in stock.
Answer in 2 short bullets: what memory shows, what SQL confirms.
```

> "Memory compounds. The agent can find similar stock drops, not only the latest row."

`saas-security` profile: under **Optional: role change**, promote `admin@acme.test` to admin, then **Copy role-change ask**.

---

## Extra prompts

**Backup if Beat 4 fails:**

```text
What happened around order 100 recently (shipping and support)?
Use search_memory, cite chunk text, then confirm with SQL.
```

**SQL only (no memory):**

> What is the current status of order 100 in `orders`?  
> How many units of SKU-12 are in `stock`?  
> List open tickets for order 100.

Then cut, `make demo-reset`, re-take from Beat 1.

---

## Keep off camera

- Long Enable or CloudFormation logs (five seconds max if you must)
- `.env`, passwords, full YAML
- Debugging a broken changefeed live

## Rehearsal

```bash
make demo-reset
# → /shop: ship 100 → open ticket → copy ask
# → optional: drop SKU-12 → copy similarity ask
# → optional: promote u1 → copy role-change ask
```
