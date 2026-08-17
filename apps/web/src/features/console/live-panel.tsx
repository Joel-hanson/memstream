"use client";

import { LogLines, MemoryChunkList } from "@/components/log-list";
import { MemoryFlow } from "@/components/memory-flow";
import { TermHint } from "@/components/term-hint";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { JobStatus, MemstreamRun, PipelineStatus } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFlashlightLine,
  RiPlugLine,
  RiRefreshLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useEffect, useState } from "react";
import {
  resolveRunDisplayStatus,
  runProfileLabel,
  runStatusLabel,
} from "./helpers";
import type { BusyAction } from "./types";

const SHOW_CONNECTION_HEALTH = true;

function healthBadgeVariant(
  status: string | undefined,
): "secondary" | "destructive" | "outline" {
  if (status === "ok") return "secondary";
  if (
    status === "down" ||
    status === "error" ||
    status === "warn" ||
    status === "degraded"
  ) {
    return "destructive";
  }
  return "outline";
}

function healthLabel(status: string | undefined): string {
  switch (status) {
    case "ok":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "down":
      return "Down";
    default:
      return "Unknown";
  }
}

function checkLabel(status: string | undefined, kind: "db" | "cf" | "mem"): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "warn":
      return kind === "mem" ? "Lagging" : "Warn";
    case "error":
      return "Error";
    case "idle":
      return "Idle";
    default:
      return "Unknown";
  }
}

function formatLag(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function healthHeadline(
  pipeline: PipelineStatus,
  lagHuman: string | null,
): string {
  const health = pipeline.health;
  if (health?.status === "down" || pipeline.db_error) {
    return "Connection is down";
  }
  if (health?.memory.status === "warn" && lagHuman) {
    return `Memory is ${lagHuman} behind live changes`;
  }
  if (health?.memory.status === "warn") {
    return "Memory is behind live changes";
  }
  if (health?.status === "degraded") {
    return "Connection is degraded";
  }
  if (health?.memory.detail?.toLowerCase().includes("quiet")) {
    return health.memory.detail;
  }
  if (health?.status === "ok") {
    return "Connected and catching memory writes";
  }
  return (
    health?.connection.detail ||
    pipeline.db_error ||
    "From the latest pipeline refresh"
  );
}

function healthHelper(
  pipeline: PipelineStatus,
  chunkCount: number,
): string | null {
  if (pipeline.health?.memory.status !== "warn") return null;
  if (chunkCount > 0) {
    return "Chunks exist, but newer DB changes aren't in memory yet.";
  }
  return "Changefeed is ahead of the memory worker.";
}

type FlowNode = {
  id?: string;
  label: string;
  count?: number;
  detail?: string;
  statusLabel?: string;
  hint?: string;
  state?: string;
  href?: string;
};

export function RunSummaryCard({
  activeRun,
  job,
  profileLabel,
  tables,
  runsCount,
  busy,
  watching,
  hasMemory,
  onOpenRuns,
  onRequestDelete,
}: {
  activeRun: MemstreamRun | null;
  job: JobStatus | null;
  profileLabel: string;
  tables: string;
  runsCount: number;
  busy: BusyAction;
  watching?: boolean;
  hasMemory?: boolean;
  onOpenRuns: () => void;
  onRequestDelete: (run: MemstreamRun, e?: React.MouseEvent) => void;
}) {
  const displayStatus = resolveRunDisplayStatus(activeRun, job, {
    watching,
    hasMemory,
  });
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2">
            {watching ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-emerald-600"
                    aria-label="Watching this flow"
                  />
                </TooltipTrigger>
                <TooltipContent>Watching</TooltipContent>
              </Tooltip>
            ) : null}
            <span className="truncate">
              {activeRun ? runProfileLabel(activeRun) : profileLabel}
            </span>
          </CardTitle>
          <CardDescription className="truncate">
            {activeRun?.tables || tables || "No tables yet"}
            {activeRun?.created_at
              ? ` · ${formatRelativeTime(activeRun.created_at)}`
              : ""}
          </CardDescription>
          {activeRun?.app_database_label ? (
            <p className="truncate font-mono text-[0.65rem] text-muted-foreground">
              {activeRun.app_database_label}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {runsCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onOpenRuns}
            >
              All ({runsCount})
            </Button>
          ) : null}
          <Badge
            variant={
              displayStatus === "succeeded"
                ? "secondary"
                : displayStatus === "failed"
                  ? "destructive"
                  : "outline"
            }
          >
            {runStatusLabel(displayStatus)}
          </Badge>
          {activeRun ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy === "delete"}
              aria-label="Delete Memstream flow"
              onClick={(e) => onRequestDelete(activeRun, e)}
            >
              <RiDeleteBinLine className="size-4" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
    </Card>
  );
}

