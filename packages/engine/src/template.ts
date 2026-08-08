/** Render chunk text from event fields and simple templates. */

import type { ChangeEvent, JsonObject, JsonValue } from "./models.js";

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

export function renderChunk(template: string, event: ChangeEvent): string {
  const text = template.replace(PLACEHOLDER, (_match, key: string) =>
    resolve(key.trim(), event),
  );
  return text.split(/\s+/).filter(Boolean).join(" ");
}

function resolve(key: string, event: ChangeEvent): string {
  if (key === "timestamp") return event.timestamp;
  if (key === "table") return event.table;

  if (key.startsWith("before.")) {
    const field = key.slice("before.".length);
    if (event.before === null) return "";
    return stringify(event.before[field]);
  }

  if (key.startsWith("after.")) {
    const field = key.slice("after.".length);
    if (event.after === null) return "";
    return stringify(event.after[field]);
  }

  for (const source of [event.after, event.before, event.key] as (
    | JsonObject
    | null
  )[]) {
    if (source && key in source && source[key] != null) {
      return stringify(source[key]);
    }
  }
  return "";
}

function stringify(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  return String(value);
}
