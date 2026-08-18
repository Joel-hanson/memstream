"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import {
  RiAddLine,
  RiBuilding2Line,
  RiCheckLine,
  RiFileCopyLine,
  RiFlashlightLine,
  RiPlugLine,
  RiSettings3Line,
} from "@remixicon/react";
import { MemstreamMark } from "@/components/memstream-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { MemstreamRun } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { pickJoinableRun, pickPrimaryRun, runProfileLabel, runStatusLabel } from "./helpers";
import { RUN_STATUS } from "./constants";
import type { BusyAction } from "./types";

const LANDING_RUNS_LIMIT = 5;

function landingPreviewRuns(runs: MemstreamRun[]): MemstreamRun[] {
  const primary = pickPrimaryRun(runs);
  const rest = primary ? runs.filter((r) => r.id !== primary.id) : runs;
  return (primary ? [primary, ...rest] : rest).slice(0, LANDING_RUNS_LIMIT);
}

export function SetupWizard({
  setupStep,
  credentialsSet,
  profileReady,
  runs,
  mcpCopied,
  demoAvailable,
  demoBusy,
  onUseDemo,
  onOpenConnect,
  onOpenConfigure,
  onOpenEnable,
  onPrimary,
  onCopyMcp,
  onSelectResume,
  onOpenRuns,
}: {
  setupStep: 1 | 2 | 3;
  credentialsSet: boolean;
  profileReady: boolean;
  runs: MemstreamRun[];
  mcpCopied: boolean;
  demoAvailable: boolean;
  demoBusy: boolean;
  onUseDemo: () => void;
  onOpenConnect: () => void;
  onOpenConfigure: () => void;
  onOpenEnable: () => void;
  onPrimary: () => void;
  onCopyMcp: () => void;
  onSelectResume: (run: MemstreamRun) => void;
  onOpenRuns: () => void;
}) {
  const resumeRun = pickJoinableRun(runs);
  const joinExisting = Boolean(resumeRun);
  const showDemoCta = demoAvailable && !joinExisting && setupStep === 1;
  const primarySetup =
    setupStep === 1
      ? joinExisting && resumeRun
        ? {
            label: `Continue with ${runProfileLabel(resumeRun)}`,
            icon: RiCheckLine,
          }
        : demoAvailable
          ? { label: "Use demo workspace", icon: RiFlashlightLine }
          : { label: "Connect your own cluster", icon: RiPlugLine }
      : setupStep === 2
        ? { label: "Configure", icon: RiSettings3Line }
        : { label: "Enable", icon: RiFlashlightLine };

  const PrimaryIcon = primarySetup.icon as ComponentType<{ className?: string }>;
  const onPrimaryClick = () => {
    if (setupStep === 1 && resumeRun) {
      onSelectResume(resumeRun);
      return;
    }
    if (setupStep === 1 && showDemoCta) {
      onUseDemo();
      return;
    }
    onPrimary();
  };
  const previewRuns = landingPreviewRuns(runs);

  return (
    <div className="flex max-w-2xl flex-col gap-6 pt-6 sm:pt-10">
      <div className="max-w-lg space-y-2">
        <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          Index Cockroach writes so agents can search them
        </h1>
        <p className="text-sm text-muted-foreground">
          {setupStep === 1
            ? joinExisting
              ? "A Memstream is already live on this database. Continue with it, or Configure another profile to stream in parallel."
              : demoAvailable
                ? "Try our shared demo application database, or connect your own Cockroach cluster."
                : "Connect your Cockroach cluster."
            : setupStep === 2
              ? "Pick which tables Memstream should watch."
              : "Enable Memstream on those tables."}
        </p>
      </div>

      <div className="max-w-lg space-y-4">
        <ol className="space-y-0 border">
          {(
            [
              {
                n: 1 as const,
                title: "Connect",
                detail: "Cockroach application database",
                done: credentialsSet,
                open: onOpenConnect,
              },
              {
                n: 2 as const,
                title: "Configure",
                detail: "Tables and memory rules",
                done: profileReady,
                open: onOpenConfigure,
              },
              {
                n: 3 as const,
                title: "Enable",
                detail: "Start indexing writes",
                done: false,
                open: onOpenEnable,
              },
            ] as const
          ).map((step, i, arr) => {
            const current = setupStep === step.n;
            const locked =
              (step.n === 2 && !credentialsSet) ||
              (step.n === 3 && !profileReady);
            return (
              <li key={step.n}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={step.open}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                    i < arr.length - 1 && "border-b",
                    current && "bg-muted/40",
                    locked
                      ? "cursor-not-allowed"
                      : "cursor-pointer hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center border text-[0.65rem] tabular-nums",
                      step.done || current
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {step.done ? <RiCheckLine className="size-3" /> : step.n}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block text-sm font-medium",
                        locked && "text-muted-foreground",
                      )}
                    >
                      {step.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {locked && step.n === 2
                        ? "Connect first"
                        : locked && step.n === 3
                          ? "Configure first"
                          : step.detail}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={demoBusy}
            onClick={onPrimaryClick}
          >
            {demoBusy && showDemoCta ? (
              <Spinner />
            ) : (
              <PrimaryIcon />
            )}
            {demoBusy && showDemoCta
              ? "Activating…"
              : primarySetup.label}
          </Button>
          {showDemoCta ? (
            <Button
              type="button"
              variant="ghost"
              disabled={demoBusy}
              onClick={onOpenConnect}
            >
              <RiPlugLine />
              Connect your own cluster
            </Button>
          ) : null}
          {setupStep === 1 && joinExisting ? (
            <Button
              type="button"
              variant="ghost"
              disabled={demoBusy}
              onClick={onOpenConnect}
            >
              <RiPlugLine />
              Connect a different cluster
            </Button>
          ) : null}
          {setupStep > 1 ? (
            <Button type="button" variant="ghost" onClick={onOpenConnect}>
              Edit connection
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onCopyMcp}>
            {mcpCopied ? <RiCheckLine /> : <RiFileCopyLine />}
            {mcpCopied ? "Copied MCP" : "Copy Memstream MCP"}
          </Button>
        </div>
      </div>

      {previewRuns.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">
              Existing Memstreams
            </h2>
            {runs.length > LANDING_RUNS_LIMIT ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={onOpenRuns}
              >
                see all ({runs.length})
              </button>
            ) : null}
          </div>
          <div className="overflow-x-auto border">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-[0.65rem] text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Memstream</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">
                    Cluster
                  </th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {previewRuns.map((run) => {
                  const when = formatRelativeTime(
                    run.finished_at || run.created_at,
                  );
                  return (
                    <tr
                      key={run.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${runProfileLabel(run)}`}
                      className="cursor-pointer border-b last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                      onClick={() => onSelectResume(run)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectResume(run);
                        }
                      }}
                    >
                      <td className="max-w-40 truncate px-3 py-2.5 font-medium">
                        {runProfileLabel(run)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={
                            run.status === RUN_STATUS.SUCCEEDED
                              ? "secondary"
                              : run.status === RUN_STATUS.FAILED
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {runStatusLabel(run.status)}
                        </Badge>
                      </td>
                      <td className="hidden max-w-48 truncate px-3 py-2.5 font-mono text-[0.65rem] text-muted-foreground sm:table-cell">
                        {run.app_database_label || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {when || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConsoleHeaderBar({
  isDemo,
  authUser,
  showProof,
  jobFailed,
  canEnable,
  isBusy,
  busy,
  runsCount,
  org,
  onOpenOrg,
  onLogout,
  onRetryEnable,
  onOpenRuns,
  onOpenConfigure,
  onNewMemstream,
}: {
  isDemo: boolean;
  authUser: string | null;
  showProof: boolean;
  jobFailed: boolean;
  canEnable: boolean;
  isBusy: boolean;
  busy: BusyAction;
  runsCount: number;
  org: { id: string; name: string } | null;
  onOpenOrg: () => void;
  onLogout?: () => void;
  onRetryEnable: () => void;
  onOpenRuns: () => void;
  onOpenConfigure: () => void;
  onNewMemstream: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex size-7 items-center justify-center bg-primary text-primary-foreground">
            <MemstreamMark className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">Memstream</div>
            <div className="hidden text-xs text-muted-foreground sm:block">
              Agent memory on CockroachDB
            </div>
          </div>
        </Link>

        {isDemo ? <Badge variant="outline">Demo</Badge> : null}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {showProof ? (
            <div className="flex items-center gap-1">
              {jobFailed ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={!canEnable || isBusy}
                  onClick={onRetryEnable}
                >
                  {busy === "enable" ? <Spinner /> : <RiFlashlightLine />}
                  {busy === "enable" ? "Starting…" : "Retry enable"}
                </Button>
              ) : null}
              {runsCount > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenRuns}
                >
                  All
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenConfigure}
              >
                Configure
              </Button>
              {runsCount > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onNewMemstream}
                >
                  <RiAddLine />
                  New
                </Button>
              ) : null}
            </div>
          ) : null}

          <div
            className="mx-1 hidden h-4 w-px bg-border sm:block"
            aria-hidden
          />

          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={onOpenOrg}
            >
              <RiBuilding2Line />
              <span className="max-w-28 truncate hidden sm:inline">
                {org?.name || "Org"}
              </span>
            </Button>
            {authUser ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onLogout}
                title={`Signed in as ${authUser}`}
              >
                Sign out
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
