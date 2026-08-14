/** Application DB connections stored in Memstream platform DB (encrypted). */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withClientObjects } from "./db.js";
import {
  appDatabaseLabel,
  ensureMemstreamSchema,
  findRepoRoot,
  memstreamDatabaseUrl,
} from "./runs.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { sanitizeDatabaseUrlForStorage } from "./store-cockroach.js";

/** Fixed workspace name for the judge / skip-Connect path. */
export const DEMO_CONNECTION_NAME = "demo";

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

function envOrFile(key: string, root: string): string {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  return parseEnvFile(join(root, ".env"))[key]?.trim() || "";
}

/**
 * Rewrite platform `…/memstream` → `…/application` (matches `make setup-db`).
 * Returns "" when the path is not exactly the `memstream` database.
 */
export function deriveApplicationUrlFromPlatformUrl(platformUrl: string): string {
  const trimmed = platformUrl.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed.replace(/^postgresql:/i, "http:"));
    const db = (u.pathname.replace(/^\//, "").split("/")[0] || "").toLowerCase();
    if (db !== "memstream") return "";
    u.pathname = "/application";
    return u.toString().replace(/^http:/i, "postgresql:");
  } catch {
    return "";
  }
}

/**
 * Demo application DB for skip-Connect: DEMO_APPLICATION_DATABASE_URL, else
 * derive from MEMSTREAM_DATABASE_URL (`/memstream` → `/application`).
 */
export function resolveDemoApplicationDatabaseUrl(
  root = findRepoRoot(),
): string {
  const explicit = envOrFile("DEMO_APPLICATION_DATABASE_URL", root);
  if (explicit) return explicit;
  const platform = memstreamDatabaseUrl(root);
  if (!platform) return "";
  return deriveApplicationUrlFromPlatformUrl(platform);
}
export type MemstreamConnection = {
  id: string;
  /** Product alias: workspace id === connection id. */
  workspace_id: string;
  name: string;
  database_url: string;
  database_label: string | null;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  is_active: boolean;
  /** SaaS org — null until auth lands. */
  org_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Product name for an application connection (customer data plane pointer). */
export type MemstreamWorkspace = MemstreamConnection;

export type UpsertConnectionInput = {
  databaseUrl: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  name?: string;
  /** When set, update this row; otherwise upsert the active connection. */
  id?: string;
  orgId?: string | null;
  root?: string;
};

function rowToConnection(
  row: Record<string, unknown>,
  root: string,
): MemstreamConnection {
  const cipher = row.database_url_ciphertext;
  let databaseUrl = "";
  if (Buffer.isBuffer(cipher)) {
    databaseUrl = decryptSecret(cipher, root);
  } else if (cipher instanceof Uint8Array) {
    databaseUrl = decryptSecret(Buffer.from(cipher), root);
  } else if (typeof cipher === "string") {
    // pg may return hex \x… or base64 depending on driver settings
    const buf = cipher.startsWith("\\x")
      ? Buffer.from(cipher.slice(2), "hex")
      : Buffer.from(cipher, "base64");
    databaseUrl = decryptSecret(buf, root);
  }
  return {
    id: String(row.id),
    workspace_id: String(row.id),
    name: String(row.name ?? "default"),
    database_url: databaseUrl,
    database_label:
      row.database_label != null ? String(row.database_label) : null,
    bucket: row.bucket != null ? String(row.bucket) : null,
    region: row.region != null ? String(row.region) : null,
    prefix: row.prefix != null ? String(row.prefix) : null,
    is_active: Boolean(row.is_active),
    org_id: row.org_id != null ? String(row.org_id) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
  };
}

const SELECT_COLS = `
  id::text, name, database_url_ciphertext, database_label,
  bucket, region, prefix, is_active, org_id,
  created_at::text, updated_at::text
`;

/** Active application connection, or null if none / platform DB unset. */
export async function getActiveConnection(
  root = findRepoRoot(),
  orgId?: string | null,
): Promise<MemstreamConnection | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  const scoped = orgId?.trim() || null;
  return withClientObjects(url, async (client) => {
    const result = scoped
      ? await client.query(
          `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE is_active = true AND org_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
      `,
          [scoped],
        )
      : await client.query(
          `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
      `,
        );
    if (!result.rows.length) return null;
    return rowToConnection(result.rows[0]!, root);
  });
}

/**
 * Application Cockroach URL: explicit arg / DATABASE_URL, else active Connect row.
 * Empty string means none configured yet (worker/shop load Connect later).
 */
