import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter, getClientIp, upstreamClientIp } from './rate-limit';

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit, then refuses until the window resets', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(() => now);
    const policy = { limit: 2, windowMs: 10_000 };

    expect(limiter.check('a', policy)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check('a', policy)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check('a', policy)).toMatchObject({ allowed: false, retryAfterSeconds: 10 });
    expect(limiter.check('b', policy).allowed).toBe(true);

    now += 10_000;
    expect(limiter.check('a', policy)).toMatchObject({ allowed: true, remaining: 1 });
  });
});

describe('getClientIp', () => {
  it('prefers x-real-ip', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.5');
  });

  it('uses the first hop of x-vercel-forwarded-for when x-real-ip is absent', () => {
    expect(
      getClientIp(
        new Headers({ 'x-vercel-forwarded-for': '203.0.113.30, 10.1.1.1', 'x-forwarded-for': '6.6.6.6, 198.51.100.1' })
      )
    ).toBe('203.0.113.30');
  });

  it('prefers x-real-ip over x-vercel-forwarded-for', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '203.0.113.5', 'x-vercel-forwarded-for': '203.0.113.30' }))).toBe(
      '203.0.113.5'
    );
  });

  it('never reads a client-supplied x-macp-client-ip', () => {
    expect(getClientIp(new Headers({ 'x-macp-client-ip': '1.2.3.4' }))).toBe('unknown');
    expect(getClientIp(new Headers({ 'x-macp-client-ip': '1.2.3.4', 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('uses the rightmost x-forwarded-for entry, not the client-controlled leftmost one', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.2 , 203.0.113.8' }))).toBe('203.0.113.8');
  });

  it('falls back to a shared bucket when no forwarded header is present', () => {
    expect(getClientIp(new Headers())).toBe('unknown');
    expect(getClientIp(new Headers({ 'x-forwarded-for': ' , ' }))).toBe('unknown');
  });
});

describe('upstreamClientIp', () => {
  it('passes IPv4 and IPv6 literals through', () => {
    expect(upstreamClientIp('203.0.113.5')).toBe('203.0.113.5');
    expect(upstreamClientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(upstreamClientIp('::ffff:203.0.113.5')).toBe('::ffff:203.0.113.5');
  });

  it('withholds the shared unknown bucket and anything that is not an IP literal', () => {
    expect(upstreamClientIp('unknown')).toBeUndefined();
    expect(upstreamClientIp('evil|bucket')).toBeUndefined();
    expect(upstreamClientIp('a'.repeat(60))).toBeUndefined();
  });
});
