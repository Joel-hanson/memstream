# Memstream demo script (video + ask)

Print [DEMO_PRINT.html](DEMO_PRINT.html) (cue card + script) and keep it next to the keyboard. About three minutes on camera.

Show the AWS demo box, not localhost. Console, shop, and worker run on EC2 (`make deploy-aws`). Cloud setup: [AWS.md](AWS.md). Overview: [README](../README.md).

---

## What you are showing (read once before you record)

Memstream is the product. If an application uses CockroachDB, that structured data is already there. Cockroach MCP can query those live tables. What an agent still does not have is meaning (what sku and status actually meant) or a searchable story of what happened over time. Getting that from SQL takes several lookups, and you still do not have a sentence you can search later. Memstream watches the writes (changefeeds), turns selected columns into plain-language memory, embeds on AWS with Bedrock, and stores searchable vectors back in the same Cockroach database next to the app tables. No separate vector DB. As the app keeps writing, memory grows with it.

The console is where you connect a Cockroach app database, pick what to remember (here the `commerce` profile: orders, stock, tickets, case notes), enable the pipeline, and watch memory chunks land live.

The shop (Acme Supply) is not the product. It is demo traffic: a tiny lamp storefront that writes the same kinds of rows a real commerce app would.

It has the two sides any ecommerce app has, and the demo uses both. The Shop tab is the customer storefront where Alex browses and buys. The Staff tab is the admin side where support ships orders and answers tickets. Both write to the same Cockroach database, which is why one demo can show a customer complaint on one side and the agent answering it on the other.

In the story, customer Alex ordered a Field Lamp (SKU-12) as order 90 back in July. Alex mentioned being away Monday through Friday for work and only home on weekends, which is why that delivery had to be rescheduled to a Saturday — case note n-89. It still arrived late, so support issued a shipping credit and closed ticket t-90 with case note n-90. That history, including the weekend-only preference, is already in memory when you start.

Today Alex buys another Field Lamp, order 100; staff ships it; it arrives damaged. When Alex reports the damage, the ticket auto-schedules pickup for the weekend — the app is reusing that same stored preference. Alex messages support asking why the pickup hasn't happened yet, gets the weekend answer, then replies that they're actually free this week. That correction becomes a new handoff note. Then staff asks Memstream what's going on with the pickup: memory surfaces the original weekend-only preference, the live conflict note shows it's now outdated, and SQL confirms the ticket. It is the same "stale memory" problem Memstream exists to catch, staged inside the demo itself.

Names the judges hear on camera: Acme Supply (the demo store), Alex (the customer), Field Lamp (the product, SKU-12). Introduce each one before you use it.

If someone muted the audio, Live chunks should still carry half the video.

---

## Deploy the demo box (off camera)

One-time / before rehearsal. Full checklist: [AWS.md](AWS.md) sections 1 through 9.

```bash
# .env ready: MEMSTREAM_DATABASE_URL, MEMSTREAM_SECRETS_KEY, CDC_S3_BUCKET, AWS_REGION, …
# Docker running (Colima / OrbStack / Desktop). Builds Next standalone for the instance.

MEMSTREAM_WORKER_COMPUTE=ec2 make deploy-aws
# optional: SHOP_CIDR=YOUR_PUBLIC_IP/32
# wait until the script prints "Shop is up" (~1-2 min after stack create)
```

CloudFormation outputs (also printed by the script):

| Output | Use |
| --- | --- |
| **ConsoleUrl** | Memstream console (`https://<public-ip>.sslip.io/`) |
| **ShopUrl** | Example Acme shop (`https://shop.<public-ip>.sslip.io/`) |

On the box: Caddy terminates free Let's Encrypt TLS; console/shop backends on localhost; worker as `memstream-watch` (do not also run Lambda on the same CDC prefix). No paid domain. sslip.io maps the IP to hostnames.

1. Open **ConsoleUrl** → `/login` with `demo` / `demo` (when demo operators are configured).
2. **Use demo workspace** (or Connect with the application URL).
3. **Configure** `commerce` → **Enable** (changefeed on orders, stock, tickets, **case_notes**). Skip long CFN logs on camera.
4. `make demo-reset` then **Enable** again (reset cancels changefeed jobs). Confirm Live shows history chunks.

Update code on the instance: `make destroy-aws && make deploy-aws`. Tear down EC2 only: `make destroy-aws`.

---

## MCP setup (off camera)

Hybrid ask: Memstream `search_memory` + Cockroach Cloud MCP (SQL).
Configure via console or Memstream MCP: prompt `make_memory_profile` (reads `memstream://schema` + `memstream://profile-guide`) → `save_memory_profile`, or heuristic `propose_memory_profile`.

