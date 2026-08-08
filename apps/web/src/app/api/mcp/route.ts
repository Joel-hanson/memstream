import { handleMcpFetchRequest, resolveMcpRuntime } from "@memstream/mcp";
import { webRepoRoot } from "@/lib/api";
import { loadConnectDefaults } from "@/lib/env-defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Memstream MCP over Streamable HTTP.
 * Cursor: { "mcpServers": { "memstream": { "url": "http://127.0.0.1:3000/api/mcp" } } }
 */
async function handle(req: Request): Promise<Response> {
  const defaults = await loadConnectDefaults();
  const runtime = await resolveMcpRuntime({
    root: webRepoRoot(),
    databaseUrl: defaults.database_url || undefined,
    connectionId: defaults.connection_id || undefined,
    awsRegion: defaults.region || undefined,
  });
  return handleMcpFetchRequest(req, runtime.embedder, runtime.store);
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
