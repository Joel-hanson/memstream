/** Resolve which memory profile owns an S3 CDC object. */

import { pickRunForCdcKey, runIdFromCdcKey } from "./cdc-prefix.js";
import type { Profile } from "./profile.js";
import { resolveProfile } from "./profile-store.js";
import { processCdcS3Object } from "./process-cdc.js";
import type { Embedder, MemoryStore } from "./ports.js";
import type { KeyState } from "./state.js";
import { findRepoRoot, listRuns } from "./runs.js";
import { listS3ObjectKeys, type S3ListClient } from "./source-s3.js";

export type CdcProfileCache = {
  runsAt: number;
  runs: Awaited<ReturnType<typeof listRuns>>;
  profiles: Map<string, Profile>;
};

const RUNS_TTL_MS = 15_000;

export function newCdcProfileCache(): CdcProfileCache {
  return { runsAt: 0, runs: [], profiles: new Map() };
}

async function liveRuns(
  cache: CdcProfileCache,
  root: string,
): Promise<CdcProfileCache["runs"]> {
  if (cache.runsAt && Date.now() - cache.runsAt < RUNS_TTL_MS) {
    return cache.runs;
  }
  try {
    cache.runs = await listRuns(50, root);
    cache.runsAt = Date.now();
  } catch {
    /* platform DB optional */
  }
  return cache.runs;
}

/** Profile for this CDC key: longest matching live run, else fallback.
 * Returns null for a run-scoped key whose Memstream is not live yet. */
export async function profileForCdcKey(options: {
  key: string;
  fallback: Profile;
  root?: string;
  cache?: CdcProfileCache;
}): Promise<Profile | null> {
  const root = options.root ?? findRepoRoot();
  const cache = options.cache ?? newCdcProfileCache();
  const runs = await liveRuns(cache, root);
  let run = pickRunForCdcKey(runs, options.key);
  if (!run) {
    cache.runsAt = 0;
    const fresh = await liveRuns(cache, root);
    run = pickRunForCdcKey(fresh, options.key);
  }
  const ref = run?.profile_path?.trim();
  if (!ref) {
    if (runIdFromCdcKey(options.key)) return null;
    return options.fallback;
  }
  const hit = cache.profiles.get(ref);
  if (hit) return hit;
  try {
    const profile = await resolveProfile(ref, root);
    cache.profiles.set(ref, profile);
    return profile;
  } catch {
    return options.fallback;
  }
}

/** Poll one CDC prefix and index each object with the matching live profile. */
export async function processCdcS3Prefix(options: {
  bucket: string;
  prefix: string;
  fallbackProfile: Profile;
  embedderFor: (profile: Profile) => Embedder;
  store: MemoryStore;
  state: KeyState;
  region?: string;
  connectionId?: string | null;
  root?: string;
  cache?: CdcProfileCache;
  client?: S3ListClient;
}): Promise<{ processed: number; skipped: number }> {
  const root = options.root ?? findRepoRoot();
  const cache = options.cache ?? newCdcProfileCache();
  const keys = await listS3ObjectKeys({
    bucket: options.bucket,
    prefix: options.prefix,
    region: options.region,
    client: options.client,
  });
  let processed = 0;
  let skipped = 0;
  for (const key of keys) {
    const profile = await profileForCdcKey({
      key,
      fallback: options.fallbackProfile,
      root,
      cache,
    });
    if (!profile) {
      skipped += 1;
      continue;
    }
    const result = await processCdcS3Object({
      bucket: options.bucket,
      key,
      region: options.region,
      profile,
      embedder: options.embedderFor(profile),
      store: options.store,
      state: options.state,
      connectionId: options.connectionId,
      client: options.client,
    });
    if (result.skipped) skipped += 1;
    else processed += 1;
  }
  return { processed, skipped };
}
