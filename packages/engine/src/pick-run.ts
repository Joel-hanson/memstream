/** Pick a live Memstream run without pulling DB/pg into the console bundle. */

import { RUN_STATUS, isActiveRunStatus } from "./constants.js";

export type JoinableRun = {
  status: string;
  app_database_label?: string | null;
};

/** Succeeded or still enabling — not failed leftover rows. */
export function isJoinableRun(run: JoinableRun): boolean {
  return (
    run.status === RUN_STATUS.SUCCEEDED || isActiveRunStatus(run.status)
  );
}

/** Prefer an in-flight enable, else the latest succeeded run. */
export function pickJoinableRun<T extends JoinableRun>(
  runs: T[],
): T | undefined {
  return (
    runs.find((r) => isActiveRunStatus(r.status)) ||
    runs.find((r) => r.status === RUN_STATUS.SUCCEEDED)
  );
}

/**
 * Live Memstream already indexing this application database.
 * Demo/Connect can join this; Enable of a different profile runs in parallel.
 */
export function pickLiveRunForAppLabel<T extends JoinableRun>(
  runs: T[],
  label: string | null | undefined,
): T | undefined {
  const needle = label?.trim().toLowerCase();
  if (!needle) return undefined;
  return pickJoinableRun(
    runs.filter(
      (r) => (r.app_database_label || "").trim().toLowerCase() === needle,
    ),
  );
}
