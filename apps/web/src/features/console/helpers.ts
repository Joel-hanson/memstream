import type { JobStatus, MemstreamRun } from "@/lib/types";

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

export function jobFromRun(run: MemstreamRun): JobStatus {
  return {
    id: run.job_id || run.id,
    kind: "enable",
    status: run.status,
    log: run.log || [],
    steps: [],
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
  return (
    runs.find((r) => r.status === "running" || r.status === "queued") ||
    runs.find((r) => r.status === "succeeded") ||
    runs[0]
  );
}

export function runProfileLabel(run: MemstreamRun): string {
  return (
    run.profile_path?.replace(/^profiles\//, "").replace(/\.yaml$/, "") ||
    "profile"
  );
}

export function runStatusLabel(status: string): string {
  if (status === "succeeded") return "Live";
  if (status === "running" || status === "queued") return "Enabling…";
  if (status === "failed") return "Failed";
  return status;
}
