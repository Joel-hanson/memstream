/**
 * Console UI constants — import only from `@memstream/engine/constants`
 * (never the engine barrel: that pulls `pg` into the client bundle).
 */

export {
  RUN_STATUS,
  WORKER_COMPUTE,
  isActiveRunStatus,
  isTerminalRunStatus,
  type RunStatus,
  type WorkerComputeKind,
} from "@memstream/engine/constants";
