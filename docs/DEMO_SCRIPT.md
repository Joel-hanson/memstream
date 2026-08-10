# Memstream demo script (video + ask)

Print the talk track. Keep it next to the keyboard. About three minutes on camera.

Story: Memstream is the product (connect, configure, enable, live memory). The shop is only traffic: Alex had a late Field Lamp once; today a new order ships damaged; Support leaves a handoff; Staff asks memory plus SQL.

Cloud setup: [AWS.md](AWS.md). Overview: [README](../README.md).

---

## MCP setup (off camera)

Hybrid ask: Memstream `search_memory` + Cockroach Cloud MCP (SQL).

1. Keep `make web` running.
2. **Copy Memstream MCP** in Live or shop Ops tools → Cursor Settings → MCP:

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
- [ ] Cloud path is live (changefeed on orders, stock, tickets, **case_notes**; worker on EC2/Lambda or `make watch-cloud`)
- [ ] If you just pulled `case_notes` into `commerce`, **re-Enable** once so the feed includes it
- [ ] Cursor has Memstream MCP and Cockroach Cloud MCP (Path B / backup)
- [ ] Profile is `commerce` (Configure / Enable already done once)
- [ ] Reset (re-embeds Alex’s past order 90 into memory via Bedrock):

```bash
make demo-reset
```

- [ ] On `/shop`, order 100 is pending for SKU-12; order 90 shows shipped (backstory)
- [ ] Live shows a few **history** chunks (order 90 / t-90 / n-90), not clutter from a prior take
- [ ] Rehearse chunk lag after Ship / Report damage / Support ask

Bad take? `make demo-reset` again, wait for Live to settle, restart from Beat 1.

---

## What to show (Memstream first)

| Beat | Window | Job |
| --- | --- | --- |
| Hook | Live console | Name the product; history chunks already there |
| Product | Live: Configure + Enable | Platform, not the shop |
| Traffic | `/shop` (short) | Buy → Ship → damage → Support handoff |
| Receipt | Live console | New ship / ticket / case_notes chunks |
| Wow | Staff **Ask the agent** | Memory + SQL (frame as Memstream) |
| Close | Live console | Chunks + one line; leave on Memstream |

Shop is proof load. If you muted the audio, Live should still feel like half the video.

Skip Flaticon / avatar slides. Use Shop / Staff tabs; say "as Alex" / "as staff" if you need labels.

---

## Say this on camera (cue card)

Print this. Stage directions stay silent. Prefer cuts over dead air while waiting for chunks.

**0:00 · Live (history chunk: order 90 / late delivery)**

This is Memstream. Apps keep writing to CockroachDB. Agents usually get a stale copy. We turn those writes into live agent memory in the same database, including past cases, running on AWS.

**0:15 · Configure, then Enable (flash only; do not re-run a long Enable)**

Customer connects their Cockroach app database, configures what to remember from their schema (here, commerce: orders, stock, tickets, case notes), and enables the fabric. Memory stays next to their tables.

Back on Live: status is live. These chunks are already from Alex’s earlier late Field Lamp.

**0:40 · Shop (traffic only; keep it moving)**

Quick proof write. As Alex: buy another Field Lamp. That row is in Cockroach.

As staff: ship it.

As Alex again: lamp arrives damaged. Open a damage report and ask Support. Support leaves a handoff in case notes. Memstream indexes that with the order and ticket story.

**1:15 · Live (wait for new chunks)**

Receipt. Ship, ticket, handoff chunks land here. Bedrock embeds. Vector memory in Cockroach beside the app data. No separate vector database.

Optional glance: `VECTOR INDEX` on `agent_memory_chunks`.

**1:40 · Staff · Ask the agent (still the Memstream ask path)**

*(click: Why is Alex upset about the Field Lamp?)*

The agent searches Memstream change memory (prior late delivery plus today’s damage), then checks live SQL.

