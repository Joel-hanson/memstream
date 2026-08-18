/** Changefeed creation helpers. */

import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { isUuid, normalizeCdcPrefix } from "./cdc-prefix.js";
import { withClientObjects } from "./db.js";

/** SQL identifier for EXTERNAL CONNECTION / table names (no quotes). */
export function isSafeSqlIdent(name: string): boolean {
  return Boolean(name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function parseChangefeedTables(tables: string): string[] {
  const list = tables
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!list.length) throw new Error("tables required");
  for (const t of list) {
    if (!isSafeSqlIdent(t)) {
      throw new Error(
        `invalid table name ${JSON.stringify(t)} (use letters, numbers, _)`,
      );
    }
  }
  return list;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildS3Uri(
  bucket: string,
  prefix: string,
  options: {
    region: string;
    accessKey?: string;
    secretKey?: string;
    sessionToken?: string;
    roleArn?: string;
    externalId?: string;
  },
): string {
  let p = prefix.replace(/^\//, "");
  if (p && !p.endsWith("/")) p += "/";
  const params = new URLSearchParams();
  params.set("AWS_REGION", options.region);

  const roleArn = options.roleArn?.trim();
  const accessKey = options.accessKey?.trim();
  const secretKey = options.secretKey?.trim();
  const ext = options.externalId?.trim();

  if (roleArn) {
    let assume = roleArn;
    if (ext) assume = `${roleArn};external_id=${ext}`;
    params.set("ASSUME_ROLE", assume);
    if (accessKey && secretKey) {
      // Specified IAM user + AssumeRole: Cockroach refreshes STS. Never
      // embed AWS_SESSION_TOKEN — that is what ExpiredToken on the job is.
      params.set("AWS_ACCESS_KEY_ID", accessKey);
      params.set("AWS_SECRET_ACCESS_KEY", secretKey);
    } else {
      params.set("AUTH", "implicit");
    }
    return `s3://${bucket}/${p}?${params.toString()}`;
  }

  if (!accessKey || !secretKey) {
    throw new Error("AWS access keys or MEMSTREAM_CDC_ROLE_ARN required");
  }
  if (options.sessionToken?.trim()) {
    throw new Error(EXPIRED_SINK_TOKEN_MSG);
  }
  params.set("AWS_ACCESS_KEY_ID", accessKey);
  params.set("AWS_SECRET_ACCESS_KEY", secretKey);
  return `s3://${bucket}/${p}?${params.toString()}`;
}

const EXPIRED_SINK_TOKEN_MSG =
  "Changefeed S3 sink cannot use temporary AWS credentials (session tokens expire and Cockroach will not refresh them). Enable from the deployed console (dedicated CDC sink user), or set MEMSTREAM_CDC_ACCESS_KEY_ID, MEMSTREAM_CDC_SECRET_ACCESS_KEY, and MEMSTREAM_CDC_ROLE_ARN.";

export async function resolveAwsKeys(
  accessKey = "",
  secretKey = "",
): Promise<{ accessKey: string; secretKey: string; sessionToken?: string }> {
  let ak = (accessKey || process.env.AWS_ACCESS_KEY_ID || "").trim();
  let sk = (secretKey || process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const st = (process.env.AWS_SESSION_TOKEN || "").trim();
  if (ak && sk) {
    return {
      accessKey: ak,
      secretKey: sk,
      sessionToken: st || undefined,
    };
  }

  const provider = fromNodeProviderChain();
  const creds = await provider();
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error(
      "No AWS credentials. Run aws configure or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY",
    );
  }
  return {
    accessKey: creds.accessKeyId,
    secretKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
  };
}

export type CdcSinkAuth = {
  accessKey?: string;
  secretKey?: string;
  roleArn?: string;
  externalId?: string;
};

/** Prefer dedicated CDC IAM user keys (no STS). Never bake session tokens. */
export async function resolveCdcSinkAuth(options: {
  accessKey?: string;
  secretKey?: string;
  roleArn?: string;
  externalId?: string;
}): Promise<CdcSinkAuth> {
  const roleArn =
    options.roleArn?.trim() ||
    process.env.MEMSTREAM_CDC_ROLE_ARN?.trim() ||
    "";
  const externalId =
    options.externalId?.trim() ||
    process.env.MEMSTREAM_CDC_EXTERNAL_ID?.trim() ||
    "";
  const cdcAk =
    options.accessKey?.trim() ||
    process.env.MEMSTREAM_CDC_ACCESS_KEY_ID?.trim() ||
    "";
  const cdcSk =
    options.secretKey?.trim() ||
    process.env.MEMSTREAM_CDC_SECRET_ACCESS_KEY?.trim() ||
    "";

  // Specified long-lived keys only. Cockroach Cloud builds the STS AssumeRole
  // client before applying AWS_REGION ("Missing Region"). Never put
  // ASSUME_ROLE in the URI unless MEMSTREAM_CDC_AUTH=implicit (Advanced).
  if (cdcAk && cdcSk) {
    return { accessKey: cdcAk, secretKey: cdcSk };
  }
  const wantImplicit =
    process.env.MEMSTREAM_CDC_AUTH?.trim().toLowerCase() === "implicit";
  if (wantImplicit && roleArn) {
    return { roleArn, externalId: externalId || undefined };
  }

  const keys = await resolveAwsKeys(options.accessKey, options.secretKey);
  if (keys.sessionToken) {
    throw new Error(EXPIRED_SINK_TOKEN_MSG);
  }
  return {
    accessKey: keys.accessKey,
    secretKey: keys.secretKey,
  };
}

export interface ChangefeedResult {
  tables: string;
  connectionName: string;
  jobRows: number;
  /** Jobs canceled before recreate (Enable re-run safety). */
  canceledJobs: string[];
  statementsRedacted: string[];
}

const ACTIVE_CHANGEFEED_STATUS = new Set([
  "running",
  "paused",
  "pending",
  "retry-running",
]);

function changefeedJobText(row: Record<string, unknown>): string {
  const named = ["sink_uri", "sink", "description"].map((key) =>
    String(row[key] ?? ""),
  );
  const blob = named.filter(Boolean).join("\n");
  if (blob) return blob.toLowerCase();
  return Object.values(row)
    .filter((v) => typeof v === "string" && v.length > 0)
    .join("\n")
    .toLowerCase();
}

/**
 * True only when this SHOW CHANGEFEED JOBS row is clearly this Memstream
 * sink. Unknown/redacted rows are left running — never cancel every job.
 */
export function changefeedJobMatchesConnection(
  row: Record<string, unknown>,
  connectionName: string,
  prefix?: string | null,
): boolean {
  const name = connectionName.trim().toLowerCase();
  if (!name) return false;
  const text = changefeedJobText(row);
  if (!text) return false;
  if (text.includes(`external://${name}`)) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:[^a-z0-9_]|$)`).test(text)) {
    return true;
  }
  const p = prefix ? normalizeCdcPrefix(prefix) : "";
  const last = p.replace(/\/$/, "").split("/").pop() || "";
  if (last && isUuid(last) && text.includes(p.toLowerCase())) return true;
  return false;
}

type QueryClient = {
  query: (
    text: string,
  ) => Promise<{
    rows: Record<string, unknown>[];
    fields: { name: string }[];
  }>;
};

/** Cancel active Memstream changefeed jobs for a sink connection (no DROP). */
export async function cancelActiveChangefeedJobs(
  client: QueryClient,
  connectionName: string,
  prefix?: string | null,
): Promise<string[]> {
  if (!isSafeSqlIdent(connectionName)) {
    throw new Error(
      `invalid connection name ${JSON.stringify(connectionName)}`,
    );
  }
  const canceledJobs: string[] = [];
  const jobs = await client.query("SHOW CHANGEFEED JOBS");
  for (const row of jobs.rows) {
    const jobId = String(row.job_id ?? "");
    if (!/^\d+$/.test(jobId)) continue;
    const status = String(row.status ?? "").toLowerCase();
    if (!ACTIVE_CHANGEFEED_STATUS.has(status)) continue;
    if (!changefeedJobMatchesConnection(row, connectionName, prefix)) continue;
    await client.query(`CANCEL JOB ${jobId}`);
    canceledJobs.push(jobId);
  }
  return canceledJobs;
}

function countActiveChangefeedJobs(
  rows: Record<string, unknown>[],
  connectionName: string,
  prefix?: string | null,
): number {
  let n = 0;
  for (const row of rows) {
    const status = String(row.status ?? "").toLowerCase();
    if (!ACTIVE_CHANGEFEED_STATUS.has(status)) continue;
    if (!changefeedJobMatchesConnection(row, connectionName, prefix)) continue;
    n += 1;
  }
  return n;
}

export async function createChangefeed(options: {
  databaseUrl: string;
  bucket: string;
  prefix?: string;
  region?: string;
  tables?: string;
  connectionName?: string;
  accessKey?: string;
  secretKey?: string;
  roleArn?: string;
  externalId?: string;
  dryRun?: boolean;
}): Promise<ChangefeedResult> {
  const prefix = options.prefix ?? "cdc/";
  const region = options.region ?? "us-east-1";
  const tableNames = parseChangefeedTables(options.tables ?? "orders,stock");
  const tableList = tableNames.join(", ");
  const connectionName = options.connectionName ?? "memstream_s3";
  if (!isSafeSqlIdent(connectionName)) {
    throw new Error(
      `invalid connection name ${JSON.stringify(connectionName)}`,
    );
  }

  const auth = await resolveCdcSinkAuth({
    accessKey: options.accessKey,
    secretKey: options.secretKey,
    roleArn: options.roleArn,
    externalId: options.externalId,
  });

  const sink = buildS3Uri(options.bucket, prefix, {
    region,
    ...auth,
  });
  const redacted = buildS3Uri(options.bucket, prefix, {
    region,
    accessKey: auth.accessKey ? "***" : undefined,
    secretKey: auth.secretKey ? "***" : undefined,
    roleArn: auth.roleArn ? "***" : undefined,
    externalId: auth.externalId ? "***" : undefined,
  });

  const statementsRedacted = [
    `-- cancel any active changefeeds into external://${connectionName}`,
    `DROP EXTERNAL CONNECTION ${connectionName};`,
    `CREATE EXTERNAL CONNECTION ${connectionName} AS '${redacted}';`,
    `CREATE CHANGEFEED FOR TABLE ${tableList} INTO 'external://${connectionName}' WITH updated, diff, format = json;`,
  ];

  if (options.dryRun) {
    return {
      tables: tableList,
      connectionName,
      jobRows: 0,
      canceledJobs: [],
      statementsRedacted,
    };
  }

  const sinkLiteral = escapeSqlLiteral(sink);
  return withClientObjects(options.databaseUrl, async (client) => {
    // Enable may be re-run; without this, each CREATE stacks another job and
    // the same row lands in S3 (and memory) once per job.
    const canceledJobs = await cancelActiveChangefeedJobs(
      client,
      connectionName,
      prefix,
    );
    try {
      await client.query(`DROP EXTERNAL CONNECTION ${connectionName}`);
    } catch {
      /* may not exist */
    }
    await client.query(
      `CREATE EXTERNAL CONNECTION ${connectionName} AS '${sinkLiteral}'`,
    );
    await client.query(
      `CREATE CHANGEFEED FOR TABLE ${tableList} INTO 'external://${connectionName}' WITH updated, diff, format = json`,
    );
    const jobs = await client.query("SHOW CHANGEFEED JOBS");
    return {
      tables: tableList,
      connectionName,
      jobRows: countActiveChangefeedJobs(
        jobs.rows as Record<string, unknown>[],
        connectionName,
        prefix,
      ),
      canceledJobs,
      statementsRedacted,
    };
  });
}

export interface CancelChangefeedResult {
  connectionName: string;
  canceledJobs: string[];
  droppedConnection: boolean;
}

/** Cancel Memstream changefeed jobs and drop the external connection. */
export async function cancelChangefeed(options: {
  databaseUrl: string;
  connectionName?: string;
  prefix?: string | null;
}): Promise<CancelChangefeedResult> {
  const connectionName = options.connectionName ?? "memstream_s3";
  if (!isSafeSqlIdent(connectionName)) {
    throw new Error(
      `invalid connection name ${JSON.stringify(connectionName)}`,
    );
  }

  return withClientObjects(options.databaseUrl, async (client) => {
    const canceledJobs = await cancelActiveChangefeedJobs(
      client,
      connectionName,
      options.prefix,
    );

    let droppedConnection = false;
    try {
      await client.query(`DROP EXTERNAL CONNECTION ${connectionName}`);
      droppedConnection = true;
    } catch {
      /* may not exist */
    }

    return { connectionName, canceledJobs, droppedConnection };
  });
}
