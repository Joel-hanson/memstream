import { saveProfileYaml } from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const body = (await readJsonBody(req as never)) as {
    id?: string;
    profile?: Record<string, unknown>;
  } | null;
  if (!body?.profile) return jsonError("profile required");
  try {
    return jsonOk(
      await saveProfileYaml({
        profile: body.profile,
        profileId: body.id || "discovered",
        root: webRepoRoot(),
      }),
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
