/** Shared string constants — prefer these over bare literals. */

export const RUN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export const JOB_STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type JobStepStatusValue =
  (typeof JOB_STEP_STATUS)[keyof typeof JOB_STEP_STATUS];

export const WORKER_COMPUTE = {
  EC2: "ec2",
  LAMBDA: "lambda",
} as const;

export type WorkerComputeKind =
  (typeof WORKER_COMPUTE)[keyof typeof WORKER_COMPUTE];

export const EVENT_SOURCE = {
  JSONL: "jsonl",
  FILESYSTEM: "filesystem",
  S3: "s3",
} as const;

export type EventSourceKind =
  (typeof EVENT_SOURCE)[keyof typeof EVENT_SOURCE];

export const EMBEDDER_KIND = {
  FAKE: "fake",
  BEDROCK: "bedrock",
} as const;

export type EmbedderKind = (typeof EMBEDDER_KIND)[keyof typeof EMBEDDER_KIND];

export const STORE_KIND = {
  MEMORY: "memory",
  COCKROACH: "cockroach",
} as const;

export type StoreKind = (typeof STORE_KIND)[keyof typeof STORE_KIND];

export const INFRA_TEMPLATE = {
  EC2: "ec2",
  LAMBDA: "lambda",
} as const;

export type InfraTemplateKindValue =
  (typeof INFRA_TEMPLATE)[keyof typeof INFRA_TEMPLATE];

export function isTerminalRunStatus(status: string): boolean {
  return status === RUN_STATUS.SUCCEEDED || status === RUN_STATUS.FAILED;
}

export function isActiveRunStatus(status: string): boolean {
  return status === RUN_STATUS.RUNNING || status === RUN_STATUS.QUEUED;
}
