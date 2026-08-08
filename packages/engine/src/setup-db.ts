/** Create Memstream platform DB and apply platform schema only.
 * Application schema (incl. agent_memory_chunks) is applied by Enable
 * on the Connect application URL — not here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withClientObjects } from "./db.js";
import { repoRoot, splitSqlStatements } from "./console-actions.js";

const DEFAULT_PLATFORM_DB = "memstream";
const DEFAULT_APP_DB = "application";
const ADMIN_DB = "defaultdb";

export type SetupDbOptions = {
  /** Any Cockroach URL on the cluster (db name is rewritten). */
  clusterUrl: string;
  platformDb?: string;
  /** Optional empty app DB for demos (schema still comes from Enable). */
  applicationDb?: string;
  root?: string;
  /** Skip CREATE DATABASE (schemas only). */
  skipCreate?: boolean;
  /** Also CREATE DATABASE application (empty). Default true for demo convenience. */
  createApplicationDb?: boolean;
};

export type SetupDbResult = {
  platformUrl: string;
  applicationUrl: string;
  platformDb: string;
  applicationDb: string;
  created: string[];
  applied: { platform: number };
};

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

/** Swap the database path segment; keep user/pass/query (incl. sslrootcert). */
export function withDatabaseName(conninfo: string, database: string): string {
  const name = database.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`invalid database name: ${database}`);
  }
  const u = new URL(conninfo);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Resolve cluster URL from CLI env, then repo `.env` (file parse — safe with `&` in URLs).
 */
export function resolveClusterUrl(
  env: NodeJS.ProcessEnv = process.env,
  root = repoRoot(),
): string | null {
  const file = parseEnvFile(join(root, ".env"));
  const candidates = [
    env.CLUSTER_URL,
    env.COCKROACH_URL,
    env.MEMSTREAM_DATABASE_URL,
    env.DATABASE_URL,
    file.CLUSTER_URL,
    file.COCKROACH_URL,
    file.MEMSTREAM_DATABASE_URL,
    file.DATABASE_URL,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return null;
}

async function applySqlFile(
  databaseUrl: string,
  relativePath: string,
  root: string,
): Promise<number> {
  const path = join(root, relativePath);
  const statements = splitSqlStatements(readFileSync(path, "utf-8"));
  await withClientObjects(databaseUrl, async (client) => {
    for (const stmt of statements) {
      await client.query(stmt);
    }
  });
  return statements.length;
}

export async function setupDatabases(
  options: SetupDbOptions,
): Promise<SetupDbResult> {
  const root = options.root ?? repoRoot();
  const platformDb = options.platformDb ?? DEFAULT_PLATFORM_DB;
  const applicationDb = options.applicationDb ?? DEFAULT_APP_DB;
  const createAppDb = options.createApplicationDb !== false;
  const adminUrl = withDatabaseName(options.clusterUrl, ADMIN_DB);
  const platformUrl = withDatabaseName(options.clusterUrl, platformDb);
  const applicationUrl = withDatabaseName(options.clusterUrl, applicationDb);

  const created: string[] = [];
  if (!options.skipCreate) {
    await withClientObjects(adminUrl, async (client) => {
      await client.query(`CREATE DATABASE IF NOT EXISTS ${platformDb}`);
      created.push(platformDb);
      if (createAppDb) {
        await client.query(`CREATE DATABASE IF NOT EXISTS ${applicationDb}`);
        created.push(applicationDb);
      }
    });
  }

  const platformStmts = await applySqlFile(
    platformUrl,
    "sql/memstream.sql",
    root,
  );

  // Seed builtin profiles into platform DB (so EC2/Lambda don't need profiles/*.yaml).
  process.env.MEMSTREAM_DATABASE_URL =
    process.env.MEMSTREAM_DATABASE_URL?.trim() || platformUrl;
  const { ensureProfilesSeeded } = await import("./profile-store.js");
  await ensureProfilesSeeded(root);

  return {
    platformUrl,
    applicationUrl,
    platformDb,
    applicationDb,
    created,
    applied: { platform: platformStmts },
  };
}
