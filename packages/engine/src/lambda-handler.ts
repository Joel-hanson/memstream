/**
 * AWS Lambda entry — S3 ObjectCreated → memory chunks.
 * Bundled separately via deploy-lambda (esbuild); not used by the CLI poller.
 */

import { buildEmbedder, buildStore } from "./factory.js";
import { getActiveConnection } from "./connections.js";
import type { Profile } from "./profile.js";
import { resolveProfile } from "./profile-store.js";
import { processCdcS3Object } from "./process-cdc.js";
import type { Embedder, MemoryStore } from "./ports.js";
import { buildKeyState, type KeyState } from "./state.js";

type S3EventRecord = {
  s3?: {
    bucket?: { name?: string };
    object?: { key?: string };
  };
};

type S3Event = {
  Records?: S3EventRecord[];
};

type Runtime = {
  profile: Profile;
  embedder: Embedder;
  store: MemoryStore;
  state: KeyState;
  region: string;
  connectionId: string | null;
};

let runtimePromise: Promise<Runtime> | null = null;

async function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { applyDeployConfigSecretFromEnv } = await import(
        "./deploy-secrets.js"
      );
      await applyDeployConfigSecretFromEnv(
        process.env.AWS_REGION || "us-east-1",
      ).catch(() => {
        /* secret optional when DATABASE_URL already set */
      });

      const profileRef =
        process.env.MEMORY_PROFILE?.trim() || "commerce";
      const root = process.env.LAMBDA_TASK_ROOT || process.cwd();
      const profile = await resolveProfile(profileRef, root);
      const region = process.env.AWS_REGION || "us-east-1";
      const embedder = buildEmbedder(
        process.env.MEMSTREAM_EMBEDDER || "bedrock",
        profile,
        { region },
      );
      let connectionId = process.env.MEMSTREAM_CONNECTION_ID || null;
      let databaseUrl = process.env.DATABASE_URL?.trim() || "";
      if (!databaseUrl || !connectionId) {
        try {
          const conn = await getActiveConnection(root);
          if (conn) {
            if (!databaseUrl) databaseUrl = conn.database_url;
            if (!connectionId) connectionId = conn.id;
          }
        } catch {
          /* Connect optional when DATABASE_URL is baked in */
        }
      }
      const store = buildStore(
        process.env.MEMSTREAM_STORE || "cockroach",
        profile,
        {
          databaseUrl: databaseUrl || undefined,
          connectionId,
        },
      );
      const bucket = process.env.CDC_S3_BUCKET || "";
      const prefix = process.env.CDC_S3_PREFIX || "cdc/";
      const state = await buildKeyState({
        source: "s3",
        connectionId,
        bucket,
        prefix,
        root,
        fileFallbackPath: "/tmp/memstream-s3-state.json",
      });
      return { profile, embedder, store, state, region, connectionId };
    })();
  }
  return runtimePromise;
}

export async function handler(event: S3Event): Promise<{
  ok: boolean;
  processed: number;
  skipped: number;
  errors: string[];
}> {
  const rt = await getRuntime();
  let processed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of event.Records || []) {
    const bucket = record.s3?.bucket?.name;
    const key = record.s3?.object?.key
      ? decodeURIComponent(record.s3.object.key.replace(/\+/g, " "))
      : "";
    if (!bucket || !key) {
      skipped += 1;
      continue;
    }
    try {
      const result = await processCdcS3Object({
        bucket,
        key,
        region: rt.region,
        profile: rt.profile,
        embedder: rt.embedder,
        store: rt.store,
        state: rt.state,
      });
      if (result.skipped) skipped += 1;
      else processed += 1;
    } catch (err) {
      errors.push(
        `${bucket}/${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { ok: errors.length === 0, processed, skipped, errors };
}
