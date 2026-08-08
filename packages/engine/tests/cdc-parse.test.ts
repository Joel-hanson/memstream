import { describe, expect, it } from "vitest";
import {
  parseCdcPayload,
  parseCdcRecord,
  tableFromKey,
} from "../src/index.js";

describe("cdc parse", () => {
  it("parses memstream-shaped records", () => {
    const event = parseCdcRecord({
      table: "orders",
      key: { id: "100" },
      before: { id: "100", status: "pending" },
      after: { id: "100", status: "shipped" },
      timestamp: "2026-08-07T10:00:00Z",
    });
    expect(event).not.toBeNull();
    expect(event!.table).toBe("orders");
    expect(event!.after!.status).toBe("shipped");
  });

  it("parses cockroach changefeed with updated", () => {
    const event = parseCdcRecord(
      {
        before: { id: "100", status: "pending", customer_id: "c1" },
        after: { id: "100", status: "shipped", customer_id: "c1" },
        updated: "2026-08-07T10:00:00Z",
      },
      "orders",
    );
    expect(event).not.toBeNull();
    expect(event!.table).toBe("orders");
    expect(event!.key.id).toBe("100");
    expect(event!.timestamp).toBe("2026-08-07T10:00:00Z");
  });

  it("skips resolved messages", () => {
    expect(parseCdcRecord({ resolved: "2026-08-07T10:00:00Z" })).toBeNull();
  });

  it("parses ndjson payloads", () => {
    const text =
      '{"table":"orders","key":{"id":"1"},"before":null,' +
      '"after":{"id":"1","status":"pending"},"timestamp":"t1"}\n' +
      '{"resolved":"t2"}\n';
    const events = parseCdcPayload(text, "orders");
    expect(events).toHaveLength(1);
    expect(events[0]!.after!.status).toBe("pending");
  });

  it("infers table from s3 key", () => {
    expect(tableFromKey("cdc/orders/2026/08/07/file.ndjson")).toBe("orders");
    expect(tableFromKey("cdc/stock/part-000.json")).toBe("stock");
    expect(tableFromKey("random/file.json")).toBe("random");
    expect(tableFromKey("file.json")).toBeNull();
  });

  it("infers table from cockroach cloud storage filename", () => {
    const key =
      "cdc/2026-08-07/" +
      "202608071200000000000000000000000-56087568dba1e6b8-1-72-00000000-orders-1.ndjson";
    expect(tableFromKey(key)).toBe("orders");
  });

  it("skips missing table without raising", () => {
    expect(parseCdcRecord({ after: { id: "1" } })).toBeNull();
  });
});
