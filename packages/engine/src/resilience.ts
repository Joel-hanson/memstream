/** Retry + circuit breaker policies for AWS calls (Bedrock, S3). */

import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  handleAll,
  retry,
  wrap,
  type IPolicy,
} from "cockatiel";

const awsRetry = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 5_000 }),
});

const bedrockBreaker = circuitBreaker(handleAll, {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

const s3Breaker = circuitBreaker(handleAll, {
  halfOpenAfter: 15_000,
  breaker: new ConsecutiveBreaker(5),
});

/** Retry through circuit breaker — Bedrock InvokeModel. */
export const resilientBedrock: IPolicy = wrap(awsRetry, bedrockBreaker);

/** Retry through circuit breaker — S3 list/get. */
export const resilientS3: IPolicy = wrap(awsRetry, s3Breaker);

export async function withResilience<T>(
  policy: IPolicy,
  fn: () => Promise<T>,
): Promise<T> {
  return policy.execute(fn);
}
