import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

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
