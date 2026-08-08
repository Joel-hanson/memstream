import { getJobStore, getRunByJobId } from "@memstream/engine";
import { jsonError, jsonOk, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const { id } = await context.params;
  const live = getJobStore().get(id);
  if (live) {
    return jsonOk({
      id: live.id,
      kind: live.kind,
      status: live.status,
      log: live.log,
      steps: live.steps,
      result: live.result,
      error: live.error,
      live: true,
    });
  }

  try {
    const run = await getRunByJobId(id, webRepoRoot());
    if (!run) return jsonError("not found", 404);
    return jsonOk({
      id,
      kind: "enable",
      status: run.status,
      log: run.log || [],
      steps: [],
      result: {
        ...(run.shop_url ? { shop_url: run.shop_url } : {}),
        run_id: run.id,
      },
      error: run.error,
      live: false,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
