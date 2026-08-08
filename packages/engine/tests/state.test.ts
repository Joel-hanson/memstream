import { describe, expect, it } from "vitest";
import { cdcScopeId, ProcessedState } from "../src/state.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cdcScopeId", () => {
  it("prefers connection id", () => {
    expect(
      cdcScopeId({
        connectionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        source: "s3",
        bucket: "b",
        prefix: "cdc/",
      }),
    ).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("falls back to s3 bucket+prefix", () => {
    expect(
      cdcScopeId({ source: "s3", bucket: "memstream-cdc", prefix: "cdc/app/" }),
    ).toBe("s3:memstream-cdc:cdc/app/");
  });

  it("uses fs:local for filesystem", () => {
    expect(cdcScopeId({ source: "filesystem" })).toBe("fs:local");
  });
});

describe("ProcessedState", () => {
  it("persists keys to a file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "memstream-st-")), "s.json");
    const a = new ProcessedState(path);
    a.markMany(["a", "b"]);
    const b = new ProcessedState(path);
    expect(b.seen("a")).toBe(true);
    expect(b.seen("c")).toBe(false);
  });
});
