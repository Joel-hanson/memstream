import { describe, expect, it } from "vitest";
import { appDatabaseLabel } from "../src/runs.js";

describe("appDatabaseLabel", () => {
  it("returns host/db without credentials", () => {
    expect(
      appDatabaseLabel(
        "postgresql://user:s3cret@db.example.com:26257/defaultdb?sslmode=verify-full",
      ),
    ).toBe("db.example.com/defaultdb");
  });

  it("returns null for invalid urls", () => {
    expect(appDatabaseLabel("not-a-url")).toBeNull();
  });
});
