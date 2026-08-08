#!/usr/bin/env node
/** Create Memstream platform DB and apply sql/memstream.sql (+ seed profiles). */

import { parseArgs } from "node:util";
import { resolveClusterUrl, setupDatabases } from "./setup-db.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "cluster-url": { type: "string" },
      "platform-db": { type: "string", default: "memstream" },
      "application-db": { type: "string", default: "application" },
      "skip-create": { type: "boolean", default: false },
      "skip-app-db": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: memstream-setup-db [--cluster-url URL]

Platform migration only (run once before make web / deploy-aws):
  CREATE DATABASE memstream
  sql/memstream.sql      → platform DB
  profiles/*.yaml        → memstream_profiles

Also creates an empty application DB for demos (schema is NOT applied here).
Application schema (shop + agent_memory_chunks VECTOR) is applied by
Memstream Enable on the Connect URL.

Cluster URL (first match):
  --cluster-url | CLUSTER_URL | COCKROACH_URL | MEMSTREAM_DATABASE_URL | DATABASE_URL

Options:
  --platform-db NAME       default: memstream
  --application-db NAME    default: application (empty DB for Connect)
  --skip-create            only apply platform schema (DBs already exist)
  --skip-app-db            do not CREATE DATABASE application
`);
    return 0;
  }

  const clusterUrl =
    (values["cluster-url"] as string | undefined)?.trim() ||
    resolveClusterUrl();
  if (!clusterUrl) {
    console.error(
      "error: set --cluster-url or CLUSTER_URL / MEMSTREAM_DATABASE_URL in .env",
    );
    return 2;
  }

  const result = await setupDatabases({
    clusterUrl,
    platformDb: values["platform-db"] as string,
    applicationDb: values["application-db"] as string,
    skipCreate: Boolean(values["skip-create"]),
    createApplicationDb: !values["skip-app-db"],
  });

  if (result.created.length) {
    console.log(`created: ${result.created.join(", ")}`);
  } else {
    console.log("skipped CREATE DATABASE");
  }
  console.log(
    `applied: sql/memstream.sql (${result.applied.platform} stmts) → ${result.platformDb}`,
  );
  console.log(
    "application schema: deferred to Memstream Enable (Connect URL)",
  );
  console.log("");
  console.log("Put in .env:");
  console.log(`  MEMSTREAM_DATABASE_URL='${result.platformUrl}'`);
  console.log("");
  console.log("Paste in Connect, then Enable (applies sql/application.sql + vector memory):");
  console.log(`  ${result.applicationUrl}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
