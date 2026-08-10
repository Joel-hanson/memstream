/** In-memory background jobs for the Memstream console.
 * When bound to a platform run, progress is mirrored so restarts can hydrate.
 */

import { randomBytes } from "node:crypto";
import {
  JOB_STEP_STATUS,
  RUN_STATUS,
  type JobStepStatusValue,
  type RunStatus,
} from "./constants.js";
import type { MemstreamRunStep } from "./runs.js";

export type JobStepStatus = JobStepStatusValue;

export type JobStep = {
  id: string;
  label: string;
  detail: string;
  status: JobStepStatus;
};

export interface Job {
  id: string;
  kind: string;
  status: RunStatus;
  log: string[];
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Platform run id when progress is durable. */
  runId: string | null;
  /** Set when console abandons a hung enable; background work should stop. */
  aborted: boolean;
  lastActivityAt: number;
  append: (line: string) => void;
  setSteps: (steps: JobStep[]) => void;
  setStep: (
    id: string,
    patch: Partial<Pick<JobStep, "status" | "detail" | "label">>,
  ) => void;
  abort: (reason: string) => void;
}

export type PersistJobProgress = (snapshot: {
  runId: string;
  log: string[];
  steps: MemstreamRunStep[];
  status: Job["status"];
}) => Promise<void>;

/** Mirror append / step updates onto the platform run (debounced). */
export function bindJobToRun(
  job: Job,
  runId: string,
  persist: PersistJobProgress,
): void {
  job.runId = runId;
  let chain: Promise<void> = Promise.resolve();
  let scheduled = false;

  const flush = () => {
    if (scheduled) return;
    scheduled = true;
    chain = chain
      .then(async () => {
        scheduled = false;
        await persist({
          runId,
          log: [...job.log],
          steps: job.steps.map((s) => ({ ...s })),
          status: job.status,
        });
      })
      .catch(() => {
        scheduled = false;
      });
  };

  const originalAppend = job.append.bind(job);
  const originalSetSteps = job.setSteps.bind(job);
  const originalSetStep = job.setStep.bind(job);
  const originalAbort = job.abort.bind(job);

  job.append = (line: string) => {
    originalAppend(line);
    flush();
  };
  job.setSteps = (steps: JobStep[]) => {
    originalSetSteps(steps);
    flush();
  };
  job.setStep = (id, patch) => {
    originalSetStep(id, patch);
    flush();
  };
  job.abort = (reason: string) => {
    originalAbort(reason);
    flush();
  };
}

export class JobStore {
  private jobs = new Map<string, Job>();

  create(kind: string): Job {
    const now = Date.now() / 1000;
    const job: Job = {
      id: randomBytes(6).toString("hex"),
      kind,
      status: RUN_STATUS.QUEUED,
      log: [],
      steps: [],
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      runId: null,
      aborted: false,
      lastActivityAt: now,
      append(line: string) {
        this.log.push(line);
        this.lastActivityAt = Date.now() / 1000;
      },
      setSteps(steps: JobStep[]) {
        this.steps = steps.map((s) => ({ ...s }));
        this.lastActivityAt = Date.now() / 1000;
      },
      setStep(id, patch) {
        const step = this.steps.find((s) => s.id === id);
        if (!step) return;
        Object.assign(step, patch);
        this.lastActivityAt = Date.now() / 1000;
      },
      abort(reason: string) {
        if (
          this.status === RUN_STATUS.SUCCEEDED ||
          this.status === RUN_STATUS.FAILED
        ) {
          return;
        }
        this.aborted = true;
        this.status = RUN_STATUS.FAILED;
        this.error = reason;
        this.append(`ERROR: ${reason}`);
        this.finishedAt = Date.now() / 1000;
        for (const step of this.steps) {
          if (step.status === JOB_STEP_STATUS.RUNNING) {
            step.status = JOB_STEP_STATUS.FAILED;
          }
        }
      },
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /** Abort an in-flight job (Enable abandon / hung waiter). */
  abort(jobId: string, reason: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.abort(reason);
    return job;
  }

  runInBackground(
    job: Job,
    fn: (job: Job) => Promise<Record<string, unknown> | void>,
  ): void {
    void (async () => {
      job.status = RUN_STATUS.RUNNING;
      job.startedAt = Date.now() / 1000;
      try {
        const result = (await fn(job)) || {};
        if (job.aborted) {
          return;
        }
        job.result = result;
        job.status = RUN_STATUS.SUCCEEDED;
        for (const step of job.steps) {
          if (step.status === JOB_STEP_STATUS.RUNNING) {
            step.status = JOB_STEP_STATUS.DONE;
          }
          if (step.status === JOB_STEP_STATUS.PENDING) {
            step.status = JOB_STEP_STATUS.SKIPPED;
          }
        }
      } catch (err) {
        if (job.aborted) {
          return;
        }
        job.status = RUN_STATUS.FAILED;
        job.error = err instanceof Error ? err.message : String(err);
        job.append(`ERROR: ${job.error}`);
        for (const step of job.steps) {
          if (step.status === JOB_STEP_STATUS.RUNNING) {
            step.status = JOB_STEP_STATUS.FAILED;
          }
        }
      } finally {
        if (!job.finishedAt) {
          job.finishedAt = Date.now() / 1000;
        }
      }
    })();
  }
}

/** Bump when Job shape / create() methods change so Next HMR does not keep a stale singleton. */
const STORE_VERSION = 4;
const globalKey = "__memstreamJobStore";
const versionKey = "__memstreamJobStoreVersion";

export function getJobStore(): JobStore {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: JobStore;
    [versionKey]?: number;
  };
  if (!g[globalKey] || g[versionKey] !== STORE_VERSION) {
    g[globalKey] = new JobStore();
    g[versionKey] = STORE_VERSION;
  }
  return g[globalKey]!;
}
