import { jsonOk } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";
import { buildMemstreamMcpConfig } from "@/lib/mcp-config";

export const runtime = "nodejs";

/** Cursor MCP snippet — HTTP URL only (no secrets in JSON). */
export async function GET(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const transport =
    url.searchParams.get("transport") === "stdio" ? "stdio" : "http";
  // Never return stdio env with DATABASE_URL to the browser.
  const safeTransport = transport === "stdio" ? "http" : "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const publicBaseUrl = host ? `${proto}://${host}` : undefined;
  const result = await buildMemstreamMcpConfig(undefined, {
    transport: safeTransport,
    publicBaseUrl,
  });
  return jsonOk({
    ...result,
    detail:
      transport === "stdio"
        ? "Stdio MCP config is not served over HTTP (would embed secrets). Use the HTTP URL below with make web."
        : result.detail,
  });
}
