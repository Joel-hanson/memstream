/** Local filesystem event source (S3-shaped inbox for offline runs). */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseCdcPayload, tableFromKey } from "./cdc-parse.js";
import type { ChangeEvent } from "./models.js";
import { ProcessedState, type KeyState } from "./state.js";

const SUFFIXES = new Set([".json", ".jsonl", ".ndjson"]);

export class FilesystemEventSource {
  readonly inboxDir: string;
  readonly state: KeyState;
  private pending: string[] = [];

  constructor(inboxDir: string, statePathOrState: string | KeyState) {
    this.inboxDir = inboxDir;
    this.state =
      typeof statePathOrState === "string"
        ? new ProcessedState(statePathOrState)
        : statePathOrState;
  }

  async poll(): Promise<ChangeEvent[]> {
    if (this.state.load) await this.state.load();
    this.pending = [];
    let isDir = false;
    try {
      isDir = statSync(this.inboxDir).isDirectory();
    } catch {
      return [];
    }
    if (!isDir) return [];

    const events: ChangeEvent[] = [];
    const files = listFiles(this.inboxDir).sort();
    for (const path of files) {
      const rel = relative(this.inboxDir, path);
      if (this.state.seen(rel)) continue;
      const defaultTable = tableFromKey(rel);
      const text = readFileSync(path, "utf-8");
      events.push(...parseCdcPayload(text, defaultTable));
      this.pending.push(rel);
    }
    return events;
  }

  async ack(): Promise<void> {
    await this.state.markMany(this.pending);
    this.pending = [];
  }
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (st.isFile()) {
      const lower = name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const suffix = dot >= 0 ? lower.slice(dot) : "";
      if (SUFFIXES.has(suffix)) out.push(full);
    }
  }
  return out;
}
