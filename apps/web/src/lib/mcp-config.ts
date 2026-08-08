import { join } from "node:path";
import { webRepoRoot } from "@/lib/api";
import { loadConnectDefaults, parseEnvFile } from "@/lib/env-defaults";

export type MemstreamMcpHttpConfig = {
  mcpServers: {
    memstream: {
      url: string;
    };
  };
};

/**
 * Prefer HTTP MCP served by the Next app (`/api/mcp`) so Cursor only needs a URL.
 * Secrets stay on the server (Connect URL + Bedrock). Never embed DATABASE_URL
 * in browser-facing JSON.
 */
export async function buildMemstreamMcpConfig(
  root = webRepoRoot(),
  options: { transport?: "http" | "stdio"; publicBaseUrl?: string } = {},
): Promise<{
  config: MemstreamMcpHttpConfig;
  json: string;
  ready: boolean;
  transport: "http";
  server: "@memstream/mcp";
  tool: "search_memory";
  detail?: string;
}> {
  const defaults = await loadConnectDefaults(root);
  const fileEnv = parseEnvFile(join(root, ".env"));
  const envVal = (key: string, fallback = "") =>
    process.env[key]?.trim() || fileEnv[key]?.trim() || fallback;

  const ready = defaults.has_url;

  const base =
    options.publicBaseUrl?.replace(/\/$/, "") ||
    envVal("MEMSTREAM_MCP_PUBLIC_URL") ||
    "http://127.0.0.1:3000";
  const url = `${base}/api/mcp`;
  const config: MemstreamMcpHttpConfig = {
    mcpServers: {
      memstream: { url },
    },
  };
  return {
    config,
    json: JSON.stringify(config, null, 2),
    ready,
    transport: "http",
    server: "@memstream/mcp",
    tool: "search_memory",
    detail: ready
      ? `HTTP Memstream MCP at ${url} (served by make web). Paste into Cursor Settings → MCP.`
      : "Connect a Cockroach DATABASE_URL first, keep make web running, then paste this URL into Cursor.",
  };
}
