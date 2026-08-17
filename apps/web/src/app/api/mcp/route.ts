import { handleMcpFetchRequest, resolveMcpRuntime } from "@memstream/mcp";
import { webRepoRoot } from "@/lib/api";
import { loadConnectDefaults } from "@/lib/env-defaults";
import { requireMcpAuth } from "@/lib/mcp-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Memstream MCP over Streamable HTTP.
 * Cursor: url + optional Authorization (Basic demo:demo or Bearer token).
 */
async function handle(req: Request): Promise<Response> {
  if (req.method !== "OPTIONS") {
    const denied = await requireMcpAuth(req);
    if (denied) return denied;
    const limited = checkRateLimit(req, true);
    if (limited) return limited;
  }

  const defaults = await loadConnectDefaults();
  const runtime = await resolveMcpRuntime({
    root: webRepoRoot(),
    databaseUrl: defaults.database_url || undefined,
    connectionId: defaults.connection_id || undefined,
    awsRegion: defaults.region || undefined,
  });
  return handleMcpFetchRequest(req, {
    embedder: runtime.embedder,
    store: runtime.store,
    databaseUrl: runtime.databaseUrl,
    connectionId: runtime.connectionId,
    root: webRepoRoot(),
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
      "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
    },
  });
}
