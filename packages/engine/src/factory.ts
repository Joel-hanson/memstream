/** Build embedder / store / event source from CLI flags and env. */

import { readFileSync } from "node:fs";
import { parseCdcPayload } from "./cdc-parse.js";
import { BedrockEmbedder } from "./embed-bedrock.js";
import {
  FakeEmbedder,
  FakeEventSource,
  InMemoryMemoryStore,
} from "./fakes.js";
import type { ChangeEvent } from "./models.js";
import type { Embedder, EventSource, MemoryStore } from "./ports.js";
import type { Profile } from "./profile.js";
import { FilesystemEventSource } from "./source-filesystem.js";
import { S3EventSource } from "./source-s3.js";
import { getPlatformState } from "./state-manager.js";
import { CockroachMemoryStore } from "./store-cockroach.js";
import {
  EMBEDDER_KIND,
  EVENT_SOURCE,
  STORE_KIND,
} from "./constants.js";

export function buildEmbedder(
  kind: string,
  profile: Profile,
  options: { region?: string } = {},
): Embedder {
  const k = kind.toLowerCase();
  if (k === EMBEDDER_KIND.FAKE) {
    return new FakeEmbedder(profile.embedding.dimensions);
  }
  if (k === EMBEDDER_KIND.BEDROCK) {
    return new BedrockEmbedder({
      modelId:
        profile.embedding.model ||
        process.env.BEDROCK_EMBED_MODEL ||
        "amazon.titan-embed-text-v2:0",
      region:
        options.region || process.env.AWS_REGION || "us-east-1",
      dimensions: profile.embedding.dimensions,
    });
  }
  throw new Error(`unknown embedder: ${kind} (use fake|bedrock)`);
}

export function buildStore(
  kind: string,
  profile: Profile,
  options: { databaseUrl?: string; connectionId?: string | null } = {},
): MemoryStore {
  const k = kind.toLowerCase();
  if (k === STORE_KIND.MEMORY) {
    return new InMemoryMemoryStore({
      connectionId: options.connectionId,
    });
  }
  if (k === STORE_KIND.COCKROACH) {
    const url = options.databaseUrl || process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required for --store cockroach");
    }
    return new CockroachMemoryStore({
      conninfo: url,
      table: profile.embedding.table || "agent_memory_chunks",
      connectionId: options.connectionId,
    });
  }
  throw new Error(`unknown store: ${kind} (use memory|cockroach)`);
}

export async function buildEventSource(
  kind: string,
  options: {
    eventsFile?: string;
    eventsDir?: string;
    stateFile?: string;
    s3Bucket?: string;
    s3Prefix?: string;
    awsRegion?: string;
    connectionId?: string;
    root?: string;
  } = {},
): Promise<EventSource> {
  const k = kind.toLowerCase();
  if (k === EVENT_SOURCE.JSONL) {
    if (!options.eventsFile) {
      throw new Error("--events is required for --source jsonl");
    }
    return new FakeEventSource(loadEventsJsonl(options.eventsFile));
  }
  if (k === EVENT_SOURCE.FILESYSTEM) {
    const inbox =
      options.eventsDir ||
      process.env.MEMSTREAM_EVENTS_DIR ||
      "data/cdc/inbox";
    const state = await getPlatformState(options.root).cdcKeys({
      source: EVENT_SOURCE.FILESYSTEM,
      connectionId: options.connectionId,
      stateFile: options.stateFile,
      root: options.root,
      fileFallbackPath: ".memstream-state/filesystem-local.json",
    });
    return new FilesystemEventSource(inbox, state);
  }
  if (k === EVENT_SOURCE.S3) {
    const bucket = options.s3Bucket || process.env.CDC_S3_BUCKET;
    if (!bucket) {
      throw new Error("CDC_S3_BUCKET or --s3-bucket is required for --source s3");
    }
    const prefix =
      options.s3Prefix || process.env.CDC_S3_PREFIX || "cdc/";
    const state = await getPlatformState(options.root).cdcKeys({
      source: EVENT_SOURCE.S3,
      connectionId: options.connectionId,
      bucket,
      prefix,
      stateFile: options.stateFile,
      root: options.root,
      fileFallbackPath: ".memstream-state/s3-fallback.json",
    });
    return new S3EventSource({
      bucket,
      prefix,
      state,
      region: options.awsRegion || process.env.AWS_REGION,
    });
  }
  throw new Error(`unknown source: ${kind} (use jsonl|filesystem|s3)`);
}

export function loadEventsJsonl(path: string): ChangeEvent[] {
  return parseCdcPayload(readFileSync(path, "utf-8"));
}
