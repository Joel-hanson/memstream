import { describe, expect, it } from "vitest";
import { withResilience } from "../src/resilience.js";
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  handleAll,
  retry,
} from "cockatiel";

describe("withResilience", () => {
  it("retries transient failures then succeeds", async () => {
    const policy = retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 1, maxDelay: 5 }),
    });
    let attempts = 0;
    const result = await withResilience(policy, async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("opens circuit after consecutive failures", async () => {
    const policy = circuitBreaker(handleAll, {
      halfOpenAfter: 60_000,
      breaker: new ConsecutiveBreaker(2),
    });
    await expect(
      withResilience(policy, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow(/down/);
    await expect(
      withResilience(policy, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow(/down/);
    await expect(
      withResilience(policy, async () => "should not run"),
    ).rejects.toBeInstanceOf(BrokenCircuitError);
  });
});
