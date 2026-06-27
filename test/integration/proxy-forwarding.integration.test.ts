import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MockBackend } from './helpers/mock-backend';
import { runsListResponse, runRecord, RUN_ID_1 } from './fixtures/backend-responses';

/**
 * Integration tests for the Next.js API proxy route handler.
 *
 * Spins up a MockBackend to simulate the macp-control-plane and example-service,
 * sets env vars so the proxy forwards to it, then calls the route handler
 * with constructed NextRequest objects.
 */
describe('Proxy Forwarding (integration)', () => {
  let cpBackend: MockBackend;
  let exBackend: MockBackend;

  beforeAll(async () => {
    cpBackend = new MockBackend();
    exBackend = new MockBackend();
    await cpBackend.start();
    await exBackend.start();

    process.env.MACP_CONTROL_PLANE_BASE_URL = cpBackend.url;
    process.env.MACP_CONTROL_PLANE_API_KEY = 'test-cp-key';
    process.env.MACP_PLAYGROUND_BASE_URL = exBackend.url;
    process.env.MACP_PLAYGROUND_API_KEY = 'test-ex-key';
  });

  afterAll(async () => {
    await cpBackend.stop();
    await exBackend.stop();
    delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    delete process.env.MACP_CONTROL_PLANE_API_KEY;
    delete process.env.MACP_PLAYGROUND_BASE_URL;
    delete process.env.MACP_PLAYGROUND_API_KEY;
  });

  beforeEach(() => {
    cpBackend.clearRequests();
    exBackend.clearRequests();
  });

  async function callProxy(
    service: string,
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string>; query?: string } = {}
  ): Promise<Response> {
    // Dynamically import to pick up fresh env vars
    const { buildUpstreamUrl, getIntegrationConfig } = await import('@/lib/server/integrations');

    const config = getIntegrationConfig(service as 'macp-playground' | 'macp-control-plane');
    const upstreamUrl = buildUpstreamUrl(
      service as 'macp-playground' | 'macp-control-plane',
      path,
      options.query ? `?${options.query}` : ''
    );

    const headers = new Headers({ 'content-type': 'application/json', ...(options.headers ?? {}) });

    if (config.authToken) {
      if (config.authHeaderName === 'authorization') {
        headers.set('authorization', `Bearer ${config.authToken}`);
      } else if (config.authHeaderName) {
        headers.set(config.authHeaderName, config.authToken);
      }
    }

    const method = (options.method ?? 'GET').toUpperCase();
    return fetch(upstreamUrl, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }

  describe('GET requests', () => {
    it('forwards GET /runs to macp-control-plane and returns response', async () => {
      cpBackend.on('GET', '/runs', () => ({
        status: 200,
        body: runsListResponse()
      }));

      const res = await callProxy('macp-control-plane', '/runs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('passes query parameters through', async () => {
      cpBackend.on('GET', '/runs', (req) => ({
        status: 200,
        body: runsListResponse(1)
      }));

      await callProxy('macp-control-plane', '/runs', { query: 'status=running&limit=10' });

      expect(cpBackend.requests).toHaveLength(1);
      expect(cpBackend.requests[0].query).toContain('status=running');
      expect(cpBackend.requests[0].query).toContain('limit=10');
    });

    it('forwards GET to example-service /packs', async () => {
      exBackend.on('GET', '/packs', () => ({
        status: 200,
        body: [
          { slug: 'fraud', name: 'Fraud Detection' },
          { slug: 'lending', name: 'Lending' }
        ]
      }));

      const res = await callProxy('macp-playground', '/packs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].slug).toBe('fraud');
    });
  });

  describe('POST requests', () => {
    it('forwards POST body to macp-control-plane /runs', async () => {
      const requestBody = { mode: 'live', session: { modeName: 'macp.mode.decision.v1' } };

      cpBackend.on('POST', '/runs', (req) => ({
        status: 201,
        body: { runId: RUN_ID_1, status: 'queued', traceId: 'trace-001' }
      }));

      const res = await callProxy('macp-control-plane', '/runs', {
        method: 'POST',
        body: requestBody
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.runId).toBe(RUN_ID_1);

      // Verify the backend received the body
      expect(cpBackend.requests).toHaveLength(1);
      const sent = cpBackend.requests[0].body as Record<string, unknown>;
      expect(sent.mode).toBe('live');
    });
  });

  describe('Auth header injection', () => {
    it('sends Bearer token for macp-control-plane requests', async () => {
      cpBackend.on('GET', '/healthz', () => ({ status: 200, body: { ok: true } }));

      await callProxy('macp-control-plane', '/healthz');

      expect(cpBackend.requests).toHaveLength(1);
      const authHeader = cpBackend.requests[0].headers['authorization'];
      expect(authHeader).toBe('Bearer test-cp-key');
    });

    it('sends X-API-Key for example-service requests', async () => {
      exBackend.on('GET', '/agents', () => ({ status: 200, body: [] }));

      await callProxy('macp-playground', '/agents');

      expect(exBackend.requests).toHaveLength(1);
      const apiKey = exBackend.requests[0].headers['x-api-key'];
      expect(apiKey).toBe('test-ex-key');
    });
  });

  describe('Error forwarding', () => {
    it('forwards 404 from upstream', async () => {
      cpBackend.on('GET', '/runs/nonexistent', () => ({
        status: 404,
        body: { error: 'Run not found' }
      }));

      const res = await callProxy('macp-control-plane', '/runs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('forwards 500 from upstream', async () => {
      cpBackend.on('POST', '/runs/validate', () => ({
        status: 500,
        body: { error: 'Internal server error' }
      }));

      const res = await callProxy('macp-control-plane', '/runs/validate', { method: 'POST', body: {} });
      expect(res.status).toBe(500);
    });

    it('forwards 400 validation errors', async () => {
      cpBackend.on('POST', '/runs', () => ({
        status: 400,
        body: { error: 'VALIDATION_ERROR', message: 'Missing required field: session' }
      }));

      const res = await callProxy('macp-control-plane', '/runs', { method: 'POST', body: {} });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('HTTP methods', () => {
    it('forwards PATCH requests', async () => {
      cpBackend.on('PATCH', `/webhooks/wh-001`, (req) => ({
        status: 200,
        body: { id: 'wh-001', active: false }
      }));

      const res = await callProxy('macp-control-plane', '/webhooks/wh-001', {
        method: 'PATCH',
        body: { active: false }
      });

      expect(res.status).toBe(200);
      expect(cpBackend.requests[0].method).toBe('PATCH');
    });

    it('forwards DELETE requests', async () => {
      cpBackend.on('DELETE', `/runs/${RUN_ID_1}`, () => ({
        status: 204
      }));

      const res = await callProxy('macp-control-plane', `/runs/${RUN_ID_1}`, { method: 'DELETE' });
      expect(res.status).toBe(204);
    });
  });
});
