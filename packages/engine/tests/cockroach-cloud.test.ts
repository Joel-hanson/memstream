import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { injectSqlPassword } from "../src/cockroach-cloud.js";

describe("injectSqlPassword", () => {
  it("sets password on postgresql URL", () => {
    const out = injectSqlPassword(
      "postgresql://user@host:26257/defaultdb?sslmode=verify-full",
      "s3cret!",
    );
    const u = new URL(out.replace(/^postgresql:/i, "http:"));
    assert.equal(u.username, "user");
    assert.equal(u.password, "s3cret!");
    assert.equal(u.pathname, "/defaultdb");
  });

  it("replaces placeholder password", () => {
    const out = injectSqlPassword(
      "postgresql://user:<password>@host:26257/app",
      "real",
    );
    const u = new URL(out.replace(/^postgresql:/i, "http:"));
    assert.equal(u.password, "real");
  });
});
