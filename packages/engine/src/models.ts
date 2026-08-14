/** Domain models for CDC events and memory chunks. */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface ChangeEvent {
  table: string;
  key: JsonObject;
  before: JsonObject | null;
  after: JsonObject | null;
  timestamp: string;
}

export function changedColumns(event: ChangeEvent): Set<string> {
  if (event.before === null && event.after === null) {
    return new Set();
  }
  if (event.after === null) {
    return new Set(Object.keys(event.before ?? {}));
  }
  // Insert / changefeed initial scan: no previous row, so this is not a
  // column change. Rules that watch columns_changed stay quiet; rules with
  // an empty when still match (see matchRules).
  if (event.before === null || Object.keys(event.before).length === 0) {
    return new Set();
  }
  const cols = new Set<string>();
  const keys = new Set([
    ...Object.keys(event.before),
    ...Object.keys(event.after),
  ]);
  for (const key of keys) {
    if (event.before[key] !== event.after[key]) {
      cols.add(key);
    }
  }
  return cols;
}

export interface MemoryChunk {
  text: string;
  embedding: number[];
  application: string;
  tableName: string;
  ruleName: string;
  tags: string[];
  sourceTs: string;
  id?: string | null;
  /** Memstream connection that owns this chunk (multi-app isolation). */
  connectionId?: string | null;
}
