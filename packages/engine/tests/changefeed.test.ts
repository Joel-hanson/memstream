import { describe, expect, it, vi } from "vitest";
import {
  buildS3Uri,
  cancelActiveChangefeedJobs,
  isSafeSqlIdent,
  parseChangefeedTables,
} from "../src/changefeed.js";

describe("changefeed identifiers", () => {
  it("accepts safe table lists", () => {
    expect(parseChangefeedTables("orders, stock")).toEqual(["orders", "stock"]);
  });

  it("rejects injection in table names", () => {
    expect(() => parseChangefeedTables("orders; DROP TABLE x")).toThrow(
      /invalid table name/,
    );
  });

  it("validates connection names", () => {
    expect(isSafeSqlIdent("memstream_s3")).toBe(true);
    expect(isSafeSqlIdent("bad-name")).toBe(false);
  });
});

describe("cancelActiveChangefeedJobs", () => {
  it("cancels only active jobs for the Memstream sink", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        if (text === "SHOW CHANGEFEED JOBS") {
          return {
            fields: [{ name: "job_id" }, { name: "status" }, { name: "sink_uri" }],
            rows: [
              {
                job_id: "101",
                status: "running",
                sink_uri: "external://memstream_s3",
              },
              {
                job_id: "102",
                status: "running",
                sink_uri: "external://memstream_s3",
              },
              {
                job_id: "103",
                status: "canceled",
                sink_uri: "external://memstream_s3",
              },
              {
                job_id: "104",
                status: "running",
                sink_uri: "external://other_sink",
              },
            ],
          };
        }
        return { fields: [], rows: [] };
      }),
    };

    const canceled = await cancelActiveChangefeedJobs(client, "memstream_s3");
    expect(canceled).toEqual(["101", "102"]);
    expect(queries).toContain("CANCEL JOB 101");
    expect(queries).toContain("CANCEL JOB 102");
    expect(queries).not.toContain("CANCEL JOB 103");
    expect(queries).not.toContain("CANCEL JOB 104");
  });
});

describe("buildS3Uri", () => {
  it("embeds access keys when no role", () => {
    const uri = buildS3Uri("b", "cdc/", {
      region: "us-east-1",
      accessKey: "AKIA",
      secretKey: "secret",
    });
    expect(uri).toContain("AWS_ACCESS_KEY_ID=AKIA");
    expect(uri).not.toContain("AUTH=implicit");
  });

  it("uses AUTH=implicit when role ARN set", () => {
    const uri = buildS3Uri("b", "cdc/", {
      region: "us-east-1",
      roleArn: "arn:aws:iam::123:role/cdc",
    });
    expect(uri).toContain("AUTH=implicit");
    expect(uri).toContain("ASSUME_ROLE=");
    expect(uri).not.toContain("AWS_ACCESS_KEY_ID");
  });
});
