import { getPlatformState } from "@memstream/engine";
import { jsonError, jsonOk, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = guardConsoleApi(req, { poll: true });
  if (denied) return denied;

  const { id } = await context.params;
  try {
    const snapshot = await getPlatformState(webRepoRoot()).getJob(id);
    if (!snapshot) return jsonError("not found", 404);
    return jsonOk(snapshot);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
