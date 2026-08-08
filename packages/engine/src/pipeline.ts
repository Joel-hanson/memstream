/** Indexer: events → rules → chunks → embeddings → store. */

import type { MemoryChunk } from "./models.js";
import type { Embedder, EventSource, MemoryStore } from "./ports.js";
import type { Profile } from "./profile.js";
import { matchRules } from "./rules.js";
import { renderChunk } from "./template.js";

export interface RunResult {
  eventsSeen: number;
  chunksWritten: number;
}

export class Indexer {
  constructor(
    readonly profile: Profile,
    readonly source: EventSource,
    readonly embedder: Embedder,
    readonly store: MemoryStore,
    readonly connectionId: string | null = null,
  ) {}

  async runOnce(): Promise<RunResult> {
    const events = await this.source.poll();
    let written = 0;
    try {
      for (const event of events) {
        for (const rule of matchRules(this.profile, event)) {
          const text = renderChunk(rule.chunkTemplate, event);
          const embedding = await this.embedder.embed(text);
          const chunk: MemoryChunk = {
            text,
            embedding,
            application: this.profile.application,
            tableName: event.table,
            ruleName: rule.name,
            tags: [...rule.tags],
            sourceTs: event.timestamp,
            connectionId: this.connectionId,
          };
          await this.store.save(chunk);
          written += 1;
        }
      }
    } catch (err) {
      throw err;
    }
    if (typeof this.source.ack === "function") {
      await this.source.ack();
    }
    return { eventsSeen: events.length, chunksWritten: written };
  }
}
