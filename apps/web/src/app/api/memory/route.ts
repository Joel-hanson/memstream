import { listRecentChunks } from "@memstream/engine";
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
    limit?: number;
  } | null;

  const resolved = await resolveRequestDatabaseUrl({
    connectionId: body?.connection_id,
    databaseUrl: body?.database_url,
    root: webRepoRoot(),
    blockPrivateHosts: true,
  });
  if (!resolved.databaseUrl) {
    return jsonError(resolved.error || "database_url or connection_id required");
  }
  try {
    const chunks = await listRecentChunks(
      resolved.databaseUrl,
      Math.min(Math.max(body?.limit ?? 10, 1), 50),
    );
    return jsonOk({ chunks });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
