import { describe, expect, it } from "vitest";
import { isInviteCode, isOrgId } from "../src/orgs.js";

describe("orgs helpers", () => {
  it("validates org ids", () => {
    expect(isOrgId("org_abcdef12abcdef12")).toBe(true);
    expect(isOrgId("org_short")).toBe(false);
    expect(isOrgId("not-an-org")).toBe(false);
  });

  it("validates invite codes", () => {
    expect(isInviteCode("inv_abcdefghijkl")).toBe(true);
    expect(isInviteCode("invite")).toBe(false);
  });
});