export async function resolveAppDatabaseUrl(
  explicit?: string | null,
  root = findRepoRoot(),
): Promise<string> {
  const fromArg = explicit?.trim() || "";
  if (fromArg) return fromArg;
  const fromEnv = process.env.DATABASE_URL?.trim() || "";
  if (fromEnv) return fromEnv;
  try {
    const conn = await getActiveConnection(root);
    return conn?.database_url?.trim() || "";
  } catch {
    return "";
  }
}

export async function getConnection(
  id: string,
  root = findRepoRoot(),
): Promise<MemstreamConnection | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  await ensureMemstreamSchema(root);
  return withClientObjects(url, async (client) => {
    const result = await client.query(
      `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE id = $1::uuid
      `,
      [id],
    );
    if (!result.rows.length) return null;
    return rowToConnection(result.rows[0]!, root);
  });
}

/** Find a connection by workspace name (optionally scoped to org). */
export async function getConnectionByName(
  name: string,
  root = findRepoRoot(),
  orgId?: string | null,
): Promise<MemstreamConnection | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  await ensureMemstreamSchema(root);
  const scoped = orgId?.trim() || null;
  return withClientObjects(url, async (client) => {
    const result = scoped
      ? await client.query(
          `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE name = $1 AND org_id = $2
      ORDER BY updated_at DESC
      LIMIT 1
      `,
          [trimmed, scoped],
        )
      : await client.query(
          `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE name = $1 AND org_id IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
      `,
          [trimmed],
        );
    if (!result.rows.length) return null;
    return rowToConnection(result.rows[0]!, root);
  });
}

export type EnsureDemoConnectionInput = {
  root?: string;
  orgId?: string | null;
  bucket?: string;
  region?: string;
  prefix?: string;
};

/**
 * Upsert the shared demo workspace (name=demo) and mark it active.
 * Does not run Configure/Enable — operator or judge continues from there.
 */
export async function ensureDemoConnection(
  input: EnsureDemoConnectionInput = {},
): Promise<MemstreamConnection> {
  const root = input.root ?? findRepoRoot();
  const databaseUrl = resolveDemoApplicationDatabaseUrl(root);
  if (!databaseUrl) {
    throw new Error(
      "Demo application database not configured (set DEMO_APPLICATION_DATABASE_URL or use a MEMSTREAM_DATABASE_URL ending in /memstream)",
    );
  }
  const orgId = input.orgId?.trim() || null;
  const existing = await getConnectionByName(
    DEMO_CONNECTION_NAME,
    root,
    orgId,
  );
  const bucket =
    input.bucket?.trim() || envOrFile("CDC_S3_BUCKET", root) || undefined;
  const region =
    input.region?.trim() || envOrFile("AWS_REGION", root) || undefined;
  const prefix =
    input.prefix?.trim() || envOrFile("CDC_S3_PREFIX", root) || undefined;
  return upsertConnection({
    databaseUrl,
    name: DEMO_CONNECTION_NAME,
    id: existing?.id,
    orgId,
    bucket,
    region,
    prefix,
    root,
  });
}

export async function listConnections(
  root = findRepoRoot(),
  orgId?: string | null,
): Promise<Omit<MemstreamConnection, "database_url">[]> {
  const url = memstreamDatabaseUrl(root);
  if (!url) return [];
  await ensureMemstreamSchema(root);
  const scoped = orgId?.trim() || null;
  return withClientObjects(url, async (client) => {
    const result = scoped
      ? await client.query(
          `
      SELECT
        id::text, name, database_label, bucket, region, prefix, is_active,
        org_id, created_at::text, updated_at::text
      FROM memstream_connections
      WHERE org_id = $1
      ORDER BY updated_at DESC
      LIMIT 50
      `,
          [scoped],
        )
      : await client.query(
          `
      SELECT
        id::text, name, database_label, bucket, region, prefix, is_active,
        org_id, created_at::text, updated_at::text
      FROM memstream_connections
      ORDER BY updated_at DESC
      LIMIT 50
      `,
        );
    return result.rows.map((row) => ({
      id: String(row.id),
      workspace_id: String(row.id),
      name: String(row.name ?? "default"),
      database_label:
        row.database_label != null ? String(row.database_label) : null,
      bucket: row.bucket != null ? String(row.bucket) : null,
      region: row.region != null ? String(row.region) : null,
      prefix: row.prefix != null ? String(row.prefix) : null,
      is_active: Boolean(row.is_active),
      org_id: row.org_id != null ? String(row.org_id) : null,
      created_at: row.created_at != null ? String(row.created_at) : null,
      updated_at: row.updated_at != null ? String(row.updated_at) : null,
    }));
  });
}

