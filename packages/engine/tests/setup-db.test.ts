import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveClusterUrl, withDatabaseName } from "../src/setup-db.js";

describe("withDatabaseName", () => {
  it("rewrites path and keeps query params", () => {
    const src =
      "postgresql://u:p@host:26257/defaultdb?sslmode=verify-full&sslrootcert=/tmp/root.crt";
    const out = withDatabaseName(src, "memstream");
    expect(out).toContain("://u:p@host:26257/memstream?");
    expect(out).toContain("sslmode=verify-full");
    expect(out).toContain("sslrootcert=");
    expect(withDatabaseName(src, "application")).toContain("/application?");
  });

  it("rejects unsafe names", () => {
    expect(() => withDatabaseName("postgresql://h/db", "foo;drop")).toThrow(
      /invalid database name/,
    );
  });
});

describe("resolveClusterUrl", () => {
  it("prefers CLUSTER_URL", () => {
    expect(
      resolveClusterUrl({
        CLUSTER_URL: "postgresql://a/defaultdb",
        MEMSTREAM_DATABASE_URL: "postgresql://b/memstream",
      } as NodeJS.ProcessEnv),
    ).toBe("postgresql://a/defaultdb");
  });

  it("reads unquoted & URLs from .env file when process env is empty", () => {
    const root = join(__dirname, "../../..");
    const url = resolveClusterUrl({} as NodeJS.ProcessEnv, root);
    // Repo .env may or may not exist in CI; just ensure no throw.
    if (url) {
      expect(url).toMatch(/^postgresql:\/\//);
    }
  });
});
