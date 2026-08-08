import {
  finishRun,
  getRun,
  memstreamDatabaseUrl,
  teardownAndDeleteRun,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const { id } = await context.params;
  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonError("MEMSTREAM_DATABASE_URL not configured", 503);
  }
  try {
    const run = await getRun(id, root);
    if (!run) return jsonError("Run not found", 404);
    return jsonOk({ run });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

/** Mark an in-flight run failed (e.g. enable orphaned after server restart). */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const { id } = await context.params;
  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonError("MEMSTREAM_DATABASE_URL not configured", 503);
  }
  const body = (await readJsonBody(req as never)) as {
    status?: string;
    error?: string;
  } | null;
  if (body?.status !== "failed") {
    return jsonError("Only status=failed is supported");
  }
  try {
    const run = await getRun(id, root);
    if (!run) return jsonError("Run not found", 404);
    if (run.status !== "running" && run.status !== "queued") {
      return jsonOk({ run });
    }
    const error =
      body.error?.trim() ||
      "Enable interrupted (console reloaded or server restarted). Retry Enable.";
    await finishRun(id, {
      status: "failed",
      log: [...(run.log || []), `ERROR: ${error}`],
      error,
      root,
    });
    const updated = await getRun(id, root);
    return jsonOk({ run: updated });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const { id } = await context.params;
  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonError("MEMSTREAM_DATABASE_URL not configured", 503);
  }
  try {
    const result = await teardownAndDeleteRun(id, root);
    if (!result) return jsonError("Run not found", 404);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
