/** Propose a memory profile from table/column metadata. */

import { stringify as yamlStringify } from "yaml";
import { withClient } from "./db.js";

const INTERESTING = new Set([
  "status",
  "state",
  "role",
  "quantity",
  "amount",
  "qty",
  "price",
  "total",
]);

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
    const interesting = interestingColumns(columns);
    if (!interesting.length) continue;
    watched.push(table);
    const idField = columns.includes("id") ? "id" : columns[0] || "id";
    for (const col of interesting) {
      rules.push({
        name: `${table}_${col}_change`,
        table,
        when: { columns_changed: [col] },
        chunk_template: `Table ${table} row {{ ${idField} }} field ${col} changed {{before.${col}}} → {{after.${col}}} at {{timestamp}}.`,
        tags: [table, col],
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
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name NOT IN ('agent_memory_chunks')
    ORDER BY table_name, ordinal_position
  `;
  return withClient(databaseUrl, async (client) => {
    const result = await client.query(sql);
    const tables: Record<string, string[]> = {};
    for (const row of result.rows) {
      const tableName = String((row as unknown[])[0]);
      const columnName = String((row as unknown[])[1]);
      if (!tables[tableName]) tables[tableName] = [];
      tables[tableName]!.push(columnName);
    }
    return tables;
  });
}
