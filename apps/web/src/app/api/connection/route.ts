import {
  activateConnection,
  listConnections,
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
  database_url?: string;
  database_label: string | null;
  bucket: string | null;
  region: string | null;
  prefix: string | null;
  org_id?: string | null;
  is_active: boolean;
  updated_at: string | null;
}) {
  const hasUrl = Boolean(connection.database_url);
  const hint = connection.database_url
    ? maskDatabaseUrl(connection.database_url)
    : connection.database_label
      ? `…/${connection.database_label}`
      : "";
  return {
    id: connection.id,
    workspace_id: connection.id,
    name: connection.name,
    has_url: hasUrl || Boolean(connection.database_label),
    database_url_hint: hint,
    database_label: connection.database_label,
    bucket: connection.bucket,
    region: connection.region,
    prefix: connection.prefix,
    org_id: connection.org_id,
    is_active: connection.is_active,
    updated_at: connection.updated_at,
  };
}

function orgIdFrom(req: Request, bodyOrg?: string): string | null {
  return (
    bodyOrg?.trim() ||
    req.headers.get("x-memstream-org")?.trim() ||
    null
  );
}

/** List saved workspaces (no secrets). */
export async function GET(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonOk({ connections: [], configured: false });
  }
  const orgId = orgIdFrom(req);
  try {
    const connections = await listConnections(root, orgId);
    return jsonOk({
      configured: true,
      connections: connections.map((c) => publicConnection(c)),
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

/** Activate an existing workspace (reuse without re-entering Cloud/URL secrets). */
export async function POST(req: Request) {
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
    id?: string;
    org_id?: string;
  };
  const id = body.id?.trim() || "";
  if (!id) return jsonError("id required");
  const orgId = orgIdFrom(req, body.org_id);
  try {
    const connection = await activateConnection(id, root, orgId);
    return jsonOk({ connection: publicConnection(connection) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 500;
    return jsonError(message, status);
  }
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
  const orgId = orgIdFrom(req, body.org_id);
  try {
    const connection = await upsertConnection({
      databaseUrl,
      bucket: body.bucket,
      region: body.region,
      prefix: body.prefix,
      name: body.name,
      id: body.id,
      orgId,
      root,
    });
    return jsonOk({ connection: publicConnection(connection) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
