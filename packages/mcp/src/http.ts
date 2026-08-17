/** Streamable HTTP transport for Memstream MCP (Cursor remote URL). */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Embedder, MemoryStore } from "@memstream/engine";
import { createMcpServer, type McpServerContext } from "./server.js";

function toContext(
  embedderOrCtx: Embedder | McpServerContext,
  store?: MemoryStore,
): McpServerContext {
  if (store) {
    return {
      embedder: embedderOrCtx as Embedder,
      store,
    };
  }
  return embedderOrCtx as McpServerContext;
}

function parseList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hostAllowed(hostHeader: string | null): boolean {
  const allowed = parseList(process.env.MEMSTREAM_MCP_ALLOWED_HOSTS);
  if (!allowed.length) {
    const h = (hostHeader || "").toLowerCase().split(":")[0] || "";
    return (
      !h ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h === "::1"
    );
  }
  const host = (hostHeader || "").toLowerCase();
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.endsWith(":*")) {
      const base = p.slice(0, -2);
      return host === base || host.startsWith(`${base}:`);
    }
    return host === p;
  });
}

function originAllowed(origin: string | null): boolean | "any" {
  const allowed = parseList(process.env.MEMSTREAM_MCP_ALLOWED_ORIGINS);
  if (!allowed.length) return "any";
  if (!origin) return false;
  return allowed.includes(origin);
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const allow = originAllowed(origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  };
  if (allow === "any") {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (allow && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rejectHost(request: Request): Response | null {
  if (hostAllowed(request.headers.get("host"))) return null;
  return new Response(JSON.stringify({ detail: "Host not allowed" }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

/**
 * Handle one MCP HTTP request (Web Standards) — for Next.js Route Handlers.
 * Stateless: one server + transport per request.
 *
 * Do not apply the standalone DNS-rebinding Host allowlist here. Next listens on
 * localhost behind Caddy; the public Host is the sslip.io name Cursor sends.
 */
export async function handleMcpFetchRequest(
  request: Request,
  embedderOrCtx: Embedder | McpServerContext,
  store?: MemoryStore,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const origin = request.headers.get("origin");
  if (origin && originAllowed(origin) === false) {
    return new Response(JSON.stringify({ detail: "Origin not allowed" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(request),
      },
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(toContext(embedderOrCtx, store));
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    return withCors(request, response);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/**
 * Standalone HTTP listener for `make mcp` / MEMSTREAM_MCP_TRANSPORT=http.
 */
export async function runHttp(
  embedderOrCtx: Embedder | McpServerContext,
  store?: MemoryStore,
  options: { host?: string; port?: number } = {},
): Promise<void> {
  const ctx = toContext(embedderOrCtx, store);
  const host = options.host || process.env.MEMSTREAM_MCP_HOST || "127.0.0.1";
  const port = Number(
    options.port || process.env.MEMSTREAM_MCP_PORT || 8765,
  );

  const httpServer = createServer(async (req, res) => {
    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headerMap[k] = v;
      else if (Array.isArray(v) && v[0]) headerMap[k] = v[0];
    }
    const fakeReq = new Request(
      `http://${req.headers.host || "localhost"}${req.url || "/"}`,
      {
        method: req.method,
        headers: headerMap,
      },
    );
    const cors = corsHeaders(fakeReq);
    for (const [k, v] of Object.entries(cors)) {
      res.setHeader(k, v);
    }

    if (!hostAllowed(req.headers.host || null)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Host not allowed" }));
      return;
    }

    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      res.writeHead(404).end("Not found");
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          name: "memstream",
          transport: "streamable-http",
          mcp: "/mcp",
          tools: [
            "get_connection",
            "list_watchable_tables",
            "list_memory_profiles",
            "propose_memory_profile",
            "save_memory_profile",
            "search_memory",
          ],
          prompts: ["make_memory_profile"],
          resources: [
            "memstream://profile-guide",
            "memstream://schema",
            "memstream://profiles/{id}",
          ],
        }),
      );
      return;
    }

    try {
      await handleNodeMcpRequest(req, res, ctx);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.on("error", reject);
  });

  const base = `http://${host}:${port}`;
  console.error(`Memstream MCP (HTTP) listening on ${base}/mcp`);
  console.error(
    `Cursor config: { "mcpServers": { "memstream": { "url": "${base}/mcp" } } }`,
  );
}

async function handleNodeMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: McpServerContext,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(ctx);
  await server.connect(transport);

  const close = () => {
    void transport.close();
    void server.close();
  };
  res.on("close", close);

  let parsedBody: unknown;
  if (req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    parsedBody = raw ? JSON.parse(raw) : undefined;
  }

  await transport.handleRequest(req, res, parsedBody);
}
