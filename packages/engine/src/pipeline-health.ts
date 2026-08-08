/** Derive Live panel connection health + memory lag from pipeline probes. */

export type HealthLevel = "ok" | "degraded" | "down" | "unknown";
export type CheckStatus = "ok" | "warn" | "error" | "idle" | "unknown";

export type PipelineHealth = {
  status: HealthLevel;
  connection: {
    status: CheckStatus;
    detail: string;
  };
  changefeed: {
    status: CheckStatus;
    jobs: number;
    running: number;
    detail: string;
  };
  memory: {
    status: CheckStatus;
    lag_seconds: number | null;
    latest_chunk_at: string | null;
    latest_cdc_at: string | null;
    processed_keys: number | null;
    last_processed_at: string | null;
    detail: string;
  };
};

/** Seconds behind CDC before we call memory "lagging". */
export const MEMORY_LAG_WARN_SECONDS = 120;

export type DerivePipelineHealthInput = {
  databaseUrlSet: boolean;
  dbOk: boolean;
  dbError: string | null;
  changefeedJobs: number;
  changefeedRunning: number;
  chunkCount: number;
  latestChunkAt: string | null;
  /** Newest CDC object LastModified (ISO), if known. */
  latestCdcAt: string | null;
  /** S3 list succeeded; null = not configured or probe failed. */
  s3Objects: number | null;
  bucketSet: boolean;
  processedKeys: number | null;
  lastProcessedAt: string | null;
  /** Wall clock for lag math (injectable in tests). */
  nowMs?: number;
};

function parseTimeMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function computeLagSeconds(
  latestCdcAt: string | null,
  latestChunkAt: string | null,
  nowMs = Date.now(),
): number | null {
  const cdcMs = parseTimeMs(latestCdcAt);
  const chunkMs = parseTimeMs(latestChunkAt);
  if (cdcMs == null) return null;
  // No chunks yet: how long ago the newest CDC object landed.
  if (chunkMs == null) {
    return Math.max(0, Math.floor((nowMs - cdcMs) / 1000));
  }
  if (cdcMs <= chunkMs) return 0;
  return Math.max(0, Math.floor((cdcMs - chunkMs) / 1000));
}

/**
 * Pure health summary for Live. Keeps AWS/DB I/O out of the unit tests.
 */
export function derivePipelineHealth(
  input: DerivePipelineHealthInput,
): PipelineHealth {
  const nowMs = input.nowMs ?? Date.now();

  let connection: PipelineHealth["connection"];
  if (!input.databaseUrlSet) {
    connection = { status: "idle", detail: "Connect your application DB" };
  } else if (!input.dbOk) {
    connection = {
      status: "error",
      detail: input.dbError?.trim() || "Application DB unreachable",
    };
  } else {
    connection = { status: "ok", detail: "Application DB reachable" };
  }

  let changefeed: PipelineHealth["changefeed"];
  if (!input.dbOk) {
    changefeed = {
      status: "unknown",
      jobs: input.changefeedJobs,
      running: input.changefeedRunning,
      detail: "Needs a healthy connection",
    };
  } else if (input.changefeedRunning > 0) {
    changefeed = {
      status: "ok",
      jobs: input.changefeedJobs,
      running: input.changefeedRunning,
      detail: `${input.changefeedRunning} job${
        input.changefeedRunning === 1 ? "" : "s"
      } streaming`,
    };
  } else if (input.changefeedJobs > 0) {
    changefeed = {
      status: "warn",
      jobs: input.changefeedJobs,
      running: 0,
      detail: `${input.changefeedJobs} changefeed job(s) not running`,
    };
  } else {
    changefeed = {
      status: "idle",
      jobs: 0,
      running: 0,
      detail: "No changefeed yet — Enable first",
    };
  }

  const lagSeconds = computeLagSeconds(
    input.latestCdcAt,
    input.latestChunkAt,
    nowMs,
  );

  const hasCdcPending =
    (input.s3Objects != null && input.s3Objects > 0) ||
    Boolean(input.latestCdcAt);
  const workerBehind =
    hasCdcPending &&
    input.chunkCount === 0 &&
    input.changefeedRunning > 0;
  const lagging =
    workerBehind ||
    (lagSeconds != null && lagSeconds >= MEMORY_LAG_WARN_SECONDS);

  let memory: PipelineHealth["memory"];
  if (!input.dbOk) {
    memory = {
      status: "unknown",
      lag_seconds: null,
      latest_chunk_at: input.latestChunkAt,
      latest_cdc_at: input.latestCdcAt,
      processed_keys: input.processedKeys,
      last_processed_at: input.lastProcessedAt,
      detail: "Needs a healthy connection",
    };
  } else if (lagging) {
    memory = {
      status: "warn",
      lag_seconds: lagSeconds,
      latest_chunk_at: input.latestChunkAt,
      latest_cdc_at: input.latestCdcAt,
      processed_keys: input.processedKeys,
      last_processed_at: input.lastProcessedAt,
      detail:
        input.chunkCount === 0
          ? "CDC objects waiting — worker may be behind"
          : lagSeconds != null
            ? `Memory ~${lagSeconds}s behind CDC`
            : "Memory lagging behind CDC",
    };
  } else if (input.chunkCount > 0) {
    memory = {
      status: "ok",
      lag_seconds: lagSeconds ?? 0,
      latest_chunk_at: input.latestChunkAt,
      latest_cdc_at: input.latestCdcAt,
      processed_keys: input.processedKeys,
      last_processed_at: input.lastProcessedAt,
      detail:
        lagSeconds != null && lagSeconds > 0
          ? `Up to date (~${lagSeconds}s lag)`
          : "Up to date",
    };
  } else if (!input.bucketSet) {
    memory = {
      status: "idle",
      lag_seconds: null,
      latest_chunk_at: null,
      latest_cdc_at: input.latestCdcAt,
      processed_keys: input.processedKeys,
      last_processed_at: input.lastProcessedAt,
      detail: "Set CDC bucket to measure lag",
    };
  } else {
    memory = {
      status: "idle",
      lag_seconds: lagSeconds,
      latest_chunk_at: input.latestChunkAt,
      latest_cdc_at: input.latestCdcAt,
      processed_keys: input.processedKeys,
      last_processed_at: input.lastProcessedAt,
      detail: "Waiting for first memory chunk",
    };
  }

  let status: HealthLevel = "unknown";
  if (connection.status === "error") {
    status = "down";
  } else if (connection.status === "idle") {
    status = "unknown";
  } else if (
    changefeed.status === "warn" ||
    memory.status === "warn" ||
    (input.bucketSet && input.s3Objects === null)
  ) {
    status = "degraded";
  } else if (
    connection.status === "ok" &&
    (changefeed.status === "ok" || memory.status === "ok")
  ) {
    status = "ok";
  } else if (connection.status === "ok") {
    status = "ok";
  }

  return { status, connection, changefeed, memory };
}
