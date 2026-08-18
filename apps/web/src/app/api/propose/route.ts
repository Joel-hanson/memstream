import { proposeFromDatabase } from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { resolveRequestDatabaseUrl } from "@/lib/resolve-database-url";

export const runtime = "nodejs";

/** Scan the connected app DB and return a draft profile (every public table). */

export async function POST(req: Request) {
  const denied = guardConsoleApi(req, { heavy: true });
  if (denied) return denied;

  const body = (await readJsonBody(req as never)) as {
    database_url?: string;
    connection_id?: string;
    application?: string;
    tables?: string[];
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
        includeTables: Array.isArray(body?.tables) ? body.tables : undefined,
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
