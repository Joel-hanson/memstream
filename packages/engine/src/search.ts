/** Semantic memory search: embed query → nearest chunks. */

import type { MemoryChunk } from "./models.js";
import type { Embedder, MemoryStore } from "./ports.js";

export interface MemoryHit {
  id: string | null | undefined;
  application: string;
  connection_id: string | null;
  table_name: string;
  rule_name: string;
  tags: string[];
  body: string;
  source_ts: string;
}

export function chunkToHit(chunk: MemoryChunk): MemoryHit {
  return {
    id: chunk.id,
    application: chunk.application,
    connection_id: chunk.connectionId ?? null,
    table_name: chunk.tableName,
    rule_name: chunk.ruleName,
    tags: [...chunk.tags],
    body: chunk.text,
    source_ts: chunk.sourceTs,
  };
}

export async function searchMemories(
  embedder: Embedder,
  store: MemoryStore,
  query: string,
  topK = 5,
): Promise<MemoryHit[]> {
  const text = (query || "").trim();
  if (!text) throw new Error("query must not be empty");
  if (topK < 1) throw new Error("top_k must be >= 1");
  if (topK > 50) throw new Error("top_k must be <= 50");

  const vector = await embedder.embed(text);
  const chunks = await store.search(vector, topK);
  return chunks.map(chunkToHit);
}
