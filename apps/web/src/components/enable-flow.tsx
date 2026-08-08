"use client";

import type { ReactNode } from "react";
import {
  PIPELINE_LABELS,
  PRODUCT,
  buildEnableSteps,
  stepStatusCopy,
} from "@memstream/engine/naming";
import { MemoryFlow } from "@/components/memory-flow";
import { cn } from "@/lib/utils";
import type {
  JobStatus,
  JobStep,
  JobStepStatus,
  PipelineNode,
} from "@/lib/types";

function stepById(steps: JobStep[], id: string): JobStep | undefined {
  return steps.find((s) => s.id === id);
}

function nodeState(
  status: JobStepStatus | undefined,
): NonNullable<PipelineNode["state"]> {
  switch (status) {
    case "done":
      return "ok";
    case "running":
      return "active";
    case "failed":
      return "error";
    case "skipped":
      return "idle";
    default:
      return "idle";
  }
}

function statusLabel(status: JobStepStatus | undefined): string {
  return stepStatusCopy(status || "pending");
}

function activeStepId(steps: JobStep[], job?: JobStatus | null): string | null {
  if (job?.status === "failed") {
    const failed = steps.find((s) => s.status === "failed");
    return failed?.id === "schema"
      ? "cockroach"
      : failed?.id || "worker";
  }
  const running = steps.find((s) => s.status === "running");
  if (running) {
    if (running.id === "schema") return "cockroach";
    if (running.id === "changefeed") return "changefeed";
    if (running.id === "worker") return "worker";
    return running.id;
  }
  if (job?.status === "running" || job?.status === "queued") return "memstream";
  return null;
}

function withFailedJobSteps(
  job: JobStatus | null | undefined,
  steps: JobStep[],
): JobStep[] {
  if (!job || job.status !== "failed") return steps;
  const hasProgress = steps.some(
    (s) =>
      s.status === "done" ||
      s.status === "failed" ||
      s.status === "running" ||
      s.status === "skipped",
  );
  if (hasProgress) return steps;

  const log = (job.log || []).join("\n") + (job.error || "");
  const workerFail =
    /cloudformation|CreateStack|UpdateStack|DescribeStacks|AccessDenied|Packaging source|deploy/i.test(
      log,
    );

  return steps.map((s) => {
    if (workerFail) {
      if (s.id === "worker") {
        return {
          ...s,
          status: "failed" as const,
          detail: "Cloud memory worker failed",
        };
      }
      return { ...s, status: "done" as const };
    }
    if (s.id === "worker" || s.id === steps[steps.length - 1]?.id) {
      return {
        ...s,
        status: "failed" as const,
        detail: job.error || s.detail || "Failed",
      };
    }
    return { ...s, status: "done" as const };
  });
}

