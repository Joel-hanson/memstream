/** Propose a memory profile from table/column metadata. */

import { stringify as yamlStringify } from "yaml";
import { withClientObjects } from "./db.js";

const INTERESTING = new Set([
  "status",
  "state",
  "role",
  "quantity",
  "amount",
  "qty",
  "price",
  "total",
  "email",
]);

/** Free-text / narrative fields that often belong in memory chunks. */
const NARRATIVE = new Set([
  "body",
  "note",
  "notes",
  "comment",
  "message",
  "description",
  "author",
  "title",
  "summary",
  "content",
  "text",
  "reason",
  "detail",
  "details",
]);

/** Extra columns to watch on identity tables (user / users / accounts / …). */
const IDENTITY = new Set([
  "name",
  "username",
  "full_name",
  "display_name",
  "first_name",
  "last_name",
  "phone",
]);

const IDENTITY_TABLE = /^(users?|accounts?|members?|people)$/i;
const IDENTITY_TABLE_SUFFIX = /_(users?|accounts?|members?)$/i;

export function interestingColumns(columns: string[]): string[] {
  return columns.filter((col) => {
    const lower = col.toLowerCase();
    return (
      INTERESTING.has(lower) ||
      lower.endsWith("_status") ||
      lower.endsWith("_state")
    );
  });
}

export function narrativeColumns(columns: string[]): string[] {
  return columns.filter((col) => {
    const lower = col.toLowerCase();
    return (
      NARRATIVE.has(lower) ||
      lower.endsWith("_note") ||
      lower.endsWith("_body") ||
      lower.endsWith("_message") ||
      lower.endsWith("_comment")
    );
  });
}

export function isIdentityTable(table: string): boolean {
  const name = (table.trim().toLowerCase().split(".").pop() || "").replace(
    /^"+|"+$/g,
    "",
  );
  return IDENTITY_TABLE.test(name) || IDENTITY_TABLE_SUFFIX.test(name);
}

export function identityColumns(columns: string[]): string[] {
  return columns.filter((col) => IDENTITY.has(col.toLowerCase()));
}

function isSecretColumn(col: string): boolean {
  const lower = col.toLowerCase();
  return (
    /password|passwd|secret|credential|api_key/.test(lower) ||
    lower.endsWith("_hash") ||
    lower.endsWith("_token") ||
    lower.endsWith("_secret") ||
    lower === "token" ||
    lower === "hash"
  );
}

/** Columns worth watching: state metrics + narrative text (+ identity fields). */
export function watchableColumns(columns: string[], table?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const extra =
    table && isIdentityTable(table) ? identityColumns(columns) : [];
  for (const col of [
    ...interestingColumns(columns),
    ...narrativeColumns(columns),
    ...extra,
  ]) {
    if (isSecretColumn(col)) continue;
    if (seen.has(col)) continue;
    seen.add(col);
    out.push(col);
  }
  return out;
}

/** Database name from a postgres URL (`…/demo?sslmode=…` → `demo`). */
export function sourceDatabaseFromUrl(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    return u.pathname.replace(/^\//, "").split("/")[0] || "defaultdb";
  } catch {
    return "defaultdb";
  }
}

function pickIdField(columns: string[]): string {
  if (columns.includes("id")) return "id";
  const withId = columns.find((c) => /_id$/i.test(c));
  return withId || columns[0] || "id";
}

export function proposeProfileDict(options: {
  application: string;
  tables: Record<string, string[]>;
  sourceDatabase?: string;
  embeddingModel?: string;
  dimensions?: number;
}): Record<string, unknown> {
  const rules: Record<string, unknown>[] = [];
  const watched: string[] = [];
  for (const table of Object.keys(options.tables).sort()) {
    const columns = options.tables[table] ?? [];
    const watchCols = watchableColumns(columns, table);
    if (!watchCols.length) continue;
    watched.push(table);
    const idField = pickIdField(columns);
    for (const col of watchCols) {
      rules.push({
        name: `${table}_${col}_change`,
        table,
        when: { columns_changed: [col] },
        chunk_template: `Table ${table} row {{ ${idField} }} field ${col} changed {{before.${col}}} → {{after.${col}}} at {{timestamp}}.`,
        tags: [table, col],
      });
    }
  }

  if (!rules.length) {
    for (const table of Object.keys(options.tables).sort()) {
      const columns = options.tables[table] ?? [];
      watched.push(table);
      const idField = pickIdField(columns);
      rules.push({
        name: `${table}_row_change`,
        table,
        when: {},
        chunk_template: `Table ${table} row {{ ${idField} }} changed at {{timestamp}}.`,
        tags: [table],
      });
    }
  }

  return {
    application: options.application,
    source_database: options.sourceDatabase ?? "defaultdb",
    changefeed: { tables: watched, sink: "s3" },
    rules,
    embedding: {
      model: options.embeddingModel ?? "amazon.titan-embed-text-v2:0",
      table: "agent_memory_chunks",
      dimensions: options.dimensions ?? 1024,
    },
    discovery: { enabled: true, mode: "schema_propose" },
    insights: { enabled: false, schedule: "manual" },
  };
}

export function proposeProfileYaml(
  options: Parameters<typeof proposeProfileDict>[0],
): string {
  return yamlStringify(proposeProfileDict(options), { sortMapEntries: false });
}

export async function fetchPublicTables(
  databaseUrl: string,
): Promise<Record<string, string[]>> {
  const sql = `
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN (
        'crdb_internal',
        'information_schema',
        'pg_catalog',
        'pg_extension'
      )
      AND table_name NOT IN ('agent_memory_chunks')
    ORDER BY table_schema, table_name, ordinal_position
  `;
  return withClientObjects(databaseUrl, async (client) => {
    const result = await client.query(sql);
    const tables: Record<string, string[]> = {};
    for (const row of result.rows) {
      const schema = String(row.table_schema || "public");
      const tableName = String(row.table_name || "").trim();
      const columnName = String(row.column_name || "").trim();
      if (!tableName || tableName === "undefined") continue;
      const key = schema === "public" ? tableName : `${schema}.${tableName}`;
      if (!tables[key]) tables[key] = [];
      if (columnName && columnName !== "undefined") {
        tables[key]!.push(columnName);
      }
    }
    return tables;
  });
}
