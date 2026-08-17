import { describe, expect, it } from "vitest";
import { injectSqlPassword } from "../src/cockroach-cloud.js";

describe("injectSqlPassword", () => {
  it("sets password on postgresql URL", () => {
    const out = injectSqlPassword(
      "postgresql://user@host:26257/defaultdb?sslmode=verify-full",
      "s3cret!",
    );
    const u = new URL(out.replace(/^postgresql:/i, "http:"));
    expect(u.username).toBe("user");
    expect(u.password).toBe("s3cret!");
    expect(u.pathname).toBe("/defaultdb");
  });

  it("replaces placeholder password", () => {
    const out = injectSqlPassword(
      "postgresql://user:<password>@host:26257/app",
      "real",
    );
    const u = new URL(out.replace(/^postgresql:/i, "http:"));
    expect(u.password).toBe("real");
  });
});