/** When steps were not persisted (reload / run hydrate), recover progress from log lines. */
export function applyEnableLogInference(
  steps: JobStep[],
  job: JobStatus,
): JobStep[] {
  const log = (job.log || []).join("\n");
  if (!log.trim()) return steps;

  const next = steps.map((s) => ({ ...s }));
  const set = (
    id: string,
    status: JobStepStatus,
    detail?: string,
  ) => {
    const step = next.find((s) => s.id === id);
    if (!step) return;
    step.status = status;
    if (detail) step.detail = detail;
  };

  if (/memory tables:\s*ready/i.test(log)) {
    set("schema", "done");
  } else if (/memory tables:\s*applying/i.test(log)) {
    set("schema", "running", "Creating memory tables…");
  }

  if (/live changes:\s*ready/i.test(log)) {
    set("changefeed", "done");
    set("s3", "done");
    set("embed", "done");
    set("vectors", "done");
  } else if (
    /live changes\s*(→|->)/i.test(log) ||
    (/s3:\/\//i.test(log) && /memory tables:\s*ready/i.test(log))
  ) {
    if (next.find((s) => s.id === "schema")?.status === "done") {
      set("changefeed", "running");
      set("s3", "running");
    }
  }

  if (/memory worker:\s*skipped/i.test(log)) {
    set("worker", "skipped", "Cloud worker off. Use local worker or the demo shop.");
  } else if (
    /shop url:|lambda worker ready|deploy finished|stack .* ready/i.test(log)
  ) {
    set("worker", "done");
  } else if (/memory worker:\s*deploying/i.test(log)) {
    set("worker", "running", "Starting cloud memory worker…");
  }

  if (job.status === "succeeded") {
    for (const step of next) {
      if (step.status === "pending" || step.status === "running") {
        step.status =
          step.id === "worker" && /memory worker:\s*skipped/i.test(log)
            ? "skipped"
            : "done";
      }
    }
  }

  return next;
}

export type EnableStepOptions = {
  tables: string;
  bucket: string;
  prefix: string;
  deploy: boolean;
  stackName: string;
};

/** Resolve enable job steps (including inferred failure when logs lack step status). */
export function resolveEnableSteps(
  job: JobStatus | null | undefined,
  options: EnableStepOptions,
): JobStep[] {
  const fromJob = Boolean(job?.steps && job.steps.length);
  let steps: JobStep[] = fromJob
    ? (job!.steps as JobStep[])
    : buildEnableSteps(options);

  const hasProgress = steps.some((s) => s.status !== "pending");
  if (job && (!fromJob || !hasProgress) && (job.log || []).length) {
    steps = applyEnableLogInference(steps, job);
  }

  return withFailedJobSteps(job, steps);
}

export type EnablePhase = "idle" | "running" | "succeeded" | "failed";

export type EnableProgress = {
  phase: EnablePhase;
  steps: JobStep[];
  doneCount: number;
  total: number;
  /** 1-based index of the current/blocker step, or total when complete */
  stepNumber: number;
  current: JobStep | null;
  headline: string;
};

/** Plain-language progress for the simplified Enable UI. */
export function getEnableProgress(
  job: JobStatus | null | undefined,
  options: EnableStepOptions,
): EnableProgress {
  const steps = resolveEnableSteps(job, options);
  const doneCount = steps.filter((s) => s.status === "done").length;
  const total = steps.length || 1;
  const failed = steps.find((s) => s.status === "failed");
  const running = steps.find((s) => s.status === "running");
  const nextPending = steps.find((s) => s.status === "pending");

  let phase: EnablePhase = "idle";
  if (job?.status === "succeeded" || (doneCount === total && total > 0 && job)) {
    phase = "succeeded";
  } else if (job?.status === "failed" || failed) {
    phase = "failed";
  } else if (
    job?.status === "running" ||
    job?.status === "queued" ||
    running
  ) {
    phase = "running";
  }

  const current =
    phase === "failed"
      ? failed || steps[steps.length - 1] || null
      : phase === "succeeded"
        ? null
        : running || nextPending || null;

  const stepNumber =
    phase === "succeeded"
      ? total
      : current
        ? steps.findIndex((s) => s.id === current.id) + 1 || doneCount + 1
        : Math.min(doneCount + 1, total);

  let headline = "Ready to enable";
  if (phase === "running") {
    headline = current
      ? `Waiting on ${current.label}`
      : "Enabling Memstream";
  } else if (phase === "succeeded") {
    headline = "Memstream is enabled";
  } else if (phase === "failed") {
    headline = current
      ? `Failed on ${current.label}`
      : "Enable failed";
  }

  return {
    phase,
    steps,
    doneCount,
    total,
    stepNumber,
    current,
    headline,
  };
}

/**
 * Cloudflare-style architecture: sources → Memstream → bindings,
 * driven by enable job steps (same layout language as Live MemoryFlow).
 */
export function EnableFlow({
  job,
  tables,
  bucket,
  prefix,
  deploy,
  stackName,
  className,
  compact,
  onNodeClick,
  footer,
  showPath = true,
}: {
  job?: JobStatus | null;
  tables: string;
  bucket: string;
  prefix: string;
  deploy: boolean;
  stackName: string;
  className?: string;
  compact?: boolean;
  onNodeClick?: (node: PipelineNode) => void;
  footer?: ReactNode;
  /** When false, hide the redundant triggers→bindings breadcrumb. */
  showPath?: boolean;
}) {
  const progress = getEnableProgress(job, {
    tables,
    bucket,
    prefix,
    deploy,
    stackName,
  });
  const steps = progress.steps;

  const schema = stepById(steps, "schema");
  const changefeed = stepById(steps, "changefeed");
  const s3 = stepById(steps, "s3");
  const embed = stepById(steps, "embed");
  const vectors = stepById(steps, "vectors");
  const worker = stepById(steps, "worker");

  const tableList = tables
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const sources: PipelineNode[] = [
    {
      id: "cockroach",
      label: schema?.label || PIPELINE_LABELS.database,
      detail: schema?.detail || "App tables plus agent_memory_chunks",
      statusLabel: statusLabel(schema?.status),
      state: nodeState(schema?.status),
      count: schema?.status === "done" ? 1 : 0,
    },
    {
      id: "tables",
      label: PIPELINE_LABELS.watchedTables,
      detail: tableList.slice(0, 4).join(", ") || "Configure a profile",
      statusLabel:
        tableList.length && changefeed?.status === "done"
          ? "Ready"
          : statusLabel(changefeed?.status),
      state:
        tableList.length && (changefeed?.status === "done" || schema?.status === "done")
          ? "ok"
          : nodeState(changefeed?.status),
    },
    {
      id: "changefeed",
      label: changefeed?.label || PIPELINE_LABELS.liveChanges,
      detail: changefeed?.detail || "Streams watched tables",
      statusLabel: statusLabel(changefeed?.status),
      state: nodeState(changefeed?.status),
    },
  ];

  const bindings: PipelineNode[] = [
    {
      id: "s3",
      label: s3?.label || PIPELINE_LABELS.changeStorage,
      detail: s3?.detail || "Holds the change stream",
      hint: bucket
        ? `s3://${bucket}/${prefix || "cdc/"}`
        : "Set CDC_S3_BUCKET in .env",
      statusLabel: statusLabel(s3?.status),
      state: nodeState(s3?.status),
    },
    {
      id: "bedrock",
      label: embed?.label || PIPELINE_LABELS.embeddings,
      detail: "Embeds change text for vector search",
      statusLabel: statusLabel(embed?.status),
      state: nodeState(embed?.status),
    },
    {
      id: "vectors",
      label: vectors?.label || PIPELINE_LABELS.agentMemory,
      detail: "Chunks stored in Cockroach",
      statusLabel: statusLabel(vectors?.status),
      state: nodeState(vectors?.status),
    },
    {
      id: "worker",
      label: worker?.label || PIPELINE_LABELS.memoryWorker,
      detail: deploy
        ? `AWS · ${stackName || "cloud"}`
        : "Local worker",
      hint: deploy ? stackName || "cloud stack" : "make watch-cloud",
      statusLabel: statusLabel(worker?.status),
      state: nodeState(worker?.status),
    },
  ];

  const coreState =
    progress.phase === "failed"
      ? "error"
      : progress.phase === "succeeded"
        ? "ok"
        : progress.phase === "running"
          ? "active"
          : "idle";

  const title = compact
    ? PIPELINE_LABELS.memstream
    : progress.phase === "succeeded"
      ? `${PRODUCT.memory} is ready`
      : progress.phase === "failed"
        ? "Enable failed"
        : progress.phase === "running"
          ? "Starting Memstream"
          : "Selected Memstream";

  const blockerLabel = progress.current?.label;
  const observability =
    progress.phase === "running" && blockerLabel
      ? [
          {
            name: "Now",
            status: blockerLabel,
          },
          {
            name: "Progress",
            status: `${progress.doneCount}/${progress.total}`,
          },
        ]
      : progress.phase === "failed" && blockerLabel
        ? [
            {
              name: "Failed",
              status: blockerLabel,
            },
          ]
        : [
            {
              name: "Steps ready",
              status: `${progress.doneCount}/${progress.total}`,
            },
            {
              name: "Ask (MCP)",
              status:
                progress.phase === "succeeded" ? "ready" : "after enable",
            },
          ];

  return (
    <div className={cn(className)}>
      <MemoryFlow
        sources={sources}
        core={{
          label: PIPELINE_LABELS.memstream,
          subtitle:
            progress.phase === "running" && blockerLabel
              ? `Waiting on ${blockerLabel}`
              : PRODUCT.tagline,
          state: coreState,
          observability,
        }}
        bindings={bindings}
        activeId={activeStepId(steps, job)}
        title={title}
        subtitle={
          progress.phase === "running"
            ? "Running this step"
            : "Click a node for details"
        }
        showPath={showPath}
        onNodeClick={onNodeClick}
        footer={footer}
      />
    </div>
  );
}
