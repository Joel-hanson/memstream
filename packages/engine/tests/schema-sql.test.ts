import { describe, expect, it } from "vitest";
import {
  formatSchemaStatementError,
  isDemoSeedStatement,
  isRequiredMemoryStatement,
  shouldSkipDemoSeed,
  sqlPreview,
  demoSeedTableName,
} from "../src/schema-sql.js";

describe("schema-sql", () => {
  it("treats agent_memory_chunks and vector index as required", () => {
    expect(
      isRequiredMemoryStatement(
        "CREATE TABLE IF NOT EXISTS agent_memory_chunks (id UUID PRIMARY KEY)",
      ),
    ).toBe(true);
    expect(
      isRequiredMemoryStatement(
        "CREATE VECTOR INDEX IF NOT EXISTS agent_memory_chunks_embedding_idx ON agent_memory_chunks (embedding vector_cosine_ops)",
      ),
    ).toBe(true);
    expect(
      isRequiredMemoryStatement(
        "SET CLUSTER SETTING feature.vector_index.enabled = true",
      ),
    ).toBe(true);
  });

  it("treats shop CREATE TABLE as not a seed", () => {
    expect(
      isDemoSeedStatement(
        "CREATE TABLE IF NOT EXISTS users (id STRING PRIMARY KEY)",
      ),
    ).toBe(false);
  });

  it("skips INSERT INTO users when the existing table has no id column", () => {
    const stmt = `INSERT INTO users (id, org_id, email, role) VALUES
      ('u1', 'org-acme', 'admin@acme.test', 'member')
    ON CONFLICT (id) DO NOTHING`;
    expect(isDemoSeedStatement(stmt)).toBe(true);
    expect(
      shouldSkipDemoSeed(stmt, new Error('column "id" does not exist')),
    ).toBe(true);
    expect(demoSeedTableName(stmt)).toBe("users");
  });

  it("does not skip a missing-column error on agent_memory_chunks", () => {
    const stmt =
      "ALTER TABLE agent_memory_chunks ADD COLUMN IF NOT EXISTS connection_id UUID";
    expect(isDemoSeedStatement(stmt)).toBe(false);
    expect(
      shouldSkipDemoSeed(stmt, new Error('column "id" does not exist')),
    ).toBe(false);
  });

  it("includes the SQL preview on required-statement failures", () => {
    const err = formatSchemaStatementError(
      `INSERT INTO users (id) VALUES ('u1');`,
      new Error('column "id" does not exist'),
    );
    expect(err.message).toContain('column "id" does not exist');
    expect(err.message).toContain("INSERT INTO users");
    expect(sqlPreview("INSERT INTO users (id) VALUES ('u1')")).toContain(
      "INSERT INTO users",
    );
  });
});
