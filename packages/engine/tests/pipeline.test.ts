import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FakeEmbedder,
  FakeEventSource,
  InMemoryMemoryStore,
  Indexer,
  loadProfile,
  type ChangeEvent,
  type MemoryChunk,
} from "../src/index.js";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
);

describe("pipeline", () => {
  it("indexes matching events only", async () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const events: ChangeEvent[] = [
      {
        table: "orders",
        key: { id: "100" },
        before: { id: "100", customer_id: "c1", status: "pending" },
        after: { id: "100", customer_id: "c1", status: "shipped" },
        timestamp: "2026-08-07T10:00:00Z",
      },
      {
        table: "orders",
        key: { id: "100" },
        before: { id: "100", customer_id: "c1", status: "shipped" },
        after: { id: "100", customer_id: "c1", status: "shipped", note: "x" },
        timestamp: "2026-08-07T10:00:30Z",
      },
      {
        table: "stock",
        key: { sku: "SKU-12" },
        before: { sku: "SKU-12", quantity: 40, warehouse_id: "east" },
        after: { sku: "SKU-12", quantity: 5, warehouse_id: "east" },
        timestamp: "2026-08-07T10:01:00Z",
      },
    ];
    const store = new InMemoryMemoryStore();
    const indexer = new Indexer(
      profile,
      new FakeEventSource(events),
      new FakeEmbedder(8),
      store,
    );

    const result = await indexer.runOnce();
    expect(result.eventsSeen).toBe(3);
    expect(result.chunksWritten).toBe(2);
    expect(store.chunks).toHaveLength(2);

    const texts = store.chunks.map((c) => c.text);
    expect(texts.some((t) => t.includes("pending → shipped"))).toBe(true);
    expect(texts.some((t) => t.includes("40 → 5"))).toBe(true);
    expect(store.chunks.every((c) => c.embedding.length === 8)).toBe(true);
    expect(store.chunks[0]!.application).toBe("acme-shop");
  });

  it("is idempotent on empty source", async () => {
    const profile = loadProfile(join(FIXTURES, "commerce.yaml"));
    const result = await new Indexer(
      profile,
      new FakeEventSource([]),
      new FakeEmbedder(8),
      new InMemoryMemoryStore(),
    ).runOnce();
    expect(result.eventsSeen).toBe(0);
    expect(result.chunksWritten).toBe(0);
  });

  it("supports semantic search over stored chunks", () => {
    const store = new InMemoryMemoryStore();
    const embedder = new FakeEmbedder(8);
    const textA = "Order 100 status pending → shipped";
    const textB = "SKU SKU-12 stock 40 → 5";
    const chunkA: MemoryChunk = {
      text: textA,
      embedding: embedder.embed(textA),
      application: "acme-shop",
      tableName: "orders",
      ruleName: "order_status_change",
      tags: ["order"],
      sourceTs: "t1",
    };
    const chunkB: MemoryChunk = {
      text: textB,
      embedding: embedder.embed(textB),
      application: "acme-shop",
      tableName: "stock",
      ruleName: "stock_drop",
      tags: ["inventory"],
      sourceTs: "t2",
    };
    store.save(chunkA);
    store.save(chunkB);

    const hits = store.search(embedder.embed("what happened to order shipping"), 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain("Order 100");
  });
});
