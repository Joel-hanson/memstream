/** Console actions: schema, pipeline, enable, profiles. */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cancelChangefeed, createChangefeed } from "./changefeed.js";
import {
  getActiveConnection,
  getConnection,
  upsertConnection,
} from "./connections.js";
import { JOB_STEP_STATUS, RUN_STATUS } from "./constants.js";
import { withClient, withClientObjects } from "./db.js";
import {
  deleteAwsStack,
  deployAwsStack,
  describeStackOutputs,
} from "./deploy-aws.js";
import { deployLambdaStack } from "./deploy-lambda.js";
import { fetchPublicTables, proposeProfileDict } from "./discover.js";
import { APPLICATION_SCHEMA_SQL } from "./embedded-schema.js";
import type { Job } from "./jobs.js";
import { bindJobToRun } from "./jobs.js";
import {
  buildEnableSteps,
  PIPELINE_LABELS,
  resourceById,
} from "./naming.js";
import { derivePipelineHealth } from "./pipeline-health.js";
import { resilientS3, withResilience } from "./resilience.js";
import {
  createRun,
  deleteRun,
  finishRun,
  getRun,
  listRuns,
  memstreamDatabaseUrl,
  updateRunProgress,
} from "./runs.js";
import { cdcScopeId } from "./state.js";
import {
  cloudWorkerStackName,
  isPrebuiltRuntime,
  resolveWorkerCompute,
  WORKER_COMPUTE,
  workerComputeLabel,
  type WorkerCompute,
} from "./worker-compute.js";

/** Stop on-box S3 poller so Lambda is the only consumer of the CDC prefix. */
function stopPrebuiltWatch(job: Job): void {
  const r = spawnSync(
    "systemctl",
    ["disable", "--now", "memstream-watch.service"],
    { encoding: "utf-8" },
  );
  if (r.status === 0) {
    job.append("Stopped on-box memstream-watch (Lambda owns the CDC prefix)");
  } else {
    job.append(
      `WARN: could not stop memstream-watch (${r.stderr || r.stdout || r.status}) — stop it manually to avoid double-processing`,
    );
  }
}

export function repoRoot(from = process.cwd()): string {
  const envRoot = process.env.MEMSTREAM_ROOT?.trim();
  if (
    envRoot &&
    (existsSync(join(envRoot, "PREBUILT")) ||
      (existsSync(join(envRoot, "profiles")) &&
        existsSync(join(envRoot, "sql"))))
  ) {
    return envRoot;
  }
  // Prefer cwd when running from monorepo root (Next / make).
  if (existsSync(join(from, "profiles")) && existsSync(join(from, "sql"))) {
    return from;
  }
  // Walk up from this file's package location.
  let dir = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "PREBUILT"))) return dir;
    if (existsSync(join(dir, "profiles")) && existsSync(join(dir, "sql"))) {
      return dir;
    }
    dir = resolve(dir, "..");
  }
  return from;
}

export async function listProfiles(root = repoRoot()): Promise<{
  id: string;
  path: string;
  application: string;
}[]> {
  const { listStoredProfiles } = await import("./profile-store.js");
  const rows = await listStoredProfiles(root);
  return rows.map(({ id, path, application }) => ({ id, path, application }));
}

export function splitSqlStatements(sql: string): string[] {
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
      if (next === "'") {
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

export async function applySchema(
  databaseUrl: string,
  schemaPath?: string,
  _root = repoRoot(),
): Promise<number> {
  // Prefer explicit path (tests); otherwise embedded sql/application.sql — no disk on EC2.
  const sql = schemaPath
    ? readFileSync(schemaPath, "utf-8")
    : APPLICATION_SCHEMA_SQL;
  const statements = splitSqlStatements(sql);
  let applied = 0;
  await withClientObjects(databaseUrl, async (client) => {
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        applied += 1;
      } catch (err) {
        if (!isVectorIndexError(err)) throw err;
        // Legacy schema changer cannot build VECTOR INDEX — retry like sql/vector_index.sql
        await client.query(`SET CLUSTER SETTING feature.vector_index.enabled = true`);
        try {
          await client.query(`SET use_declarative_schema_changer = on`);
        } catch {
          /* setting may require admin; continue */
        }
        await client.query(`
          CREATE VECTOR INDEX IF NOT EXISTS agent_memory_chunks_embedding_idx
            ON agent_memory_chunks (embedding vector_cosine_ops)`);
        applied += 1;
      }
    }
  });
  return applied;
}

