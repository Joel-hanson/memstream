import { getLatestRun, memstreamDatabaseUrl } from "@memstream/engine";
import { jsonOk, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const root = webRepoRoot();
  const configured = Boolean(memstreamDatabaseUrl(root));
  try {
    const run = await getLatestRun(root);
    return jsonOk({
      configured,
      run,
    });
  } catch (err) {
    return jsonOk({
      configured,
      run: null,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
