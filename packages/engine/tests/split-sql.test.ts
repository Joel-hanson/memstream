import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../src/console-actions.js";

describe("splitSqlStatements", () => {
  it("ignores semicolons inside -- comments", () => {
    const sql = `
-- first use; run manually if you prefer.
-- CREATE DATABASE IF NOT EXISTS memstream;
CREATE TABLE IF NOT EXISTS t (id INT);
INSERT INTO t VALUES (1);
`;
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("CREATE TABLE IF NOT EXISTS t (id INT)");
    expect(stmts[1]).toContain("INSERT INTO t VALUES (1)");
    expect(stmts.some((s) => /^\s*run\b/i.test(s))).toBe(false);
  });

  it("parses application.sql including demo user seed", () => {
    const path = join(__dirname, "../../../sql/application.sql");
    const stmts = splitSqlStatements(readFileSync(path, "utf-8"));
    expect(
      stmts.some((s) => /INSERT INTO users \(id, org_id, email, role\)/i.test(s)),
    ).toBe(true);
    expect(
      stmts.some((s) => /CREATE TABLE IF NOT EXISTS agent_memory_chunks/i.test(s)),
    ).toBe(true);
  });

  it("parses memstream.sql without bogus fragments", () => {
    const path = join(__dirname, "../../../sql/memstream.sql");
    const stmts = splitSqlStatements(readFileSync(path, "utf-8"));
    for (const s of stmts) {
      expect(s.trim().toLowerCase()).not.toMatch(/^run\b/);
    }
    expect(stmts.some((s) => /CREATE TABLE IF NOT EXISTS memstream_connections/i.test(s))).toBe(
      true,
    );
  });
});
