/** Shared runtime wiring for Memstream MCP (stdio + HTTP). */

import {
  buildEmbedder,
  buildStore,
  getActiveConnection,
  resolveProfile,
  repoRoot,
  type Embedder,
  type MemoryStore,
} from "@memstream/engine";

export type McpRuntimeOptions = {
  profile?: string;
  embedder?: string;
  store?: string;
  databaseUrl?: string;
  connectionId?: string;
  awsRegion?: string;
  root?: string;
};

export type McpRuntime = {
  embedder: Embedder;
  store: MemoryStore;
  databaseUrl: string;
  connectionId: string;
};

export async function resolveMcpRuntime(
  options: McpRuntimeOptions = {},
): Promise<McpRuntime> {
  const root = options.root || repoRoot();
  let databaseUrl =
    options.databaseUrl?.trim() || process.env.DATABASE_URL?.trim() || "";
  let connectionId =
    options.connectionId?.trim() ||
    process.env.MEMSTREAM_CONNECTION_ID?.trim() ||
    "";

  try {
    const conn = await getActiveConnection(root);
    if (conn) {
      if (!databaseUrl) databaseUrl = conn.database_url;
      if (!connectionId) connectionId = conn.id;
    }
  } catch {
    /* platform DB optional when DATABASE_URL is set */
  }

  const profileRef =
    options.profile ||
    process.env.MEMORY_PROFILE ||
    "profiles/commerce.yaml";
  const profile = await resolveProfile(profileRef, root);
  const embedderKind =
    options.embedder || process.env.MEMSTREAM_EMBEDDER || "bedrock";
  const storeKind =
    options.store || process.env.MEMSTREAM_STORE || "cockroach";
  const region =
    options.awsRegion || process.env.AWS_REGION || "us-east-1";

  const embedder = buildEmbedder(embedderKind, profile, { region });
  const store = buildStore(storeKind, profile, {
    databaseUrl: databaseUrl || undefined,
    connectionId: connectionId || undefined,
  });

  return { embedder, store, databaseUrl, connectionId };
}
