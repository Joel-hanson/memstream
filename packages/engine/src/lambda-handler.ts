/**
 * AWS Lambda entry — S3 ObjectCreated → memory chunks.
 * Bundled separately via deploy-lambda (esbuild); not used by the CLI poller.
 */

import { buildEmbedder, buildStore } from "./factory.js";
import { getActiveConnection } from "./connections.js";
import { runIdFromCdcKey } from "./cdc-prefix.js";
import {
  newCdcProfileCache,
  profileForCdcKey,
  type CdcProfileCache,
} from "./cdc-route.js";
import type { Profile } from "./profile.js";
import { resolveProfile } from "./profile-store.js";
import { processCdcS3Object } from "./process-cdc.js";
import type { Embedder, MemoryStore } from "./ports.js";
import type { KeyState } from "./state.js";
import { getPlatformState } from "./state-manager.js";

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
  fallbackProfile: Profile;
  embedders: Map<string, Embedder>;
  store: MemoryStore;
  state: KeyState;
  region: string;
  connectionId: string | null;
  root: string;
  embedderKind: string;
  cache: CdcProfileCache;
};

let runtimePromise: Promise<Runtime> | null = null;

function embedderKey(profile: Profile): string {
  return `${profile.embedding.model}:${profile.embedding.dimensions}`;
}

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
      const fallbackProfile = await resolveProfile(profileRef, root);
      const region = process.env.AWS_REGION || "us-east-1";
      const embedderKind = process.env.MEMSTREAM_EMBEDDER || "bedrock";
      const embedders = new Map<string, Embedder>();
      embedders.set(
        embedderKey(fallbackProfile),
        buildEmbedder(embedderKind, fallbackProfile, { region }),
      );
      let connectionId = process.env.MEMSTREAM_CONNECTION_ID?.trim() || null;
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
        fallbackProfile,
        {
          databaseUrl: databaseUrl || undefined,
          connectionId,
        },
      );
      const bucket = process.env.CDC_S3_BUCKET || "";
      const prefix = process.env.CDC_S3_PREFIX || "cdc/";
      const state = await getPlatformState(root).cdcKeys({
        source: "s3",
        connectionId,
        bucket,
        prefix,
        root,
        fileFallbackPath: "/tmp/memstream-s3-state.json",
      });
      return {
        fallbackProfile,
        embedders,
        store,
        state,
        region,
        connectionId,
        root,
        embedderKind,
        cache: newCdcProfileCache(),
      };
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
      const profile = await profileForCdcKey({
        key,
        fallback: rt.fallbackProfile,
        root: rt.root,
        cache: rt.cache,
      });
      if (!profile) {
        if (runIdFromCdcKey(key)) {
          throw new Error(`no live Memstream for ${key} yet`);
        }
        skipped += 1;
        continue;
      }
      let embedder = rt.embedders.get(embedderKey(profile));
      if (!embedder) {
        embedder = buildEmbedder(rt.embedderKind, profile, {
          region: rt.region,
        });
        rt.embedders.set(embedderKey(profile), embedder);
      }
      const result = await processCdcS3Object({
        bucket,
        key,
        region: rt.region,
        profile,
        embedder,
        store: rt.store,
        state: rt.state,
        connectionId: rt.connectionId,
      });
      if (result.skipped) skipped += 1;
      else processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no live Memstream/.test(msg)) throw err;
      errors.push(`${bucket}/${key}: ${msg}`);
    }
  }

  return { ok: errors.length === 0, processed, skipped, errors };
}
