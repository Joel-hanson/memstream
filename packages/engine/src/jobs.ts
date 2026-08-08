/** In-memory background jobs for the Memstream console. */

import { randomBytes } from "node:crypto";

export type JobStepStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type JobStep = {
  id: string;
  label: string;
  detail: string;
  status: JobStepStatus;
};

export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  log: string[];
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  append: (line: string) => void;
  setSteps: (steps: JobStep[]) => void;
  setStep: (
    id: string,
    patch: Partial<Pick<JobStep, "status" | "detail" | "label">>,
  ) => void;
}

export class JobStore {
  private jobs = new Map<string, Job>();

  create(kind: string): Job {
    const job: Job = {
      id: randomBytes(6).toString("hex"),
      kind,
      status: "queued",
      log: [],
      steps: [],
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      append(line: string) {
        this.log.push(line);
      },
      setSteps(steps: JobStep[]) {
        this.steps = steps.map((s) => ({ ...s }));
      },
      setStep(id, patch) {
        const step = this.steps.find((s) => s.id === id);
        if (!step) return;
        Object.assign(step, patch);
      },
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  runInBackground(
    job: Job,
    fn: (job: Job) => Promise<Record<string, unknown> | void>,
  ): void {
    void (async () => {
      job.status = "running";
      job.startedAt = Date.now() / 1000;
      try {
        job.result = (await fn(job)) || {};
        job.status = "succeeded";
        for (const step of job.steps) {
          if (step.status === "running") step.status = "done";
          if (step.status === "pending") step.status = "skipped";
        }
      } catch (err) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
        job.append(`ERROR: ${job.error}`);
        for (const step of job.steps) {
          if (step.status === "running") step.status = "failed";
        }
      } finally {
        job.finishedAt = Date.now() / 1000;
      }
    })();
  }
}

/** Bump when Job shape / create() methods change so Next HMR does not keep a stale singleton. */
const STORE_VERSION = 2;
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
