/**
 * Curated Alex / Field Lamp backstory for demo RAG.
 * Seeded into agent_memory_chunks on demo-reset (and optionally after ask).
 */

import { BedrockEmbedder } from "./embed-bedrock.js";
import type { MemoryChunk } from "./models.js";
import type { Embedder, MemoryStore } from "./ports.js";
import { CockroachMemoryStore } from "./store-cockroach.js";

export type DemoHistorySeed = {
  tableName: string;
  ruleName: string;
  tags: string[];
  body: string;
  /** ISO-ish source time for ordering in citations. */
  sourceTs: string;
};

/** Past chapters that should exist before the live order-100 drama. */
export const DEMO_HISTORY_SEEDS: DemoHistorySeed[] = [
  {
    tableName: "orders",
    ruleName: "order_status_change",
    tags: ["order", "status", "shipping", "history"],
    body: `Order 90 (SKU-12 × 1) for customer c1
status pending → shipped at 2026-07-01T14:00:00Z.
Note: Shipped 1× SKU-12 for Alex`,
    sourceTs: "2026-07-01T14:00:00.000Z",
  },
  {
    tableName: "tickets",
    ruleName: "ticket_opened",
    tags: ["support", "ticket", "complaint", "history"],
    body: `Support ticket t-90 for order 90 is closed:
Alex reported late delivery on Field Lamp order 90; shipping credit issued and case closed. (2026-07-02T09:15:00Z)`,
    sourceTs: "2026-07-02T09:15:00.000Z",
  },
  {
    tableName: "case_notes",
    ruleName: "support_handoff",
    tags: ["support", "handoff", "conversation", "history"],
    body: `Case note n-90 (staff) for order 90 ticket t-90:
Follow-up with Alex on late Field Lamp order 90 — shipping credit issued; case closed. Resume only if a new ticket opens. (2026-07-02T10:00:00Z)`,
    sourceTs: "2026-07-02T10:00:00.000Z",
  },
];

export function formatCaseNoteChunk(input: {
  id: string;
  author: string;
  orderId: string | null;
  ticketId: string | null;
  body: string;
  timestamp?: string;
}): string {
  const ts = input.timestamp || new Date().toISOString();
  return `Case note ${input.id} (${input.author}) for order ${input.orderId ?? "none"} ticket ${input.ticketId ?? "none"}:
${input.body} (${ts})`;
}

export async function saveMemoryTexts(
  store: MemoryStore,
  embedder: Embedder,
  chunks: Array<{
    text: string;
    application?: string;
    tableName: string;
    ruleName: string;
    tags: string[];
    sourceTs: string;
    connectionId?: string | null;
  }>,
): Promise<number> {
  let saved = 0;
  for (const c of chunks) {
    const embedding = await embedder.embed(c.text);
    const chunk: MemoryChunk = {
      text: c.text,
      embedding,
      application: c.application || "acme-shop",
      tableName: c.tableName,
      ruleName: c.ruleName,
      tags: c.tags,
      sourceTs: c.sourceTs,
      connectionId: c.connectionId ?? null,
    };
    await store.save(chunk);
    saved += 1;
  }
  return saved;
}

/** Embed curated history into the application DB memory table. */
export async function seedDemoHistoryMemory(options: {
  databaseUrl: string;
  connectionId?: string | null;
  region?: string;
  application?: string;
}): Promise<number> {
  const embedder = new BedrockEmbedder({
    modelId:
      process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0",
    region: options.region || process.env.AWS_REGION || "us-east-1",
    dimensions: 1024,
  });
  const store = new CockroachMemoryStore({
    conninfo: options.databaseUrl,
    connectionId: options.connectionId ?? null,
  });
  return saveMemoryTexts(
    store,
    embedder,
    DEMO_HISTORY_SEEDS.map((s) => ({
      text: s.body,
      application: options.application || "acme-shop",
      tableName: s.tableName,
      ruleName: s.ruleName,
      tags: s.tags,
      sourceTs: s.sourceTs,
      connectionId: options.connectionId ?? null,
    })),
  );
}
