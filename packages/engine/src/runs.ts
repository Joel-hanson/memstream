/** Memstream platform DB — run history (MEMSTREAM_DATABASE_URL from .env). */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withClientObjects } from "./db.js";
import { MEMSTREAM_SCHEMA_SQL } from "./embedded-schema.js";
import { RUN_STATUS, type RunStatus } from "./constants.js";

/** @deprecated Prefer `RunStatus` from constants — alias kept for callers. */
export type MemstreamRunStatus = RunStatus;

export { RUN_STATUS };

export type MemstreamRunStep = {
  id: string;
  label: string;
  detail: string;
  status: string;
};

export type MemstreamRun = {
  id: string;
  status: MemstreamRunStatus;
  profile_path: string;
  tables: string;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  stack_name: string | null;
  shop_url: string | null;
  job_id: string | null;
  app_database_label: string | null;
  /** Workspace id (= memstream_connections.id). */
  connection_id: string | null;
  /** Alias of connection_id for product language. */
  workspace_id: string | null;
  log: string[];
  steps: MemstreamRunStep[];
  error: string | null;
  created_at: string | null;
  finished_at: string | null;
};

export type CreateRunInput = {
  jobId: string;
  profilePath: string;
  tables: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  stackName?: string;
  appDatabaseUrl?: string;
  connectionId?: string;
  root?: string;
};

