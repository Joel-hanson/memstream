import {
  memstreamDatabaseUrl,
  upsertConnection,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { isUsableDatabaseUrl, maskDatabaseUrl } from "@/lib/connect-url";

export const runtime = "nodejs";

function publicConnection(connection: {
  id: string;
  name: string;
  database_url: string;
  database_label: string | null;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  org_id?: string | null;
  is_active: boolean;
  updated_at: string | null;
}) {
  return {
    id: connection.id,
    workspace_id: connection.id,
    name: connection.name,
    has_url: Boolean(connection.database_url),
    database_url_hint: connection.database_url
      ? maskDatabaseUrl(connection.database_url)
      : "",
    database_label: connection.database_label,
    bucket: connection.bucket,
    region: connection.region,
    prefix: connection.prefix,
    org_id: connection.org_id,
    is_active: connection.is_active,
    updated_at: connection.updated_at,
  };
}

export async function PUT(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonError(
      "MEMSTREAM_DATABASE_URL required to store the application connection",
      503,
    );
  }
  const body = ((await readJsonBody(req as never)) || {}) as {
    database_url?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    name?: string;
    id?: string;
    org_id?: string;
  };
  const databaseUrl = body.database_url?.trim() || "";
  if (!isUsableDatabaseUrl(databaseUrl)) {
    return jsonError(
      "Paste a real Cockroach DATABASE_URL (not a placeholder)",
    );
  }
  const orgId =
    body.org_id?.trim() ||
    req.headers.get("x-memstream-org")?.trim() ||
    undefined;
  try {
    const connection = await upsertConnection({
      databaseUrl,
      bucket: body.bucket,
      region: body.region,
      prefix: body.prefix,
      name: body.name,
      id: body.id,
      orgId: orgId || null,
      root,
    });
    return jsonOk({ connection: publicConnection(connection) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
