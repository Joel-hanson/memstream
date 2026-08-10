/** In-memory sliding-window rate limiter for console APIs. */

type RateLimitOptions = {
  /** Window length in ms. */
  intervalMs: number;
  /** Max requests per token per window. */
  maxRequests: number;
  /** Max distinct tokens tracked. */
  maxTokens: number;
};

const DEFAULT: RateLimitOptions = {
  intervalMs: 60_000,
  maxRequests: 120,
  maxTokens: 500,
};

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly options: RateLimitOptions;

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.options = { ...DEFAULT, ...options };
  }

  check(token: string): { ok: boolean; remaining: number } {
    const now = Date.now();
    const windowStart = now - this.options.intervalMs;
    let stamps = (this.hits.get(token) || []).filter((t) => t > windowStart);

    if (stamps.length >= this.options.maxRequests) {
      this.hits.set(token, stamps);
      return { ok: false, remaining: 0 };
    }

    stamps = [...stamps, now];
    this.hits.set(token, stamps);

    if (this.hits.size > this.options.maxTokens) {
      const oldest = this.hits.keys().next().value;
      if (oldest != null) this.hits.delete(oldest);
    }

    return {
      ok: true,
      remaining: this.options.maxRequests - stamps.length,
    };
  }
}

const consoleLimiter = new RateLimiter();

/** Stricter limiter for Enable / propose (expensive). */
const heavyLimiter = new RateLimiter({
  intervalMs: 60_000,
  maxRequests: 20,
  maxTokens: 200,
});

function clientToken(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "local";
}

/**
 * Returns a 429 Response when over limit, else null.
 * @param heavy Use tighter budget for Enable / propose.
 */
export function checkRateLimit(
  req: Request,
  heavy = false,
): Response | null {
  const limiter = heavy ? heavyLimiter : consoleLimiter;
  const result = limiter.check(clientToken(req));
  if (result.ok) return null;
  return Response.json(
    { detail: "Rate limit exceeded — try again shortly" },
    {
      status: 429,
      headers: {
        "Retry-After": "60",
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}