**How the two MCPs reach Cockroach**

| Server | Auth | How it reaches data |
| --- | --- | --- |
| **Memstream MCP** (`/api/mcp`) | Same as console: Basic `demo:demo` **or** Bearer `MEMSTREAM_MCP_TOKEN` | Uses the **application DATABASE_URL** already saved in Connect (demo workspace / paste URL / Cloud API key flow). No Cloud OAuth. |
| **Cockroach Cloud MCP** | Cloud console / Cursor OAuth for that MCP | Talks to Cloud's managed SQL API for exact rows. Separate product. Add it next to Memstream in Cursor. |

1. EC2 demo box is up (**ConsoleUrl** healthy).
2. **Copy Memstream MCP** in Live or Ops tools → Cursor Settings → MCP (includes `headers.Authorization` when login is enabled). Prefer the public console base so Cursor hits AWS, not laptop:

```json
{
  "mcpServers": {
    "memstream": {
      "url": "https://YOUR_PUBLIC_IP.sslip.io/api/mcp",
      "headers": {
        "Authorization": "Basic ZGVtbzpkZW1v"
      }
    }
  }
}
```

(`Basic ZGVtbzpkZW1v` is `demo:demo`. Or set `MEMSTREAM_MCP_TOKEN` and Copy MCP will emit Bearer instead. Paste the real host from **ConsoleUrl**. No trailing slash before `/api/mcp`.)

3. Cockroach Cloud console → MCP → add next to Memstream (prefer read-only). That path is Cloud's auth, not demo/demo.

Laptop alternatives (backup only): `make web` + local MCP, or `make mcp` / `make mcp-stdio`. Hero take uses the AWS URLs.

---

## Before you hit record

