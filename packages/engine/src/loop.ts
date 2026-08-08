/** Indexer poll loop (one-shot or --watch). */

import { Indexer, type RunResult } from "./pipeline.js";

export interface PollLoopOptions {
  watch?: boolean;
  interval?: number;
  label?: string;
  sleepFn?: (seconds: number) => Promise<void>;
  shouldContinue?: () => boolean;
  log?: (line: string) => void;
}

export async function runPollLoop(
  indexer: Indexer,
  options: PollLoopOptions = {},
): Promise<RunResult> {
  const watch = options.watch ?? false;
  const interval = options.interval ?? 5;
  const label = options.label ?? "";
  const sleepFn =
    options.sleepFn ??
    ((seconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
  const log = options.log ?? ((line: string) => console.error(line));

  let totalEvents = 0;
  let totalChunks = 0;
  while (true) {
    const result = await indexer.runOnce();
    totalEvents += result.eventsSeen;
    totalChunks += result.chunksWritten;
    log(
      `events_seen=${result.eventsSeen} chunks_written=${result.chunksWritten} ${label}`.trim(),
    );
    if (!watch) break;
    if (options.shouldContinue && !options.shouldContinue()) break;
    await sleepFn(interval);
  }
  return { eventsSeen: totalEvents, chunksWritten: totalChunks };
}
