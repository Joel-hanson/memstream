import { describe, expect, it } from "vitest";
import { getJobStore } from "../src/jobs.js";
import { PlatformState } from "../src/state-manager.js";
import type { MemstreamRun } from "../src/runs.js";
import { jobSnapshotFromRun } from "../src/runs.js";

describe("PlatformState.getJob", () => {
  it("returns live JobStore snapshot when present", async () => {
    const store = getJobStore();
    const job = store.create("enable");
    job.append("hello");
    job.status = "running";

    const state = new PlatformState();
    const snap = await state.getJob(job.id);
    expect(snap).not.toBeNull();
    expect(snap!.live).toBe(true);
    expect(snap!.status).toBe("running");
    expect(snap!.log).toContain("hello");
    expect(snap!.id).toBe(job.id);
  });

  it("jobSnapshotFromRun marks hydrated jobs as not live", () => {
    const run: MemstreamRun = {
      id: "run-1",
      status: "succeeded",
      profile_path: "commerce",
      tables: "public.orders",
      bucket: "b",
      region: "us-east-1",
      prefix: "cdc/",
      stack_name: "memstream-demo",
      shop_url: null,
      job_id: "abc123",
      app_database_label: "app",
      connection_id: null,
      workspace_id: null,
      log: ["done"],
      steps: [],
      error: null,
      created_at: null,
      finished_at: null,
    };
    const snap = jobSnapshotFromRun(run);
    expect(snap.live).toBe(false);
    expect(snap.id).toBe("abc123");
    expect(snap.status).toBe("succeeded");
  });

  it("jobSnapshotFromRun heals finished_at + running race to succeeded", () => {
    const run: MemstreamRun = {
      id: "run-2",
      status: "running",
      profile_path: "commerce",
      tables: "public.orders",
      bucket: "b",
      region: "us-east-1",
      prefix: "cdc/",
      stack_name: "memstream-demo",
      shop_url: "/shop",
      job_id: "abc999",
      app_database_label: "app",
      connection_id: null,
      workspace_id: null,
      log: ["done"],
      steps: [
        { id: "schema", label: "Schema", detail: "", status: "done" },
        { id: "worker", label: "Worker", detail: "", status: "done" },
      ],
      error: null,
      created_at: null,
      finished_at: "2026-08-09T08:23:28Z",
    };
    const snap = jobSnapshotFromRun(run);
    expect(snap.status).toBe("succeeded");
  });
});
