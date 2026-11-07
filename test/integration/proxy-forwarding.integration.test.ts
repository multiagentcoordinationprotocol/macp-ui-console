import { NextRequest } from 'next/server';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { proxyRateLimiter } from '@/lib/server/rate-limit';
import { DELETE, GET, PATCH, POST } from '@/app/api/proxy/[service]/[...path]/route';
import { MockBackend } from './helpers/mock-backend';
import { runsListResponse, RUN_ID_1, validateRunResponse } from './fixtures/backend-responses';

/**
 * Integration tests for the Next.js API proxy route handler.
 *
 * Spins up two MockBackends (control plane and playground) on real sockets, points the proxy at them
 * through its env vars, and calls the REAL route handler with NextRequest objects, so the allow-list
 * (W0.1), the rate limiter, credential injection and the upstream fetch all run as in production.
 *
 * The previous version of this file re-implemented the forwarding inline and asserted that POST /runs,
 * PATCH /webhooks/:id and DELETE /runs/:id reach upstream — all of which the real proxy has refused
 * with 403 since W0.1, so the suite was green while testing nothing the console does.
 */
describe('Proxy Forwarding (integration)', () => {
  let cpBackend: MockBackend;
  let pgBackend: MockBackend;

  beforeAll(async () => {
    cpBackend = new MockBackend();
    pgBackend = new MockBackend();
    await cpBackend.start();
    await pgBackend.start();

    process.env.MACP_CONTROL_PLANE_BASE_URL = cpBackend.url;
    process.env.MACP_CONTROL_PLANE_API_KEY = 'test-cp-key';
    process.env.MACP_PLAYGROUND_BASE_URL = pgBackend.url;
    process.env.MACP_PLAYGROUND_API_KEY = 'test-pg-key';
  });

  afterAll(async () => {
    await cpBackend.stop();
    await pgBackend.stop();
    delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    delete process.env.MACP_CONTROL_PLANE_API_KEY;
    delete process.env.MACP_PLAYGROUND_BASE_URL;
    delete process.env.MACP_PLAYGROUND_API_KEY;
  });

  beforeEach(() => {
    cpBackend.reset();
    pgBackend.reset();
    proxyRateLimiter.reset();
  });

  const handlers = { GET, POST, PATCH, DELETE } as const;

  async function callProxy(
    service: string,
    path: string,
    options: { method?: keyof typeof handlers; body?: unknown; query?: string; headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const method = options.method ?? 'GET';
    const segments = path.split('/').filter(Boolean);
    const url = `http://console.test/api/proxy/${service}/${segments.join('/')}${options.query ? `?${options.query}` : ''}`;
    const request = new NextRequest(url, {
      method,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    return handlers[method](request, { params: Promise.resolve({ service, path: segments }) });
  }

  describe('GET requests', () => {
    it('forwards GET /runs to macp-control-plane and returns response', async () => {
      cpBackend.on('GET', '/runs', () => ({ status: 200, body: runsListResponse() }));

      const res = await callProxy('macp-control-plane', '/runs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(res.headers.get('x-macp-ui-proxy')).toBe('macp-control-plane');
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('passes query parameters through', async () => {
      cpBackend.on('GET', '/runs', () => ({ status: 200, body: runsListResponse(1) }));

      await callProxy('macp-control-plane', '/runs', { query: 'status=running&limit=10' });

      expect(cpBackend.requests).toHaveLength(1);
      expect(cpBackend.requests[0].query).toContain('status=running');
      expect(cpBackend.requests[0].query).toContain('limit=10');
    });

    it('forwards GET to the playground /packs', async () => {
      pgBackend.on('GET', '/packs', () => ({
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

    it('forwards the decision receipt route', async () => {
      cpBackend.on('GET', `/runs/${RUN_ID_1}/receipt`, () => ({
        status: 200,
        body: { runId: RUN_ID_1, sessionId: 's-1', receiptJson: '{}', receipt: { receipt_format: 'macp-receipt/1' } }
      }));

      const res = await callProxy('macp-control-plane', `/runs/${RUN_ID_1}/receipt`);

      expect(res.status).toBe(200);
      expect((await res.json()).receipt.receipt_format).toBe('macp-receipt/1');
    });
  });

  describe('POST requests', () => {
    it('forwards the launch body to the playground /examples/run', async () => {
      pgBackend.on('POST', '/examples/run', () => ({
        status: 200,
        body: { sessionId: 's-1', controlPlaneRun: { runId: RUN_ID_1, status: 'queued', sessionId: 's-1' } }
      }));

      const launch = {
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        templateId: 'suspend-demo',
        mode: 'live',
        inputs: { customerId: 'CUST-1' },
        bootstrapAgents: true
      };
      const res = await callProxy('macp-playground', '/examples/run', { method: 'POST', body: launch });

      expect(res.status).toBe(200);
      expect((await res.json()).controlPlaneRun.runId).toBe(RUN_ID_1);
      expect(pgBackend.requests).toHaveLength(1);
      expect(pgBackend.requests[0].body).toEqual(launch);
    });

    it('forwards POST /runs/validate to the control plane', async () => {
      cpBackend.on('POST', '/runs/validate', () => ({ status: 200, body: validateRunResponse() }));

      const res = await callProxy('macp-control-plane', '/runs/validate', { method: 'POST', body: { mode: 'live' } });

      expect(res.status).toBe(200);
      expect((cpBackend.requests[0].body as Record<string, unknown>).mode).toBe('live');
    });
  });

  describe('Auth header injection', () => {
    it('sends the Bearer token for macp-control-plane requests and drops the caller-supplied one', async () => {
      cpBackend.on('GET', '/readyz', () => ({ status: 200, body: { ok: true } }));

      await callProxy('macp-control-plane', '/readyz', { headers: { authorization: 'Bearer visitor-token' } });

      expect(cpBackend.requests).toHaveLength(1);
      expect(cpBackend.requests[0].headers['authorization']).toBe('Bearer test-cp-key');
    });

    it('sends X-API-Key for playground requests', async () => {
      pgBackend.on('GET', '/agents', () => ({ status: 200, body: [] }));

      await callProxy('macp-playground', '/agents');

      expect(pgBackend.requests).toHaveLength(1);
      expect(pgBackend.requests[0].headers['x-api-key']).toBe('test-pg-key');
    });
  });

  describe('Error forwarding', () => {
    it('forwards 404 from upstream', async () => {
      cpBackend.on('GET', '/runs/nonexistent', () => ({ status: 404, body: { error: 'Run not found' } }));

      const res = await callProxy('macp-control-plane', '/runs/nonexistent');
      expect(res.status).toBe(404);
    });

    it('forwards 500 from upstream', async () => {
      cpBackend.on('POST', '/runs/validate', () => ({ status: 500, body: { error: 'Internal server error' } }));

      const res = await callProxy('macp-control-plane', '/runs/validate', { method: 'POST', body: {} });
      expect(res.status).toBe(500);
    });

    it('forwards 400 validation errors', async () => {
      cpBackend.on('POST', '/runs/validate', () => ({
        status: 400,
        body: { error: 'VALIDATION_ERROR', message: 'Missing required field: session' }
      }));

      const res = await callProxy('macp-control-plane', '/runs/validate', { method: 'POST', body: {} });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('Routes the hosted proxy refuses (W0.1)', () => {
    const refused: Array<[keyof typeof handlers, string, string]> = [
      ['POST', 'macp-control-plane', '/runs'],
      ['POST', 'macp-control-plane', `/runs/${RUN_ID_1}/suspend`],
      ['POST', 'macp-control-plane', `/runs/${RUN_ID_1}/resume`],
      ['POST', 'macp-control-plane', `/runs/${RUN_ID_1}/cancel`],
      ['PATCH', 'macp-control-plane', '/webhooks/wh-001'],
      ['DELETE', 'macp-control-plane', `/runs/${RUN_ID_1}`]
    ];

    it.each(refused)('answers %s %s %s with 403 and never reaches upstream', async (method, service, path) => {
      cpBackend.onPrefix(method, '/', () => ({ status: 200, body: {} }));

      const res = await callProxy(service, path, { method, body: method === 'DELETE' ? undefined : {} });

      expect(res.status).toBe(403);
      expect(cpBackend.requests).toHaveLength(0);
      expect(pgBackend.requests).toHaveLength(0);
    });
  });
});
