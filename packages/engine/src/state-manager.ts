/** Unified platform state — DB-first accessors for CDC, jobs, connections. */

import {
  getActiveConnection,
  getConnection,
  type MemstreamConnection,
} from "./connections.js";
import { getJobStore, type JobStep } from "./jobs.js";
import {
  getRunByJobId,
  jobSnapshotFromRun,
  type MemstreamRunStep,
} from "./runs.js";
import {
  buildKeyState,
  type CdcScopeOptions,
  type KeyState,
} from "./state.js";

export type JobSnapshot = {
  id: string;
  kind: string;
  status: string;
  log: string[];
  steps: JobStep[] | MemstreamRunStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  live: boolean;
  run_id?: string | null;
};

export type CdcKeysOptions = CdcScopeOptions & {
  stateFile?: string | null;
  root?: string;
  fileFallbackPath?: string;
};

export class PlatformState {
  constructor(private readonly root?: string) {}

  /** CDC cursor — Memstream DB when configured; file only if forced/offline. */
  cdcKeys(opts: CdcKeysOptions): Promise<KeyState> {
    return buildKeyState({
      source: opts.source,
      connectionId: opts.connectionId,
      bucket: opts.bucket,
      prefix: opts.prefix,
      stateFile: opts.stateFile,
      root: opts.root ?? this.root,
      fileFallbackPath: opts.fileFallbackPath,
    });
  }

  /**
   * Enable job snapshot: live in-process JobStore first, else hydrate from
   * memstream_runs (source of truth after restart).
   */
  async getJob(jobId: string): Promise<JobSnapshot | null> {
    const live = getJobStore().get(jobId);
    if (live) {
      return {
        id: live.id,
        kind: live.kind,
        status: live.status,
        log: live.log,
        steps: live.steps,
        result: live.result,
        error: live.error,
        live: true,
        run_id: live.runId,
      };
    }
    const run = await getRunByJobId(jobId, this.root);
    if (!run) return null;
    return jobSnapshotFromRun(run);
  }

  activeConnection(): Promise<MemstreamConnection | null> {
    return getActiveConnection(this.root);
  }

  connection(id: string): Promise<MemstreamConnection | null> {
    return getConnection(id, this.root);
  }
}

const globalKey = "__memstreamPlatformState";

export function getPlatformState(root?: string): PlatformState {
  if (root) return new PlatformState(root);
  const g = globalThis as typeof globalThis & {
    [globalKey]?: PlatformState;
  };
  if (!g[globalKey]) g[globalKey] = new PlatformState();
  return g[globalKey]!;
}
