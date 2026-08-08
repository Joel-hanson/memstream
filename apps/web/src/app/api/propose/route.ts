import { proposeFromDatabase } from "@memstream/engine";
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
    application?: string;
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
    return jsonOk(
      await proposeFromDatabase({
        databaseUrl: resolved.databaseUrl,
        application: body?.application?.trim() || "discovered-app",
      }),
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
      return jsonError(
        `Cannot reach database host (${raw}). Check Connect → DATABASE_URL.`,
        400,
      );
    }
    return jsonError(raw);
  }
}
