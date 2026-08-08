import { getJobStore, runEnablePipeline } from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";
import { resolveRequestDatabaseUrl } from "@/lib/resolve-database-url";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const body = (await readJsonBody(req as never)) as {
    database_url?: string;
    connection_id?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    profile_path?: string;
    tables?: string;
    deploy?: boolean;
    stack_name?: string;
    embed_model?: string;
    worker_compute?: string;
  } | null;

  const root = webRepoRoot();
  const resolved = await resolveRequestDatabaseUrl({
    connectionId: body?.connection_id,
    databaseUrl: body?.database_url,
    root,
    blockPrivateHosts: false,
  });
  if (!resolved.databaseUrl) {
    return jsonError(resolved.error || "database_url required");
  }

  const bucket = body?.bucket?.trim();
  if (!bucket || bucket.length < 3) return jsonError("bucket required");

  const store = getJobStore();
  const job = store.create("enable");

  store.runInBackground(job, async (j) =>
    runEnablePipeline(j, {
      databaseUrl: resolved.databaseUrl,
      bucket,
      prefix: body?.prefix?.trim() || "cdc/",
      region: body?.region?.trim() || "us-east-1",
      profilePath: body?.profile_path?.trim() || "profiles/commerce.yaml",
      tables: body?.tables?.trim() || "orders,stock",
      stackName: body?.stack_name?.trim() || "memstream-demo",
      deploy: Boolean(body?.deploy),
      embedModel:
        body?.embed_model?.trim() || "amazon.titan-embed-text-v2:0",
      workerCompute: body?.worker_compute?.trim(),
      root,
    }),
  );

  return jsonOk({ job_id: job.id });
}
