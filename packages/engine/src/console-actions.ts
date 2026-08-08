/** Console actions: schema, pipeline, enable, profiles. */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { cancelChangefeed, createChangefeed } from "./changefeed.js";
import { withClient, withClientObjects } from "./db.js";
import {
  deleteAwsStack,
  deployAwsStack,
  describeStackOutputs,
} from "./deploy-aws.js";
import { deployLambdaStack } from "./deploy-lambda.js";
import { fetchPublicTables, proposeProfileDict } from "./discover.js";
import type { Job } from "./jobs.js";
import { bindJobToRun } from "./jobs.js";
import {
  buildEnableSteps,
  PIPELINE_LABELS,
  resourceById,
} from "./naming.js";
import {
  createRun,
  deleteRun,
  finishRun,
  getRun,
  listRuns,
  memstreamDatabaseUrl,
  updateRunProgress,
} from "./runs.js";
import { APPLICATION_SCHEMA_SQL } from "./embedded-schema.js";
import { getConnection, upsertConnection } from "./connections.js";
import {
  cloudWorkerStackName,
  isPrebuiltRuntime,
  resolveWorkerCompute,
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

export function consoleDir(root = repoRoot()): string {
  const path = join(root, ".memstream-console");
  mkdirSync(path, { recursive: true });
  return path;
}

export function sessionEnvPath(root = repoRoot()): string {
  return join(consoleDir(root), "session.env");
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function writeSessionEnv(
  values: Record<string, string>,
  root = repoRoot(),
): string {
  const path = sessionEnvPath(root);
  const lines = Object.entries(values)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${shellQuote(v)}`);
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  chmodSync(path, 0o600);
  return path;
}

export function readSessionEnv(
  path = sessionEnvPath(),
): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/'"'"'/g, "'");
    }
    out[key] = value;
  }
  return out;
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

export async function s3ObjectCount(
  bucket: string,
  prefix = "cdc/",
  region = "us-east-1",
): Promise<number | null> {
  if (!bucket) return null;
  try {
    const client = new S3Client({ region });
    let total = 0;
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix.replace(/^\//, ""),
          ContinuationToken: token,
        }),
      );
      total += page.KeyCount ?? page.Contents?.length ?? 0;
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return total;
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
  const session = readSessionEnv(sessionEnvPath(root));
  const databaseUrl = options.databaseUrl || session.DATABASE_URL || "";
  const bucket = options.bucket || session.CDC_S3_BUCKET || "";
  const prefix = options.prefix || session.CDC_S3_PREFIX || "cdc/";
  const region = options.region || session.AWS_REGION || "us-east-1";
  const stackName = options.stackName || session.STACK_NAME || "memstream-demo";
  const profilePath =
    options.profilePath || session.MEMORY_PROFILE || "commerce";
  let tables = options.tables || session.MEMSTREAM_CHANGEFEED_TABLES || "";
  const connectionId =
    options.connectionId?.trim() ||
    session.MEMSTREAM_CONNECTION_ID?.trim() ||
    null;

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
      mem = await memoryMetrics(databaseUrl, connectionId);
      feeds = await changefeedMetrics(databaseUrl);
      recent = await listRecentChunks(databaseUrl, 5, connectionId);
      dbOk = true;
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
    }
  }

  const s3Count = bucket ? await s3ObjectCount(bucket, prefix, region) : null;
  const outs = await stackOutputs(stackName, region);
  const shopUrl = outs.ShopUrl ?? null;

  return {
    session: {
      has_session: Object.keys(session).length > 0,
      bucket,
      region,
      profile_path: profilePath,
      stack_name: stackName,
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
        hint: session.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0",
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
    },
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

  if (compute === "lambda") {
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
  const values = {
    DATABASE_URL: options.databaseUrl,
    AWS_REGION: options.region,
    CDC_S3_BUCKET: options.bucket,
    CDC_S3_PREFIX: options.prefix,
    BEDROCK_EMBED_MODEL: options.embedModel,
    MEMORY_PROFILE: options.profilePath,
    MEMSTREAM_EMBEDDER: "bedrock",
    MEMSTREAM_STORE: "cockroach",
    MEMSTREAM_SOURCE: "s3",
    MEMSTREAM_WATCH: "true",
    STACK_NAME: options.stackName,
    MEMSTREAM_CHANGEFEED_TABLES: options.tables,
  };

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
        await updateRunProgress(
          snapshot.runId,
          {
            log: snapshot.log,
            steps: snapshot.steps,
            status: snapshot.status,
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

    // Local worker bridge only — source of truth is memstream_connections (workspace).
    const envPath = writeSessionEnv(values, root);
    job.append(`Wrote local worker env → ${envPath}`);

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
      status: "running",
      detail: "Creating app tables + agent_memory_chunks (vector)…",
    });
    job.append(`${schema.label}: applying sql/application.sql on Connect DB…`);
    const n = await applySchema(options.databaseUrl, undefined, root);
    job.append(
      `${schema.label}: ready (${n} statements) — includes agent_memory_chunks VECTOR(1024)`,
    );
    job.setStep("schema", {
      status: "done",
      detail: schema.blurb,
    });

    job.setStep("changefeed", {
      status: "running",
      detail: `Starting stream for ${options.tables}…`,
    });
    job.setStep("s3", {
      status: "running",
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
    job.append(`${changes.label}: ready (${result.jobRows} job(s))`);
    job.setStep("changefeed", {
      status: "done",
      detail: `Streaming ${options.tables}`,
    });
    job.setStep("s3", {
      status: "done",
      detail: `s3://${options.bucket}/${options.prefix}`,
    });
    job.setStep("embed", {
      status: "done",
      detail: options.embedModel || embed.blurb,
    });
    job.setStep("vectors", {
      status: "done",
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
        status: "running",
        detail:
          prebuilt && compute === "ec2"
            ? "Using on-box memory worker (memstream-watch)…"
            : `Starting cloud memory worker (${workerComputeLabel(compute)})…`,
      });
      job.append(
        prebuilt && compute === "ec2"
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
      if (!shopUrl && compute === "ec2" && !prebuilt) {
        const outs = await describeStackOutputs(
          deployedStackName,
          options.region,
        );
        shopUrl = outs.ShopUrl ?? null;
      }
      if (shopUrl && shopUrl.startsWith("http")) {
        job.append(`Shop URL: ${shopUrl}`);
      } else if (prebuilt && compute === "ec2") {
        job.append(
          "Shop/console is this host — memstream-watch embeds S3 → live memory",
        );
      } else if (compute === "lambda") {
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
        status: "done",
        detail:
          prebuilt && compute === "ec2"
            ? "On-box memstream-watch (already running)"
            : compute === "lambda"
              ? `Lambda stack ${deployedStackName} ready`
              : shopUrl || `Stack ${deployedStackName} ready`,
      });
    } else {
      job.append(`${worker.label}: skipped (local mode)`);
      job.setStep("worker", {
        status: "skipped",
        detail: "Cloud worker off — use local worker / demo shop",
      });
    }

    const payload = {
      env_file: envPath,
      tables: result.tables,
      shop_url: shopUrl || "/shop",
      stack_name: options.deploy ? deployedStackName : null,
      run_id: runId,
    };

    if (runId) {
      await finishRun(runId, {
        status: "succeeded",
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
        status: "failed",
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
  if (!databaseUrl) {
    const session = readSessionEnv(sessionEnvPath(root));
    databaseUrl = session.DATABASE_URL?.trim() || null;
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
}): Promise<{ profile: Record<string, unknown>; tables_scanned: string[] }> {
  const tables = await fetchPublicTables(options.databaseUrl);
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
