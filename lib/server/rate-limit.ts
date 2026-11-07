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
  launch: { limit: 5, windowMs: 10 * 60_000 },
  // What-if replays a whole session in the runtime per call: same cap as launch, its own bucket.
  whatIf: { limit: 5, windowMs: 10 * 60_000 }
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
 * Best-effort client IP from the trusted forwarded headers.
 *
 * - `x-real-ip` first: Vercel (the production host) sets it to the connecting client and does not
 *   let the client override it.
 * - Then the FIRST hop of `x-vercel-forwarded-for`: also written by Vercel's edge (a client-sent
 *   value is overwritten), and its first entry is the client Vercel saw.
 * - Otherwise the RIGHTMOST `x-forwarded-for` entry (non-Vercel hosts, local dev): each proxy appends
 *   the address it saw, so the last entry is the one written by our own edge. The leftmost entry is
 *   client-controlled and trivially spoofable, which would let one client mint unlimited quotas.
 * - Falls back to a shared `unknown` bucket — fail closed into one quota rather than no quota.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const vercelFirstHop = firstEntry(headers.get('x-vercel-forwarded-for'));
  if (vercelFirstHop) return vercelFirstHop;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = splitEntries(forwarded);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  return 'unknown';
}

function splitEntries(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function firstEntry(value: string | null): string | undefined {
  return value ? splitEntries(value)[0] : undefined;
}

/**
 * Header the proxy sets on every upstream call to the end user's IP (from {@link getClientIp}), so
 * macp-playground and macp-control-plane can rate-limit per visitor behind the console's shared
 * server-held key. A client-supplied value is always stripped before forwarding.
 */
export const CLIENT_IP_HEADER = 'x-macp-client-ip';

/** Plausible IPv4/IPv6 literal (incl. IPv4-mapped IPv6). Anything else is not forwarded. */
const IP_LITERAL = /^[0-9A-Fa-f:.]{2,45}$/;

/** The value to send upstream in {@link CLIENT_IP_HEADER}, or `undefined` when no usable IP is known. */
export function upstreamClientIp(clientIp: string): string | undefined {
  return clientIp !== 'unknown' && IP_LITERAL.test(clientIp) ? clientIp : undefined;
}
