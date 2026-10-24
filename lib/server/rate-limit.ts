import type { RateLimitClass } from '@/lib/server/proxy-allowlist';

/**
 * Per-IP fixed-window rate limiting for the hosted console proxy.
 *
 * CAVEAT — in-memory only: counters live in this server instance's memory. On a multi-instance or
 * serverless deployment (Vercel spins up several lambdas), each instance keeps its own counters, so
 * the effective limit is roughly `limit × instances`, and a cold start resets them. That is still a
 * meaningful brake on a single abusive client, but a hard global cap needs a shared store
 * (Redis / Upstash / Vercel KV) or an edge rate-limit rule in front of the deployment.
 */

export interface RateLimitPolicy {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitClass, RateLimitPolicy> = {
  // Generous enough for a page load fanning out to ~10 queries plus SSE reconnects.
  read: { limit: 300, windowMs: 60_000 },
  // The launch route bootstraps hosted agents (and possibly LLM calls): a handful per 10 minutes.
  launch: { limit: 5, windowMs: 10 * 60_000 }
};

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets; meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Hard cap on tracked keys so a flood of distinct (spoofed) IPs cannot grow memory unboundedly. */
const MAX_BUCKETS = 50_000;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, policy: RateLimitPolicy): RateLimitResult {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= MAX_BUCKETS) this.prune(now);
      bucket = { count: 0, resetAt: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= policy.limit) {
      return { allowed: false, limit: policy.limit, remaining: 0, retryAfterSeconds };
    }
    bucket.count += 1;
    return { allowed: true, limit: policy.limit, remaining: policy.limit - bucket.count, retryAfterSeconds };
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    // Still full of live buckets: drop the oldest insertions rather than refuse to track new clients.
    const overflow = this.buckets.size - MAX_BUCKETS + 1;
    if (overflow > 0) {
      let dropped = 0;
      for (const key of this.buckets.keys()) {
        if (dropped >= overflow) break;
        this.buckets.delete(key);
        dropped += 1;
      }
    }
  }
}

/** Process-wide limiter used by the proxy route. */
export const proxyRateLimiter = new FixedWindowRateLimiter();

/**
 * Best-effort client IP from the standard forwarded headers.
 *
 * - `x-real-ip` first: Vercel (the production host) sets it to the connecting client and does not
 *   let the client override it.
 * - Otherwise the RIGHTMOST `x-forwarded-for` entry: each proxy appends the address it saw, so the
 *   last entry is the one written by our own edge. The leftmost entry is client-controlled and
 *   trivially spoofable, which would let one client mint unlimited quotas. (Vercel overwrites
 *   `x-forwarded-for` with a single client address, so rightmost is correct there too.)
 * - Falls back to a shared `unknown` bucket — fail closed into one quota rather than no quota.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  return 'unknown';
}
