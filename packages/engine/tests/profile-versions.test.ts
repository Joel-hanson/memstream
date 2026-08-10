import { describe, expect, it } from "vitest";
import { PROFILE_VERSION_KEEP } from "../src/profile-store.js";

describe("profile versioning", () => {
  it("keeps a bounded history window", () => {
    expect(PROFILE_VERSION_KEEP).toBe(20);
  });
});