export function findRepoRoot(from = process.cwd()): string {
  const envRoot = process.env.MEMSTREAM_ROOT?.trim();
  if (envRoot && existsSync(join(envRoot, "profiles")) && existsSync(join(envRoot, "sql"))) {
    return envRoot;
  }
  if (existsSync(join(from, "profiles")) && existsSync(join(from, "sql"))) {
    return from;
  }
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "profiles")) && existsSync(join(dir, "sql"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return from;
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function splitSqlStatements(sql: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let inSingle = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (inLineComment) {
      buf += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (!inSingle && ch === "-" && next === "-") {
      inLineComment = true;
      buf += ch;
      continue;
    }
    if (ch === "'" && !inSingle) {
      inSingle = true;
      buf += ch;
    } else if (ch === "'" && inSingle) {
      if (sql[i + 1] === "'") {
        buf += "''";
        i += 1;
      } else {
        inSingle = false;
        buf += ch;
      }
    } else if (ch === ";" && !inSingle) {
      const stmt = buf.trim();
      if (stmt) parts.push(stmt);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts.filter((stmt) => {
    const without = stmt.replace(/--.*?$/gm, "").trim();
    return Boolean(without);
  });
}

/** Resolve platform DB URL from process.env or repo `.env` — never from Connect. */
export function memstreamDatabaseUrl(root = findRepoRoot()): string | null {
  const fromEnv = process.env.MEMSTREAM_DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const file = parseEnvFile(join(root, ".env"));
  const fromFile = file.MEMSTREAM_DATABASE_URL?.trim();
  return fromFile || null;
}

/** Host + database name only — never user/password. */
export function appDatabaseLabel(databaseUrl: string): string | null {
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    const db = u.pathname.replace(/^\//, "") || "defaultdb";
    return `${u.hostname}/${db}`;
  } catch {
    return null;
  }
}

export async function ensureMemstreamSchema(
  root = findRepoRoot(),
): Promise<boolean> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return false;
  // Embedded DDL — never read sql/ from disk (EC2 standalone has no repo tree).
  // Operator migration path: make setup-db
  const statements = splitSqlStatements(MEMSTREAM_SCHEMA_SQL);
  await withClientObjects(url, async (client) => {
    for (const stmt of statements) {
      await client.query(stmt);
    }
  });
  // Seed builtins after DDL (lazy import avoids cycle with profile-store).
  // Needs profiles/*.yaml when present; no-op if already seeded / files absent (EC2).
  try {
    const { ensureProfilesSeeded } = await import("./profile-store.js");
    await ensureProfilesSeeded(root);
  } catch {
    /* seed best-effort */
  }
  return true;
}

function parseStepsJson(raw: unknown): MemstreamRunStep[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed =
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => {
      const row = (s && typeof s === "object" ? s : {}) as Record<
        string,
        unknown
      >;
      return {
        id: String(row.id ?? ""),
        label: String(row.label ?? ""),
        detail: String(row.detail ?? ""),
        status: String(row.status ?? "pending"),
      };
    });
  } catch {
    return [];
  }
}

function rowToRun(row: Record<string, unknown>): MemstreamRun {
  const log = row.log;
  const connectionId =
    row.connection_id != null ? String(row.connection_id) : null;
  return {
    id: String(row.id),
    status: String(row.status) as MemstreamRunStatus,
    profile_path: String(row.profile_path ?? ""),
    tables: String(row.tables ?? ""),
    bucket: row.bucket != null ? String(row.bucket) : null,
    region: row.region != null ? String(row.region) : null,
    prefix: row.prefix != null ? String(row.prefix) : null,
    stack_name: row.stack_name != null ? String(row.stack_name) : null,
    shop_url: row.shop_url != null ? String(row.shop_url) : null,
    job_id: row.job_id != null ? String(row.job_id) : null,
    app_database_label:
      row.app_database_label != null ? String(row.app_database_label) : null,
    connection_id: connectionId,
    workspace_id: connectionId,
    log: Array.isArray(log) ? log.map(String) : [],
    steps: parseStepsJson(row.steps_json),
    error: row.error != null ? String(row.error) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    finished_at: row.finished_at != null ? String(row.finished_at) : null,
  };
}

const RUN_SELECT = `
  id::text, status, profile_path, tables, bucket, region, prefix,
  stack_name, shop_url, job_id, app_database_label, connection_id::text,
  log, steps_json, error, created_at::text, finished_at::text
`;

function stepsLookComplete(steps: MemstreamRunStep[]): boolean {
  if (!steps.length) return false;
  return (
    steps.every(
      (s) =>
        s.status === "done" ||
        s.status === "skipped" ||
        s.status === "failed",
    ) && steps.some((s) => s.status === "done")
  );
}

/**
 * finishRun sets finished_at, then a lagged progress flush can overwrite
 * status back to running. Heal that for reads/list.
 */
export function coalesceRunStatus(run: MemstreamRun): MemstreamRunStatus {
  if (
    (run.status === RUN_STATUS.RUNNING || run.status === RUN_STATUS.QUEUED) &&
    run.finished_at &&
    !run.error
  ) {
    return RUN_STATUS.SUCCEEDED;
  }
  if (
    (run.status === RUN_STATUS.RUNNING || run.status === RUN_STATUS.QUEUED) &&
    run.finished_at &&
    run.error
  ) {
    return RUN_STATUS.FAILED;
  }
  if (
    (run.status === RUN_STATUS.RUNNING || run.status === RUN_STATUS.QUEUED) &&
    stepsLookComplete(run.steps) &&
    !run.error
  ) {
    return RUN_STATUS.SUCCEEDED;
  }
  return run.status;
}

/** Hydrate a console JobStatus-shaped payload from a persisted run. */
export function jobSnapshotFromRun(run: MemstreamRun): {
  id: string;
  kind: string;
  status: string;
  log: string[];
  steps: MemstreamRunStep[];
  result: { shop_url?: string; run_id: string } | null;
  error: string | null;
  live: false;
} {
  return {
    id: run.job_id || run.id,
    kind: "enable",
    status: coalesceRunStatus(run),
    log: run.log || [],
    steps: run.steps || [],
    result: {
      ...(run.shop_url ? { shop_url: run.shop_url } : {}),
      run_id: run.id,
    },
    error: run.error,
    live: false,
  };
}

/** Returns null if Memstream DB is not configured. */
export async function createRun(
  input: CreateRunInput,
): Promise<MemstreamRun | null> {
  const root = input.root ?? findRepoRoot();
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  const label = input.appDatabaseUrl
    ? appDatabaseLabel(input.appDatabaseUrl)
    : null;
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      INSERT INTO memstream_runs (
        status, profile_path, tables, bucket, region, prefix,
        stack_name, job_id, app_database_label, connection_id, log
      ) VALUES (
        'running', $1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, ARRAY[]::STRING[]
      )
      RETURNING ${RUN_SELECT}
      `,
      [
        input.profilePath,
        input.tables,
        input.bucket || null,
        input.region || null,
        input.prefix || null,
        input.stackName || null,
        input.jobId,
        label,
        input.connectionId || null,
      ],
    );
    return rowToRun(result.rows[0]!);
  });
}

/** Persist enable progress — platform runs are the durable source of truth. */
export async function updateRunProgress(
  runId: string,
  patch: {
    log?: string[];
    steps?: MemstreamRunStep[];
    status?: MemstreamRunStatus;
  },
  root = findRepoRoot(),
): Promise<void> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return;
  await ensureMemstreamSchema(root);
  const stepsJson =
    patch.steps !== undefined ? JSON.stringify(patch.steps) : null;
  await withClientObjects(url, async (client) => {
    // Never regress terminal status — debounced job flushes can land after
    // finishRun(succeeded) and would otherwise stick the UI on "Enabling…".
    await client.query(
      `
      UPDATE memstream_runs SET
        log = COALESCE($2, log),
        steps_json = COALESCE($3, steps_json),
        status = CASE
          WHEN status IN ('succeeded', 'failed') THEN status
          ELSE COALESCE($4, status)
        END
      WHERE id = $1::uuid
      `,
      [runId, patch.log ?? null, stepsJson, patch.status ?? null],
    );
  });
}

export async function finishRun(
  runId: string,
  options: {
    status: typeof RUN_STATUS.SUCCEEDED | typeof RUN_STATUS.FAILED;
    log?: string[];
    steps?: MemstreamRunStep[];
    shopUrl?: string | null;
    error?: string | null;
    root?: string;
  },
): Promise<void> {
  const root = options.root ?? findRepoRoot();
  const url = memstreamDatabaseUrl(root);
  if (!url) return;
  await ensureMemstreamSchema(root);
  const stepsJson =
    options.steps !== undefined ? JSON.stringify(options.steps) : null;
  await withClientObjects(url, async (client) => {
    await client.query(
      `
      UPDATE memstream_runs SET
        status = $2,
        log = COALESCE($3, log),
        steps_json = COALESCE($4, steps_json),
        shop_url = COALESCE($5, shop_url),
        error = $6,
        finished_at = now()
      WHERE id = $1::uuid
      `,
      [
        runId,
        options.status,
        options.log ?? null,
        stepsJson,
        options.shopUrl ?? null,
        options.error ?? null,
      ],
    );
  });
}

export async function getLatestRun(
  root = findRepoRoot(),
): Promise<MemstreamRun | null> {
  const runs = await listRuns(1, root);
  return runs[0] ?? null;
}

/** Persist healed status when finishRun was overwritten by a progress flush. */
async function healRegressedRuns(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  runs: MemstreamRun[],
): Promise<MemstreamRun[]> {
  const out: MemstreamRun[] = [];
  for (const run of runs) {
    const healed = coalesceRunStatus(run);
    if (healed !== run.status) {
      await client.query(
        `
        UPDATE memstream_runs SET status = $2
        WHERE id = $1::uuid AND status IN ('running', 'queued')
        `,
        [run.id, healed],
      );
      out.push({ ...run, status: healed });
    } else {
      out.push(run);
    }
  }
  return out;
}

export async function listRuns(
  limit = 20,
  root = findRepoRoot(),
): Promise<MemstreamRun[]> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return [];
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT ${RUN_SELECT}
      FROM memstream_runs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return healRegressedRuns(client, result.rows.map(rowToRun));
  });
}

export async function getRun(
  runId: string,
  root = findRepoRoot(),
): Promise<MemstreamRun | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT ${RUN_SELECT}
      FROM memstream_runs
      WHERE id = $1::uuid
      `,
      [runId],
    );
    if (!result.rows.length) return null;
    const [healed] = await healRegressedRuns(client, [
      rowToRun(result.rows[0]!),
    ]);
    return healed ?? null;
  });
}

/** Latest run for an enable job id (console job store / reload recovery). */
export async function getRunByJobId(
  jobId: string,
  root = findRepoRoot(),
): Promise<MemstreamRun | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT ${RUN_SELECT}
      FROM memstream_runs
      WHERE job_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [jobId],
    );
    if (!result.rows.length) return null;
    const [healed] = await healRegressedRuns(client, [
      rowToRun(result.rows[0]!),
    ]);
    return healed ?? null;
  });
}

/** Delete an enable run (Memstream flow). Returns false if not found / DB unset. */
export async function deleteRun(
  runId: string,
  root = findRepoRoot(),
): Promise<boolean> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return false;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `DELETE FROM memstream_runs WHERE id = $1::uuid RETURNING id::text`,
      [runId],
    );
    return result.rows.length > 0;
  });
}
