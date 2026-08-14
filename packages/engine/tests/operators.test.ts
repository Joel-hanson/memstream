import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/operators.js";

describe("operator password hashing", () => {
  it("round-trips scrypt hashes", () => {
    const stored = hashPassword("demo-secret");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("demo-secret", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed stored values", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$aa$bb")).toBe(false);
  });
});
