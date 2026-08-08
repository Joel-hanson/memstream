/** Memstream MCP server: search_memory (stdio). */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  searchMemories,
  type Embedder,
  type MemoryStore,
} from "@memstream/engine";
import { z } from "zod";

export function createMcpServer(embedder: Embedder, store: MemoryStore): McpServer {
  const server = new McpServer({
    name: "memstream",
    version: "0.1.0",
  });

  server.tool(
    "search_memory",
    "Embed the query and return the nearest Memstream memory chunks for this connection. Use for narrative / similarity questions, then verify exact state with Cockroach SQL.",
    {
      query: z.string().describe("Natural-language memory query"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe("Number of chunks to return"),
    },
    async ({ query, top_k }) => {
      const hits = await searchMemories(embedder, store, query, top_k ?? 5);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(hits, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

export async function runStdio(
  embedder: Embedder,
  store: MemoryStore,
): Promise<void> {
  const server = createMcpServer(embedder, store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
