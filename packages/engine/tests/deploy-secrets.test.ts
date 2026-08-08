import { describe, expect, it } from "vitest";
import { deployConfigSecretName } from "../src/deploy-secrets.js";

describe("deployConfigSecretName", () => {
  it("namespaces under memstream/", () => {
    expect(deployConfigSecretName("memstream-demo")).toBe(
      "memstream/memstream-demo/config",
    );
  });

  it("sanitizes unsafe characters", () => {
    expect(deployConfigSecretName("My Stack!!")).toBe(
      "memstream/my-stack/config",
    );
  });
});
