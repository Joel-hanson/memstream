"use client";

import { RiAddLine, RiDeleteBinLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MemstreamRun } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { runProfileLabel, runStatusLabel } from "./helpers";
import type { BusyAction, RunsFilter } from "./types";

export function RunsSheet({
  open,
  onOpenChange,
  runs,
  filteredRuns,
  runsFilter,
  onFilterChange,
  activeRunId,
  canEnable,
  isBusy,
  busy,
  onSelectRun,
  onEnable,
  onRequestDelete,
  onNewMemstream,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: MemstreamRun[];
  filteredRuns: MemstreamRun[];
  runsFilter: RunsFilter;
  onFilterChange: (filter: RunsFilter) => void;
  activeRunId: string | null;
  canEnable: boolean;
  isBusy: boolean;
  busy: BusyAction;
  onSelectRun: (run: MemstreamRun) => void;
  onEnable: (run: MemstreamRun) => void;
  onRequestDelete: (run: MemstreamRun, e?: React.MouseEvent) => void;
  onNewMemstream: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>All Memstreams</SheetTitle>
          <SheetDescription>Open a run on the home screen</SheetDescription>
        </SheetHeader>
        <div className="flex gap-1 border-b px-4 pb-3">
          {(
            [
              { id: "all" as const, label: "All" },
              { id: "live" as const, label: "Live" },
              { id: "failed" as const, label: "Failed" },
            ] as const
          ).map((f) => (
            <Button
              key={f.id}
              type="button"
              size="xs"
              variant={runsFilter === f.id ? "outline" : "ghost"}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <ScrollArea className="min-h-0 flex-1 px-4">
          {filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-xs text-muted-foreground">
                {runs.length === 0
                  ? "No Memstreams yet."
                  : "No Memstreams in this filter."}
              </p>
              {runs.length === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onNewMemstream();
                  }}
                >
                  <RiAddLine />
                  New Memstream
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y border">
              {filteredRuns.map((run) => {
                const active = run.id === activeRunId;
                const profile = runProfileLabel(run);
                const when = formatRelativeTime(run.created_at);
                const errHint =
                  run.status === "failed"
                    ? (run.error || run.log?.slice(-1)[0] || "")
                        .replace(/\s+/g, " ")
                        .slice(0, 90)
                    : "";
                return (
                  <li key={run.id} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRun(run);
                        onOpenChange(false);
                      }}
                      className={cn(
                        "min-w-0 flex-1 px-3 py-2.5 text-left transition-colors",
                        active ? "bg-muted/50" : "hover:bg-muted/30",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{profile}</span>
                        <Badge
                          variant={
                            run.status === "succeeded"
                              ? "secondary"
                              : run.status === "failed"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {runStatusLabel(run.status)}
                        </Badge>
                        {active ? (
                          <span className="text-[0.65rem] text-muted-foreground">
                            current
                          </span>
                        ) : null}
                        {when ? (
                          <span className="text-[0.65rem] text-muted-foreground">
                            {when}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">
                        {errHint || run.tables}
                      </p>
                      {run.app_database_label ? (
                        <p className="mt-0.5 truncate font-mono text-[0.6rem] text-muted-foreground">
                          {run.app_database_label}
                        </p>
                      ) : null}
                    </button>
                    {run.status === "failed" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="m-1 shrink-0"
                        disabled={!canEnable || isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChange(false);
                          onEnable(run);
                        }}
                      >
                        Retry
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="m-1 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy === "delete"}
                      aria-label="Delete Memstream"
                      onClick={(e) => onRequestDelete(run, e)}
                    >
                      <RiDeleteBinLine className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onNewMemstream();
            }}
          >
            <RiAddLine />
            New Memstream
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
