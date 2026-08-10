import { describe, expect, it } from "vitest";
import {
  computeLagSeconds,
  derivePipelineHealth,
  MEMORY_LAG_WARN_SECONDS,
} from "../src/pipeline-health.js";

const NOW = Date.parse("2026-08-08T12:00:00.000Z");

describe("computeLagSeconds", () => {
  it("returns null without CDC timestamp", () => {
    expect(computeLagSeconds(null, "2026-08-08T11:00:00.000Z", NOW)).toBeNull();
  });

  it("uses now when there are no chunks yet", () => {
    expect(
      computeLagSeconds("2026-08-08T11:59:00.000Z", null, NOW),
    ).toBe(60);
  });

  it("is zero when chunks are ahead of CDC", () => {
    expect(
      computeLagSeconds(
        "2026-08-08T11:00:00.000Z",
        "2026-08-08T11:30:00.000Z",
        NOW,
      ),
    ).toBe(0);
  });

  it("measures CDC ahead of chunks", () => {
    expect(
      computeLagSeconds(
        "2026-08-08T11:05:00.000Z",
        "2026-08-08T11:00:00.000Z",
        NOW,
      ),
    ).toBe(300);
  });
});

describe("derivePipelineHealth", () => {
  const base = {
    databaseUrlSet: true,
    dbOk: true,
    dbError: null as string | null,
    changefeedJobs: 1,
    changefeedRunning: 1,
    chunkCount: 3,
    latestChunkAt: "2026-08-08T11:59:50.000Z",
    latestCdcAt: "2026-08-08T11:59:55.000Z",
    s3Objects: 10,
    bucketSet: true,
    processedKeys: 10,
    lastProcessedAt: "2026-08-08T11:59:55.000Z",
    nowMs: NOW,
  };

  it("is ok when connected, streaming, and caught up", () => {
    const h = derivePipelineHealth(base);
    expect(h.status).toBe("ok");
    expect(h.connection.status).toBe("ok");
    expect(h.changefeed.status).toBe("ok");
    expect(h.memory.status).toBe("ok");
    expect(h.memory.lag_seconds).toBe(5);
  });

  it("is down when the application DB is unreachable", () => {
    const h = derivePipelineHealth({
      ...base,
      dbOk: false,
      dbError: "connection refused",
    });
    expect(h.status).toBe("down");
    expect(h.connection.status).toBe("error");
  });

  it("marks memory lagging when recent CDC is far ahead", () => {
    const h = derivePipelineHealth({
      ...base,
      latestChunkAt: "2026-08-08T11:50:00.000Z",
      latestCdcAt: "2026-08-08T11:59:00.000Z",
    });
    expect(h.memory.lag_seconds).toBeGreaterThanOrEqual(MEMORY_LAG_WARN_SECONDS);
    expect(h.memory.status).toBe("warn");
    expect(h.status).toBe("degraded");
  });

  it("does not degrade when shop is quiet (stale CDC backlog)", () => {
    const h = derivePipelineHealth({
      ...base,
      latestChunkAt: "2026-08-08T10:00:00.000Z",
      latestCdcAt: "2026-08-08T10:10:00.000Z",
    });
    expect(h.memory.lag_seconds).toBeGreaterThanOrEqual(MEMORY_LAG_WARN_SECONDS);
    expect(h.memory.status).toBe("ok");
    expect(h.memory.detail).toMatch(/Quiet/i);
    expect(h.status).toBe("ok");
  });

  it("warns when S3 has recent objects but no chunks while changefeed runs", () => {
    const h = derivePipelineHealth({
      ...base,
      chunkCount: 0,
      latestChunkAt: null,
      s3Objects: 4,
      latestCdcAt: "2026-08-08T11:59:00.000Z",
    });
    expect(h.memory.status).toBe("warn");
    expect(h.status).toBe("degraded");
  });

  it("stays idle when CDC exists but shop has been quiet", () => {
    const h = derivePipelineHealth({
      ...base,
      chunkCount: 0,
      latestChunkAt: null,
      s3Objects: 4,
      latestCdcAt: "2026-08-08T10:00:00.000Z",
    });
    expect(h.memory.status).toBe("idle");
    expect(h.memory.detail).toMatch(/Quiet|waiting for shop/i);
    expect(h.status).toBe("ok");
  });

  it("warns when changefeed jobs exist but none are running", () => {
    const h = derivePipelineHealth({
      ...base,
      changefeedRunning: 0,
      changefeedJobs: 2,
    });
    expect(h.changefeed.status).toBe("warn");
    expect(h.status).toBe("degraded");
  });
});
