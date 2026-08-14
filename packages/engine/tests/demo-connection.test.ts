import { afterEach, describe, expect, it } from "vitest";
import {
  DEMO_CONNECTION_NAME,
  deriveApplicationUrlFromPlatformUrl,
  resolveDemoApplicationDatabaseUrl,
} from "../src/connections.js";

describe("deriveApplicationUrlFromPlatformUrl", () => {
  it("rewrites /memstream to /application", () => {
    const input =
      "postgresql://joel:secret@host:26257/memstream?sslmode=verify-full";
    expect(deriveApplicationUrlFromPlatformUrl(input)).toBe(
      "postgresql://joel:secret@host:26257/application?sslmode=verify-full",
    );
  });

  it("preserves query strings and userinfo", () => {
    const input =
      "postgresql://u:p@orchid.example:26257/memstream?sslmode=verify-full&options=--cluster%3Dfoo";
    const out = deriveApplicationUrlFromPlatformUrl(input);
    expect(out).toContain("/application");
    expect(out).toContain("sslmode=verify-full");
    expect(out).toContain("options=--cluster%3Dfoo");
    expect(out).not.toContain("/memstream");
  });

  it("returns empty when database is not memstream", () => {
    expect(
      deriveApplicationUrlFromPlatformUrl(
        "postgresql://u:p@host:26257/application?sslmode=verify-full",
      ),
    ).toBe("");
    expect(
      deriveApplicationUrlFromPlatformUrl(
        "postgresql://u:p@host:26257/defaultdb?sslmode=verify-full",
      ),
    ).toBe("");
  });

  it("returns empty for blank or invalid URLs", () => {
    expect(deriveApplicationUrlFromPlatformUrl("")).toBe("");
    expect(deriveApplicationUrlFromPlatformUrl("not-a-url")).toBe("");
  });
});

describe("resolveDemoApplicationDatabaseUrl", () => {
  const prevDemo = process.env.DEMO_APPLICATION_DATABASE_URL;
  const prevPlatform = process.env.MEMSTREAM_DATABASE_URL;

  afterEach(() => {
    if (prevDemo === undefined) delete process.env.DEMO_APPLICATION_DATABASE_URL;
    else process.env.DEMO_APPLICATION_DATABASE_URL = prevDemo;
    if (prevPlatform === undefined) delete process.env.MEMSTREAM_DATABASE_URL;
    else process.env.MEMSTREAM_DATABASE_URL = prevPlatform;
  });

  it("prefers DEMO_APPLICATION_DATABASE_URL", () => {
    process.env.DEMO_APPLICATION_DATABASE_URL =
      "postgresql://demo:x@host:26257/application?sslmode=verify-full";
    process.env.MEMSTREAM_DATABASE_URL =
      "postgresql://u:p@host:26257/memstream?sslmode=verify-full";
    expect(resolveDemoApplicationDatabaseUrl("/nonexistent-root")).toBe(
      "postgresql://demo:x@host:26257/application?sslmode=verify-full",
    );
  });

  it("derives from MEMSTREAM_DATABASE_URL when demo env unset", () => {
    delete process.env.DEMO_APPLICATION_DATABASE_URL;
    process.env.MEMSTREAM_DATABASE_URL =
      "postgresql://u:p@host:26257/memstream?sslmode=verify-full";
    expect(resolveDemoApplicationDatabaseUrl("/nonexistent-root")).toBe(
      "postgresql://u:p@host:26257/application?sslmode=verify-full",
    );
  });
});

describe("DEMO_CONNECTION_NAME", () => {
  it("is the fixed workspace name for skip-Connect", () => {
    expect(DEMO_CONNECTION_NAME).toBe("demo");
  });
});

describe("activateConnection export", () => {
  it("is exported for workspace reuse without re-entering secrets", async () => {
    const { activateConnection, listConnections } = await import(
      "../src/connections.js"
    );
    expect(typeof activateConnection).toBe("function");
    expect(typeof listConnections).toBe("function");
  });
});
