/** Helpers for applying sql/application.sql on DBs that may already have tables. */

export function stripSqlComments(sql: string): string {
  return sql.replace(/--.*?$/gm, "").trim();
}

export function sqlPreview(stmt: string, max = 120): string {
  return stripSqlComments(stmt).replace(/\s+/g, " ").slice(0, max);
}

/** Statements that must succeed for Memstream itself (not demo shop seed). */
export function isRequiredMemoryStatement(stmt: string): boolean {
  return /agent_memory_chunks|CREATE\s+VECTOR\s+INDEX|feature\.vector_index/i.test(
    stmt,
  );
}

/** Demo shop INSERT/UPDATE — skip when the connected DB already has a different shape. */
export function isDemoSeedStatement(stmt: string): boolean {
  const s = stripSqlComments(stmt);
  return /^(INSERT|UPDATE)\b/i.test(s);
}

export function demoSeedTableName(stmt: string): string | null {
  const s = stripSqlComments(stmt);
  const m = /^(?:INSERT INTO|UPDATE)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(s);
  return m?.[1]?.toLowerCase() ?? null;
}

export function isIncompatibleSchemaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /column ".*" does not exist/i.test(msg) ||
    /undefined column/i.test(msg) ||
    /no unique or exclusion constraint matching the ON CONFLICT/i.test(msg)
  );
}

export function shouldSkipDemoSeed(stmt: string, err: unknown): boolean {
  return isDemoSeedStatement(stmt) && isIncompatibleSchemaError(err);
}

export function formatSchemaStatementError(stmt: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`${msg}\nwhile running: ${sqlPreview(stmt)}`);
}
