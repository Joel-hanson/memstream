#!/usr/bin/env node
/**
 * Reset Memstream to a clean demo starting state for video rehearsal.
 *
 * Default (--full): shop seed + clear memory + prune platform clutter +
 * reseed profiles from profiles/*.yaml + clear S3 CDC prefix objects.
 * Does NOT destroy AWS stacks or cancel changefeeds, and keeps the active
 * Connect workspace.
 */

import { rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getActiveConnection } from "./connections.js";
import { clearS3CdcPrefix } from "./console-actions.js";
import { closePools, withClientObjects } from "./db.js";
import { seedDemoHistoryMemory } from "./demo-history.js";
import { forceReseedProfilesFromFiles } from "./profile-store.js";
import { memstreamDatabaseUrl } from "./runs.js";
import { resolveClusterUrl, withDatabaseName } from "./setup-db.js";

const DEFAULTDB_LEFTOVER_TABLES = [
  "agent_memory_chunks",
  "case_notes",
  "tickets",
  "orders",
  "stock",
  "customers",
  "users",
  "memstream_runs",
  "memstream_connections",
  "memstream_cdc_keys",
  "memstream_profiles",
  "memstream_profile_versions",
  "memstream_orgs",
  "memstream_org_invites",
] as const;

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

async function safeDelete(
  client: {
    query: (
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  sql: string,
  params?: unknown[],
): Promise<number> {
  try {
    const result = await client.query(sql, params);
    return result.rows.length;
  } catch (err) {
    console.error(
      `warn: ${sql.split(/\s+/).slice(0, 4).join(" ")}…: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return 0;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "database-url": { type: "string" },
      full: { type: "boolean", default: true },
      shop: { type: "boolean", default: false },
      "keep-memory": { type: "boolean", default: false },
      "keep-cdc-inbox": { type: "boolean", default: false },
      "keep-s3-cdc": { type: "boolean", default: false },
      "keep-cdc-keys": { type: "boolean", default: false },
      "keep-runs": { type: "boolean", default: false },
      "keep-inactive-connections": { type: "boolean", default: false },
      "keep-profiles": { type: "boolean", default: false },
      "keep-orgs": { type: "boolean", default: false },
      "skip-defaultdb": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: memstream-demo-reset [options]

Reset to a clean demo beginning (ship → ticket → ask).

Default (--full):
  Application DB
  • customers Alex/Sam; orders 90 (past) + 100/101 pending; stock SKU-12=40, SKU-99=10
  • seed closed ticket t-90 + case note n-90 (Alex late-delivery backstory)
  • delete other tickets / case notes / extra orders
  • reset saas-security users seed (u1 member / u2 owner)
  • clear agent_memory_chunks, then re-embed curated history (Bedrock)

  Platform DB (MEMSTREAM_DATABASE_URL)
  • clear memstream_cdc_keys
  • clear memstream_runs
  • delete inactive memstream_connections (keep active workspace)
  • clear memstream_orgs / memstream_org_invites
  • clear memstream_profile_versions
  • force-reseed memstream_profiles from profiles/*.yaml as builtin

  Local / S3 / leftovers
  • clear data/cdc/inbox
  • clear objects under CDC S3 prefix (bucket/prefix from Connect or CDC_S3_*)
  • drop leftover demo tables from defaultdb (early-dev junk)

  --shop                 shop + memory only (legacy narrow reset)
  --keep-memory          do not clear or re-seed agent_memory_chunks
  --keep-cdc-inbox       keep data/cdc/inbox
  --keep-s3-cdc          keep S3 objects under the CDC prefix
  --keep-cdc-keys        keep memstream_cdc_keys
  --keep-runs            keep memstream_runs
  --keep-inactive-connections
  --keep-profiles        do not overwrite user-edited profiles
  --keep-orgs            keep orgs / invites
  --skip-defaultdb       do not touch defaultdb

Application DB URL (first match):
  --database-url | active Connect connection | DATABASE_URL

Does not destroy CloudFormation / cancel changefeeds (S3 CDC objects only).
After pulling case_notes into commerce profile, re-Enable (or recreate the
changefeed) so live support handoffs stream into memory.
`);
    return 0;
  }

  const root = findRepoRoot();
  const shopOnly = Boolean(values.shop);
  const full = shopOnly ? false : values.full !== false;

  let databaseUrl =
    (values["database-url"] as string | undefined)?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "";
  let cdcBucket = process.env.CDC_S3_BUCKET?.trim() || "";
  let cdcPrefix = process.env.CDC_S3_PREFIX?.trim() || "cdc/";
  let cdcRegion = process.env.AWS_REGION?.trim() || "us-east-1";

  try {
    const conn = await getActiveConnection(root);
    if (!databaseUrl && conn?.database_url) databaseUrl = conn.database_url;
    if (conn?.bucket?.trim()) cdcBucket = conn.bucket.trim();
    if (conn?.prefix?.trim()) cdcPrefix = conn.prefix.trim();
    if (conn?.region?.trim()) cdcRegion = conn.region.trim();
  } catch (err) {
    console.error(
      `warn: could not load Connect connection: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  if (!databaseUrl) {
    console.error(
      "error: set --database-url, DATABASE_URL, or save Connect in the console",
    );
    return 2;
  }

  const keepMemory = Boolean(values["keep-memory"]);
  const keepInbox = Boolean(values["keep-cdc-inbox"]);
  const keepS3Cdc = Boolean(values["keep-s3-cdc"]);
  const keepCdcKeys = Boolean(values["keep-cdc-keys"]);
  const keepRuns = Boolean(values["keep-runs"]);
  const keepInactive = Boolean(values["keep-inactive-connections"]);
  const keepProfiles = Boolean(values["keep-profiles"]);
  const keepOrgs = Boolean(values["keep-orgs"]);
  const skipDefaultdb = Boolean(values["skip-defaultdb"]);

  const summary = await withClientObjects(databaseUrl, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id STRING PRIMARY KEY,
        order_id STRING NULL,
        status STRING NOT NULL,
        body STRING NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS case_notes (
        id STRING PRIMARY KEY,
        order_id STRING NULL,
        ticket_id STRING NULL,
        author STRING NOT NULL,
        body STRING NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    await client.query(`DELETE FROM case_notes`);
    await client.query(`DELETE FROM tickets`);
    await client.query(`DELETE FROM orders WHERE id NOT IN ('90', '100', '101')`);

    await client.query(`
      INSERT INTO customers (id, name) VALUES
        ('c1', 'Alex'),
        ('c2', 'Sam')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);

    await client.query(`
      INSERT INTO orders (id, customer_id, status, sku, quantity, note, updated_at)
      VALUES
        ('90', 'c1', 'shipped', 'SKU-12', 1, 'Shipped 1× SKU-12 for Alex', now()),
        ('100', 'c1', 'pending', 'SKU-12', 1, NULL, now()),
        ('101', 'c2', 'pending', 'SKU-99', 1, NULL, now())
      ON CONFLICT (id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        status = EXCLUDED.status,
        sku = EXCLUDED.sku,
        quantity = EXCLUDED.quantity,
        note = EXCLUDED.note,
        updated_at = now()`);

    // Live demo order must start pending even if EXCLUDED.status was wrong on conflict path
    await client.query(`
      UPDATE orders SET status = 'pending', note = NULL, updated_at = now()
      WHERE id IN ('100', '101')`);
    await client.query(`
      UPDATE orders SET status = 'shipped',
        note = 'Shipped 1× SKU-12 for Alex', updated_at = now()
      WHERE id = '90'`);

    await client.query(`
      INSERT INTO tickets (id, order_id, status, body, updated_at) VALUES
        (
          't-90',
          '90',
          'closed',
          'Alex reported late delivery on Field Lamp order 90; shipping credit issued and case closed.',
          now()
        )
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        status = EXCLUDED.status,
        body = EXCLUDED.body,
        updated_at = now()`);

    await client.query(`
      INSERT INTO case_notes (id, order_id, ticket_id, author, body, updated_at) VALUES
        (
          'n-90',
          '90',
          't-90',
          'staff',
          'Follow-up with Alex on late Field Lamp order 90 — shipping credit issued; case closed. Resume only if a new ticket opens.',
          now()
        )
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        ticket_id = EXCLUDED.ticket_id,
        author = EXCLUDED.author,
        body = EXCLUDED.body,
        updated_at = now()`);

    await client.query(`
      INSERT INTO stock (sku, warehouse_id, quantity, updated_at) VALUES
        ('SKU-12', 'east', 40, now()),
        ('SKU-99', 'west', 10, now())
      ON CONFLICT (sku) DO UPDATE SET
        warehouse_id = EXCLUDED.warehouse_id,
        quantity = EXCLUDED.quantity,
        updated_at = now()`);

    // saas-security demo seed (roles drift during rehearsal)
    try {
      await client.query(`
        INSERT INTO users (id, org_id, email, role, updated_at) VALUES
          ('u1', 'org-acme', 'admin@acme.test', 'member', now()),
          ('u2', 'org-acme', 'boss@acme.test', 'owner', now())
        ON CONFLICT (id) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          updated_at = now()`);
    } catch (err) {
      console.error(
        `warn: could not reset users: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

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
    const noteCount = Number(
      (await client.query(`SELECT count(*)::int AS n FROM case_notes`)).rows[0]
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

    return { order100, ticketCount, noteCount, chunkCount };
  });

  let historySeeded: number | null = null;
  if (!keepMemory) {
    try {
      let connectionId: string | null = null;
      try {
        const conn = await getActiveConnection(root);
        connectionId = conn?.id ?? null;
      } catch {
        /* optional scope */
      }
      historySeeded = await seedDemoHistoryMemory({
        databaseUrl,
        connectionId,
        region: process.env.AWS_REGION || undefined,
      });
      summary.chunkCount = historySeeded;
    } catch (err) {
      console.error(
        `warn: could not seed demo history memory (Bedrock?): ${
          err instanceof Error ? err.message : err
        }`,
      );
      historySeeded = null;
    }
  }

  let inboxCleared = false;
  if (!keepInbox) {
    const inbox = join(root, "data/cdc/inbox");
    if (existsSync(inbox)) {
      rmSync(inbox, { recursive: true, force: true });
      inboxCleared = true;
    }
  }

  let s3Deleted: number | null = null;
  let s3Skipped: "kept" | "no-bucket" | "error" | null = null;
  if (keepS3Cdc) {
    s3Skipped = "kept";
  } else if (!cdcBucket) {
    s3Skipped = "no-bucket";
  } else {
    try {
      const cleared = await clearS3CdcPrefix(cdcBucket, cdcPrefix, cdcRegion);
      if (cleared == null) {
        s3Skipped = "no-bucket";
      } else {
        s3Deleted = cleared.deleted;
      }
    } catch (err) {
      s3Skipped = "error";
      console.error(
        `warn: could not clear s3://${cdcBucket}/${cdcPrefix.replace(/^\//, "")}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  const platform: {
    cdcKeys: number | null;
    runs: number | null;
    inactiveConnections: number | null;
    orgs: number | null;
    invites: number | null;
    profileVersions: number | null;
    profilesReseeded: number | null;
    activeConnectionId: string | null;
  } = {
    cdcKeys: null,
    runs: null,
    inactiveConnections: null,
    orgs: null,
    invites: null,
    profileVersions: null,
    profilesReseeded: null,
    activeConnectionId: null,
  };

  if (full) {
    const platformUrl = memstreamDatabaseUrl(root);
    if (!platformUrl) {
      console.error(
        "warn: MEMSTREAM_DATABASE_URL unset — skipped platform cleanup",
      );
    } else {
      await withClientObjects(platformUrl, async (client) => {
        if (!keepCdcKeys) {
          const before = await client.query(
            `SELECT count(*)::int AS n FROM memstream_cdc_keys`,
          );
          await client.query(`DELETE FROM memstream_cdc_keys`);
          platform.cdcKeys = Number(before.rows[0]?.n ?? 0);
        }

        if (!keepRuns) {
          platform.runs = await safeDelete(
            client,
            `DELETE FROM memstream_runs RETURNING id::text`,
          );
        }

        if (!keepInactive) {
          platform.inactiveConnections = await safeDelete(
            client,
            `DELETE FROM memstream_connections
             WHERE is_active = false
             RETURNING id::text`,
          );
        }

        if (!keepOrgs) {
          platform.invites = await safeDelete(
            client,
            `DELETE FROM memstream_org_invites RETURNING code`,
          );
          platform.orgs = await safeDelete(
            client,
            `DELETE FROM memstream_orgs RETURNING id`,
          );
        }

        if (!keepProfiles) {
          platform.profileVersions = await safeDelete(
            client,
            `DELETE FROM memstream_profile_versions RETURNING profile_id`,
          );
        }

        const active = await client.query(
          `SELECT id::text AS id FROM memstream_connections
           WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`,
        );
        platform.activeConnectionId =
          (active.rows[0]?.id as string | undefined) ?? null;
      });

      if (!keepProfiles) {
        try {
          platform.profilesReseeded = await forceReseedProfilesFromFiles(root);
        } catch (err) {
          console.error(
            `warn: could not reseed profiles: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
  } else if (!keepCdcKeys) {
    // Narrow --shop path: still clear CDC keys when platform URL is set
    const platformUrl = memstreamDatabaseUrl(root);
    if (platformUrl) {
      try {
        await withClientObjects(platformUrl, async (client) => {
          const before = await client.query(
            `SELECT count(*)::int AS n FROM memstream_cdc_keys`,
          );
          await client.query(`DELETE FROM memstream_cdc_keys`);
          platform.cdcKeys = Number(before.rows[0]?.n ?? 0);
        });
      } catch (err) {
        console.error(
          `warn: could not clear memstream_cdc_keys: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  let defaultdbDropped = 0;
  if (full && !skipDefaultdb) {
    const clusterUrl = resolveClusterUrl(process.env, root);
    if (clusterUrl) {
      try {
        const defaultdbUrl = withDatabaseName(clusterUrl, "defaultdb");
        await withClientObjects(defaultdbUrl, async (client) => {
          for (const table of DEFAULTDB_LEFTOVER_TABLES) {
            const existing = await client.query(
              `SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = $1`,
              [table],
            );
            if (existing.rows.length === 0) continue;
            await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
            defaultdbDropped += 1;
          }
        });
      } catch (err) {
        console.error(
          `warn: defaultdb cleanup: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  console.log(full ? "Full demo reset OK" : "Shop demo reset OK");
  console.log(
    `  order 100: ${summary.order100?.status ?? "?"} (${summary.order100?.sku ?? "?"})`,
  );
  console.log(
    `  tickets: ${summary.ticketCount} · case notes: ${summary.noteCount}`,
  );
  if (keepMemory) {
    console.log("  memory: kept (--keep-memory)");
  } else if (historySeeded != null) {
    console.log(`  memory history seeded: ${historySeeded} chunks`);
  } else {
    console.log(
      `  memory chunks remaining: ${summary.chunkCount ?? "?"} (history seed skipped)`,
    );
  }
  console.log(`  local cdc inbox: ${inboxCleared ? "cleared" : "kept"}`);
  if (s3Deleted != null) {
    console.log(
      `  s3 cdc prefix cleared: ${s3Deleted} object(s) (s3://${cdcBucket}/${cdcPrefix.replace(/^\//, "")})`,
    );
  } else if (s3Skipped === "kept") {
    console.log("  s3 cdc prefix: kept (--keep-s3-cdc)");
  } else if (s3Skipped === "no-bucket") {
    console.log("  s3 cdc prefix: skipped (no CDC_S3_BUCKET / Connect bucket)");
  } else if (s3Skipped === "error") {
    console.log("  s3 cdc prefix: failed (see warn above)");
  }
  if (platform.cdcKeys != null) {
    console.log(`  memstream_cdc_keys cleared: ${platform.cdcKeys}`);
  }
  if (full) {
    if (platform.runs != null) {
      console.log(`  memstream_runs deleted: ${platform.runs}`);
    }
    if (platform.inactiveConnections != null) {
      console.log(
        `  inactive connections deleted: ${platform.inactiveConnections}`,
      );
    }
    if (platform.activeConnectionId) {
      console.log(`  active connection kept: ${platform.activeConnectionId}`);
    } else {
      console.log("  active connection: none (re-save Connect before Enable)");
    }
    if (platform.orgs != null || platform.invites != null) {
      console.log(
        `  orgs/invites deleted: ${platform.orgs ?? 0}/${platform.invites ?? 0}`,
      );
    }
    if (platform.profilesReseeded != null) {
      console.log(
        `  profiles reseeded from profiles/*.yaml: ${platform.profilesReseeded}`,
      );
    }
    if (defaultdbDropped > 0) {
      console.log(`  defaultdb leftover tables dropped: ${defaultdbDropped}`);
    }
  }
  console.log("");
  console.log(
    "Next: open /shop → ship 100 → open ticket → ask Support/Staff (handoff saves to case_notes).",
  );
  await closePools();
  return 0;
}

main().then(
  (code) => process.exit(code),
  async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closePools().catch(() => undefined);
    process.exit(1);
  },
);
