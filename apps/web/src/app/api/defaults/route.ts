import { jsonOk } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";
import {
  loadConnectDefaults,
  publicConnectDefaults,
} from "@/lib/env-defaults";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;
  return jsonOk(publicConnectDefaults(await loadConnectDefaults()));
}