- [ ] `make deploy-aws` finished; **ConsoleUrl** and **ShopUrl** open in the browser (not `127.0.0.1`)
- [ ] Logged in on console (`demo` / `demo` when configured); demo workspace connected
- [ ] Cloud path is live (changefeed on orders, stock, tickets, **case_notes**; worker on the EC2 box)
- [ ] If you just pulled `case_notes` into `commerce`, **re-Enable** once so the feed includes it
- [ ] Cursor has Memstream MCP pointed at the **EC2** `/api/mcp` and Cockroach Cloud MCP (Path B / backup)
- [ ] Profile is `commerce` (Configure / Enable already done once)
- [ ] Reset from your laptop (re-embeds Alex's past order 90 into memory via Bedrock):

```bash
make demo-reset
```

That also cancels Memstream changefeed jobs and clears the S3 CDC prefix. **Enable** again off camera so a fresh feed is running before you record.

- [ ] On **ShopUrl** (`shop.<ip>.sslip.io`), order 100 is pending for SKU-12; order 90 shows shipped (backstory)
- [ ] Live shows a few **history** chunks (order 90 / t-90 / n-89 weekend-availability / n-90), not clutter from a prior take
- [ ] Changefeed is running again after Enable (orders, stock, tickets, **case_notes**)
- [ ] Rehearse chunk lag after Ship / Report damage / Support ask

Bad take? `make demo-reset` again, **Enable**, wait for Live to settle, restart from the top of the script.

---

## Screen map (silent; do not read aloud)

| Time | Window | What you do |
| --- | --- | --- |
| 0:00 | Live (**ConsoleUrl**) | Hook: rows are already there, MCP can query them, they are not memory yet |
| 0:45 | Live | Introduce Acme Supply and Alex; point at order 90 and n-89 |
| 1:05 | Live: Configure + Enable | Flash commerce tables and live status; do not re-run a long Enable |
| 1:20 | Shop (**ShopUrl**) | Name both sides, then Shop tab: Buy → Staff tab: Ship → Shop tab: Report damage → Support: "why hasn't my damaged lamp been picked up?" → "actually I'm free this week" |
| 2:05 | Live | Wait for ship / ticket / case_notes chunks |
| 2:25 | Staff tab → Ask the agent | Three prompts below |
| 3:00 | Live | End on chunks; leave on Memstream |

Prefer cuts over dead air while waiting for chunks. Skip Flaticon / avatar slides. Use Shop / Staff tabs; say "as Alex" / "as staff" if you need labels. Do not linger on the EC2 hostname or CloudFormation.

Running long? Cut the lines marked *(trim)* in the script. They are context, not proof.

---

## Script (read this on camera)

Read the plain paragraphs aloud. Stage directions in parentheses stay silent. Assume the judge has never seen this app, so every name (Acme Supply, Alex, Field Lamp) gets introduced before it is used.

### The problem (0:00)

*(Live console on ConsoleUrl. Do not click anything yet. Speak this at a normal pace; do not rush the hook.)*

Memstream is the product. If an application uses CockroachDB, that structured data is already there. Cockroach MCP can query those live tables. What an agent still does not have is meaning (what sku and status actually meant) or a searchable story of what happened over time.

Getting that from SQL takes several lookups, and you still do not have a sentence you can search later.

Memstream watches the writes (changefeeds), turns selected columns into plain-language memory, embeds on AWS with Bedrock, and stores searchable vectors back in the same Cockroach database next to the app tables. No separate vector DB. As the app keeps writing, memory grows with it.

### What you are looking at (0:45)

*(Still on Live. Point at the order 90 shipped chunk, then n-89 if you need the weekend beat.)*

This is the Memstream console. It is watching a demo store called Acme Supply that sells lamps.

It writes to Cockroach like any normal application: orders, stock levels, support tickets, and the notes support staff leave each other. *(trim)*

Every card in this feed is memory Memstream built from one of those writes. This one is from last month. A customer named Alex ordered a Field Lamp, order 90, and mentioned being away on weekdays, only home on weekends. That's why the delivery moved to a Saturday. It still arrived late, so support issued a credit and closed the case. The chunk reads like a sentence, not a database row.

### Setup (1:05)

*(Open Configure. Show commerce and the remembered tables: orders, stock, tickets, case notes. Close. Flash Enable and the live status for a few seconds. Do not re-run a long Enable. Back to Live.)*

Setup is three steps. Connect the application database, choose what to remember from the schema (here: orders, stock, tickets, and case notes), then enable it. Memstream opens a changefeed on those tables. The memory stays inside the customer's own database.

### Live traffic (1:20)

*(Cut to ShopUrl. Keep storefront time short and keep talking through the clicks.)*

Now some live traffic. Acme Supply is a normal ecommerce app, so it has two sides. This is the storefront that customers see, and there is a staff side where support ships orders and answers tickets. I will use both, and they write to the same database.

*(Shop tab. Buy the Field Lamp, or use seeded order 100.)*

As Alex, the customer, I buy another Field Lamp. That is order 100, a real row in Cockroach.

*(Switch to the Staff tab. Point at it so the persona change is obvious.)*

Switching to the staff side, the admin view Acme employees work in. I ship the order.

*(Staff → Ship.)*

*(Back to the Shop tab.)*

Back as Alex: the lamp arrives damaged. I file a damage report — and because Memstream remembers Alex is usually away on weekdays, from that order 90 story, the ticket auto-schedules pickup for the weekend.

*(Shop → Report damage. Support ask: "Why hasn't my damaged lamp been picked up?")*

But this week is different — Alex is actually free. I say so in the same chat.

*(Support ask: "Actually, I'm free this week — can you come sooner?")*

That reply doesn't just get acknowledged — it's saved as a new note support can act on. On the staff side, support leaves a handoff note for whoever picks the case up next.

### The receipt (2:05)

*(Cut back to Live. Hold while the new ship, ticket, and case note chunks appear.)*

Back on Live: the shipment, the new ticket, and the support handoff. Bedrock embedded each one. The vectors sit in Cockroach beside the app data, seconds old, with no separate vector database.

*(Optional five-second glance at VECTOR INDEX on agent_memory_chunks. If chunks are slow, say the line once, wait, do not debug on camera.)*

### The payoff (2:25)

*(Staff tab → Ask the agent. Frame this as the Memstream ask, not a shop feature tour.)*

Back on the staff side. Support has an agent built into the admin view, and it starts with the problem every support desk has: an upset customer and no history. *(trim)*

*(Click:)*

```text
Why is Alex upset about the Field Lamp?
```

It searches Memstream memory first, finds the late delivery from last month and today's damaged lamp, then confirms the live details with SQL.

*(Wait for the answer. Point at the expanded memory citations.)*

That answer ties two incidents a month apart. You would not get that from a single row lookup.

*(Click:)*

```text
Where did we leave off on Alex's Field Lamp case?
```

This is the question support teams ask all the time. The agent reads the handoff note and picks up where the last person stopped.

*(Click:)*

```text
Why hasn't Alex's damaged lamp been picked up?
```

Here is the twist. Memory remembers Alex from a month ago as weekend-only, so the pickup got scheduled for Saturday. But the agent also surfaces the brand new note from a minute ago — Alex is free this week — and flags that the stored preference is stale. That is not a single row anyone would have caught. It is memory built from two moments a month apart, and it just told support the assumption it made was wrong.

### Close (3:00)

*(Cut back to Live with chunks and case_notes visible. A brief flash of the staff answer is fine; end on Live.)*

That is Memstream. Your app keeps writing to CockroachDB. Your agents get live memory of what happened, in the same database, embedded on AWS. They can answer what happened over time, not only what the row says right now.

*(Stop. No architecture slides. No tear-down on camera.)*

---

## Optional Path B (Q&A / backup)

Same `commerce` profile. Skip in the hero take unless Staff chat fails or a judge asks.

In Cursor, with Memstream MCP (EC2 URL) + Cockroach Cloud MCP:

```text
Why is Alex upset about the Field Lamp?
1) Call Memstream search_memory first and cite the chunks.
2) Then use Cockroach Cloud MCP SQL to confirm order 100, tickets, and SKU-12 stock.
Answer in short bullets: what memory shows, what SQL confirms.
```

Say if you cut here: "Same hybrid idea over MCP: Memstream for change memory, Cockroach for exact rows."

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

Say: "Memory builds up over time. The agent can find similar stock drops, not only the latest row."

`saas-security` profile: under **Optional: role change**, promote `admin@acme.test` to admin, then **Copy role-change ask**.

---

## Extra prompts

**Backup if Staff ask fails:**

```text
What happened around order 100 recently (shipping and support)?
```

**Backup if Cursor ask fails:**

```text
What happened around order 100 recently (shipping and support)?
Use search_memory, cite chunk text, then confirm with SQL.
```

**Resume backup:**

```text
Where did we leave off on Alex's Field Lamp case?
Use search_memory for case_notes and tickets, then confirm with SQL.
```

**Pickup-conflict backup:**

```text
Why hasn't Alex's damaged lamp been picked up?
Use search_memory to find the weekend-only preference from order 90 and any newer note about this week, then confirm the ticket with SQL.
```

**SQL only (proves the gap; do not end here):**

> What is the current status of order 100 in `orders`?  
> How many units of SKU-12 are in `stock`?  
> List open tickets for order 100.  
> List case_notes for order 100.

Then cut, `make demo-reset`, re-take from the shop beat.

---

## Keep off camera

- Long Enable or CloudFormation logs (five seconds max if you must)
- Deploy / `make deploy-aws` / Docker build (do this before record)
- `.env`, passwords, full YAML, Secrets Manager ARNs
- Debugging a broken changefeed or empty ShopUrl live
- Flaticon / avatar slides for Alex vs staff
- Lingering on Acme Supply branding (shop is traffic)
- Claiming Cursor/MCP while only showing Staff chat
- Localhost tabs (`127.0.0.1:3000` / `:3001`); use **ConsoleUrl** / **ShopUrl** instead

## Rehearsal

```bash
make deploy-aws          # once; reuse the stack between takes
make demo-reset          # from laptop against the cloud DBs
# → Console: Enable (changefeed was canceled by reset)
# → Browser: ConsoleUrl → Live: history chunks (90 / t-90 / n-89 / n-90)
# → Live: flash Configure + Enable
# → ShopUrl (shop.<ip>.sslip.io, fast): Buy → Ship → Report damage
#   → Support: "Why hasn't my damaged lamp been picked up?" → "Actually, I'm free this week…"
# → Live: wait for new chunks
# → Staff: "Why is Alex upset…" → "Where did we leave off…" → "Why hasn't Alex's damaged lamp been picked up?"
# → Close on Live
# → optional Cursor MCP (EC2 /api/mcp) / stock-drop ask
```

## Devpost (text, not on camera)

- **Cockroach:** Distributed Vector Indexing (`agent_memory_chunks`); Cloud Managed MCP (SQL); Memstream MCP (`search_memory` + `propose_memory_profile` / `list_watchable_tables`)
- **AWS:** S3 (changefeed sink), Bedrock (embeddings), EC2 demo box (console + shop + worker); Lambda optional as managed worker alternate
- **Production shape:** memory stays in the customer application DB; console Connect stores encrypted connection pointers; pipeline on AWS
- **Judge path:** Open **ConsoleUrl** (`/login` with demo/demo when configured) → **Use demo workspace** → **ShopUrl** (`shop.<ip>.sslip.io`) for traffic. Operators set `DEMO_APPLICATION_DATABASE_URL` or rely on derive from `MEMSTREAM_DATABASE_URL` (`/memstream` → `/application`), then Configure commerce + Enable once. Deploy: `MEMSTREAM_WORKER_COMPUTE=ec2 make deploy-aws`.
