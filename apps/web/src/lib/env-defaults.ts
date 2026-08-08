import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveConnection,
  memstreamDatabaseUrl,
  resolveWorkerCompute,
} from "@memstream/engine";
import { webRepoRoot } from "@/lib/api";
import { maskDatabaseUrl } from "@/lib/connect-url";

export { isUsableDatabaseUrl, maskDatabaseUrl } from "@/lib/connect-url";

/** Parse KEY=VAL lines (unquoted or double-quoted). */
export function parseEnvFile(path: string): Record<string, string> {
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

export type ConnectDefaults = {
  /** Server-only plaintext URL — never send over HTTP. */
  database_url: string;
  has_url: boolean;
  database_url_hint: string;
  bucket: string;
  region: string;
  prefix: string;
  connection_id: string | null;
  database_label: string | null;
  /** Where Connect fields came from */
  source: "memstream" | "empty";
  platform_configured: boolean;
  /** Cloud worker target from MEMSTREAM_WORKER_COMPUTE (.env). */
  worker_compute: "ec2" | "lambda";
};

/** Safe JSON for /api/defaults (no plaintext DATABASE_URL). */
export function publicConnectDefaults(d: ConnectDefaults) {
  const { database_url: _omit, ...rest } = d;
  return rest;
}

function opsPrefill(root: string): {
  bucket: string;
  region: string;
  prefix: string;
  worker_compute: "ec2" | "lambda";
} {
  const fileEnv = parseEnvFile(join(root, ".env"));
  const envVal = (key: string) =>
    process.env[key]?.trim() || fileEnv[key]?.trim() || "";
  const merged: NodeJS.ProcessEnv = {
    ...process.env,
    MEMSTREAM_WORKER_COMPUTE:
      process.env.MEMSTREAM_WORKER_COMPUTE ||
      fileEnv.MEMSTREAM_WORKER_COMPUTE ||
      "lambda",
  };
  return {
    bucket: envVal("CDC_S3_BUCKET"),
    region: envVal("AWS_REGION") || "us-east-1",
    prefix: envVal("CDC_S3_PREFIX") || "cdc/",
    worker_compute: resolveWorkerCompute(merged),
  };
}

function emptyDefaults(
  ops: ReturnType<typeof opsPrefill>,
  platformConfigured: boolean,
): ConnectDefaults {
  return {
    database_url: "",
    has_url: false,
    database_url_hint: "",
    bucket: ops.bucket,
    region: ops.region,
    prefix: ops.prefix,
    connection_id: null,
    database_label: null,
    source: "empty",
    platform_configured: platformConfigured,
    worker_compute: ops.worker_compute,
  };
}

/**
 * Prefill Connect from the encrypted active row in Memstream DB.
 * Does not read application DATABASE_URL from .env.
 * CDC bucket/prefix/region come from .env ops (not Connect UI).
 */
export async function loadConnectDefaults(
  root = webRepoRoot(),
): Promise<ConnectDefaults> {
  const platformConfigured = Boolean(memstreamDatabaseUrl(root));
  const ops = opsPrefill(root);

  if (!platformConfigured) {
    return emptyDefaults(ops, false);
  }

  try {
    const conn = await getActiveConnection(root);
    if (!conn) {
      return emptyDefaults(ops, true);
    }
    const url = conn.database_url || "";
    return {
      database_url: url,
      has_url: Boolean(url),
      database_url_hint: url ? maskDatabaseUrl(url) : "",
      bucket: conn.bucket || ops.bucket,
      region: conn.region || ops.region,
      prefix: conn.prefix || ops.prefix,
      connection_id: conn.id,
      database_label: conn.database_label,
      source: "memstream",
      platform_configured: true,
      worker_compute: ops.worker_compute,
    };
  } catch {
    return emptyDefaults(ops, true);
  }
}
