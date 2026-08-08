/** Memstream platform DB — run history (MEMSTREAM_DATABASE_URL from .env). */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { withClientObjects } from "./db.js";
import { MEMSTREAM_SCHEMA_SQL } from "./embedded-schema.js";

export type MemstreamRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

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
  connection_id: string | null;
  log: string[];
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

function rowToRun(row: Record<string, unknown>): MemstreamRun {
  const log = row.log;
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
    connection_id:
      row.connection_id != null ? String(row.connection_id) : null,
    log: Array.isArray(log) ? log.map(String) : [],
    error: row.error != null ? String(row.error) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    finished_at: row.finished_at != null ? String(row.finished_at) : null,
  };
}

const RUN_SELECT = `
  id::text, status, profile_path, tables, bucket, region, prefix,
  stack_name, shop_url, job_id, app_database_label, connection_id::text,
  log, error, created_at::text, finished_at::text
`;

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

export async function updateRunLog(
  runId: string,
  log: string[],
  root = findRepoRoot(),
): Promise<void> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return;
  await ensureMemstreamSchema(root);
  await withClientObjects(url, async (client) => {
    await client.query(`UPDATE memstream_runs SET log = $2 WHERE id = $1::uuid`, [
      runId,
      log,
    ]);
  });
}

export async function finishRun(
  runId: string,
  options: {
    status: "succeeded" | "failed";
    log?: string[];
    shopUrl?: string | null;
    error?: string | null;
    root?: string;
  },
): Promise<void> {
  const root = options.root ?? findRepoRoot();
  const url = memstreamDatabaseUrl(root);
  if (!url) return;
  await ensureMemstreamSchema(root);
  await withClientObjects(url, async (client) => {
    await client.query(
      `
      UPDATE memstream_runs SET
        status = $2,
        log = COALESCE($3, log),
        shop_url = COALESCE($4, shop_url),
        error = $5,
        finished_at = now()
      WHERE id = $1::uuid
      `,
      [
        runId,
        options.status,
        options.log ?? null,
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
    return result.rows.map(rowToRun);
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
    return rowToRun(result.rows[0]!);
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
    return rowToRun(result.rows[0]!);
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
