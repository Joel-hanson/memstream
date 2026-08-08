/** In-memory fakes for local TDD without AWS or Cockroach. */

import { createHash } from "node:crypto";
import type { ChangeEvent, MemoryChunk } from "./models.js";

export class FakeEventSource {
  private events: ChangeEvent[];

  constructor(events: ChangeEvent[] = []) {
    this.events = [...events];
  }

  poll(): ChangeEvent[] {
    const batch = this.events;
    this.events = [];
    return batch;
  }

  push(event: ChangeEvent): void {
    this.events.push(event);
  }
}

export class FakeEmbedder {
  readonly dimensions: number;

  constructor(dimensions = 8) {
    if (dimensions < 1) throw new Error("dimensions must be >= 1");
    this.dimensions = dimensions;
  }

  embed(text: string): number[] {
    const values = Array.from({ length: this.dimensions }, () => 0);
    let tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) tokens = ["empty"];
    for (const token of tokens) {
      const digest = createHash("sha256").update(token, "utf8").digest();
      for (let i = 0; i < this.dimensions; i++) {
        const byte = digest[i % digest.length]!;
        values[i]! += (byte / 255) * 2 - 1;
      }
    }
    return l2Normalize(values);
  }
}

export class InMemoryMemoryStore {
  chunks: MemoryChunk[] = [];
  readonly connectionId: string | null;

  constructor(options: { connectionId?: string | null } = {}) {
    this.connectionId = options.connectionId?.trim() || null;
  }

  save(chunk: MemoryChunk): void {
    const connectionId = chunk.connectionId ?? this.connectionId;
    this.chunks.push({
      ...chunk,
      connectionId: connectionId ?? chunk.connectionId ?? null,
    });
  }

  search(queryEmbedding: number[], topK = 5): MemoryChunk[] {
    const scoped = this.connectionId;
    const scored = this.chunks
      .filter((c) => c.embedding.length > 0)
      .filter((c) => {
        if (!scoped) return true;
        return (
          c.connectionId === scoped ||
          c.connectionId == null ||
          c.connectionId === ""
        );
      })
      .map((c) => ({ score: cosine(queryEmbedding, c.embedding), chunk: c }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.chunk);
  }
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return values;
  return values.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}
