import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { S3EventSource, type S3ListClient } from "../src/source-s3.js";

class FakeS3Client implements S3ListClient {
  listCalls = 0;

  constructor(private readonly objects: Record<string, string>) {}

  async send(command: ListObjectsV2Command | GetObjectCommand) {
    if (command instanceof ListObjectsV2Command) {
      this.listCalls += 1;
      const prefix = command.input.Prefix || "";
      const contents = Object.keys(this.objects)
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((Key) => ({ Key }));
      return { Contents: contents, IsTruncated: false };
    }
    if (command instanceof GetObjectCommand) {
      const key = command.input.Key!;
      const body = this.objects[key] ?? "";
      return {
        Body: {
          transformToString: async () => body,
        },
      };
    }
    throw new Error("unexpected command");
  }
}

describe("S3EventSource", () => {
  it("reads objects and remembers keys after ack", async () => {
    const client = new FakeS3Client({
      "cdc/orders/a.ndjson":
        '{"before":{"id":"100","customer_id":"c1","status":"pending"},' +
        '"after":{"id":"100","customer_id":"c1","status":"shipped"},' +
        '"updated":"t1"}\n',
    });
    const state = join(mkdtempSync(join(tmpdir(), "memstream-s3-")), "state.json");
    const source = new S3EventSource({
      bucket: "memstream-cdc",
      prefix: "cdc/",
      statePath: state,
      client,
    });

    const first = await source.poll();
    await source.ack();
    const second = await source.poll();

    expect(first).toHaveLength(1);
    expect(first[0]!.table).toBe("orders");
    expect(second).toEqual([]);
    expect(client.listCalls).toBe(2);
  });
});
