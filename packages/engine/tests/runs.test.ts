import { describe, expect, it } from "vitest";
import { appDatabaseLabel, jobSnapshotFromRun } from "../src/runs.js";
import type { MemstreamRun } from "../src/runs.js";

describe("appDatabaseLabel", () => {
  it("returns host/db without credentials", () => {
    expect(
      appDatabaseLabel(
        "postgresql://user:s3cret@db.example.com:26257/defaultdb?sslmode=verify-full",
      ),
    ).toBe("db.example.com/defaultdb");
  });

  it("returns null for invalid urls", () => {
    expect(appDatabaseLabel("not-a-url")).toBeNull();
  });
});

describe("jobSnapshotFromRun", () => {
  it("hydrates job shape with durable steps and workspace alias", () => {
    const run: MemstreamRun = {
      id: "run-1",
      status: "running",
      profile_path: "profiles/commerce.yaml",
      tables: "orders,stock",
      bucket: "b",
      region: "us-east-1",
      prefix: "cdc/",
      stack_name: null,
      shop_url: null,
      job_id: "abc123",
      app_database_label: "h/db",
      connection_id: "ws-1",
      workspace_id: "ws-1",
      log: ["hi"],
      steps: [
        {
          id: "schema",
          label: "Schema",
          detail: "working",
          status: "running",
        },
      ],
      error: null,
      created_at: null,
      finished_at: null,
    };
    const snap = jobSnapshotFromRun(run);
    expect(snap.id).toBe("abc123");
    expect(snap.live).toBe(false);
    expect(snap.steps).toHaveLength(1);
    expect(snap.steps[0]!.id).toBe("schema");
    expect(snap.result?.run_id).toBe("run-1");
  });
});
