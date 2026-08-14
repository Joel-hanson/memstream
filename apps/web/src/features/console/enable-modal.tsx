"use client";

import { EnableResources } from "@/components/enable-resources";
import { LogLines } from "@/components/log-list";
import { TermHint } from "@/components/term-hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { JobStatus } from "@/lib/types";
import { Advanced } from "./advanced";
import { RUN_STATUS, WORKER_COMPUTE } from "./constants";
import type { BusyAction, WorkerCompute } from "./types";

type EnableProgress = {
  phase: "idle" | "running" | "succeeded" | "failed" | string;
  stepNumber?: number;
  total?: number;
  current?: { label?: string } | null;
  headline?: string;
};

export function EnableModal({
  open,
  onOpenChange,
  enableProgress,
  job,
  tables,
  onTablesChange,
  bucket,
  prefix,
  deploy,
  onDeployChange,
  stackName,
  onStackNameChange,
  workerCompute,
  onWorkerComputeChange,
  enableAdvanced,
  onToggleAdvanced,
  profileLabel,
  credentialsSet,
  bucketSet,
  canEnable,
  busy,
  isBusy,
  onNodeClick,
  onAbandon,
  onBack,
  onEnable,
  onClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enableProgress: EnableProgress;
  job: JobStatus | null;
  tables: string;
  onTablesChange: (value: string) => void;
  bucket: string;
  prefix: string;
  deploy: boolean;
  onDeployChange: (value: boolean) => void;
  stackName: string;
  onStackNameChange: (value: string) => void;
  workerCompute: WorkerCompute;
  onWorkerComputeChange: (value: WorkerCompute) => void;
  enableAdvanced: boolean;
  onToggleAdvanced: () => void;
  profileLabel: string;
  credentialsSet: boolean;
  bucketSet: boolean;
  canEnable: boolean;
  busy: BusyAction;
  isBusy: boolean;
  onNodeClick: (node: { id?: string; href?: string }) => void;
  onAbandon: () => void;
  onBack: () => void;
  onEnable: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {enableProgress.phase === "running"
              ? "Enabling Memstream"
              : enableProgress.phase === RUN_STATUS.SUCCEEDED
                ? "Memstream is enabled"
                : enableProgress.phase === "failed"
                  ? "Enable failed"
                  : "Enable"}
          </DialogTitle>
          <DialogDescription>
            {enableProgress.phase === "running"
              ? `Step ${enableProgress.stepNumber} of ${enableProgress.total}${
                  enableProgress.current
                    ? `: ${enableProgress.current.label}`
                    : ""
                }`
              : enableProgress.phase === RUN_STATUS.SUCCEEDED
                ? "Ship an order in the shop, then ask from Cursor."
                : enableProgress.phase === "failed"
                  ? enableProgress.headline
                  : deploy
                    ? workerCompute === WORKER_COMPUTE.LAMBDA
                      ? "Indexes watched tables and starts a managed Lambda worker on your CDC bucket."
                      : "Indexes watched tables and starts an EC2 memory worker (self-host / demo)."
                    : "Indexes watched tables. Run the worker locally afterward."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">
          {enableProgress.phase === "idle" ? (
            <p className="border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {deploy ? (
                workerCompute === WORKER_COMPUTE.LAMBDA ? (
                  <>
                    <span className="text-foreground">Managed Lambda</span> is
                    the default cloud worker — S3-triggered, no EC2 box to
                    babysit. Change compute under Advanced if you need EC2.
                  </>
                ) : (
                  <>
                    Using{" "}
                    <span className="text-foreground">EC2</span> (self-host /
                    demo). Prefer Managed Lambda unless you need the on-box
                    watcher.
                  </>
                )
              ) : (
                <>
                  Cloud worker is off — Enable will set up schema and
                  changefeed only. Run{" "}
                  <span className="font-mono text-foreground">
                    make watch-cloud
                  </span>{" "}
                  locally, or turn the cloud worker on under Advanced.
                </>
              )}
            </p>
          ) : null}
          <EnableResources
            job={job}
            tables={tables}
            bucket={bucket}
            prefix={prefix}
            deploy={deploy}
            stackName={stackName}
            onNodeClick={onNodeClick}
            onAbandon={onAbandon}
          />

          {enableProgress.phase === "idle" ? (
            <div className="space-y-3 border bg-muted/20 p-3 text-xs">
              <div className="flex justify-between gap-2">
                <TermHint
                  className="text-muted-foreground"
                  hint="Profile YAML applied when indexing change events."
                >
                  Profile
                </TermHint>
                <span className="font-mono">{profileLabel}</span>
              </div>
              <div className="flex justify-between gap-2">
                <TermHint
                  className="text-muted-foreground"
                  hint="App tables included in the Cockroach changefeed for this profile."
                >
                  Tables
                </TermHint>
                <span className="font-mono">{tables || "-"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Cluster</span>
                <span className="font-mono">
                  {credentialsSet ? "connected" : "missing URL"}
                </span>
              </div>
              {!bucketSet ? (
                <p className="text-muted-foreground">
                  Set <span className="font-mono">CDC_S3_BUCKET</span> in{" "}
                  <span className="font-mono">.env</span>, then refresh. Required
                  to enable.
                </p>
              ) : null}
            </div>
          ) : null}

          {job?.log?.length &&
          (enableProgress.phase === "failed" ||
            enableProgress.phase === RUN_STATUS.SUCCEEDED) ? (
            <LogLines lines={job.log} maxHeightClass="max-h-48" />
          ) : null}

          {enableProgress.phase === "idle" ? (
            <Advanced open={enableAdvanced} onToggle={onToggleAdvanced}>
              <Field>
                <FieldLabel htmlFor="tables">
                  <TermHint hint="App tables included in the changefeed for this profile.">
                    Watched tables
                  </TermHint>
                </FieldLabel>
                <Input
                  id="tables"
                  value={tables}
                  onChange={(e) => onTablesChange(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="stackName">
                  <TermHint hint="CloudFormation stack name for the optional cloud worker.">
                    Stack name
                  </TermHint>
                </FieldLabel>
                <Input
                  id="stackName"
                  value={stackName}
                  onChange={(e) => onStackNameChange(e.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="deploy"
                  checked={deploy}
                  onCheckedChange={(v) => onDeployChange(v === true)}
                />
                <FieldLabel htmlFor="deploy" className="font-normal">
                  Start managed cloud worker
                </FieldLabel>
              </Field>
              {deploy ? (
                <Field>
                  <FieldLabel>
                    <TermHint hint="Managed Lambda (recommended): S3-triggered function. EC2: self-host / demo box with memstream-watch.">
                      Worker compute
                    </TermHint>
                  </FieldLabel>
                  <Select
                    value={workerCompute}
                    onValueChange={(value) =>
                      onWorkerComputeChange(
                        value === WORKER_COMPUTE.EC2
                          ? WORKER_COMPUTE.EC2
                          : WORKER_COMPUTE.LAMBDA,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select worker compute…" />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value={WORKER_COMPUTE.LAMBDA}>
                        Managed Lambda (recommended)
                      </SelectItem>
                      <SelectItem value={WORKER_COMPUTE.EC2}>
                        EC2 (self-host / demo)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </Advanced>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          {enableProgress.phase === RUN_STATUS.SUCCEEDED ? (
            <Button type="button" onClick={onClose}>
              Back to Live
            </Button>
          ) : enableProgress.phase === "failed" ? (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                type="button"
                disabled={isBusy || !canEnable}
                onClick={onEnable}
              >
                {busy === "enable" ? <Spinner /> : null}
                {busy === "enable" ? "Retrying…" : "Retry"}
              </Button>
            </>
          ) : enableProgress.phase === "running" ? (
            <Button type="button" variant="outline" disabled>
              <Spinner />
              Enabling…
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onBack}>
                Back
              </Button>
              <Button
                type="button"
                disabled={isBusy || !canEnable}
                onClick={onEnable}
              >
                {busy === "enable" ? <Spinner /> : null}
                {busy === "enable" ? "Starting…" : "Enable"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SetupLogDialog({
  open,
  onOpenChange,
  lines,
  deploy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: string[];
  deploy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Setup log</DialogTitle>
          <DialogDescription>
            What ran when Memstream was enabled — schema, change streams, and
            the {deploy ? "AWS memory worker" : "local worker"}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <LogLines
            lines={lines}
            empty="No setup output saved for this run."
            maxHeightClass="max-h-[min(24rem,60vh)]"
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
