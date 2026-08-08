import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemEventSource } from "../src/source-filesystem.js";

describe("FilesystemEventSource", () => {
  it("reads new files once after ack", async () => {
    const root = mkdtempSync(join(tmpdir(), "memstream-fs-"));
    const inbox = join(root, "inbox");
    mkdirSync(inbox);
    writeFileSync(
      join(inbox, "orders-1.ndjson"),
      '{"table":"orders","key":{"id":"100"},' +
        '"before":{"id":"100","customer_id":"c1","status":"pending"},' +
        '"after":{"id":"100","customer_id":"c1","status":"shipped"},' +
        '"timestamp":"2026-08-07T10:00:00Z"}\n',
    );
    const source = new FilesystemEventSource(inbox, join(root, "state.json"));
    const first = await source.poll();
    await source.ack();
    const second = await source.poll();
    expect(first).toHaveLength(1);
    expect(first[0]!.table).toBe("orders");
    expect(second).toEqual([]);
  });
});
