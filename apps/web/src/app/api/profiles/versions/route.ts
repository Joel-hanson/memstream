import {
  listProfileVersions,
  restoreProfileVersion,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim() || "";
  if (!id) return jsonError("id required", 400);
  try {
    const versions = await listProfileVersions(id, webRepoRoot());
    return jsonOk({ versions });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}

export async function POST(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const body = (await readJsonBody(req as never)) as {
    id?: string;
    version?: number;
  } | null;
  if (!body?.id?.trim()) return jsonError("id required", 400);
  if (body.version == null) return jsonError("version required", 400);
  try {
    const restored = await restoreProfileVersion({
      profileId: body.id.trim(),
      version: Number(body.version),
      root: webRepoRoot(),
    });
    return jsonOk(restored);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
