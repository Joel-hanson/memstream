import { describe, expect, it } from "vitest";
import {
  buildS3Uri,
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
