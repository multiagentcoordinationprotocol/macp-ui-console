import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findAllowedRoute, PROXY_ALLOWLIST } from '@/lib/server/proxy-allowlist';
import { proxyRateLimiter, RATE_LIMIT_POLICIES } from '@/lib/server/rate-limit';

import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './route';

/**
 * #58: the proxy attaches server-held credentials, so it must forward only to the two known
 * services. An unknown `[service]` segment previously fell through to the control-plane config and
 * was forwarded with `MACP_CONTROL_PLANE_API_KEY`.
 */
describe('proxy route service allow-list', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.MACP_CONTROL_PLANE_BASE_URL = 'http://cp.test';
    process.env.MACP_CONTROL_PLANE_API_KEY = 'cp-secret';
    process.env.MACP_PLAYGROUND_BASE_URL = 'http://pg.test';
    process.env.MACP_PLAYGROUND_API_KEY = 'pg-secret';
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    proxyRateLimiter.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    delete process.env.MACP_CONTROL_PLANE_API_KEY;
    delete process.env.MACP_PLAYGROUND_BASE_URL;
    delete process.env.MACP_PLAYGROUND_API_KEY;
  });

  const call = (handler: typeof GET, service: string, path: string[], method = 'GET') =>
    handler(new NextRequest(`http://console.test/api/proxy/${service}/${path.join('/')}`, { method }), {
      params: Promise.resolve({ service, path })
    });

  it.each(['anything', 'macp-control-plane-x', 'MACP-CONTROL-PLANE', ''])(
    'refuses unknown service %j with 404 and never calls upstream',
    async (service) => {
      const response = await call(GET, service, ['runs']);
      expect(response.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('refuses unknown services for mutating methods too', async () => {
    const response = await call(POST, 'evil', ['runtime', 'policies'], 'POST');
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards macp-control-plane with its bearer token', async () => {
    await call(GET, 'macp-control-plane', ['runs']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://cp.test/runs');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer cp-secret');
  });

  it('forwards macp-playground with its x-api-key', async () => {
    await call(GET, 'macp-playground', ['packs']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pg.test/packs');
    expect((init.headers as Headers).get('x-api-key')).toBe('pg-secret');
    expect((init.headers as Headers).get('authorization')).toBeNull();
  });
});

/**
 * W0.1: the proxy has no visitor auth and forwards with server-held credentials, so it forwards
 * only the allow-listed (service, method, path) triples the UI uses, and rate limits per IP.
 */
describe('proxy route method/path allow-list and rate limiting', () => {
  const fetchMock = vi.fn();
  const handlers = { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } as const;
  type Method = keyof typeof handlers;

  beforeEach(() => {
    process.env.MACP_CONTROL_PLANE_BASE_URL = 'http://cp.test';
    process.env.MACP_CONTROL_PLANE_API_KEY = 'cp-secret';
    process.env.MACP_PLAYGROUND_BASE_URL = 'http://pg.test';
    process.env.MACP_PLAYGROUND_API_KEY = 'pg-secret';
    fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    proxyRateLimiter.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    delete process.env.MACP_CONTROL_PLANE_API_KEY;
    delete process.env.MACP_PLAYGROUND_BASE_URL;
    delete process.env.MACP_PLAYGROUND_API_KEY;
  });

  const call = (method: Method, service: string, path: string[], headers: Record<string, string> = {}) =>
    handlers[method](
      new NextRequest(`http://console.test/api/proxy/${service}/${path.join('/')}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : '{}'
      }),
      { params: Promise.resolve({ service, path }) }
    );

  const concrete = (template: string) =>
    template
      .split('/')
      .filter(Boolean)
      .map((part) => (part.startsWith(':') ? `${part.slice(1)}-1` : part));

  it.each(PROXY_ALLOWLIST.map((route) => [route.method, route.service, route.path] as const))(
    'forwards allow-listed %s %s%s',
    async (method, service, template) => {
      const path = concrete(template);
      const response = await call(method, service, path);
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`http://${service === 'macp-playground' ? 'pg' : 'cp'}.test/${path.join('/')}`);
      expect(init.method).toBe(method);
    }
  );

  // Every route the UI can reach with a mutating or admin effect, plus generic probes.
  const refused: Array<[Method, string, string[]]> = [
    ['POST', 'macp-control-plane', ['runtime', 'policies']],
    ['DELETE', 'macp-control-plane', ['runtime', 'policies', 'policy.x']],
    ['GET', 'macp-control-plane', ['webhooks']],
    ['POST', 'macp-control-plane', ['webhooks']],
    ['PATCH', 'macp-control-plane', ['webhooks', 'wh-1']],
    ['DELETE', 'macp-control-plane', ['webhooks', 'wh-1']],
    ['POST', 'macp-control-plane', ['admin', 'circuit-breaker', 'reset']],
    ['GET', 'macp-control-plane', ['admin', 'circuit-breaker', 'history']],
    ['GET', 'macp-control-plane', ['admin', 'runtime', 'sessions']],
    ['GET', 'macp-control-plane', ['audit']],
    ['POST', 'macp-control-plane', ['runs']],
    ['DELETE', 'macp-control-plane', ['runs', 'run-1']],
    ['PUT', 'macp-control-plane', ['runs', 'run-1']],
    ['PATCH', 'macp-control-plane', ['runs', 'run-1']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'cancel']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'suspend']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'resume']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'clone']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'archive']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'messages']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'signal']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'context']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'artifacts']],
    ['POST', 'macp-control-plane', ['runs', 'run-1', 'projection', 'rebuild']],
    ['POST', 'macp-control-plane', ['runs', 'batch', 'cancel']],
    ['POST', 'macp-control-plane', ['runs', 'batch', 'archive']],
    ['POST', 'macp-control-plane', ['runs', 'batch', 'delete']],
    ['POST', 'macp-control-plane', ['runs', 'batch', 'export']],
    ['GET', 'macp-control-plane', ['runs', 'run-1', 'messages']],
    ['GET', 'macp-control-plane', ['healthz']],
    ['HEAD', 'macp-control-plane', ['runs']],
    ['OPTIONS', 'macp-control-plane', ['runs']],
    ['PUT', 'macp-playground', ['packs']],
    ['DELETE', 'macp-playground', ['agents', 'a-1']],
    ['GET', 'macp-playground', ['examples', 'run']],
    ['GET', 'macp-playground', ['scenarios']],
    // Path tricks: dot segments, encoded separators, case and trailing variants.
    ['GET', 'macp-control-plane', ['runs', '..', 'admin', 'runtime', 'sessions']],
    ['GET', 'macp-control-plane', ['runs', '.', 'state']],
    ['GET', 'macp-control-plane', ['runs', 'x/../../admin', 'state']],
    ['GET', 'macp-control-plane', ['runs', 'x%2F..%2Fadmin', 'state']],
    ['GET', 'macp-control-plane', ['runs', 'x\\..\\admin', 'state']],
    ['GET', 'macp-control-plane', ['Runs']],
    ['GET', 'macp-control-plane', ['runs', '']],
    ['GET', 'macp-control-plane', []],
    // A playground path under the control plane service (and vice versa) is not a match.
    ['POST', 'macp-control-plane', ['examples', 'run']],
    ['GET', 'macp-playground', ['runs']]
  ];

  it.each(refused)('refuses %s %s %j with 403 and never calls upstream', async (method, service, path) => {
    const response = await call(method, service, path);
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('every refused triple is genuinely absent from the allow-list', () => {
    // Guards the table above against drifting into testing something the allow-list now permits.
    for (const [method, service, path] of refused) {
      expect(findAllowedRoute(service, method, path), `${method} ${service} /${path.join('/')}`).toBeUndefined();
    }
  });

  it('rate limits read traffic per client IP with 429 and stops forwarding', async () => {
    const { limit } = RATE_LIMIT_POLICIES.read;
    for (let i = 0; i < limit; i += 1) {
      const ok = await call('GET', 'macp-control-plane', ['runs'], { 'x-real-ip': '203.0.113.7' });
      expect(ok.status).toBe(200);
    }
    const limited = await call('GET', 'macp-control-plane', ['runs'], { 'x-real-ip': '203.0.113.7' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(limit);

    // A different client is unaffected.
    const other = await call('GET', 'macp-control-plane', ['runs'], { 'x-real-ip': '198.51.100.2' });
    expect(other.status).toBe(200);
  });

  it('applies the stricter launch quota to the launch route', async () => {
    const { limit } = RATE_LIMIT_POLICIES.launch;
    const headers = { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' };
    for (let i = 0; i < limit; i += 1) {
      expect((await call('POST', 'macp-playground', ['examples', 'run'], headers)).status).toBe(200);
    }
    const limited = await call('POST', 'macp-playground', ['examples', 'run'], headers);
    expect(limited.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(limit);

    // Read routes for the same client still work: the launch cap is separate.
    expect((await call('GET', 'macp-playground', ['packs'], headers)).status).toBe(200);
  });

  it('does not let a spoofed leftmost x-forwarded-for entry mint a fresh launch quota', async () => {
    const { limit } = RATE_LIMIT_POLICIES.launch;
    for (let i = 0; i < limit; i += 1) {
      await call('POST', 'macp-playground', ['examples', 'run'], { 'x-forwarded-for': `1.1.1.${i}, 203.0.113.9` });
    }
    const limited = await call('POST', 'macp-playground', ['examples', 'run'], {
      'x-forwarded-for': '9.9.9.9, 203.0.113.9'
    });
    expect(limited.status).toBe(429);
  });

  it('refused requests do not consume rate-limit quota or reach upstream', async () => {
    for (let i = 0; i < RATE_LIMIT_POLICIES.launch.limit + 2; i += 1) {
      expect((await call('DELETE', 'macp-control-plane', ['runs', 'r'], { 'x-real-ip': '203.0.113.1' })).status).toBe(
        403
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await call('POST', 'macp-playground', ['examples', 'run'], { 'x-real-ip': '203.0.113.1' })).status).toBe(
      200
    );
  });
});