function isVectorIndexError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /vector index/i.test(msg) && /legacy schema changer|unimplemented/i.test(msg);
}

export async function listRecentChunks(
  databaseUrl: string,
  limit = 10,
  connectionId?: string | null,
): Promise<Record<string, unknown>[]> {
  return withClient(databaseUrl, async (client) => {
    const scoped = Boolean(connectionId?.trim());
    const result = scoped
      ? await client.query(
          `
      SELECT created_at::text, application, table_name, rule_name, tags::text, left(body, 240), connection_id::text
      FROM agent_memory_chunks
      WHERE connection_id = $2::UUID OR connection_id IS NULL
      ORDER BY created_at DESC
      LIMIT $1
      `,
          [limit, connectionId],
        )
      : await client.query(
          `
      SELECT created_at::text, application, table_name, rule_name, tags::text, left(body, 240), connection_id::text
      FROM agent_memory_chunks
      ORDER BY created_at DESC
      LIMIT $1
      `,
          [limit],
        );
    return result.rows.map((row) => {
      const r = row as unknown[];
      return {
        created_at: r[0],
        application: r[1],
        table_name: r[2],
        rule_name: r[3],
        tags: r[4],
        body: r[5],
        connection_id: r[6] ?? null,
      };
    });
  });
}

export async function memoryMetrics(
  databaseUrl: string,
  connectionId?: string | null,
): Promise<{ chunks: number; by_rule: { rule: string; count: number }[]; latest_at: string | null }> {
  return withClient(databaseUrl, async (client) => {
    const scoped = Boolean(connectionId?.trim());
    const scopeSql = scoped
      ? "WHERE connection_id = $1::UUID OR connection_id IS NULL"
      : "";
    const scopeParams = scoped ? [connectionId] : [];
    const total = await client.query(
      `SELECT count(*) FROM agent_memory_chunks ${scopeSql}`,
      scopeParams,
    );
    const byRule = await client.query(
      `
      SELECT rule_name, count(*)
      FROM agent_memory_chunks
      ${scopeSql}
      GROUP BY rule_name
      ORDER BY count(*) DESC
      LIMIT 8
      `,
      scopeParams,
    );
    const latest = await client.query(
      `SELECT max(created_at)::text FROM agent_memory_chunks ${scopeSql}`,
      scopeParams,
    );
    return {
      chunks: Number((total.rows[0] as unknown[])[0] ?? 0),
      by_rule: byRule.rows.map((row) => {
        const r = row as unknown[];
        return { rule: String(r[0]), count: Number(r[1]) };
      }),
      latest_at: ((latest.rows[0] as unknown[])?.[0] as string | null) ?? null,
    };
  });
}

export async function changefeedMetrics(
  databaseUrl: string,
): Promise<{ jobs: number; running: number }> {
  return withClientObjects(databaseUrl, async (client) => {
    const result = await client.query("SHOW CHANGEFEED JOBS");
    const colnames = result.fields.map((f) => f.name.toLowerCase());
    const statusIdx = colnames.indexOf("status");
    let running = 0;
    for (const row of result.rows) {
      if (statusIdx >= 0) {
        const vals = Object.values(row);
        if (String(vals[statusIdx]).toLowerCase() === "running") running += 1;
      } else {
        const text = Object.values(row).join(" ").toLowerCase();
        if (text.includes("running")) running += 1;
      }
    }
    if (running === 0 && result.rows.length && statusIdx < 0) {
      running = result.rows.length;
    }
    return { jobs: result.rows.length, running };
  });
}

export type S3CdcSnapshot = {
  count: number;
  /** ISO timestamp of the newest object under the prefix. */
  latestAt: string | null;
};

