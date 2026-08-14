import { buildPipelineStatus } from "@memstream/engine";
import { jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { resolveRequestDatabaseUrl } from "@/lib/resolve-database-url";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = guardConsoleApi(req, { poll: true });
  if (denied) return denied;

  const body = ((await readJsonBody(req as never)) || {}) as {
    database_url?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    profile_path?: string;
    tables?: string;
    stack_name?: string;
    connection_id?: string;
  };
  const root = webRepoRoot();
  const resolved = await resolveRequestDatabaseUrl({
    connectionId: body.connection_id,
    databaseUrl: body.database_url,
    root,
    blockPrivateHosts: false,
  });
  const status = await buildPipelineStatus({
    databaseUrl: resolved.databaseUrl || "",
    bucket: body.bucket?.trim() || "",
    region: body.region?.trim() || "us-east-1",
    prefix: body.prefix?.trim() || "cdc/",
    profilePath: body.profile_path?.trim() || "",
    tables: body.tables?.trim() || "",
    stackName: body.stack_name?.trim() || "memstream-demo",
    connectionId: body.connection_id?.trim() || null,
    root,
  });
  return jsonOk(status);
}
