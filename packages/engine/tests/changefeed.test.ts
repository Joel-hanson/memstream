import { describe, expect, it, vi } from "vitest";
import {
  buildS3Uri,
  cancelActiveChangefeedJobs,
  isSafeSqlIdent,
  parseChangefeedTables,
  resolveCdcSinkAuth,
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

  it("uses specified keys + ASSUME_ROLE without session token when both passed to URI builder", () => {
    const uri = buildS3Uri("b", "cdc/", {
      region: "us-east-1",
      roleArn: "arn:aws:iam::123:role/cdc",
      accessKey: "AKIAEXAMPLE",
      secretKey: "secret",
      sessionToken: "should-not-appear",
    });
    expect(uri).toContain("ASSUME_ROLE=");
    expect(uri).toContain("AWS_ACCESS_KEY_ID=AKIAEXAMPLE");
    expect(uri).not.toContain("AUTH=implicit");
    expect(uri).not.toContain("AWS_SESSION_TOKEN");
  });

  it("rejects session tokens when no assume-role sink", () => {
    expect(() =>
      buildS3Uri("b", "cdc/", {
        region: "us-east-1",
        accessKey: "ASIAEXAMPLE",
        secretKey: "secret",
        sessionToken: "tok",
      }),
    ).toThrow(/session tokens expire/);
  });
});

describe("resolveCdcSinkAuth", () => {
  it("uses dedicated CDC keys and ignores role ARN (Cockroach Cloud STS region bug)", async () => {
    const prev = {
      ak: process.env.MEMSTREAM_CDC_ACCESS_KEY_ID,
      sk: process.env.MEMSTREAM_CDC_SECRET_ACCESS_KEY,
      role: process.env.MEMSTREAM_CDC_ROLE_ARN,
      session: process.env.AWS_SESSION_TOKEN,
    };
    process.env.MEMSTREAM_CDC_ACCESS_KEY_ID = "AKIACDC";
    process.env.MEMSTREAM_CDC_SECRET_ACCESS_KEY = "cdcsecret";
    process.env.MEMSTREAM_CDC_ROLE_ARN = "arn:aws:iam::1:role/cdc";
    process.env.AWS_SESSION_TOKEN = "expired-sso";
    try {
      const auth = await resolveCdcSinkAuth({});
      expect(auth).toEqual({
        accessKey: "AKIACDC",
        secretKey: "cdcsecret",
      });
      expect(auth.roleArn).toBeUndefined();
    } finally {
      restoreEnv("MEMSTREAM_CDC_ACCESS_KEY_ID", prev.ak);
      restoreEnv("MEMSTREAM_CDC_SECRET_ACCESS_KEY", prev.sk);
      restoreEnv("MEMSTREAM_CDC_ROLE_ARN", prev.role);
      restoreEnv("AWS_SESSION_TOKEN", prev.session);
    }
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