/** List CDC prefix: object count + newest LastModified (one pass). */
export async function s3CdcSnapshot(
  bucket: string,
  prefix = "cdc/",
  region = "us-east-1",
): Promise<S3CdcSnapshot | null> {
  if (!bucket) return null;
  try {
    const client = new S3Client({ region });
    let total = 0;
    let latestMs = 0;
    let token: string | undefined;
    do {
      const page = await withResilience(resilientS3, () =>
        client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix.replace(/^\//, ""),
            ContinuationToken: token,
          }),
        ),
      );
      for (const obj of page.Contents || []) {
        total += 1;
        const lm = obj.LastModified?.getTime();
        if (lm != null && lm > latestMs) latestMs = lm;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return {
      count: total,
      latestAt: latestMs > 0 ? new Date(latestMs).toISOString() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Delete all objects under the CDC prefix (not the whole bucket — leaves
 * deploy/ and other keys alone). Returns null when bucket/prefix is missing.
 * Throws on AWS API failures.
 */
export async function clearS3CdcPrefix(
  bucket: string,
  prefix = "cdc/",
  region = "us-east-1",
): Promise<{ deleted: number } | null> {
  const normalized = prefix.replace(/^\//, "").trim();
  if (!bucket || !normalized) return null;
  const client = new S3Client({ region });
  let deleted = 0;
  // List → delete until empty (safer than paging while mutating).
  for (;;) {
    const page = await withResilience(resilientS3, () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: normalized,
          MaxKeys: 1000,
        }),
      ),
    );
    const keys = (page.Contents || [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string" && !k.endsWith("/"));
    if (keys.length === 0) break;
    const result = await withResilience(resilientS3, () =>
      client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      ),
    );
    const errors = result.Errors?.length ?? 0;
    deleted += keys.length - errors;
    if (errors > 0) {
      const sample = result.Errors?.[0];
      throw new Error(
        `S3 DeleteObjects failed for ${errors} key(s) under s3://${bucket}/${normalized}` +
          (sample?.Message ? `: ${sample.Message}` : ""),
      );
    }
  }
  return { deleted };
}

/** Platform cursor stats for a CDC scope (connection or s3:bucket:prefix). */
export async function cdcProcessedStats(
  scopeId: string,
  root = repoRoot(),
): Promise<{ count: number; last_processed_at: string | null } | null> {
  const url = memstreamDatabaseUrl(root);
  if (!url || !scopeId.trim()) return null;
  try {
    return await withClientObjects(url, async (client) => {
      const result = await client.query(
        `
        SELECT count(*)::int AS n, max(processed_at)::text AS last_at
        FROM memstream_cdc_keys
        WHERE scope_id = $1
        `,
        [scopeId],
      );
      const row = result.rows[0];
      return {
        count: Number(row?.n ?? 0),
        last_processed_at:
          row?.last_at != null ? String(row.last_at) : null,
      };
    });
  } catch {
    return null;
  }
}

export async function stackOutputs(
  stackName = "memstream-demo",
  region = "us-east-1",
): Promise<Record<string, string>> {
  return describeStackOutputs(stackName, region);
}

export async function buildPipelineStatus(options: {
  databaseUrl?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  stackName?: string;
  profilePath?: string;
  tables?: string;
  connectionId?: string | null;
  root?: string;
}): Promise<Record<string, unknown>> {
  const root = options.root ?? repoRoot();
  const connectionId = options.connectionId?.trim() || null;
  const conn = connectionId
    ? await getConnection(connectionId, root)
    : await getActiveConnection(root);

  const databaseUrl =
    options.databaseUrl ||
    conn?.database_url ||
    process.env.DATABASE_URL?.trim() ||
    "";
  const bucket =
    options.bucket ||
    conn?.bucket ||
    process.env.CDC_S3_BUCKET?.trim() ||
    "";
  const prefix =
    options.prefix ||
    conn?.prefix ||
    process.env.CDC_S3_PREFIX?.trim() ||
    "cdc/";
  const region =
    options.region ||
    conn?.region ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1";
  const stackName =
    options.stackName || process.env.STACK_NAME?.trim() || "memstream-demo";
  const profilePath =
    options.profilePath || process.env.MEMORY_PROFILE?.trim() || "commerce";
  let tables =
    options.tables || process.env.MEMSTREAM_CHANGEFEED_TABLES?.trim() || "";
  const resolvedConnectionId = connectionId || conn?.id || null;

  let tableList = tables
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tableList.length && profilePath) {
    try {
      const { resolveProfile } = await import("./profile-store.js");
      tableList = (await resolveProfile(profilePath, root)).changefeed.tables;
    } catch {
      tableList = [];
    }
  }

  let dbOk = false;
  let mem = { chunks: 0, by_rule: [] as { rule: string; count: number }[], latest_at: null as string | null };
  let feeds = { jobs: 0, running: 0 };
  let dbError: string | null = null;
  let recent: Record<string, unknown>[] = [];

  if (databaseUrl) {
    try {
      mem = await memoryMetrics(databaseUrl, resolvedConnectionId);
      feeds = await changefeedMetrics(databaseUrl);
      recent = await listRecentChunks(databaseUrl, 25, resolvedConnectionId);
      dbOk = true;
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
    }
  }

  const s3Snap = bucket ? await s3CdcSnapshot(bucket, prefix, region) : null;
  const s3Count = s3Snap?.count ?? null;
  const latestCdcAt = s3Snap?.latestAt ?? null;
  const outs = await stackOutputs(stackName, region);
  const shopUrl = outs.ShopUrl ?? null;

  const scopeId = cdcScopeId({
    connectionId: resolvedConnectionId,
    source: "s3",
    bucket: bucket || null,
    prefix,
  });
  const processed = await cdcProcessedStats(scopeId, root);

  const health = derivePipelineHealth({
    databaseUrlSet: Boolean(databaseUrl),
    dbOk,
    dbError,
    changefeedJobs: feeds.jobs,
    changefeedRunning: feeds.running,
    chunkCount: mem.chunks,
    latestChunkAt: mem.latest_at,
    latestCdcAt,
    s3Objects: s3Count,
    bucketSet: Boolean(bucket),
    processedKeys: processed?.count ?? null,
    lastProcessedAt: processed?.last_processed_at ?? null,
  });

  return {
    session: {
      has_session: Boolean(databaseUrl || bucket || resolvedConnectionId),
      bucket,
      region,
      profile_path: profilePath,
      stack_name: stackName,
      connection_id: resolvedConnectionId,
    },
    sources: [
      {
        id: "cockroach",
        label: PIPELINE_LABELS.database,
        detail: dbOk ? "CockroachDB connected" : dbError || "Connect your application DB",
        statusLabel: dbOk ? "Ready" : "Waiting",
        count: dbOk ? 1 : 0,
        state: dbOk ? "ok" : "idle",
      },
      {
        id: "tables",
        label: PIPELINE_LABELS.watchedTables,
        detail: tableList.slice(0, 4).join(", ") || "Configure a profile",
        statusLabel: tableList.length ? "Ready" : "Waiting",
        count: tableList.length,
        state: tableList.length ? "ok" : "idle",
      },
      {
        id: "changefeed",
        label: PIPELINE_LABELS.liveChanges,
        detail: feeds.jobs
          ? `${feeds.running} streaming`
          : "Streams watched tables after Enable",
        statusLabel: feeds.jobs ? "Ready" : "Waiting",
        count: feeds.jobs,
        state: feeds.jobs ? "ok" : "idle",
      },
    ],
    core: {
      id: "memstream",
      label: PIPELINE_LABELS.memstream,
      subtitle: "Live agent memory",
      observability: [
        {
          name: "Chunks",
          status: String(mem.chunks ?? 0),
        },
        { name: "Ask (MCP)", status: dbOk ? "ready" : "offline" },
      ],
      state: dbOk ? "ok" : "idle",
    },
    bindings: [
      {
        id: "s3",
        label: PIPELINE_LABELS.changeStorage,
        detail:
          s3Count != null
            ? `${s3Count} object${s3Count === 1 ? "" : "s"}`
            : bucket
              ? "From .env (CDC_S3_BUCKET)"
              : "Set CDC_S3_BUCKET in .env",
        hint: bucket ? `s3://${bucket}/${prefix}` : undefined,
        statusLabel: bucket && (s3Count || 0) > 0 ? "Ready" : bucket ? "Waiting" : "Waiting",
        count: s3Count ?? 0,
        state: bucket && s3Count != null && s3Count > 0 ? "ok" : bucket ? "warn" : "idle",
      },
      {
        id: "bedrock",
        label: PIPELINE_LABELS.embeddings,
        detail: "Turns text into searchable meaning",
        hint:
          process.env.BEDROCK_EMBED_MODEL?.trim() ||
          "amazon.titan-embed-text-v2:0",
        statusLabel: dbOk ? "Ready" : "Waiting",
        count: dbOk ? 1 : 0,
        state: dbOk ? "ok" : "idle",
      },
      {
        id: "vectors",
        label: PIPELINE_LABELS.agentMemory,
        detail: "Searchable chunks in Cockroach",
        statusLabel: mem.chunks ? "Ready" : "Waiting",
        count: mem.chunks,
        state: mem.chunks ? "ok" : "idle",
      },
      {
        id: "worker",
        label: PIPELINE_LABELS.memoryWorker,
        detail: stackName ? `AWS · ${stackName}` : "Local worker",
        hint:
          (s3Count || 0) > 0 || mem.chunks > 0
            ? "Processing change stream"
            : stackName
              ? "Cloud memory worker"
              : "make watch-cloud",
        statusLabel:
          (s3Count || 0) > 0 || mem.chunks > 0 ? "Ready" : "Waiting",
        state: (s3Count || 0) > 0 || mem.chunks > 0 ? "ok" : "idle",
      },
    ],
    metrics: {
      chunks: mem.chunks,
      changefeed_jobs: feeds.jobs,
      s3_objects: s3Count,
      latest_at: mem.latest_at,
      by_rule: mem.by_rule,
      lag_seconds: health.memory.lag_seconds,
      latest_cdc_at: latestCdcAt,
      processed_keys: processed?.count ?? null,
      last_processed_at: processed?.last_processed_at ?? null,
    },
    health,
    recent,
    shop_url: shopUrl || "/shop",
    db_ok: dbOk,
    db_error: dbError,
  };
}

async function deployCloudWorker(
  job: Job,
  options: {
    root: string;
    databaseUrl: string;
    bucket: string;
    prefix: string;
    region: string;
    /** Logical stack base from UI (e.g. memstream-demo). */
    stackName: string;
    profilePath: string;
    embedModel: string;
    connectionId?: string | null;
    workerCompute?: WorkerCompute | string;
  },
): Promise<{ shopUrl: string | null; deployedStackName: string }> {
  const compute = resolveWorkerCompute(
    process.env,
    options.root,
    options.workerCompute,
  );
  const deployedStackName = cloudWorkerStackName(options.stackName, compute);
  const label = workerComputeLabel(compute);
  const prebuilt = isPrebuiltRuntime(process.env, options.root);
  job.append(`Cloud worker compute: ${label} (stack ${deployedStackName})`);

  if (compute === WORKER_COMPUTE.LAMBDA) {
    await deployLambdaStack({
      root: options.root,
      databaseUrl: options.databaseUrl,
      memstreamDatabaseUrl: memstreamDatabaseUrl(options.root) || undefined,
      connectionId: options.connectionId,
      bucket: options.bucket,
      prefix: options.prefix,
      region: options.region,
      stackName: deployedStackName,
      profilePath: options.profilePath,
      embedModel: options.embedModel,
      job,
    });
    if (prebuilt) stopPrebuiltWatch(job);
    return { shopUrl: "/shop", deployedStackName };
  }

  // Already on the EC2 demo box: memstream-watch is the worker. Redeploy needs
  // Docker + EC2 templates that are not used for in-place Enable.
  if (prebuilt) {
    job.append(
      "Already on EC2 prebuilt — memstream-watch is the memory worker; skipping CloudFormation redeploy",
    );
    return { shopUrl: "/shop", deployedStackName };
  }

  const { shopUrl } = await deployAwsStack({
    root: options.root,
    databaseUrl: options.databaseUrl,
    memstreamDatabaseUrl: memstreamDatabaseUrl(options.root) || undefined,
    bucket: options.bucket,
    prefix: options.prefix,
    region: options.region,
    stackName: deployedStackName,
    profilePath: options.profilePath,
    embedModel: options.embedModel,
    job,
  });
  return { shopUrl, deployedStackName };
}

export async function runEnablePipeline(
  job: Job,
  options: {
    databaseUrl: string;
    bucket: string;
    prefix: string;
    region: string;
    profilePath: string;
    tables: string;
    stackName: string;
    deploy: boolean;
    embedModel: string;
    root?: string;
    workerCompute?: WorkerCompute | string;
  },
): Promise<Record<string, unknown>> {
  const root = options.root ?? repoRoot();

  let runId: string | null = null;
  try {
    let connectionId: string | null = null;
    try {
      const conn = await upsertConnection({
        databaseUrl: options.databaseUrl,
        bucket: options.bucket,
        region: options.region,
        prefix: options.prefix,
        root,
      });
      connectionId = conn.id;
      job.append(
        `Workspace ${conn.database_label || conn.id} (encrypted connection)`,
      );
    } catch (err) {
      job.append(
        `Could not persist workspace connection to Memstream DB: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const run = await createRun({
      jobId: job.id,
      profilePath: options.profilePath,
      tables: options.tables,
      bucket: options.bucket,
      region: options.region,
      prefix: options.prefix,
      stackName: options.stackName,
      appDatabaseUrl: options.databaseUrl,
      connectionId: connectionId || undefined,
      root,
    });
    runId = run?.id ?? null;
    if (runId) {
      bindJobToRun(job, runId, async (snapshot) => {
        // Only mirror terminal status from the job (abort → failed). Mid-flight
        // "running" must not overwrite finishRun(succeeded) when a flush lags.
        await updateRunProgress(
          snapshot.runId,
          {
            log: snapshot.log,
            steps: snapshot.steps,
            ...(snapshot.status === RUN_STATUS.FAILED ||
            snapshot.status === RUN_STATUS.SUCCEEDED
              ? { status: snapshot.status }
              : {}),
          },
          root,
        );
      });
      job.append(`Memstream run ${runId} (platform DB — durable)`);
    } else {
      job.append(
        "MEMSTREAM_DATABASE_URL unset — enable continues without run history",
      );
    }

    job.setSteps(
      buildEnableSteps({
        tables: options.tables,
        bucket: options.bucket,
        prefix: options.prefix,
        deploy: options.deploy,
        stackName: options.stackName,
        embedModel: options.embedModel,
      }),
    );

    const schema = resourceById("schema")!;
    const changes = resourceById("changefeed")!;
    const storage = resourceById("s3")!;
    const embed = resourceById("embed")!;
    const memory = resourceById("vectors")!;
    const worker = resourceById("worker")!;

    job.setStep("schema", {
      status: JOB_STEP_STATUS.RUNNING,
      detail: "Creating app tables + agent_memory_chunks (vector)…",
    });
    job.append(`${schema.label}: applying sql/application.sql on Connect DB…`);
    const n = await applySchema(options.databaseUrl, undefined, root);
    job.append(
      `${schema.label}: ready (${n} statements) — includes agent_memory_chunks VECTOR(1024)`,
    );
    job.setStep("schema", {
      status: JOB_STEP_STATUS.DONE,
      detail: schema.blurb,
    });

    job.setStep("changefeed", {
      status: JOB_STEP_STATUS.RUNNING,
      detail: `Starting stream for ${options.tables}…`,
    });
    job.setStep("s3", {
      status: JOB_STEP_STATUS.RUNNING,
      detail: `Connecting change storage…`,
    });
    job.append(
      `${changes.label} → ${storage.label}: s3://${options.bucket}/${options.prefix}`,
    );
    const result = await createChangefeed({
      databaseUrl: options.databaseUrl,
      bucket: options.bucket,
      prefix: options.prefix,
      region: options.region,
      tables: options.tables,
    });
    if (result.canceledJobs.length) {
      job.append(
        `${changes.label}: canceled ${result.canceledJobs.length} prior job(s) before recreate`,
      );
    }
    job.append(`${changes.label}: ready (${result.jobRows} active job(s))`);
    job.setStep("changefeed", {
      status: JOB_STEP_STATUS.DONE,
      detail: `Streaming ${options.tables}`,
    });
    job.setStep("s3", {
      status: JOB_STEP_STATUS.DONE,
      detail: `s3://${options.bucket}/${options.prefix}`,
    });
    job.setStep("embed", {
      status: JOB_STEP_STATUS.DONE,
      detail: options.embedModel || embed.blurb,
    });
    job.setStep("vectors", {
      status: JOB_STEP_STATUS.DONE,
      detail: memory.blurb,
    });

    let shopUrl: string | null = null;
    let deployedStackName: string | null = null;
    if (options.deploy) {
      const compute = resolveWorkerCompute(
        process.env,
        root,
        options.workerCompute,
      );
      const prebuilt = isPrebuiltRuntime(process.env, root);
      job.setStep("worker", {
        status: JOB_STEP_STATUS.RUNNING,
        detail:
          prebuilt && compute === WORKER_COMPUTE.EC2
            ? "Using on-box memory worker (memstream-watch)…"
            : `Starting cloud memory worker (${workerComputeLabel(compute)})…`,
      });
      job.append(
        prebuilt && compute === WORKER_COMPUTE.EC2
          ? `${worker.label}: using on-box memstream-watch…`
          : `${worker.label}: deploying via AWS SDK…`,
      );
      const deployed = await deployCloudWorker(job, {
        root,
        databaseUrl: options.databaseUrl,
        bucket: options.bucket,
        prefix: options.prefix,
        region: options.region,
        stackName: options.stackName,
        profilePath: options.profilePath,
        embedModel: options.embedModel,
        connectionId,
        workerCompute: compute,
      });
      shopUrl = deployed.shopUrl;
      deployedStackName = deployed.deployedStackName;
      if (!shopUrl && compute === WORKER_COMPUTE.EC2 && !prebuilt) {
        const outs = await describeStackOutputs(
          deployedStackName,
          options.region,
        );
        shopUrl = outs.ShopUrl ?? null;
      }
      if (shopUrl && shopUrl.startsWith("http")) {
        job.append(`Shop URL: ${shopUrl}`);
      } else if (prebuilt && compute === WORKER_COMPUTE.EC2) {
        job.append(
          "Shop/console is this host — memstream-watch embeds S3 → live memory",
        );
      } else if (compute === WORKER_COMPUTE.LAMBDA) {
        job.append(
          prebuilt
            ? "Lambda worker ready — shop/console stays on this EC2 host"
            : "Lambda worker ready — use local shop/console (make web)",
        );
      } else {
        job.append(
          "Deploy finished (check CloudFormation outputs if ShopUrl missing)",
        );
      }
      job.setStep("worker", {
        status: JOB_STEP_STATUS.DONE,
        detail:
          prebuilt && compute === WORKER_COMPUTE.EC2
            ? "On-box memstream-watch (already running)"
            : compute === WORKER_COMPUTE.LAMBDA
              ? `Lambda stack ${deployedStackName} ready`
              : shopUrl || `Stack ${deployedStackName} ready`,
      });
    } else {
      job.append(`${worker.label}: skipped (local mode)`);
      job.setStep("worker", {
        status: JOB_STEP_STATUS.SKIPPED,
        detail: "Cloud worker off — use local worker / demo shop",
      });
    }

    const payload = {
      tables: result.tables,
      shop_url: shopUrl || "/shop",
      stack_name: options.deploy ? deployedStackName : null,
      run_id: runId,
      connection_id: connectionId,
    };

    if (runId) {
      await finishRun(runId, {
        status: RUN_STATUS.SUCCEEDED,
        log: [...job.log],
        steps: job.steps.map((s) => ({ ...s })),
        shopUrl: payload.shop_url,
        root,
      });
    }

    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) {
      await finishRun(runId, {
        status: RUN_STATUS.FAILED,
        log: [...job.log, `ERROR: ${message}`],
        steps: job.steps.map((s) => ({ ...s })),
        error: message,
        root,
      }).catch(() => {
        /* non-fatal */
      });
    }
    throw err;
  }
}

export type TeardownResult = {
  deleted: boolean;
  id: string;
  changefeed: {
    skipped: boolean;
    reason?: string;
    canceledJobs: string[];
    droppedConnection: boolean;
  };
  stack: {
    skipped: boolean;
    reason?: string;
    deleted: boolean;
    stackName?: string;
  };
};

/**
 * Reverse enable for a Memstream run: cancel changefeeds, drop the external
 * connection, start CloudFormation delete when this was the last user of that
 * stack, then remove the run row. Keeps memory tables/chunks.
 */
export async function teardownAndDeleteRun(
  runId: string,
  root = repoRoot(),
): Promise<TeardownResult | null> {
  const run = await getRun(runId, root);
  if (!run) return null;

  const others = (await listRuns(50, root)).filter((r) => r.id !== runId);
  const result: TeardownResult = {
    deleted: false,
    id: runId,
    changefeed: {
      skipped: true,
      reason: "no app connection on run",
      canceledJobs: [],
      droppedConnection: false,
    },
    stack: {
      skipped: true,
      reason: "no stack on run",
      deleted: false,
    },
  };

  let databaseUrl: string | null = null;
  if (run.connection_id) {
    const conn = await getConnection(run.connection_id, root);
    databaseUrl = conn?.database_url ?? null;
  }

  const othersShareConnection =
    Boolean(run.connection_id) &&
    others.some((r) => r.connection_id === run.connection_id);

  if (!databaseUrl) {
    result.changefeed.reason = "could not resolve app database URL";
  } else if (othersShareConnection) {
    result.changefeed.reason =
      "other Memstreams still use this connection — left stream running";
  } else {
    const canceled = await cancelChangefeed({ databaseUrl });
    result.changefeed = {
      skipped: false,
      canceledJobs: canceled.canceledJobs,
      droppedConnection: canceled.droppedConnection,
    };
  }

  const stackName = run.stack_name?.trim();
  const region = run.region?.trim() || "us-east-1";
  if (!stackName) {
    result.stack.reason = "no stack on run";
  } else if (others.some((r) => r.stack_name === stackName)) {
    result.stack.reason =
      "other Memstreams still use this stack — left cloud worker running";
  } else {
    const deleted = await deleteAwsStack({
      stackName,
      region,
      wait: false,
    });
    result.stack = {
      skipped: false,
      deleted: deleted.deleted,
      stackName,
    };
  }

  const ok = await deleteRun(runId, root);
  result.deleted = ok;
  if (!ok) return null;
  return result;
}

export async function proposeFromDatabase(options: {
  databaseUrl: string;
  application?: string;
  /** When set, only these public tables are considered for the draft. */
  includeTables?: string[];
}): Promise<{ profile: Record<string, unknown>; tables_scanned: string[] }> {
  let tables = await fetchPublicTables(options.databaseUrl);
  const include = (options.includeTables || [])
    .map((t) => t.trim())
    .filter(Boolean);
  if (include.length) {
    const allow = new Set(include);
    tables = Object.fromEntries(
      Object.entries(tables).filter(([name]) => allow.has(name)),
    );
  }
  if (!Object.keys(tables).length) throw new Error("no public tables found");
  const profile = proposeProfileDict({
    application: options.application || "discovered-app",
    tables,
  });
  return { profile, tables_scanned: Object.keys(tables).sort() };
}

export async function saveProfileYaml(options: {
  profile: Record<string, unknown>;
  profileId?: string;
  root?: string;
}): Promise<{ id: string; path: string; application: string; tables: string }> {
  const { saveStoredProfile } = await import("./profile-store.js");
  return saveStoredProfile(options);
}

export async function profileTables(
  profilePath: string,
  root = repoRoot(),
): Promise<{ tables: string; application: string }> {
  const { resolveProfile } = await import("./profile-store.js");
  const profile = await resolveProfile(profilePath, root);
  return {
    tables: profile.changefeed.tables.join(","),
    application: profile.application,
  };
}

/** Load a profile YAML as a snake_case draft dict for the console editor. */
export async function loadProfileDraft(
  profilePath: string,
  root = repoRoot(),
): Promise<Record<string, unknown>> {
  const { resolveProfileDraft } = await import("./profile-store.js");
  return resolveProfileDraft(profilePath, root);
}
