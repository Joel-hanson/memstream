/** Build a memory rule from a table/column the customer picks in Configure. */

import type { ProfileRule } from "@/lib/types";

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

export function pickIdField(columns: string[]): string {
  if (columns.includes("id")) return "id";
  const withId = columns.find((c) => /_id$/i.test(c));
  return withId || columns[0] || "id";
}

function uniqueRuleName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function addableColumns(
  columns: string[],
  tableRules: ProfileRule[],
): string[] {
  const used = new Set(
    tableRules.flatMap((r) => r.when?.columns_changed || []),
  );
  return columns.filter((c) => c && !isSecretColumn(c) && !used.has(c));
}

export function hasAnyRowRule(tableRules: ProfileRule[]): boolean {
  return tableRules.some((r) => !(r.when?.columns_changed || []).length);
}

export function createDraftRule(options: {
  table: string;
  column?: string | null;
  columns: string[];
  existingNames: string[];
}): ProfileRule {
  const table = options.table;
  const idField = pickIdField(options.columns);
  const col = options.column?.trim() || "";
  if (!col) {
    return {
      name: uniqueRuleName(`${table}_row_change`, options.existingNames),
      table,
      when: {},
      chunk_template: `Table ${table} row {{ ${idField} }} changed at {{timestamp}}.`,
      tags: [table],
    };
  }
  return {
    name: uniqueRuleName(`${table}_${col}_change`, options.existingNames),
    table,
    when: { columns_changed: [col] },
    chunk_template: `Table ${table} row {{ ${idField} }} field ${col} changed {{before.${col}}} → {{after.${col}}} at {{timestamp}}.`,
    tags: [table, col],
  };
}
