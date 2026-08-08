import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/secrets.js";

describe("secrets", () => {
  it("requires MEMSTREAM_SECRETS_KEY to encrypt", () => {
    const prev = process.env.MEMSTREAM_SECRETS_KEY;
    delete process.env.MEMSTREAM_SECRETS_KEY;
    try {
      expect(() => encryptSecret("postgresql://x", "/tmp")).toThrow(
        /MEMSTREAM_SECRETS_KEY required/,
      );
    } finally {
      if (prev === undefined) delete process.env.MEMSTREAM_SECRETS_KEY;
      else process.env.MEMSTREAM_SECRETS_KEY = prev;
    }
  });

  it("round-trips with an explicit hex key", () => {
    const prev = process.env.MEMSTREAM_SECRETS_KEY;
    process.env.MEMSTREAM_SECRETS_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    try {
      const blob = encryptSecret("hello-secret", process.cwd());
      expect(decryptSecret(blob, process.cwd())).toBe("hello-secret");
    } finally {
      if (prev === undefined) delete process.env.MEMSTREAM_SECRETS_KEY;
      else process.env.MEMSTREAM_SECRETS_KEY = prev;
    }
  });
});
