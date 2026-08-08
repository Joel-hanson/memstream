import { listProfiles } from "@memstream/engine";
import { jsonOk, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;
  return jsonOk({ profiles: await listProfiles(webRepoRoot()) });
}