export function EnableLogCard({ job }: { job: JobStatus }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>
            {job.status === "failed" ? "Enable failed" : "Enable log"}
          </CardTitle>
          <CardDescription>
            {job.status === "failed"
              ? "Fix the issue below, then retry"
              : "Enable is running. This is the next step."}
          </CardDescription>
        </div>
        <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
          {runStatusLabel(job.status)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {job.error || job.status === "failed" ? (
          <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {job.error || "Enable failed"}
            {/AccessDenied|CreateStack|DescribeStacks|cloudformation/i.test(
              (job.log || []).join("\n") + (job.error || ""),
            ) ? (
              <p className="mt-1 text-muted-foreground">
                Memory worker needs CloudFormation permission. Attach{" "}
                <span className="font-mono text-foreground">
                  infra/deployer-policy.json
                </span>{" "}
                as a managed policy, or turn off “Start managed cloud worker”
                and run the worker locally.
              </p>
            ) : null}
          </div>
        ) : null}
        <LogLines
          lines={job.log || []}
          empty="Waiting for enable output…"
          maxHeightClass="max-h-48"
        />
      </CardContent>
    </Card>
  );
}

export function LivePanel({
  profileLabel,
  tables,
  workerStamp,
  busy,
  watching,
  pipeline,
  recentChunks,
  recentTables,
  metrics,
  hasSetupLog,
  wiringOpen,
  onToggleWiring,
  flowSources,
  flowCore,
  flowBindings,
  flowFooter,
  askCopied,
  mcpCopied,
  onRefresh,
  onOpenSetupLog,
  onStartWatch,
  onCopyAsk,
  onCopyMcp,
  onNodeClick,
}: {
  profileLabel: string;
  tables: string;
  workerStamp: string;
  busy: BusyAction;
  watching: boolean;
  pipeline: PipelineStatus | null;
  recentChunks: PipelineStatus["recent"];
  recentTables: string[];
  metrics: PipelineStatus["metrics"] | undefined;
  hasSetupLog: boolean;
  wiringOpen: boolean;
  onToggleWiring: () => void;
  flowSources: FlowNode[];
  flowCore: {
    label?: string;
    subtitle?: string;
    state?: string;
    observability?: { name: string; status: string }[];
  };
  flowBindings: FlowNode[];
  flowFooter: React.ReactNode;
  askCopied: boolean;
  mcpCopied: boolean;
  onRefresh: () => void;
  onOpenSetupLog: () => void;
  onStartWatch: () => void;
  onCopyAsk: () => void;
  onCopyMcp: () => void;
  onNodeClick: (node: { id?: string; href?: string }) => void;
}) {
  const health = pipeline?.health;
  const lagSeconds =
    health?.memory.lag_seconds ?? metrics?.lag_seconds ?? null;
  const lagHuman = formatLag(lagSeconds);
  const chunkCount = metrics?.chunks ?? recentChunks.length;
  const isLagging = health?.memory.status === "warn";
  const isUnhealthy =
    health?.status === "degraded" ||
    health?.status === "down" ||
    Boolean(pipeline?.db_error);
  const latestCdcAt = health?.memory.latest_cdc_at ?? metrics?.latest_cdc_at;
  const latestChunkAt =
    health?.memory.latest_chunk_at ?? metrics?.latest_at ?? null;
  const headline = pipeline
    ? healthHeadline(pipeline, lagHuman)
    : null;
  const helper = pipeline ? healthHelper(pipeline, chunkCount) : null;

  // Fold like Pipeline: collapsed when healthy, forced open when degraded/down.
  const [healthOpen, setHealthOpen] = useState(isUnhealthy);
  useEffect(() => {
    if (isUnhealthy) setHealthOpen(true);
  }, [isUnhealthy]);

  const openWorker = () => {
    if (!wiringOpen) onToggleWiring();
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-sm font-medium">
            {recentChunks.length ? "Memory chunks" : "Live"}
          </h1>
          <p className="text-xs text-muted-foreground">
            <TermHint hint="YAML that lists which tables to watch, when a write should become a chunk, and how that chunk is worded.">
              Profile
            </TermHint>{" "}
            <span className="font-mono text-foreground">{profileLabel}</span>
            {tables ? (
              <>
                {" "}
                · tables{" "}
                <span className="font-mono text-foreground">{tables}</span>
              </>
            ) : null}
            {" · "}
            <span className="text-foreground">{workerStamp}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy === "refresh"}
            onClick={onRefresh}
          >
            {busy === "refresh" ? <Spinner /> : <RiRefreshLine />}
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
          {hasSetupLog ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenSetupLog}
            >
              Setup log
            </Button>
          ) : null}
          {!watching ? (
            <Button type="button" size="sm" onClick={onStartWatch}>
              Watch
            </Button>
          ) : null}
        </div>
      </div>

      {SHOW_CONNECTION_HEALTH && pipeline ? (
        <div
          className={cn(
            "border",
            isUnhealthy &&
            (health?.status === "down" || pipeline.db_error
              ? "border-destructive/50 bg-destructive/5"
              : "border-destructive/35 bg-destructive/3"),
          )}
        >
          <button
            type="button"
            className="flex w-full cursor-pointer items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
            onClick={() => setHealthOpen((o) => !o)}
            aria-expanded={healthOpen}
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Connection health
                </span>
                <Badge variant={healthBadgeVariant(health?.status)}>
                  {healthLabel(health?.status)}
                </Badge>
              </div>
              <p className="truncate text-xs text-foreground/90">{headline}</p>
            </div>
            <RiArrowDownSLine
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                healthOpen && "rotate-180",
              )}
            />
          </button>
          {healthOpen ? (
            <div className="space-y-3 border-t px-3 py-3">
              {helper ? (
                <p className="text-xs text-muted-foreground">{helper}</p>
              ) : null}
              <ul className="grid gap-2 text-xs sm:grid-cols-3">
                {[
                  {
                    key: "db" as const,
                    label: "App DB",
                    status: health?.connection.status,
                    detail: health?.connection.detail,
                    warn: health?.connection.status === "error",
                  },
                  {
                    key: "cf" as const,
                    label: "Changefeed",
                    status: health?.changefeed.status,
                    detail: health?.changefeed.detail,
                    warn: health?.changefeed.status === "warn",
                  },
                  {
                    key: "mem" as const,
                    label: "Memory",
                    status: health?.memory.status,
                    detail: (() => {
                      if (isLagging && lagHuman) return `${lagHuman} behind`;
                      if (health?.memory.status === "ok") {
                        return lagHuman && lagSeconds && lagSeconds > 0
                          ? `Up to date (${lagHuman})`
                          : "Up to date";
                      }
                      return (
                        health?.memory.detail || "Waiting for pipeline data"
                      );
                    })(),
                    warn: isLagging,
                    title:
                      lagSeconds != null
                        ? `${lagSeconds}s behind CDC`
                        : undefined,
                  },
                ].map((row) => (
                  <li
                    key={row.key}
                    className={cn(
                      "min-w-0 border border-border/80 bg-muted/20 px-2.5 py-2",
                      row.warn && "border-destructive/40 bg-destructive/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{row.label}</span>
                      <Badge
                        variant={healthBadgeVariant(row.status)}
                        className="shrink-0"
                      >
                        {checkLabel(row.status, row.key)}
                      </Badge>
                    </div>
                    {row.key === "mem" && row.title ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="mt-1 truncate text-foreground/90">
                            {row.detail || "—"}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6}>
                          {row.title}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="mt-1 truncate text-foreground/90">
                        {row.detail || "—"}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {(latestCdcAt || latestChunkAt) && (
                <dl className="grid gap-1 text-[0.7rem] text-muted-foreground sm:grid-cols-2">
                  <div className="flex min-w-0 justify-between gap-2 border border-border/60 px-2 py-1.5">
                    <dt>Last CDC</dt>
                    <dd className="truncate text-foreground/90">
                      {latestCdcAt
                        ? formatRelativeTime(latestCdcAt) || latestCdcAt
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 justify-between gap-2 border border-border/60 px-2 py-1.5">
                    <dt>Last memory</dt>
                    <dd className="truncate text-foreground/90">
                      {latestChunkAt
                        ? formatRelativeTime(latestChunkAt) || latestChunkAt
                        : "—"}
                    </dd>
                  </div>
                </dl>
              )}

              {isLagging || isUnhealthy ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openWorker}
                  >
                    Check worker
                  </Button>
                  {hasSetupLog ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onOpenSetupLog}
                    >
                      View setup log
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>
              {pipeline?.db_error
                ? "Recent memory"
                : recentChunks.length
                  ? "Recent memory"
                  : "No chunks yet"}
            </CardTitle>
            <CardDescription>
              {pipeline?.db_error
                ? pipeline.db_error
                : recentChunks.length
                  ? `${recentChunks.length} chunk${recentChunks.length === 1 ? "" : "s"
                  }${recentTables.length
                    ? ` from ${recentTables.slice(0, 3).join(", ")}`
                    : ""
                  }`
                  : watching
                    ? "Waiting for a write on a watched table"
                    : "After Enable, new writes show up here"}
            </CardDescription>
          </div>
          {busy === "refresh" || (watching && !pipeline) ? (
            <Spinner className="text-muted-foreground" />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <MemoryChunkList
            chunks={recentChunks}
            empty={
              watching && !pipeline
                ? "Loading pipeline…"
                : watching
                  ? "Write to a watched table (or use the demo shop)."
                  : "Enable Memstream, then write to a watched table."
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopyAsk}
            >
              {askCopied ? <RiCheckLine /> : <RiFileCopyLine />}
              {askCopied ? "Copied" : "Copy ask for Cursor"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCopyMcp}
            >
              {mcpCopied ? <RiCheckLine /> : <RiFileCopyLine />}
              {mcpCopied ? "Copied" : "Copy Memstream MCP"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Ask in Cursor with{" "}
              <TermHint hint="Cursor /api/mcp: search_memory, schema resources, make_memory_profile → save_memory_profile.">
                <span className="font-mono">search_memory</span>
              </TermHint>
              . Copy Memstream MCP pastes the HTTP URL (plus Basic demo/demo or Bearer when auth is on).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          {
            label: (
              <TermHint hint="Rows in agent_memory_chunks. Each row is one rule match on a write.">
                Memory chunks
              </TermHint>
            ),
            key: "chunks",
            value:
              watching && !pipeline ? (
                <Spinner className="size-5 text-muted-foreground" />
              ) : (
                (metrics?.chunks ?? "-")
              ),
            sub: metrics?.latest_at
              ? `last ${metrics.latest_at}`
              : "in agent memory",
          },
          {
            label: (
              <TermHint hint="Count of distinct rule names that produced chunks (for example order_status_change).">
                Rules firing
              </TermHint>
            ),
            key: "rules",
            value:
              watching && !pipeline ? (
                <Spinner className="size-5 text-muted-foreground" />
              ) : (
                (metrics?.by_rule || []).length || "-"
              ),
            sub:
              (metrics?.by_rule || [])
                .slice(0, 2)
                .map((r) => `${r.rule}×${r.count}`)
                .join(" · ") || "by rule_name",
          },
        ].map((m) => (
          <Card key={m.key} size="sm">
            <CardHeader>
              <CardDescription>{m.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{m.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="truncate text-xs text-muted-foreground">{m.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="border">
        <button
          type="button"
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          onClick={onToggleWiring}
          aria-expanded={wiringOpen}
        >
          <span>
            Pipeline
            <span className="ml-2 text-foreground/80">{workerStamp}</span>
          </span>
          <RiArrowDownSLine
            className={cn(
              "size-4 transition-transform",
              wiringOpen && "rotate-180",
            )}
          />
        </button>
        {wiringOpen ? (
          <div className="border-t">
            <MemoryFlow
              sources={flowSources}
              core={flowCore}
              bindings={flowBindings}
              activeId={null}
              title="This Memstream"
              subtitle="Click a node for the related action"
              showPath={false}
              onNodeClick={onNodeClick}
              footer={flowFooter}
              className="border-0"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

export function ConsoleAlerts({
  apiHint,
  notice,
  error,
  busy,
  onRetryProfiles,
  onDismissNotice,
}: {
  apiHint: string | null;
  notice: string | null;
  error: string | null;
  busy: BusyAction;
  onRetryProfiles: () => void;
  onDismissNotice: () => void;
}) {
  return (
    <>
      {apiHint ? (
        <div className="flex items-start justify-between gap-3 border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <p>
            <span className="text-foreground">API offline.</span> {apiHint}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy === "profiles"}
            onClick={onRetryProfiles}
          >
            {busy === "profiles" ? <Spinner /> : null}
            Retry
          </Button>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start justify-between gap-3 border bg-muted/30 px-3 py-2 text-xs">
          <p>{notice}</p>
          <Button type="button" variant="ghost" size="xs" onClick={onDismissNotice}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

export function FlowPrimaryCta({
  job,
  watching,
  hasMemory,
  credentialsSet,
  profileReady,
  canEnable,
  isBusy,
  busy,
  onEnable,
  onOpenConnect,
  onOpenConfigure,
  onOpenEnable,
}: {
  job: JobStatus | null;
  watching: boolean;
  hasMemory: boolean;
  credentialsSet: boolean;
  profileReady: boolean;
  canEnable: boolean;
  isBusy: boolean;
  busy: BusyAction;
  onEnable: () => void;
  onOpenConnect: () => void;
  onOpenConfigure: () => void;
  onOpenEnable: () => void;
}) {
  if (job?.status === "running" || job?.status === "queued") {
    return (
      <span className="text-xs text-muted-foreground">Enable in progress…</span>
    );
  }
  if (job?.status === "failed") {
    return (
      <Button
        type="button"
        size="sm"
        disabled={!canEnable || isBusy}
        onClick={onEnable}
      >
        {busy === "enable" ? <Spinner /> : <RiFlashlightLine />}
        {busy === "enable" ? "Starting…" : "Retry enable"}
      </Button>
    );
  }
  if (job?.status === "succeeded" || watching || hasMemory) {
    return null;
  }
  if (!credentialsSet) {
    return (
      <Button type="button" size="sm" onClick={onOpenConnect}>
        <RiPlugLine />
        Connect cluster
      </Button>
    );
  }
  if (!profileReady) {
    return (
      <Button type="button" size="sm" onClick={onOpenConfigure}>
        <RiSettings3Line />
        Configure
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      disabled={!canEnable || isBusy}
      onClick={onOpenEnable}
    >
      <RiFlashlightLine />
      Enable
    </Button>
  );
}
