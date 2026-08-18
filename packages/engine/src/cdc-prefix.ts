/** Per-run CDC prefix + Cockroach EXTERNAL CONNECTION names.
 *
 * Two Memstreams on the same database cannot share an S3 prefix (two workers
 * would double-index). Each run gets `cdc/<runId>/` and `memstream_<uuid>`.
 * The Lambda/EC2 watcher stays on the parent prefix (`cdc/`) and routes by key.
 */

import { isJoinableRun, type JoinableRun } from "./pick-run.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEGACY_CHANGEFEED_CONNECTION = "memstream_s3";

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** `cdc` / `cdc/` / `/cdc/foo` → `cdc/` or `cdc/foo/`. */
export function normalizeCdcPrefix(prefix: string | null | undefined): string {
  let p = (prefix || "cdc/").trim().replace(/^\//, "");
  if (p && !p.endsWith("/")) p += "/";
  return p || "cdc/";
}

/**
 * Parent prefix the worker watches. Strips a trailing run UUID so Enable
 * never nests `cdc/<oldRun>/<newRun>/` when the UI passes a run's sink prefix.
 */
export function cdcWatchPrefix(prefix: string | null | undefined): string {
  const p = normalizeCdcPrefix(prefix);
  const parts = p.replace(/\/$/, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && isUuid(last)) {
    parts.pop();
    return normalizeCdcPrefix(parts.join("/") || "cdc");
  }
  return p;
}

/** Unique sink prefix for one Memstream run: `cdc/<runId>/`. */
export function runCdcPrefix(
  watchPrefix: string | null | undefined,
  runId: string,
): string {
  return `${cdcWatchPrefix(watchPrefix)}${runId.trim()}/`;
}

/** Cockroach EXTERNAL CONNECTION ident for a run (`memstream_` + uuid hex). */
export function changefeedConnectionName(runId: string): string {
  const compact = runId.trim().replace(/-/g, "").toLowerCase();
  if (!compact || /[^a-z0-9]/.test(compact)) {
    throw new Error(`invalid run id for changefeed connection: ${runId}`);
  }
  return `memstream_${compact}`;
}

export function isRunScopedPrefix(
  prefix: string | null | undefined,
  runId: string,
): boolean {
  if (!runId.trim()) return false;
  return normalizeCdcPrefix(prefix).includes(`${runId.trim()}/`);
}

/** Legacy shared `memstream_s3`, or the per-run connection after parallel streams. */
export function changefeedConnectionNameForRun(run: {
  id: string;
  prefix?: string | null;
}): string {
  if (isRunScopedPrefix(run.prefix, run.id)) {
    return changefeedConnectionName(run.id);
  }
  return LEGACY_CHANGEFEED_CONNECTION;
}

export type CdcPrefixRun = JoinableRun & {
  id: string;
  prefix?: string | null;
  profile_path?: string | null;
};

/** First UUID path segment in an S3 key, if any (`cdc/<runId>/…`). */
export function runIdFromCdcKey(key: string): string | undefined {
  for (const part of key.split("/")) {
    if (isUuid(part)) return part;
  }
  return undefined;
}

/**
 * Live run whose CDC prefix is the longest match for this S3 object key.
 * `cdc/<runId>/file` wins over a legacy `cdc/` shop stream, and never
 * falls back to `cdc/` for a run-scoped key (avoids applying the shop
 * profile to another stream while that run row is still loading).
 */
export function pickRunForCdcKey<T extends CdcPrefixRun>(
  runs: T[],
  key: string,
): T | undefined {
  const scopedId = runIdFromCdcKey(key);
  let best: T | undefined;
  let bestLen = -1;
  for (const run of runs) {
    if (!isJoinableRun(run)) continue;
    const prefix = normalizeCdcPrefix(run.prefix);
    if (!key.startsWith(prefix)) continue;
    if (scopedId && !prefix.includes(`${scopedId}/`) && run.id !== scopedId) {
      continue;
    }
    if (prefix.length > bestLen) {
      best = run;
      bestLen = prefix.length;
    }
  }
  return best;
}
