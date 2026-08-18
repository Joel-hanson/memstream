import { describe, expect, it } from "vitest";
import {
  isJoinableRun,
  pickJoinableRun,
  pickLiveRunForAppLabel,
} from "../src/pick-run.js";

function run(
  status: string,
  label: string | null = "host/application",
) {
  return { status, app_database_label: label };
}

describe("pickLiveRunForAppLabel", () => {
  it("joins a succeeded run on the same application database", () => {
    const live = run("succeeded", "db.example/application");
    expect(
      pickLiveRunForAppLabel(
        [run("failed", "db.example/application"), live],
        "db.example/application",
      ),
    ).toBe(live);
  });

  it("ignores live runs on a different database", () => {
    expect(
      pickLiveRunForAppLabel(
        [run("succeeded", "other.host/application")],
        "db.example/application",
      ),
    ).toBeUndefined();
  });

  it("prefers an in-flight enable over an older succeeded run", () => {
    const enabling = run("running", "host/application");
    expect(
      pickLiveRunForAppLabel(
        [run("succeeded", "host/application"), enabling],
        "host/application",
      ),
    ).toBe(enabling);
  });

  it("returns nothing for a blank label", () => {
    expect(pickLiveRunForAppLabel([run("succeeded")], "")).toBeUndefined();
    expect(pickLiveRunForAppLabel([run("succeeded")], null)).toBeUndefined();
  });
});

describe("pickJoinableRun", () => {
  it("skips failed leftover rows", () => {
    expect(isJoinableRun(run("failed"))).toBe(false);
    expect(pickJoinableRun([run("failed")])).toBeUndefined();
    expect(pickJoinableRun([run("failed"), run("succeeded")])?.status).toBe(
      "succeeded",
    );
  });
});
