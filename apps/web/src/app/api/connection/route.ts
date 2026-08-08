import {
  getActiveConnection,
  listConnections,
  memstreamDatabaseUrl,
  upsertConnection,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";
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
  is_active: boolean;
  updated_at: string | null;
}) {
  return {
    id: connection.id,
    name: connection.name,
    has_url: Boolean(connection.database_url),
    database_url_hint: connection.database_url
      ? maskDatabaseUrl(connection.database_url)
      : "",
    database_label: connection.database_label,
    bucket: connection.bucket,
    region: connection.region,
    prefix: connection.prefix,
    is_active: connection.is_active,
    updated_at: connection.updated_at,
  };
}

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const root = webRepoRoot();
  const configured = Boolean(memstreamDatabaseUrl(root));
  if (!configured) {
    return jsonOk({
      configured: false,
      connection: null,
      connections: [],
      detail: "MEMSTREAM_DATABASE_URL not configured",
    });
  }
  try {
    const [connection, connections] = await Promise.all([
      getActiveConnection(root),
      listConnections(root),
    ]);
    return jsonOk({
      configured: true,
      connection: connection ? publicConnection(connection) : null,
      connections,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function PUT(req: Request) {
  const denied = requireConsoleAuth(req);
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
  };
  const databaseUrl = body.database_url?.trim() || "";
  if (!isUsableDatabaseUrl(databaseUrl)) {
    return jsonError(
      "Paste a real Cockroach DATABASE_URL (not a placeholder)",
    );
  }
  try {
    const connection = await upsertConnection({
      databaseUrl,
      bucket: body.bucket,
      region: body.region,
      prefix: body.prefix,
      name: body.name,
      id: body.id,
      root,
    });
    return jsonOk({ connection: publicConnection(connection) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
