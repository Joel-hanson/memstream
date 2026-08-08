#!/usr/bin/env node
/**
 * Reset demo shop + memory for video rehearsal.
 * Does NOT destroy AWS stacks or changefeeds.
 */

import { rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getActiveConnection } from "./connections.js";
import { withClientObjects } from "./db.js";
import { memstreamDatabaseUrl } from "./runs.js";

function findRepoRoot(from = process.cwd()): string {
  if (existsSync(join(from, "profiles")) && existsSync(join(from, "sql"))) {
    return from;
  }
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "profiles")) && existsSync(join(dir, "sql"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return from;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "database-url": { type: "string" },
      "keep-memory": { type: "boolean", default: false },
      "keep-cdc-inbox": { type: "boolean", default: false },
      "keep-cdc-keys": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: memstream-demo-reset [options]

Resets the commerce demo so you can rehearse ship → ticket → ask:

  • customers Alex/Sam
  • orders 100/101 pending (deletes extra orders)
  • stock SKU-12=40, SKU-99=10
  • deletes all tickets
  • clears agent_memory_chunks (unless --keep-memory)
  • clears data/cdc/inbox (unless --keep-cdc-inbox)
  • clears memstream_cdc_keys on platform DB (unless --keep-cdc-keys)

Application DB URL (first match):
  --database-url | active Connect connection | DATABASE_URL

Does not destroy CloudFormation / changefeeds.
`);
    return 0;
  }

  const root = findRepoRoot();
  let databaseUrl =
    (values["database-url"] as string | undefined)?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "";

  if (!databaseUrl) {
    try {
      const conn = await getActiveConnection(root);
      if (conn?.database_url) databaseUrl = conn.database_url;
    } catch (err) {
      console.error(
        `warn: could not load Connect connection: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  if (!databaseUrl) {
    console.error(
      "error: set --database-url, DATABASE_URL, or save Connect in the console",
    );
    return 2;
  }

  const keepMemory = Boolean(values["keep-memory"]);
  const keepInbox = Boolean(values["keep-cdc-inbox"]);
  const keepCdcKeys = Boolean(values["keep-cdc-keys"]);

  const summary = await withClientObjects(databaseUrl, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id STRING PRIMARY KEY,
        order_id STRING NULL,
        status STRING NOT NULL,
        body STRING NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    await client.query(`DELETE FROM tickets`);
    await client.query(`DELETE FROM orders WHERE id NOT IN ('100', '101')`);

    await client.query(`
      INSERT INTO customers (id, name) VALUES
        ('c1', 'Alex'),
        ('c2', 'Sam')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);

    await client.query(`
      INSERT INTO orders (id, customer_id, status, sku, quantity, note, updated_at)
      VALUES
        ('100', 'c1', 'pending', 'SKU-12', 1, NULL, now()),
        ('101', 'c2', 'pending', 'SKU-99', 1, NULL, now())
      ON CONFLICT (id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        status = 'pending',
        sku = EXCLUDED.sku,
        quantity = EXCLUDED.quantity,
        note = NULL,
        updated_at = now()`);

    await client.query(`
      INSERT INTO stock (sku, warehouse_id, quantity, updated_at) VALUES
        ('SKU-12', 'east', 40, now()),
        ('SKU-99', 'west', 10, now())
      ON CONFLICT (sku) DO UPDATE SET
        warehouse_id = EXCLUDED.warehouse_id,
        quantity = EXCLUDED.quantity,
        updated_at = now()`);

    if (!keepMemory) {
      try {
        await client.query(`DELETE FROM agent_memory_chunks`);
      } catch (err) {
        console.error(
          `warn: could not clear agent_memory_chunks: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    const order100 = (
      await client.query(`SELECT status, sku FROM orders WHERE id = '100'`)
    ).rows[0] as { status?: string; sku?: string } | undefined;
    const ticketCount = Number(
      (await client.query(`SELECT count(*)::int AS n FROM tickets`)).rows[0]
        ?.n ?? 0,
    );
    let chunkCount: number | null = null;
    try {
      chunkCount = Number(
        (
          await client.query(
            `SELECT count(*)::int AS n FROM agent_memory_chunks`,
          )
        ).rows[0]?.n ?? 0,
      );
    } catch {
      chunkCount = null;
    }

    return { order100, ticketCount, chunkCount };
  });

  let inboxCleared = false;
  if (!keepInbox) {
    const inbox = join(root, "data/cdc/inbox");
    if (existsSync(inbox)) {
      rmSync(inbox, { recursive: true, force: true });
      inboxCleared = true;
    }
  }

  let cdcKeysCleared = false;
  if (!keepCdcKeys) {
    const platformUrl = memstreamDatabaseUrl();
    if (platformUrl) {
      try {
        await withClientObjects(platformUrl, async (client) => {
          await client.query(`DELETE FROM memstream_cdc_keys`);
        });
        cdcKeysCleared = true;
      } catch (err) {
        console.error(
          `warn: could not clear memstream_cdc_keys: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  console.log("Demo reset OK");
  console.log(
    `  order 100: ${summary.order100?.status ?? "?"} (${summary.order100?.sku ?? "?"})`,
  );
  console.log(`  tickets: ${summary.ticketCount}`);
  if (keepMemory) {
    console.log("  memory: kept (--keep-memory)");
  } else {
    console.log(`  memory chunks remaining: ${summary.chunkCount ?? "?"}`);
  }
  console.log(`  local cdc inbox: ${inboxCleared ? "cleared" : "kept"}`);
  console.log(
    `  memstream_cdc_keys: ${cdcKeysCleared ? "cleared" : "kept / unavailable"}`,
  );
  console.log("");
  console.log("Next: open /shop → ship 100 → open ticket → ask in Cursor.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
