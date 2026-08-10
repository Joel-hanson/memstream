import type { JobStatus, MemstreamRun } from "@/lib/types";
import {
  RUN_STATUS,
  isActiveRunStatus,
} from "./constants";

export const ENABLE_JOB_STORAGE_KEY = "memstream.enableJobId";

export function readStoredEnableJobId(): string | null {
  try {
    return sessionStorage.getItem(ENABLE_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeEnableJobId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ENABLE_JOB_STORAGE_KEY, id);
    else sessionStorage.removeItem(ENABLE_JOB_STORAGE_KEY);
  } catch {
    /* private mode / SSR */
  }
}

export function enableStepsComplete(
  steps: { status: string }[] | null | undefined,
): boolean {
  if (!steps?.length) return false;
  return (
    steps.every(
      (s) =>
        s.status === "done" ||
        s.status === "skipped" ||
        s.status === "failed",
    ) && steps.some((s) => s.status === "done")
  );
}

export function jobFromRun(run: MemstreamRun): JobStatus {
  const stuckComplete =
    isActiveRunStatus(run.status) && enableStepsComplete(run.steps);
  return {
    id: run.job_id || run.id,
    kind: "enable",
    status: stuckComplete ? RUN_STATUS.SUCCEEDED : run.status,
    log: run.log || [],
    steps: run.steps || [],
    result: {
      ...(run.shop_url ? { shop_url: run.shop_url } : {}),
      run_id: run.id,
    },
    error: run.error,
    live: false,
  };
}

export function pickPrimaryRun(runs: MemstreamRun[]): MemstreamRun | undefined {
  // Prefer in-flight enable so a reload mid-enable doesn't jump to an older Live run.
  // Ignore "running" rows whose steps already finished (stuck after finishRun race).
  const trulyActive = runs.find(
    (r) =>
      isActiveRunStatus(r.status) && !enableStepsComplete(r.steps),
  );
  return (
    trulyActive ||
    runs.find((r) => r.status === RUN_STATUS.SUCCEEDED) ||
    runs.find((r) => isActiveRunStatus(r.status) && enableStepsComplete(r.steps)) ||
    runs[0]
  );
}

export function runProfileLabel(run: MemstreamRun): string {
  return (
    run.profile_path?.replace(/^profiles\//, "").replace(/\.yaml$/, "") ||
    "profile"
  );
}

export function profileIdFromPath(path: string): string {
  return path.trim().replace(/^.*\//, "").replace(/\.ya?ml$/i, "");
}

export function runStatusLabel(status: string): string {
  if (status === RUN_STATUS.SUCCEEDED) return "Live";
  if (isActiveRunStatus(status)) return "Enabling…";
  if (status === RUN_STATUS.FAILED) return "Failed";
  return status;
}

/**
 * Prefer the polled job when it's terminal so a stale run row
 * doesn't keep showing "Enabling…" after Live is already up.
 * Also treat a fully-finished enable as Live when the durable row was
 * left "running" by a race (progress flush after finishRun).
 */
export function resolveRunDisplayStatus(
  activeRun: MemstreamRun | null | undefined,
  job: JobStatus | null | undefined,
  opts?: { watching?: boolean; hasMemory?: boolean },
): string {
  const runStatus = activeRun?.status;
  const jobStatus = job?.status;

  if (jobStatus === RUN_STATUS.SUCCEEDED || jobStatus === RUN_STATUS.FAILED) {
    return jobStatus;
  }
  if (runStatus === RUN_STATUS.FAILED) {
    return RUN_STATUS.FAILED;
  }
  const stepsDone =
    enableStepsComplete(job?.steps) || enableStepsComplete(activeRun?.steps);
  // Stuck "running" row after a successful enable (flush race) — show Live.
  if (
    stepsDone &&
    (isActiveRunStatus(runStatus || "") || isActiveRunStatus(jobStatus || ""))
  ) {
    return RUN_STATUS.SUCCEEDED;
  }
  if (isActiveRunStatus(jobStatus || "")) {
    return jobStatus!;
  }
  if (
    (opts?.watching || opts?.hasMemory) &&
    runStatus !== RUN_STATUS.FAILED &&
    !isActiveRunStatus(jobStatus || "")
  ) {
    return RUN_STATUS.SUCCEEDED;
  }
  return runStatus || jobStatus || "…";
}
