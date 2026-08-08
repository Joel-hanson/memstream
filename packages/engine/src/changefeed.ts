/** Changefeed creation helpers. */

import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
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
  if (roleArn) {
    params.set("AUTH", "implicit");
    let assume = roleArn;
    const ext = options.externalId?.trim();
    if (ext) assume = `${roleArn};external_id=${ext}`;
    params.set("ASSUME_ROLE", assume);
  } else {
    if (!options.accessKey || !options.secretKey) {
      throw new Error("AWS access keys or MEMSTREAM_CDC_ROLE_ARN required");
    }
    params.set("AWS_ACCESS_KEY_ID", options.accessKey);
    params.set("AWS_SECRET_ACCESS_KEY", options.secretKey);
    if (options.sessionToken) {
      params.set("AWS_SESSION_TOKEN", options.sessionToken);
    }
  }
  return `s3://${bucket}/${p}?${params.toString()}`;
}

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

export interface ChangefeedResult {
  tables: string;
  connectionName: string;
  jobRows: number;
  statementsRedacted: string[];
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

  const roleArn =
    options.roleArn?.trim() ||
    process.env.MEMSTREAM_CDC_ROLE_ARN?.trim() ||
    "";
  const externalId =
    options.externalId?.trim() ||
    process.env.MEMSTREAM_CDC_EXTERNAL_ID?.trim() ||
    "";

  let sink: string;
  let redacted: string;
  if (roleArn) {
    sink = buildS3Uri(options.bucket, prefix, {
      region,
      roleArn,
      externalId: externalId || undefined,
    });
    redacted = buildS3Uri(options.bucket, prefix, {
      region,
      roleArn: "***",
      externalId: externalId ? "***" : undefined,
    });
  } else {
    const keys = await resolveAwsKeys(options.accessKey, options.secretKey);
    sink = buildS3Uri(options.bucket, prefix, {
      region,
      accessKey: keys.accessKey,
      secretKey: keys.secretKey,
      sessionToken: keys.sessionToken,
    });
    redacted = buildS3Uri(options.bucket, prefix, {
      region,
      accessKey: "***",
      secretKey: "***",
      sessionToken: keys.sessionToken ? "***" : undefined,
    });
  }

  const statementsRedacted = [
    `DROP EXTERNAL CONNECTION ${connectionName};`,
    `CREATE EXTERNAL CONNECTION ${connectionName} AS '${redacted}';`,
    `CREATE CHANGEFEED FOR TABLE ${tableList} INTO 'external://${connectionName}' WITH updated, diff, format = json;`,
  ];

  if (options.dryRun) {
    return {
      tables: tableList,
      connectionName,
      jobRows: 0,
      statementsRedacted,
    };
  }

  const sinkLiteral = escapeSqlLiteral(sink);
  return withClientObjects(options.databaseUrl, async (client) => {
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
      jobRows: jobs.rows.length,
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
}): Promise<CancelChangefeedResult> {
  const connectionName = options.connectionName ?? "memstream_s3";
  if (!isSafeSqlIdent(connectionName)) {
    throw new Error(
      `invalid connection name ${JSON.stringify(connectionName)}`,
    );
  }
  const needle = `external://${connectionName}`.toLowerCase();
  const active = new Set(["running", "paused", "pending", "retry-running"]);

  return withClientObjects(options.databaseUrl, async (client) => {
    const canceledJobs: string[] = [];
    const jobs = await client.query("SHOW CHANGEFEED JOBS");
    const hasSink = jobs.fields.some(
      (f) => f.name.toLowerCase() === "sink_uri",
    );
    for (const row of jobs.rows as Record<string, unknown>[]) {
      const jobId = String(row.job_id ?? "");
      if (!/^\d+$/.test(jobId)) continue;
      const status = String(row.status ?? "").toLowerCase();
      if (!active.has(status)) continue;
      if (hasSink) {
        const sink = String(row.sink_uri ?? "").toLowerCase();
        if (
          !sink.includes(needle) &&
          !sink.includes(connectionName.toLowerCase())
        ) {
          continue;
        }
      }
      await client.query(`CANCEL JOB ${jobId}`);
      canceledJobs.push(jobId);
    }

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
