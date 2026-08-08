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
  if (event.before === null) {
    return new Set(event.after ? Object.keys(event.after) : []);
  }
  if (event.after === null) {
    return new Set(Object.keys(event.before));
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
