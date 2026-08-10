/** Graceful shutdown helpers for long-running CLI workers. */

import { closePools } from "./db.js";

export type ShutdownController = {
  /** Returns false after SIGINT/SIGTERM. */
  shouldContinue: () => boolean;
  /** Register once; subsequent calls are no-ops. */
  install: () => void;
};

export function createShutdownController(
  options: { onSignal?: (signal: string) => void } = {},
): ShutdownController {
  let running = true;
  let installed = false;

  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    options.onSignal?.(signal);
  };

  return {
    shouldContinue: () => running,
    install: () => {
      if (installed) return;
      installed = true;
      const handler = (signal: string) => {
        stop(signal);
        void closePools().catch(() => undefined);
      };
      process.once("SIGINT", () => handler("SIGINT"));
      process.once("SIGTERM", () => handler("SIGTERM"));
    },
  };
}
