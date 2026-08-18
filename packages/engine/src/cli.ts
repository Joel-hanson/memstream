#!/usr/bin/env node
/** CLI entrypoint for Memstream (local + cloud backends). */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getActiveConnection } from "./connections.js";
import {
  buildEmbedder,
  buildEventSource,
  buildStore,
} from "./factory.js";
import { InMemoryMemoryStore } from "./fakes.js";
import { runPollLoop } from "./loop.js";
import { Indexer } from "./pipeline.js";
import { resolveProfile } from "./profile-store.js";
import { repoRoot } from "./console-actions.js";
import { cdcWatchPrefix } from "./cdc-prefix.js";
import {
  newCdcProfileCache,
  processCdcS3Prefix,
} from "./cdc-route.js";
import { createShutdownController } from "./shutdown.js";
import { closePools } from "./db.js";
import { getPlatformState } from "./state-manager.js";

function envFlag(name: string): boolean {
  const v = (process.env[name] || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      profile: {
        type: "string",
        default: process.env.MEMORY_PROFILE || "commerce",
      },
      source: {
        type: "string",
        default: process.env.MEMSTREAM_SOURCE || "filesystem",
      },
      events: { type: "string" },
      "events-dir": {
        type: "string",
        default: process.env.MEMSTREAM_EVENTS_DIR || "data/cdc/inbox",
      },
      "s3-bucket": {
        type: "string",
        default: process.env.CDC_S3_BUCKET,
      },
      "s3-prefix": {
        type: "string",
        default: process.env.CDC_S3_PREFIX || "cdc/",
      },
      "state-file": {
        type: "string",
        default: process.env.MEMSTREAM_STATE_FILE,
      },
      embedder: {
        type: "string",
        default: process.env.MEMSTREAM_EMBEDDER || "fake",
      },
      store: {
        type: "string",
        default: process.env.MEMSTREAM_STORE || "memory",
      },
      "database-url": {
        type: "string",
        default: process.env.DATABASE_URL,
      },
      "aws-region": {
        type: "string",
        default: process.env.AWS_REGION || "us-east-1",
      },
      "connection-id": { type: "string" },
      watch: { type: "boolean", default: envFlag("MEMSTREAM_WATCH") },
      "poll-interval": {
        type: "string",
        default: process.env.MEMSTREAM_POLL_INTERVAL || "5",
      },
      "dump-store": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`Usage: memstream [options]

Options:
  --profile PATH          Memory profile YAML
  --source KIND           jsonl|filesystem|s3
  --events PATH           JSONL file when --source jsonl
  --events-dir PATH       CDC inbox when --source filesystem
  --s3-bucket NAME        S3 bucket when --source s3
  --s3-prefix PREFIX      S3 key prefix (default cdc/)
  --state-file PATH       Force local JSON cursor (default: Memstream DB)
  --embedder KIND         fake|bedrock
  --store KIND            memory|cockroach
  --database-url URL      App Cockroach URL (or active memstream_connections)
  --connection-id UUID    Memstream connection scope for CDC cursor
  --aws-region REGION     AWS region for Bedrock/S3
  --watch                 Keep polling
  --poll-interval SECS    Watch interval (default 5)
  --dump-store PATH       Write chunks JSON (memory store)
`);
    return 0;
  }

  const root = repoRoot();
  let databaseUrl = (values["database-url"] as string | undefined)?.trim() || "";
  let s3Bucket = (values["s3-bucket"] as string | undefined)?.trim() || "";
  let s3Prefix = (values["s3-prefix"] as string | undefined)?.trim() || "cdc/";
  let awsRegion = (values["aws-region"] as string) || "us-east-1";
  let connectionId =
    (values["connection-id"] as string | undefined)?.trim() || "";

  const sourceKind = values.events ? "jsonl" : (values.source as string);
  const storeKind = (values.store as string) || "memory";
  // Offline jsonl + memory store never needs Connect / platform DB.
  const offline =
    sourceKind === "jsonl" &&
    storeKind === "memory" &&
    (values.embedder as string) === "fake";

  if (!offline) {
    try {
      const conn = await getActiveConnection(root);
      if (conn) {
        if (!databaseUrl) databaseUrl = conn.database_url;
        if (!s3Bucket && conn.bucket) s3Bucket = conn.bucket;
        if (conn.prefix) s3Prefix = conn.prefix;
        if (conn.region) awsRegion = conn.region;
        if (!connectionId) connectionId = conn.id;
        console.log(
          `Using Memstream connection ${conn.database_label || conn.id}`,
        );
      }
    } catch (err) {
      console.warn(
        `warn: could not load memstream_connections: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  if (sourceKind === "jsonl" && !values.events) {
    console.error("error: --events is required for --source jsonl");
    return 2;
  }
  if (values.watch && sourceKind === "jsonl") {
    console.error("error: --watch is for filesystem or s3 sources");
    return 2;
  }
  if (sourceKind === "s3" && !s3Bucket) {
    console.error(
      "error: set CDC via Connect (memstream_connections) or --s3-bucket / CDC_S3_BUCKET",
    );
    return 2;
  }
  if (storeKind === "cockroach" && !databaseUrl) {
    console.error(
      "error: set application DB via Connect or --database-url / DATABASE_URL",
    );
    return 2;
  }

  const profile = await resolveProfile(values.profile as string, root);
  const embedder = buildEmbedder(values.embedder as string, profile, {
    region: awsRegion,
  });
  const store = buildStore(storeKind, profile, {
    databaseUrl: databaseUrl || undefined,
    connectionId: connectionId || undefined,
  });
  const watchPrefix = cdcWatchPrefix(s3Prefix);
  const label = `source=${sourceKind} embedder=${values.embedder} store=${storeKind}`;
  const watch = Boolean(values.watch);
  const shutdown = createShutdownController({
    onSignal: (signal) => {
      console.error(`received ${signal}, finishing current poll…`);
    },
  });
  if (watch) shutdown.install();

  if (sourceKind === "s3") {
    const state = await getPlatformState(root).cdcKeys({
      source: "s3",
      connectionId: connectionId || undefined,
      bucket: s3Bucket,
      prefix: watchPrefix,
      stateFile: values["state-file"] as string | undefined,
      root,
      fileFallbackPath: ".memstream-state/s3-fallback.json",
    });
    const cache = newCdcProfileCache();
    const embedders = new Map([[`${profile.embedding.model}:${profile.embedding.dimensions}`, embedder]]);
    const interval = Number(values["poll-interval"] || 5);
    const sleep = (seconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
    while (true) {
      const result = await processCdcS3Prefix({
        bucket: s3Bucket,
        prefix: watchPrefix,
        fallbackProfile: profile,
        embedderFor: (p) => {
          const k = `${p.embedding.model}:${p.embedding.dimensions}`;
          let e = embedders.get(k);
          if (!e) {
            e = buildEmbedder(values.embedder as string, p, { region: awsRegion });
            embedders.set(k, e);
          }
          return e;
        },
        store,
        state,
        region: awsRegion,
        connectionId: connectionId || null,
        root,
        cache,
      });
      console.error(
        `events_seen=${result.processed + result.skipped} chunks_batch=${result.processed} ${label}`.trim(),
      );
      if (!watch) break;
      if (!shutdown.shouldContinue()) break;
      await sleep(interval);
    }
  } else {
    const source = await buildEventSource(sourceKind, {
      eventsFile: values.events,
      eventsDir: values["events-dir"],
      stateFile: values["state-file"] as string | undefined,
      s3Bucket: s3Bucket || undefined,
      s3Prefix,
      awsRegion,
      connectionId: connectionId || undefined,
      root,
    });

    const indexer = new Indexer(
      profile,
      source,
      embedder,
      store,
      connectionId || null,
    );
    await runPollLoop(indexer, {
      watch,
      interval: Number(values["poll-interval"] || 5),
      label,
      shouldContinue: shutdown.shouldContinue,
    });
  }

  await closePools();

  if (values["dump-store"]) {
    if (!(store instanceof InMemoryMemoryStore)) {
      console.error("--dump-store only works with --store memory");
      return 2;
    }
    const payload = store.chunks.map((c) => ({
      text: c.text,
      application: c.application,
      table_name: c.tableName,
      rule_name: c.ruleName,
      tags: c.tags,
      source_ts: c.sourceTs,
      embedding_dims: c.embedding.length,
      id: c.id ?? null,
    }));
    writeFileSync(values["dump-store"], JSON.stringify(payload, null, 2), "utf-8");
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
