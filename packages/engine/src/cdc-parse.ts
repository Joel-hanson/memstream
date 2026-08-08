/** Parse CDC payloads into ChangeEvent (Memstream + Cockroach shapes). */

import { basename } from "node:path";
import type { ChangeEvent, JsonObject, JsonValue } from "./models.js";
import { normalizeSourceTs } from "./timestamps.js";

const CRDB_FILE =
  /^(?<head>.+)-(?<topic>[A-Za-z_][A-Za-z0-9_]*)-(?<schema>\d+)$/;

export function tableFromKey(key: string): string | null {
  const normalized = key.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts[i]!;
    if (looksLikeTable(candidate)) return candidate;
  }

  if (parts.length) {
    const stem = basename(parts[parts.length - 1]!).replace(/\.[^.]+$/, "");
    const match = CRDB_FILE.exec(stem);
    if (match?.groups?.topic && looksLikeTable(match.groups.topic)) {
      return match.groups.topic;
    }
    const segs = stem.split("-");
    if (
      segs.length >= 2 &&
      /^\d+$/.test(segs[segs.length - 1]!) &&
      looksLikeTable(segs[segs.length - 2]!)
    ) {
      return segs[segs.length - 2]!;
    }
  }

  return null;
}

function looksLikeTable(name: string): boolean {
  const lowered = name.toLowerCase();
  if (["cdc", "inbox", "data", "tmp", "temp"].includes(lowered)) return false;
  const bare = name.split(".").pop() ?? name;
  const alnum = bare.replace(/_/g, "");
  if (!/^[A-Za-z0-9]+$/.test(alnum)) return false;
  if (/^\d+$/.test(bare)) return false;
  return true;
}

export function parseCdcPayload(
  text: string,
  defaultTable: string | null = null,
): ChangeEvent[] {
  const stripped = text.trim();
  if (!stripped) return [];

  let loaded: unknown;
  try {
    loaded = JSON.parse(stripped);
  } catch {
    loaded = null;
  }

  if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
    const event = parseCdcRecord(loaded as Record<string, unknown>, defaultTable);
    return event ? [event] : [];
  }

  if (Array.isArray(loaded)) {
    const events: ChangeEvent[] = [];
    for (const item of loaded) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const event = parseCdcRecord(
          item as Record<string, unknown>,
          defaultTable,
        );
        if (event) events.push(event);
      }
    }
    return events;
  }

  const events: ChangeEvent[] = [];
  for (const line of stripped.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      const event = parseCdcRecord(raw, defaultTable);
      if (event) events.push(event);
    } catch {
      continue;
    }
  }
  return events;
}

export function parseCdcRecord(
  rawInput: Record<string, unknown>,
  defaultTable: string | null = null,
): ChangeEvent | null {
  const raw = unwrapEnvelope(rawInput);

  if ("resolved" in raw && !("after" in raw) && !("before" in raw)) {
    return null;
  }

  const table = extractTable(raw, defaultTable);
  if (!table) return null;

  const before = raw.before;
  const after = raw.after;
  if (before != null && (typeof before !== "object" || Array.isArray(before))) {
    return null;
  }
  if (after != null && (typeof after !== "object" || Array.isArray(after))) {
    return null;
  }

  const beforeObj = (before as JsonObject | null) ?? null;
  const afterObj = (after as JsonObject | null) ?? null;
  const key = normalizeKey(raw.key, beforeObj, afterObj);
  const rawTs = String(raw.timestamp ?? raw.updated ?? "");
  const timestamp = normalizeSourceTs(rawTs) || rawTs;

  return {
    table: bareTable(String(table)),
    key,
    before: beforeObj,
    after: afterObj,
    timestamp,
  };
}

function unwrapEnvelope(raw: Record<string, unknown>): Record<string, unknown> {
  if ("after" in raw || "before" in raw) return raw;
  const value = raw.value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("after" in value || "before" in value || "resolved" in value)
  ) {
    const merged = { ...(value as Record<string, unknown>) };
    if ("key" in raw && !("key" in merged)) merged.key = raw.key;
    if ("table" in raw && !("table" in merged)) merged.table = raw.table;
    return merged;
  }
  return raw;
}

function extractTable(
  raw: Record<string, unknown>,
  defaultTable: string | null,
): string | null {
  if (raw.table) return String(raw.table);
  const source = raw.source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const src = source as Record<string, unknown>;
    for (const key of ["table_name", "table"]) {
      if (src[key]) return String(src[key]);
    }
  }
  if (raw.topic) return String(raw.topic);
  return defaultTable;
}

function bareTable(name: string): string {
  return name.split(".").pop() ?? name;
}

function normalizeKey(
  key: unknown,
  before: JsonObject | null,
  after: JsonObject | null,
): JsonObject {
  if (key && typeof key === "object" && !Array.isArray(key)) {
    return key as JsonObject;
  }
  const row = after || before || {};
  if ("id" in row) return { id: row.id as JsonValue };
  if ("sku" in row) return { sku: row.sku as JsonValue };
  if (Array.isArray(key) && key.length) return { key: key as JsonValue };
  return {};
}
