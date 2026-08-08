import {
  getJobStore,
  getRunByJobId,
  jobSnapshotFromRun,
} from "@memstream/engine";
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
      run_id: live.runId,
    });
  }

  try {
    const run = await getRunByJobId(id, webRepoRoot());
    if (!run) return jsonError("not found", 404);
    return jsonOk(jobSnapshotFromRun(run));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
