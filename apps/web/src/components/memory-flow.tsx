"use client";

import type { ReactNode } from "react";
import { PIPELINE_LABELS, PRODUCT } from "@memstream/engine/naming";
import { cn } from "@/lib/utils";
import type { JobStatus, PipelineNode, PipelineStatus } from "@/lib/types";

type FlowCore = PipelineStatus["core"];

function stateDot(state?: string) {
  if (state === "ok" || state === "active") return "bg-foreground";
  if (state === "warn") return "bg-muted-foreground";
  if (state === "error" || state === "failed") return "bg-destructive";
  return "bg-border";
}

function statusFromState(state?: string): string {
  switch (state) {
    case "ok":
      return "Ready";
    case "active":
      return "Working";
    case "error":
    case "failed":
      return "Failed";
    case "warn":
      return "Pending";
    default:
      return "Waiting";
  }
}

function nodeKey(node: PipelineNode, i: number) {
  return node.id || `${node.label}-${i}`;
}

function isActive(node: PipelineNode, activeId?: string | null) {
  if (!activeId) return false;
  if (node.id === activeId) return true;
  return node.label.toLowerCase().includes(activeId.toLowerCase());
}

function NodeCard({
  node,
  active,
  onClick,
}: {
  node: PipelineNode;
  active?: boolean;
  onClick?: (node: PipelineNode) => void;
}) {
  const status = node.statusLabel || statusFromState(node.state);
  const clickable = Boolean(onClick && node.id);
  const Tag = clickable ? "button" : "div";

  return (
    <Tag
      type={clickable ? "button" : undefined}
      title={node.hint || node.detail || undefined}
      onClick={clickable ? () => onClick?.(node) : undefined}
      className={cn(
        "w-full border bg-background px-2.5 py-2 text-left transition-colors",
        active && "border-foreground bg-muted/40 ring-1 ring-foreground/20",
        node.state === "error" && "border-destructive/40 bg-destructive/5",
        node.state === "active" &&
          !active &&
          "border-foreground/50 bg-muted/30",
        clickable &&
          "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {node.label}
          {clickable ? (
            <span className="ml-1 text-[0.6rem] font-normal text-muted-foreground">
              →
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "text-[0.6rem] uppercase tracking-wide",
              node.state === "error"
                ? "text-destructive"
                : node.state === "active"
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
          >
            {status}
          </span>
          <span
            className={cn(
              "size-1.5 rounded-full",
              stateDot(node.state),
              node.state === "active" && "animate-pulse-dot",
            )}
          />
        </span>
      </div>
      {node.detail ? (
        <p className="mt-0.5 line-clamp-2 text-[0.65rem] leading-snug text-muted-foreground">
          {node.detail}
        </p>
      ) : null}
    </Tag>
  );
}

function Rail({ from = "left" }: { from?: "left" | "right" }) {
  return (
    <div
      className="relative hidden w-10 shrink-0 self-stretch sm:block"
      aria-hidden
    >
      <div className="absolute inset-y-[18%] left-1/2 w-px -translate-x-1/2 bg-border" />
      <div
        className={cn(
          "absolute top-1/2 h-px w-full -translate-y-1/2 bg-border",
          from === "left" ? "left-0" : "right-0",
        )}
      />
      <div
        className={cn(
          "absolute top-1/2 size-1.5 -translate-y-1/2 border border-border bg-background",
          from === "left" ? "right-0" : "left-0",
        )}
      />
    </div>
  );
}

export function MemoryFlow({
  sources,
  core,
  bindings,
  activeId,
  title = PRODUCT.memory,
  subtitle,
  className,
  onNodeClick,
  footer,
  showPath = true,
}: {
  sources: PipelineNode[];
  core: FlowCore;
  bindings: PipelineNode[];
  activeId?: string | null;
  title?: string;
  subtitle?: string;
  className?: string;
  onNodeClick?: (node: PipelineNode) => void;
  footer?: ReactNode;
  /** Hide the redundant path breadcrumb when the diagram is nested. */
  showPath?: boolean;
}) {
  return (
    <div className={cn("border bg-muted/15", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="text-xs font-medium">{title}</div>
          {subtitle ? (
            <div className="text-[0.65rem] text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
        {showPath ? (
          <div className="text-[0.65rem] text-muted-foreground">
            triggers → memstream → bindings
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4 overflow-x-auto p-3 sm:flex-row sm:items-stretch sm:gap-0">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="mb-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            Triggers
          </div>
          {sources.map((node, i) => (
            <NodeCard
              key={nodeKey(node, i)}
              node={node}
              active={isActive(node, activeId)}
              onClick={onNodeClick}
            />
          ))}
        </div>

        <Rail from="left" />

        <div className="flex w-full shrink-0 flex-col justify-center sm:w-48">
          <div
            className={cn(
              "relative border bg-background p-3",
              (activeId === "memstream" ||
                core.state === "active" ||
                core.state === "ok") &&
                "border-foreground/60",
              core.state === "error" && "border-destructive/50 bg-destructive/5",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {core.label || PIPELINE_LABELS.memstream}
                </div>
                <div className="truncate text-[0.65rem] text-muted-foreground">
                  {core.subtitle || PRODUCT.tagline}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "text-[0.6rem] uppercase tracking-wide",
                    core.state === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {statusFromState(core.state)}
                </span>
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    stateDot(core.state),
                    (core.state === "ok" || core.state === "active") &&
                      "animate-pulse-dot",
                  )}
                />
              </span>
            </div>
            {(core.observability || []).length ? (
              <ul className="mt-3 space-y-1.5 border-t pt-2">
                {(core.observability || []).map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center justify-between gap-2 text-[0.65rem]"
                  >
                    <span className="text-muted-foreground">{row.name}</span>
                    <span className="font-mono text-foreground">
                      {row.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <Rail from="right" />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="mb-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            Bindings
          </div>
          <div className="border bg-background">
            <div className="flex items-center justify-between border-b px-2.5 py-1.5 text-[0.65rem] text-muted-foreground">
              <span>
                Bindings{" "}
                <span className="tabular-nums text-foreground">
                  ({bindings.length})
                </span>
              </span>
            </div>
            <ul className="divide-y">
              {bindings.map((node, i) => {
                const status = node.statusLabel || statusFromState(node.state);
                const clickable = Boolean(onNodeClick && node.id);
                const Row = clickable ? "button" : "div";
                return (
                  <li key={nodeKey(node, i)}>
                    <Row
                      type={clickable ? "button" : undefined}
                      title={node.hint || undefined}
                      onClick={
                        clickable ? () => onNodeClick?.(node) : undefined
                      }
                      className={cn(
                        "flex w-full items-start justify-between gap-2 px-2.5 py-2 text-left",
                        isActive(node, activeId) && "bg-muted/50",
                        node.state === "error" && "bg-destructive/5",
                        clickable && "cursor-pointer hover:bg-muted/40",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">
                          {node.label}
                        </div>
                        {node.detail ? (
                          <div className="line-clamp-2 text-[0.65rem] leading-snug text-muted-foreground">
                            {node.detail}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "text-[0.6rem] uppercase tracking-wide",
                            node.state === "error"
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {status}
                        </span>
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            stateDot(node.state),
                            node.state === "active" && "animate-pulse-dot",
                          )}
                        />
                      </div>
                    </Row>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      {footer ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Preview nodes before /api/pipeline has live counts. */
export function previewFlow(options: {
  connected: boolean;
  profileReady: boolean;
  tables: string;
  bucket: string;
  prefix: string;
  profileLabel: string;
  deploy: boolean;
  stackName: string;
}): Pick<PipelineStatus, "sources" | "core" | "bindings"> {
  const tableList = options.tables
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const connected = options.connected;
  const configured = connected && options.profileReady;

  return {
    sources: [
      {
        id: "cockroach",
        label: PIPELINE_LABELS.database,
        detail: connected ? "CockroachDB connected" : "Connect your application DB",
        statusLabel: connected ? "Ready" : "Waiting",
        count: connected ? 1 : 0,
        state: connected ? "ok" : "idle",
      },
      {
        id: "tables",
        label: PIPELINE_LABELS.watchedTables,
        detail: connected
          ? tableList.slice(0, 4).join(", ") || "Configure a profile"
          : "Connect first",
        statusLabel: configured && tableList.length ? "Ready" : "Waiting",
        count: tableList.length,
        state: configured && tableList.length ? "ok" : "idle",
      },
      {
        id: "changefeed",
        label: PIPELINE_LABELS.liveChanges,
        detail: configured
          ? "Streams watched tables after Enable"
          : "Waiting for Connect + Configure",
        statusLabel: "Waiting",
        count: 0,
        state: "idle",
      },
    ],
    core: {
      label: PIPELINE_LABELS.memstream,
      subtitle: options.profileLabel
        ? `profile · ${options.profileLabel}`
        : PRODUCT.tagline,
      state: configured ? "warn" : "idle",
      observability: [
        {
          name: "Setup",
          status: !connected
            ? "connect"
            : !options.profileReady
              ? "configure"
              : "ready to enable",
        },
        { name: "Ask (MCP)", status: "after enable" },
      ],
    },
    bindings: [
      {
        id: "s3",
        label: PIPELINE_LABELS.changeStorage,
        detail: options.bucket ? "From .env (CDC_S3_BUCKET)" : "Set CDC_S3_BUCKET in .env",
        hint: options.bucket
          ? `s3://${options.bucket}/${options.prefix || "cdc/"}`
          : undefined,
        statusLabel: options.bucket ? "Ready" : "Waiting",
        state: options.bucket ? "ok" : "idle",
      },
      {
        id: "bedrock",
        label: PIPELINE_LABELS.embeddings,
        detail: "Embeds change text for vector search",
        statusLabel: "Waiting",
        state: "idle",
      },
      {
        id: "vectors",
        label: PIPELINE_LABELS.agentMemory,
        detail: "Chunks stored in Cockroach",
        statusLabel: "Waiting",
        state: "idle",
      },
      {
        id: "worker",
        label: PIPELINE_LABELS.memoryWorker,
        detail: options.deploy
          ? `AWS · ${options.stackName || "cloud"}`
          : "Local worker",
        hint: options.deploy ? options.stackName : "make watch-cloud",
        statusLabel: "Waiting",
        state: "idle",
      },
    ],
  };
}

/** Which flow node is currently being brought up, from enable job logs. */
export function activeIdFromJob(job: JobStatus | null): string | null {
  if (!job) return null;
  if (job.status === "succeeded") return null;
  if (job.status === "failed") return "worker";
  const log = (job.log || []).join("\n").toLowerCase();
  if (log.includes("deploying") || log.includes("cloudformation")) {
    return "worker";
  }
  if (log.includes("changefeed")) return "changefeed";
  if (log.includes("schema") || log.includes("sql/schema")) return "cockroach";
  if (log.includes("wrote session") || job.status === "running") {
    return "memstream";
  }
  return "memstream";
}
