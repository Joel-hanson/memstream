import { join } from "node:path";
import { webRepoRoot } from "@/lib/api";
import { loadConnectDefaults, parseEnvFile } from "@/lib/env-defaults";
import {
  mcpAuthRequired,
  mcpCursorAuthHeader,
} from "@/lib/mcp-auth";

export type MemstreamMcpHttpConfig = {
  mcpServers: {
    memstream: {
      url: string;
      headers?: Record<string, string>;
    };
  };
};

/**
 * Prefer HTTP MCP served by the Next app (`/api/mcp`) so Cursor only needs a URL.
 * Secrets stay on the server (Connect URL + Bedrock). Never embed DATABASE_URL
 * in browser-facing JSON. When console auth is on, include Authorization
 * (Basic demo/demo or Bearer token) for Cursor.
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
  tool: string;
  auth?: "none" | "basic" | "bearer";
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

  const authHeader = mcpAuthRequired(root) ? mcpCursorAuthHeader(root) : null;
  const memstream: MemstreamMcpHttpConfig["mcpServers"]["memstream"] = { url };
  let auth: "none" | "basic" | "bearer" = "none";
  if (authHeader) {
    memstream.headers = { Authorization: authHeader };
    auth = authHeader.startsWith("Bearer ") ? "bearer" : "basic";
  }

  const config: MemstreamMcpHttpConfig = {
    mcpServers: { memstream },
  };

  const authHint =
    auth === "bearer"
      ? " Includes Bearer MEMSTREAM_MCP_TOKEN (or console token)."
      : auth === "basic"
        ? " Includes Basic auth (same demo/demo as /login)."
        : "";

  return {
    config,
    json: JSON.stringify(config, null, 2),
    ready,
    transport: "http",
    server: "@memstream/mcp",
    tool: "search_memory",
    auth,
    detail: ready
      ? `HTTP Memstream MCP at ${url}.${authHint} Resources: profile-guide, schema, profiles/{id}. Prompt: make_memory_profile. Paste into Cursor Settings → MCP.`
      : "Connect a Cockroach DATABASE_URL first, keep make web running, then paste this URL into Cursor.",
  };
}