/**
 * Mark an existing connection active (reuse saved workspace without re-pasting
 * Cloud API key / DATABASE_URL). Deactivates other rows in the same org scope.
 */
export async function activateConnection(
  id: string,
  root = findRepoRoot(),
  orgId?: string | null,
): Promise<MemstreamConnection> {
  const url = memstreamDatabaseUrl(root);
  if (!url) {
    throw new Error("MEMSTREAM_DATABASE_URL required to store connections");
  }
  const connectionId = id.trim();
  if (!connectionId) throw new Error("connection id required");
  await ensureMemstreamSchema(root);
  const scoped = orgId?.trim() || null;

  return withClientObjects(url, async (client) => {
    const existing = await client.query(
      `
      SELECT ${SELECT_COLS}
      FROM memstream_connections
      WHERE id = $1::uuid
      `,
      [connectionId],
    );
    if (!existing.rows.length) {
      throw new Error("Connection not found");
    }
    const row = existing.rows[0]!;
    const rowOrg =
      row.org_id != null && String(row.org_id).trim()
        ? String(row.org_id)
        : null;
    if (scoped && rowOrg && rowOrg !== scoped) {
      throw new Error("Connection not found in this org");
    }

    if (rowOrg) {
      await client.query(
        `UPDATE memstream_connections SET is_active = false
         WHERE is_active = true AND org_id = $1 AND id <> $2::uuid`,
        [rowOrg, connectionId],
      );
    } else {
      await client.query(
        `UPDATE memstream_connections SET is_active = false
         WHERE is_active = true AND org_id IS NULL AND id <> $1::uuid`,
        [connectionId],
      );
    }

    const updated = await client.query(
      `
      UPDATE memstream_connections SET
        is_active = true,
        updated_at = now()
      WHERE id = $1::uuid
      RETURNING ${SELECT_COLS}
      `,
      [connectionId],
    );
    return rowToConnection(updated.rows[0]!, root);
  });
}

/**
 * Upsert the active application connection (encrypted URL + CDC settings).
 * Marks other connections inactive when creating/updating the active one.
 */
export async function upsertConnection(
  input: UpsertConnectionInput,
): Promise<MemstreamConnection> {
  const root = input.root ?? findRepoRoot();
  const url = memstreamDatabaseUrl(root);
  if (!url) {
    throw new Error("MEMSTREAM_DATABASE_URL required to store connections");
  }
  const databaseUrl = sanitizeDatabaseUrlForStorage(input.databaseUrl);
  if (!databaseUrl) {
    throw new Error("database_url required");
  }
  await ensureMemstreamSchema(root);
  const ciphertext = encryptSecret(databaseUrl, root);
  const label = appDatabaseLabel(databaseUrl);
  const name = input.name?.trim() || "default";
  const bucket = input.bucket?.trim() || null;
  const region = input.region?.trim() || null;
  const prefix = input.prefix?.trim() || null;
  const orgId = input.orgId?.trim() || null;

  return withClientObjects(url, async (client) => {
    if (orgId) {
      await client.query(
        `UPDATE memstream_connections SET is_active = false
         WHERE is_active = true AND org_id = $1`,
        [orgId],
      );
    } else {
      await client.query(
        `UPDATE memstream_connections SET is_active = false
         WHERE is_active = true AND org_id IS NULL`,
      );
    }

    if (input.id) {
      const updated = await client.query(
        `
        UPDATE memstream_connections SET
          name = $2,
          database_url_ciphertext = $3,
          database_label = $4,
          bucket = $5,
          region = $6,
          prefix = $7,
          org_id = COALESCE($8, org_id),
          is_active = true,
          updated_at = now()
        WHERE id = $1::uuid
        RETURNING ${SELECT_COLS}
        `,
        [input.id, name, ciphertext, label, bucket, region, prefix, orgId],
      );
      if (updated.rows.length) {
        return rowToConnection(updated.rows[0]!, root);
      }
    }

    // New Memstream / first Connect — always insert a new connection row (workspace).
    const inserted = await client.query(
      `
      INSERT INTO memstream_connections (
        name, database_url_ciphertext, database_label,
        bucket, region, prefix, org_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING ${SELECT_COLS}
      `,
      [name, ciphertext, label, bucket, region, prefix, orgId],
    );
    return rowToConnection(inserted.rows[0]!, root);
  });
}
