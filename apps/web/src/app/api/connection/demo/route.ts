import {
  ensureDemoConnection,
  memstreamDatabaseUrl,
  resolveDemoApplicationDatabaseUrl,
} from "@memstream/engine";
import { jsonError, jsonOk, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { maskDatabaseUrl } from "@/lib/connect-url";

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
    is_demo: true,
  };
}

/** Activate the shared demo application workspace (skip Connect paste). */
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
  if (!resolveDemoApplicationDatabaseUrl(root)) {
    return jsonError(
      "Demo application database not configured (set DEMO_APPLICATION_DATABASE_URL or use a MEMSTREAM_DATABASE_URL ending in /memstream)",
      503,
    );
  }

  const orgId = req.headers.get("x-memstream-org")?.trim() || null;
  try {
    const connection = await ensureDemoConnection({
      root,
      orgId,
    });
    return jsonOk({ connection: publicConnection(connection) });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
