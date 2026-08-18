import { describe, expect, it } from "vitest";
import {
  LEGACY_CHANGEFEED_CONNECTION,
  cdcWatchPrefix,
  changefeedConnectionName,
  changefeedConnectionNameForRun,
  isRunScopedPrefix,
  isUuid,
  normalizeCdcPrefix,
  pickRunForCdcKey,
  runCdcPrefix,
} from "../src/cdc-prefix.js";

const RUN_A = "550e8400-e29b-41d4-a716-446655440000";
const RUN_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("cdc prefix helpers", () => {
  it("normalizes trailing slashes", () => {
    expect(normalizeCdcPrefix("cdc")).toBe("cdc/");
    expect(normalizeCdcPrefix("/cdc/")).toBe("cdc/");
    expect(normalizeCdcPrefix("cdc/app")).toBe("cdc/app/");
  });

  it("strips a trailing run UUID from the watch prefix", () => {
    expect(cdcWatchPrefix(`cdc/${RUN_A}/`)).toBe("cdc/");
    expect(cdcWatchPrefix("cdc/")).toBe("cdc/");
    expect(cdcWatchPrefix(`cdc/app/${RUN_A}`)).toBe("cdc/app/");
  });

  it("nests the run id under the watch prefix", () => {
    expect(runCdcPrefix("cdc/", RUN_A)).toBe(`cdc/${RUN_A}/`);
    expect(runCdcPrefix(`cdc/${RUN_B}/`, RUN_A)).toBe(`cdc/${RUN_A}/`);
  });

  it("builds a safe EXTERNAL CONNECTION name from the run uuid", () => {
    expect(changefeedConnectionName(RUN_A)).toBe(
      "memstream_550e8400e29b41d4a716446655440000",
    );
    expect(() => changefeedConnectionName("not a uuid!")).toThrow(/invalid run id/);
  });

  it("detects run-scoped prefixes vs legacy cdc/", () => {
    expect(isUuid(RUN_A)).toBe(true);
    expect(isRunScopedPrefix(`cdc/${RUN_A}/`, RUN_A)).toBe(true);
    expect(isRunScopedPrefix("cdc/", RUN_A)).toBe(false);
    expect(changefeedConnectionNameForRun({ id: RUN_A, prefix: "cdc/" })).toBe(
      LEGACY_CHANGEFEED_CONNECTION,
    );
    expect(
      changefeedConnectionNameForRun({
        id: RUN_A,
        prefix: `cdc/${RUN_A}/`,
      }),
    ).toBe(changefeedConnectionName(RUN_A));
  });
});

describe("pickRunForCdcKey", () => {
  it("prefers the longest matching live prefix", () => {
    const shop = {
      id: RUN_A,
      status: "succeeded",
      prefix: "cdc/",
      profile_path: "acme-live-memory",
    };
    const other = {
      id: RUN_B,
      status: "succeeded",
      prefix: `cdc/${RUN_B}/`,
      profile_path: "saas-security",
    };
    expect(
      pickRunForCdcKey(
        [shop, other],
        `cdc/${RUN_B}/2026-08-18/users-1.ndjson`,
      )?.id,
    ).toBe(RUN_B);
    expect(
      pickRunForCdcKey(
        [shop],
        `cdc/${RUN_B}/2026-08-18/users-1.ndjson`,
      ),
    ).toBeUndefined();
    expect(
      pickRunForCdcKey(
        [shop, other],
        "cdc/2026-08-07/x-b05e92b61f20bb47-1-2-00000000-orders-3.ndjson",
      )?.id,
    ).toBe(RUN_A);
  });

  it("ignores failed leftover runs", () => {
    expect(
      pickRunForCdcKey(
        [{ id: RUN_A, status: "failed", prefix: "cdc/" }],
        "cdc/orders.ndjson",
      ),
    ).toBeUndefined();
  });
});
