import { profileTables } from "@memstream/engine";
import { jsonError, jsonOk, webRepoRoot } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const path = new URL(req.url).searchParams.get("path") || "";
  try {
    return jsonOk(await profileTables(path, webRepoRoot()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return jsonError(message, status);
  }
}