*(click: Where did we leave off on Alex's Field Lamp case?)*

Staff picks up from the handoff. Memory has where the case left off. SQL has the live order.

**2:40 · cut back to Live**

Memstream is the live memory layer on Cockroach. AWS runs the pipeline. Agents answer what happened over time, not just what the row says right now.

Stop. No architecture slides. No tear-down on camera.

---

## Talk track

Same words as the cue card, with screen notes.

### Beat 0. Hook (0:00-0:15)

Screen: Live console. Point at a history chunk (order 90 or late-delivery ticket).

> "This is Memstream. Apps keep writing to CockroachDB. Agents usually get a stale copy. We turn those writes into live agent memory in the same database, including past cases, running on AWS."

Skip S3 for now.

### Beat 1. Product (0:15-0:40)

Screen: Live console

Action (already enabled is fine):

1. Open **Configure**. Show `commerce` and remembered tables (orders, stock, tickets, case_notes).
2. Close. Open **Enable**. One CTA / live status. Five seconds max on any job log.
3. Back to Live. Point at status and history chunks.

> "Customer connects their Cockroach app database, configures what to remember from their schema (here, commerce: orders, stock, tickets, case notes), and enables the fabric. Memory stays next to their tables."

> "Back on Live: status is live. These chunks are already from Alex’s earlier late Field Lamp."

### Beat 2. Traffic (0:40-1:15)

Screen: http://127.0.0.1:3000/shop. Keep storefront time short.

> "Quick proof write. As Alex: buy another Field Lamp. That row is in Cockroach."

Action: **Buy** on Field Lamp (or use seeded order 100).

> "As staff: ship it."

Action: **Staff** → **Ship**.

> "As Alex again: lamp arrives damaged. Open a damage report and ask Support. Support leaves a handoff in case notes. Memstream indexes that with the order and ticket story."

Action: **Shop** → **Report damage**. Support → "My lamp arrived damaged — what's going on?"

### Beat 3. Receipt (1:15-1:40)

Screen: Live console. New chunks (ship, ticket, case note). Hold on them appearing.

> "Receipt. Ship, ticket, handoff chunks land here. Bedrock embeds. Vector memory in Cockroach beside the app data. No separate vector database."

Optional: five seconds on `VECTOR INDEX` for `agent_memory_chunks`.

If chunks are slow: say the line once, wait, do not debug on camera.

### Beat 4. Wow (1:40-2:40)

Screen: **Staff** tab → **Ask the agent**. Frame this as the Memstream ask, not a shop feature tour.

First click:

```text
Why is Alex upset about the Field Lamp?
```

While it runs:

> "The agent searches Memstream change memory (prior late delivery plus today’s damage), then checks live SQL."

On camera:

- [ ] Cites past history (order 90 / late delivery) and/or today’s ticket
- [ ] Confirms with SQL (shipped, ticket, and/or stock)
- [ ] Memory citations are expanded (RAG visible)

Then click:

```text
Where did we leave off on Alex's Field Lamp case?
```

> "Staff picks up from the handoff. Memory has where the case left off. SQL has the live order."

Honest framing: in-product ask over memory search + SQL. Do not say "same path as Cursor" unless you cut to Cursor (Path B).

**If Staff ask is empty or wrong:** cut, use Extra prompts, or Path B.

### Beat 5. Close (2:40-3:00)

Screen: cut back to Live (chunks / case_notes visible). Brief flash of the staff answer is fine; end on Live.

> "Memstream is the live memory layer on Cockroach. AWS runs the pipeline. Agents answer what happened over time, not just what the row says right now."

Stop. No architecture slides after this.

---

## Optional Path B (Q&A / backup)

Same `commerce` profile. Skip in the hero take unless Staff chat fails or a judge asks.

In Cursor, with Memstream MCP + Cockroach Cloud MCP:

```text
Why is Alex upset about the Field Lamp?
1) Call Memstream search_memory first and cite the chunks.
2) Then use Cockroach Cloud MCP SQL to confirm order 100, tickets, and SKU-12 stock.
Answer in short bullets: what memory shows, what SQL confirms.
```

> "Same hybrid idea over MCP: Memstream for change memory, Cockroach for exact rows."

### Optional similarity beat (only if time)

1. **Staff** → drop Field Lamp stock once or twice.
2. Wait for an inventory chunk in Live.
3. Staff Agent or Cursor:

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

**Backup if Beat 4 fails (Staff):**

```text
What happened around order 100 recently (shipping and support)?
```

**Backup if Beat 4 fails (Cursor):**

```text
What happened around order 100 recently (shipping and support)?
Use search_memory, cite chunk text, then confirm with SQL.
```

**Resume backup:**

```text
Where did we leave off on Alex's Field Lamp case?
Use search_memory for case_notes and tickets, then confirm with SQL.
```

**SQL only (proves the gap; do not end here):**

> What is the current status of order 100 in `orders`?  
> How many units of SKU-12 are in `stock`?  
> List open tickets for order 100.  
> List case_notes for order 100.

Then cut, `make demo-reset`, re-take from Beat 2.

---

## Keep off camera

- Long Enable or CloudFormation logs (five seconds max if you must)
- `.env`, passwords, full YAML
- Debugging a broken changefeed live
- Flaticon / avatar slides for Alex vs staff
- Lingering on Acme Supply branding (shop is traffic)
- Claiming Cursor/MCP while only showing Staff chat

## Rehearsal

```bash
make demo-reset
# → Live: history chunks (90 / t-90 / n-90)
# → Live: flash Configure + Enable
# → Shop (fast): Buy → Ship → Report damage → Support ask
# → Live: wait for new chunks
# → Staff: “Why is Alex upset…” → “Where did we leave off…”
# → Close on Live
# → optional Cursor MCP / stock-drop ask
```

## Devpost (text, not on camera)

- **Cockroach:** Distributed Vector Indexing (`agent_memory_chunks`); Cloud Managed MCP (SQL); Memstream MCP `search_memory`
- **AWS:** S3 (changefeed sink), Bedrock (embeddings), Lambda and/or EC2 (worker)
- **Production shape:** memory stays in the customer application DB; console Connect stores encrypted connection pointers; managed worker on AWS
