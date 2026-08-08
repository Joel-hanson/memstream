/** Processed CDC object keys — file fallback or Memstream platform DB. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withClientObjects } from "./db.js";
import {
  ensureMemstreamSchema,
  findRepoRoot,
  memstreamDatabaseUrl,
} from "./runs.js";

export interface KeyState {
  seen(key: string): boolean;
  mark(key: string): void | Promise<void>;
  markMany(keys: string[]): void | Promise<void>;
  /** Load remote cache before first seen() (DB backend). */
  load?(): Promise<void>;
}

/** Local JSON journal — tests / offline when platform DB is unset. */
export class ProcessedState implements KeyState {
  readonly path: string;
  private done: Set<string>;

  constructor(path: string) {
    this.path = path;
    this.done = new Set();
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf-8")) as {
        processed?: string[];
      };
      this.done = new Set(raw.processed ?? []);
    }
  }

  seen(key: string): boolean {
    return this.done.has(key);
  }

  mark(key: string): void {
    void this.markMany([key]);
  }

  markMany(keys: string[]): void {
    if (!keys.length) return;
    for (const key of keys) this.done.add(key);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ processed: [...this.done].sort() }, null, 2),
      "utf-8",
    );
  }
}

export type CdcScopeOptions = {
  connectionId?: string | null;
  source: "s3" | "filesystem";
  bucket?: string | null;
  prefix?: string | null;
};

/** Prefer connection UUID; else stable slug for legacy CLI. */
export function cdcScopeId(options: CdcScopeOptions): string {
  const id = options.connectionId?.trim();
  if (id) return id;
  if (options.source === "s3") {
    const bucket = (options.bucket || "bucket").trim();
    const prefix = (options.prefix || "cdc/").trim() || "cdc/";
    return `s3:${bucket}:${prefix}`;
  }
  return "fs:local";
}

/** Platform DB cursor — per connection / CDC scope. */
export class DbProcessedState implements KeyState {
  readonly scopeId: string;
  readonly root: string;
  private done = new Set<string>();
  private loaded = false;

  constructor(scopeId: string, root = findRepoRoot()) {
    this.scopeId = scopeId;
    this.root = root;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const url = memstreamDatabaseUrl(this.root);
    if (!url) {
      throw new Error("MEMSTREAM_DATABASE_URL required for DbProcessedState");
    }
    await ensureMemstreamSchema(this.root);
    await withClientObjects(url, async (client) => {
      const result = await client.query(
        `SELECT object_key FROM memstream_cdc_keys WHERE scope_id = $1`,
        [this.scopeId],
      );
      this.done = new Set(result.rows.map((r) => String(r.object_key)));
    });
    this.loaded = true;
  }

  seen(key: string): boolean {
    return this.done.has(key);
  }

  async mark(key: string): Promise<void> {
    await this.markMany([key]);
  }

  async markMany(keys: string[]): Promise<void> {
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return;
    await this.load();
    const url = memstreamDatabaseUrl(this.root)!;
    await withClientObjects(url, async (client) => {
      for (const key of unique) {
        await client.query(
          `
          INSERT INTO memstream_cdc_keys (scope_id, object_key)
          VALUES ($1, $2)
          ON CONFLICT (scope_id, object_key) DO NOTHING
          `,
          [this.scopeId, key],
        );
        this.done.add(key);
      }
    });
  }
}

/**
 * Prefer Memstream DB when configured; otherwise local JSON file.
 * Explicit stateFile / MEMSTREAM_STATE_FILE forces file backend.
 */
export async function buildKeyState(options: {
  source: "s3" | "filesystem";
  connectionId?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  stateFile?: string | null;
  root?: string;
  fileFallbackPath?: string;
}): Promise<KeyState> {
  const root = options.root ?? findRepoRoot();
  const forceFile =
    Boolean(options.stateFile?.trim()) ||
    Boolean(process.env.MEMSTREAM_STATE_FILE?.trim());

  if (!forceFile && memstreamDatabaseUrl(root)) {
    const scope = cdcScopeId({
      connectionId: options.connectionId,
      source: options.source,
      bucket: options.bucket,
      prefix: options.prefix,
    });
    const state = new DbProcessedState(scope, root);
    await state.load();
    return state;
  }

  const path =
    options.stateFile?.trim() ||
    process.env.MEMSTREAM_STATE_FILE?.trim() ||
    options.fileFallbackPath ||
    (options.source === "s3"
      ? ".memstream-state/s3-fallback.json"
      : ".memstream-state/filesystem-local.json");
  return new ProcessedState(path);
}
