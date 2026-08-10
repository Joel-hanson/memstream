"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
import { stepStatusCopy } from "@memstream/engine/naming";
import {
  EnableFlow,
  getEnableProgress,
} from "@/components/enable-flow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobStatus, JobStep, PipelineNode } from "@/lib/types";

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="h-1.5 w-full overflow-hidden bg-muted"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full bg-foreground transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StepList({
  steps,
  phase,
}: {
  steps: JobStep[];
  phase: string;
}) {
  return (
    <ul className="divide-y border bg-background">
      {steps.map((step) => {
        const active =
          step.status === "running" ||
          (phase === "failed" && step.status === "failed");
        return (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-2.5 px-3 py-2",
              active && "bg-muted/40",
              step.status === "failed" && "bg-destructive/5",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center border text-[0.55rem]",
                step.status === "done" &&
                  "border-foreground bg-foreground text-background",
                step.status === "running" && "border-foreground",
                step.status === "failed" &&
                  "border-destructive text-destructive",
                step.status === "pending" && "border-border text-transparent",
              )}
              aria-hidden
            >
              {step.status === "done" ? (
                <RiCheckLine className="size-2.5" />
              ) : step.status === "running" ? (
                <span className="size-1.5 animate-pulse-dot rounded-full bg-foreground" />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {step.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[0.6rem] uppercase tracking-wide",
                    step.status === "failed"
                      ? "text-destructive"
                      : step.status === "running"
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {stepStatusCopy(step.status)}
                </span>
              </div>
              {step.detail ? (
                <p className="mt-0.5 text-[0.65rem] leading-snug text-muted-foreground">
                  {step.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Progress-first Enable UI. Architecture diagram stays behind “See how it works.”
 */
export function EnableResources({
  job,
  tables,
  bucket,
  prefix,
  deploy,
  stackName,
  className,
  onNodeClick,
  footer,
  defaultShowArchitecture = false,
  onAbandon,
}: {
  job?: JobStatus | null;
  tables: string;
  bucket: string;
  prefix: string;
  deploy: boolean;
  stackName: string;
  className?: string;
  onNodeClick?: (node: PipelineNode) => void;
  footer?: ReactNode;
  defaultShowArchitecture?: boolean;
  /** When enable was recovered after reload and the live worker is gone. */
  onAbandon?: () => void;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [showArchitecture, setShowArchitecture] = useState(
    defaultShowArchitecture,
  );

  const progress = getEnableProgress(job, {
    tables,
    bucket,
    prefix,
    deploy,
    stackName,
  });
  const { phase, steps, doneCount, total, stepNumber, current, headline } =
    progress;

  useEffect(() => {
    if (phase === "failed") setShowSteps(true);
  }, [phase]);

  const tablePreview = tables
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");

  const progressValue =
    phase === "succeeded"
      ? total
      : phase === "failed"
        ? Math.max(doneCount, stepNumber - 1)
        : doneCount + (current?.status === "running" ? 0.35 : 0);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="border bg-muted/15">
        <div className="space-y-3 px-4 py-4">
          {phase === "running" ? (
            <>
              <div>
                <div className="text-sm font-medium text-foreground">
                  Enabling Memstream
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Step {stepNumber} of {total}
                  {current ? `: ${current.label}` : ""}
                </p>
              </div>
              <ProgressBar value={progressValue} max={total} />
              <p className="text-xs font-medium text-foreground">{headline}</p>
              {onAbandon ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-background px-2.5 py-2">
                  <p className="text-[0.65rem] leading-snug text-muted-foreground">
                    {job?.live === false
                      ? "Reconnected after reload; watching saved progress. If this stalls, mark failed and retry."
                      : "Stack may already be up while Enable is still waiting. Mark failed, then retry Enable."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={onAbandon}
                  >
                    Mark failed
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {phase === "succeeded" ? (
            <>
              <div>
                <div className="text-sm font-medium text-foreground">
                  {headline}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tablePreview
                    ? `Watching ${tablePreview}`
                    : "Ready for your profile"}
                </p>
              </div>
              <ProgressBar value={total} max={total} />
              <p className="text-xs text-muted-foreground">
                Next: write in the shop, then ask from Cursor.
              </p>
            </>
          ) : null}

          {phase === "failed" ? (
            <>
              <div>
                <div className="text-sm font-medium text-destructive">
                  {headline}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {job?.error ||
                    current?.detail ||
                    "Something went wrong during enable."}
                </p>
              </div>
              <ProgressBar value={progressValue} max={total} />
            </>
          ) : null}

          {phase === "idle" ? (
            <>
              <div>
                <div className="text-sm font-medium text-foreground">
                  Enable Memstream
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tablePreview
                    ? `Will watch ${tablePreview}`
                    : "Uses the tables in your profile"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs {total} steps. When it finishes, ship an order in the shop
                to confirm chunks show up.
              </p>
            </>
          ) : null}
        </div>

        {(phase === "running" || phase === "idle" || phase === "failed") && (
          <div className="border-t px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="w-full justify-between font-normal text-muted-foreground"
              onClick={() => setShowSteps((v) => !v)}
              aria-expanded={showSteps}
            >
              {showSteps ? "Hide steps" : "Show steps"}
              <RiArrowDownSLine
                className={cn(
                  "size-3.5 transition-transform",
                  showSteps && "rotate-180",
                )}
              />
            </Button>
            {showSteps ? (
              <div className="px-1.5 pb-2">
                <StepList steps={steps} phase={phase} />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="w-full justify-between font-normal text-muted-foreground"
          onClick={() => setShowArchitecture((v) => !v)}
          aria-expanded={showArchitecture}
        >
          {showArchitecture ? "Hide how it works" : "See how it works"}
          <RiArrowDownSLine
            className={cn(
              "size-3.5 transition-transform",
              showArchitecture && "rotate-180",
            )}
          />
        </Button>
        {showArchitecture ? (
          <div className="mt-1.5">
            <EnableFlow
              job={job}
              tables={tables}
              bucket={bucket}
              prefix={prefix}
              deploy={deploy}
              stackName={stackName}
              compact
              showPath={false}
              onNodeClick={onNodeClick}
            />
          </div>
        ) : null}
      </div>

      {footer ? (
        <div className="flex flex-wrap items-center gap-2">{footer}</div>
      ) : null}
    </div>
  );
}
