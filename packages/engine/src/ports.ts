/** Ports for event sources, embedders, and memory stores. */

import type { ChangeEvent, MemoryChunk } from "./models.js";

export interface EventSource {
  poll(): Promise<ChangeEvent[]> | ChangeEvent[];
  ack?(): Promise<void> | void;
}

export interface Embedder {
  embed(text: string): Promise<number[]> | number[];
}

export interface MemoryStore {
  save(chunk: MemoryChunk): Promise<void> | void;
  search(
    queryEmbedding: number[],
    topK?: number,
  ): Promise<MemoryChunk[]> | MemoryChunk[];
}
