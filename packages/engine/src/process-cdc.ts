/** Shared CDC object → memory chunks (EC2 poller + Lambda). */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseCdcPayload, tableFromKey } from "./cdc-parse.js";
import type { MemoryChunk } from "./models.js";
import type { Embedder, MemoryStore } from "./ports.js";
import type { Profile } from "./profile.js";
import { matchRules } from "./rules.js";
import type { KeyState } from "./state.js";
import { renderChunk } from "./template.js";

export type ProcessCdcResult = {
  skipped: boolean;
  reason?: string;
  eventsSeen: number;
  chunksWritten: number;
};

/** Skip non-event objects Cockroach writes under the CDC prefix. */
export function shouldSkipCdcKey(key: string): boolean {
  const normalized = key.replace(/\\/g, "/");
  if (!normalized || normalized.endsWith("/")) return true;
  const base = normalized.split("/").pop() || normalized;
  if (base === "crdb_external_storage_location") return true;
  if (base.startsWith(".")) return true;
  return false;
}

export async function indexCdcPayload(options: {
  profile: Profile;
  embedder: Embedder;
  store: MemoryStore;
  text: string;
  defaultTable?: string | null;
  connectionId?: string | null;
}): Promise<{ eventsSeen: number; chunksWritten: number }> {
  const events = parseCdcPayload(options.text, options.defaultTable ?? null);
  let written = 0;
  for (const event of events) {
    for (const rule of matchRules(options.profile, event)) {
      const text = renderChunk(rule.chunkTemplate, event);
      const embedding = await options.embedder.embed(text);
      const chunk: MemoryChunk = {
        text,
        embedding,
        application: options.profile.application,
        tableName: event.table,
        ruleName: rule.name,
        tags: [...rule.tags],
        sourceTs: event.timestamp,
        connectionId: options.connectionId ?? null,
      };
      await options.store.save(chunk);
      written += 1;
    }
  }
  return { eventsSeen: events.length, chunksWritten: written };
}

export async function processCdcS3Object(options: {
  bucket: string;
  key: string;
  profile: Profile;
  embedder: Embedder;
  store: MemoryStore;
  state: KeyState;
  region?: string;
  connectionId?: string | null;
  client?: {
    send: (command: GetObjectCommand) => Promise<{
      Body?: { transformToString?: (enc?: string) => Promise<string> };
    }>;
  };
}): Promise<ProcessCdcResult> {
  const key = options.key;
  if (shouldSkipCdcKey(key)) {
    return {
      skipped: true,
      reason: "non-event object",
      eventsSeen: 0,
      chunksWritten: 0,
    };
  }

  if (options.state.load) await options.state.load();
  if (options.state.seen(key)) {
    return {
      skipped: true,
      reason: "already processed",
      eventsSeen: 0,
      chunksWritten: 0,
    };
  }

  const client =
    options.client ??
    (new S3Client({
      region:
        options.region || process.env.AWS_REGION || "us-east-1",
    }) as unknown as NonNullable<typeof options.client>);

  const obj = await client.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: key }),
  );
  let text = "";
  if (obj.Body && typeof obj.Body.transformToString === "function") {
    text = await obj.Body.transformToString("utf-8");
  }

  let result: { eventsSeen: number; chunksWritten: number };
  try {
    result = await indexCdcPayload({
      profile: options.profile,
      embedder: options.embedder,
      store: options.store,
      text,
      defaultTable: tableFromKey(key),
      connectionId: options.connectionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Parse / shape errors are permanent — ack so we do not retry forever.
    if (/json|parse|unexpected|not an object/i.test(msg)) {
      console.error(`warn: skip s3://${options.bucket}/${key}: ${msg}`);
      await options.state.mark(key);
      return {
        skipped: true,
        reason: msg,
        eventsSeen: 0,
        chunksWritten: 0,
      };
    }
    throw err;
  }

  await options.state.mark(key);
  return {
    skipped: false,
    eventsSeen: result.eventsSeen,
    chunksWritten: result.chunksWritten,
  };
}
