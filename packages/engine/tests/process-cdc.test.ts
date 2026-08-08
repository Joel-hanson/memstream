import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FakeEmbedder,
  InMemoryMemoryStore,
  ProcessedState,
  indexCdcPayload,
  loadProfile,
  processCdcS3Object,
  shouldSkipCdcKey,
  cloudWorkerStackName,
  resolveWorkerCompute,
  isPrebuiltRuntime,
} from "../src/index.js";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);

describe("worker-compute", () => {
  it("defaults to ec2", () => {
    expect(resolveWorkerCompute({})).toBe("ec2");
    expect(resolveWorkerCompute({ MEMSTREAM_WORKER_COMPUTE: "EC2" })).toBe(
      "ec2",
    );
  });

  it("accepts lambda", () => {
    expect(
      resolveWorkerCompute({ MEMSTREAM_WORKER_COMPUTE: "lambda" }),
    ).toBe("lambda");
  });

  it("accepts override over env", () => {
    expect(
      resolveWorkerCompute({ MEMSTREAM_WORKER_COMPUTE: "ec2" }, undefined, "lambda"),
    ).toBe("lambda");
    expect(
      resolveWorkerCompute({ MEMSTREAM_WORKER_COMPUTE: "lambda" }, undefined, "ec2"),
    ).toBe("ec2");
  });

  it("detects prebuilt via MEMSTREAM_PREBUILT", () => {
    expect(isPrebuiltRuntime({ MEMSTREAM_PREBUILT: "1" })).toBe(true);
    expect(isPrebuiltRuntime({})).toBe(false);
  });

  it("suffixes lambda stack names", () => {
    expect(cloudWorkerStackName("memstream-demo", "ec2")).toBe(
      "memstream-demo",
    );
    expect(cloudWorkerStackName("memstream-demo", "lambda")).toBe(
      "memstream-demo-lambda",
    );
  });
});

describe("process-cdc", () => {
  it("skips control objects", () => {
    expect(shouldSkipCdcKey("cdc/crdb_external_storage_location")).toBe(
      true,
    );
    expect(shouldSkipCdcKey("cdc/2026/orders-1.ndjson")).toBe(false);
  });

  it("indexes matching payload text", async () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const store = new InMemoryMemoryStore();
    const text = JSON.stringify({
      after: { id: "100", customer_id: "c1", status: "shipped" },
      before: { id: "100", customer_id: "c1", status: "pending" },
      key: ["100"],
      updated: "2026-08-07T10:00:00Z",
    });
    const result = await indexCdcPayload({
      profile,
      embedder: new FakeEmbedder(8),
      store,
      text,
      defaultTable: "orders",
    });
    expect(result.eventsSeen).toBe(1);
    expect(result.chunksWritten).toBe(1);
    expect(store.chunks[0]!.ruleName).toBe("order_status_change");
  });

  it("is idempotent via key state", async () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const store = new InMemoryMemoryStore();
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "memstream-cdc-test-"));
    const state = new ProcessedState(join(dir, "state.json"));
    const text = JSON.stringify({
      after: { id: "101", customer_id: "c2", status: "shipped" },
      before: { id: "101", customer_id: "c2", status: "pending" },
      key: ["101"],
      updated: "2026-08-07T10:00:00Z",
    });
    const client = {
      send: async () => ({
        Body: {
          transformToString: async () => text,
        },
      }),
    };
    const first = await processCdcS3Object({
      bucket: "b",
      key: "cdc/2026-08-07/x-b05e92b61f20bb47-1-2-00000000-orders-3.ndjson",
      profile,
      embedder: new FakeEmbedder(8),
      store,
      state,
      client,
    });
    const second = await processCdcS3Object({
      bucket: "b",
      key: "cdc/2026-08-07/x-b05e92b61f20bb47-1-2-00000000-orders-3.ndjson",
      profile,
      embedder: new FakeEmbedder(8),
      store,
      state,
      client,
    });
    expect(first.skipped).toBe(false);
    expect(first.chunksWritten).toBe(1);
    expect(second.skipped).toBe(true);
    expect(store.chunks).toHaveLength(1);
  });
});
