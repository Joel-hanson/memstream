import { listRuns, memstreamDatabaseUrl } from "@memstream/engine";
import { jsonOk, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const root = webRepoRoot();
  const configured = Boolean(memstreamDatabaseUrl(root));
  try {
    const runs = configured ? await listRuns(20, root) : [];
    return jsonOk({ configured, runs });
  } catch (err) {
    return jsonOk({
      configured,
      runs: [],
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
