import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FetchMocker } from '../../test/integration/helpers/fetch-mocker';
import {
  RUN_ID_1,
  RUN_ID_2,
  runRecord,
  runsListResponse,
  runStateProjection,
  canonicalEvents,
  createRunResponse,
  validateRunResponse,
  dashboardOverview,
  runtimeHealth,
  runtimeManifest,
  runtimeModes,
  runtimeRoots,
  readinessProbe,
  auditLogs,
  agentMetrics,
  agentProfiles,
  packsList
} from '../../test/integration/fixtures/backend-responses';
import { ApiError } from '@/lib/api/fetcher';

const REAL = false;

describe('real mode API client', () => {
  let mocker: FetchMocker;

  beforeAll(() => {
    mocker = new FetchMocker();
    mocker.install();
  });

  afterAll(() => {
    mocker.restore();
  });

  beforeEach(() => {
    mocker.clearRequests();
  });

  /* ─── listRuns ─── */

  describe('listRuns', () => {
    it('calls GET /api/proxy/macp-control-plane/runs and unwraps { data, total }', async () => {
      const payload = runsListResponse(2);
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({ status: 200, body: payload }));

      const { listRuns } = await import('@/lib/api/client');
      const result = await listRuns(REAL);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('id', RUN_ID_1);
      expect(result[1]).toHaveProperty('id', RUN_ID_2);
    });

    it('normalizes runs from the response', async () => {
      const payload = runsListResponse(1);
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({ status: 200, body: payload }));

      const { listRuns } = await import('@/lib/api/client');
      const result = await listRuns(REAL);

      expect(result[0]).toHaveProperty('status', 'running');
      expect(result[0]).toHaveProperty('runtimeKind', 'rust');
    });

    it('passes query params to the endpoint', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: runsListResponse(1)
      }));

      const { listRuns } = await import('@/lib/api/client');
      await listRuns(REAL, { status: 'running', limit: 10 });

      const req = mocker.requests.find((r) => r.url.includes('/runs'));
      expect(req).toBeDefined();
      expect(req!.url).toContain('status=running');
      expect(req!.url).toContain('limit=10');
    });
  });

  /* ─── getRun ─── */

  describe('getRun', () => {
    it('calls GET /api/proxy/macp-control-plane/runs/:id and normalizes response', async () => {
      const record = runRecord(RUN_ID_1);
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({ status: 200, body: record }));

      const { getRun } = await import('@/lib/api/client');
      const result = await getRun(RUN_ID_1, REAL);

      expect(result.id).toBe(RUN_ID_1);
      expect(result.status).toBe('running');
      expect(result.runtimeKind).toBe('rust');
    });
  });

  /* ─── getRunState ─── */

  describe('getRunState', () => {
    it('calls GET /api/proxy/macp-control-plane/runs/:id/state', async () => {
      const projection = runStateProjection(RUN_ID_1);
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/state`, () => ({
        status: 200,
        body: projection
      }));

      const { getRunState } = await import('@/lib/api/client');
      const result = await getRunState(RUN_ID_1, REAL);

      expect(result).toHaveProperty('graph');
      expect(result).toHaveProperty('participants');
      expect(result).toHaveProperty('decision');
      expect(result.run.runId).toBe(RUN_ID_1);
    });
  });

  /* ─── getRunEvents ─── */

  describe('getRunEvents', () => {
    it('calls GET /api/proxy/macp-control-plane/runs/:id/events?afterSeq=0&limit=500 by default', async () => {
      const events = canonicalEvents(RUN_ID_1, 3);
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: events
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      const result = await getRunEvents(RUN_ID_1, REAL);

      expect(result).toHaveLength(3);
      const req = mocker.requests.find((r) => r.url.includes('/events'));
      expect(req!.url).toContain('afterSeq=0');
      expect(req!.url).toContain('limit=500');
    });

    it('uses custom limit when provided', async () => {
      const events = canonicalEvents(RUN_ID_1, 2);
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: events
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      await getRunEvents(RUN_ID_1, REAL, 100);

      const req = mocker.requests.find((r) => r.url.includes('/events'));
      expect(req!.url).toContain('limit=100');
    });
  });

  /* ─── cancelRun ─── */

  describe('cancelRun', () => {
    it('calls POST /api/proxy/macp-control-plane/runs/:id/cancel with body', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/cancel`, () => ({
        status: 200,
        body: { id: RUN_ID_1, status: 'cancelled' }
      }));

      const { cancelRun } = await import('@/lib/api/client');
      const result = await cancelRun(RUN_ID_1, REAL);

      expect(result).toEqual({ ok: true, runId: RUN_ID_1, status: 'cancelled' });

      const req = mocker.requests.find((r) => r.url.includes('/cancel'));
      expect(req!.method).toBe('POST');
      expect(req!.body).toEqual({ reason: 'Cancelled from MACP UI' });
    });
  });

  /* ─── cloneRun ─── */

  describe('cloneRun', () => {
    it('calls POST /api/proxy/macp-control-plane/runs/:id/clone with overrides and returns CreateRunResponse', async () => {
      const response = createRunResponse(RUN_ID_2);
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/clone`, () => ({
        status: 200,
        body: response
      }));

      const { cloneRun } = await import('@/lib/api/client');
      const overrides = { tags: ['cloned'], context: { key: 'value' } };
      const result = await cloneRun(RUN_ID_1, REAL, overrides);

      expect(result).toHaveProperty('runId', RUN_ID_2);
      expect(result).toHaveProperty('status', 'queued');

      const req = mocker.requests.find((r) => r.url.includes('/clone'));
      expect(req!.method).toBe('POST');
      expect(req!.body).toEqual(overrides);
    });

    it('sends empty object when no overrides provided', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/clone`, () => ({
        status: 200,
        body: createRunResponse()
      }));

      const { cloneRun } = await import('@/lib/api/client');
      await cloneRun(RUN_ID_1, REAL);

      const req = mocker.requests.find((r) => r.url.includes('/clone'));
      expect(req!.body).toEqual({});
    });
  });

  /* ─── createRun ─── */

  describe('createRun', () => {
    it('calls POST /api/proxy/macp-control-plane/runs and returns CreateRunResponse', async () => {
      const response = createRunResponse();
      mocker.on('POST', '/api/proxy/macp-control-plane/runs', () => ({ status: 200, body: response }));

      const { createRun } = await import('@/lib/api/client');
      const body = { mode: 'live', session: { modeName: 'macp.mode.decision.v1' } };
      const result = await createRun(body, REAL);

      expect(result).toHaveProperty('runId', RUN_ID_1);
      expect(result).toHaveProperty('status', 'queued');

      const req = mocker.requests.find((r) => r.method === 'POST' && r.url.includes('/runs'));
      expect(req).toBeDefined();
      expect(req!.body).toEqual(body);
    });
  });

  /* ─── validateRun ─── */

  describe('validateRun', () => {
    it('calls POST and maps valid -> ok', async () => {
      const cpResponse = validateRunResponse(true);
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/validate', () => ({ status: 200, body: cpResponse }));

      const { validateRun } = await import('@/lib/api/client');
      const result = await validateRun({ session: {} }, REAL);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.runtime).toHaveProperty('reachable', true);
    });

    it('returns ok=false when response has errors', async () => {
      const cpResponse = validateRunResponse(false);
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/validate', () => ({ status: 200, body: cpResponse }));

      const { validateRun } = await import('@/lib/api/client');
      const result = await validateRun({ session: {} }, REAL);

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  /* ─── deleteRun ─── */

  describe('deleteRun', () => {
    it('calls DELETE /api/proxy/macp-control-plane/runs/:id and returns void', async () => {
      mocker.on('DELETE', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({ status: 204 }));

      const { deleteRun } = await import('@/lib/api/client');
      const result = await deleteRun(RUN_ID_1, REAL);

      expect(result).toBeUndefined();

      const req = mocker.requests.find((r) => r.method === 'DELETE');
      expect(req!.url).toContain(`/runs/${RUN_ID_1}`);
    });
  });

  /* ─── deleteWebhook ─── */

  describe('deleteWebhook', () => {
    it('calls DELETE and returns void (204)', async () => {
      mocker.on('DELETE', '/api/proxy/macp-control-plane/webhooks/wh-001', () => ({ status: 204 }));

      const { deleteWebhook } = await import('@/lib/api/client');
      const result = await deleteWebhook('wh-001', REAL);

      expect(result).toBeUndefined();

      const req = mocker.requests.find((r) => r.method === 'DELETE');
      expect(req!.url).toContain('/webhooks/wh-001');
    });
  });

  /* ─── batchCancelRuns ─── */

  describe('batchCancelRuns', () => {
    it('calls POST /api/proxy/macp-control-plane/runs/batch/cancel with runIds', async () => {
      const ids = [RUN_ID_1, RUN_ID_2];
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/batch/cancel', () => ({
        status: 200,
        body: { results: ids.map((id) => ({ runId: id, ok: true })) }
      }));

      const { batchCancelRuns } = await import('@/lib/api/client');
      const result = await batchCancelRuns(ids, REAL);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ runId: RUN_ID_1, ok: true });

      const req = mocker.requests.find((r) => r.url.includes('/batch/cancel'));
      expect(req!.body).toEqual({ runIds: ids });
    });
  });

  /* ─── rebuildProjection ─── */

  describe('rebuildProjection', () => {
    it('calls POST and returns typed result', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/projection/rebuild`, () => ({
        status: 200,
        body: { rebuilt: true, latestSeq: 42 }
      }));

      const { rebuildProjection } = await import('@/lib/api/client');
      const result = await rebuildProjection(RUN_ID_1, REAL);

      expect(result).toEqual({ rebuilt: true, latestSeq: 42 });
    });
  });

  /* ─── getAgentProfile ─── */

  describe('getAgentProfile', () => {
    it('returns profile for known agent', async () => {
      const profile = agentProfiles()[0];
      mocker.on('GET', `/api/proxy/macp-playground/agents/${encodeURIComponent('fraud-detector')}`, () => ({
        status: 200,
        body: profile
      }));

      const { getAgentProfile } = await import('@/lib/api/client');
      const result = await getAgentProfile('fraud-detector', REAL);

      expect(result).toBeDefined();
      expect(result!.agentRef).toBe('fraud-detector');
    });

    it('returns undefined on 404', async () => {
      mocker.on('GET', `/api/proxy/macp-playground/agents/unknown-agent`, () => ({
        status: 404,
        body: { error: 'not found' }
      }));

      const { getAgentProfile } = await import('@/lib/api/client');
      const result = await getAgentProfile('unknown-agent', REAL);

      expect(result).toBeUndefined();
    });

    it('throws on 500', async () => {
      mocker.on('GET', `/api/proxy/macp-playground/agents/broken-agent`, () => ({
        status: 500,
        body: { error: 'internal error' }
      }));

      const { getAgentProfile } = await import('@/lib/api/client');
      await expect(getAgentProfile('broken-agent', REAL)).rejects.toThrow(ApiError);
    });
  });

  /* ─── getDashboardOverview ─── */

  describe('getDashboardOverview', () => {
    it('aggregates from multiple endpoints', async () => {
      const overview = dashboardOverview();
      const runsList = runsListResponse(2);

      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
        status: 200,
        body: overview
      }));
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({ status: 200, body: runsList }));
      mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({ status: 200, body: packsList() }));
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
        status: 200,
        body: runtimeHealth()
      }));

      const { getDashboardOverview } = await import('@/lib/api/client');
      const result = await getDashboardOverview(REAL);

      expect(result).toHaveProperty('kpis');
      expect(result).toHaveProperty('runs');
      expect(result).toHaveProperty('packs');
      expect(result).toHaveProperty('runtimeHealth');
      expect(result).toHaveProperty('charts');
      expect(result.kpis.totalRuns).toBe(42);
      expect(result.runs).toHaveLength(2);
      expect(result.packs).toHaveLength(2);
      expect(result.charts).toHaveProperty('runVolume');
    });

    it('sets degraded flag when overview endpoint fails', async () => {
      const runsList = runsListResponse(1);

      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
        status: 500,
        body: { error: 'unavailable' }
      }));
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({ status: 200, body: runsList }));
      mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({ status: 200, body: packsList() }));
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
        status: 200,
        body: runtimeHealth()
      }));

      const { getDashboardOverview } = await import('@/lib/api/client');
      const result = await getDashboardOverview(REAL);

      expect(result.degraded).toBe(true);
      // Falls back to computing kpis from runs
      expect(result.kpis.totalRuns).toBe(1);
    });
  });

  /* ─── getAgentMetrics ─── */

  describe('getAgentMetrics', () => {
    it('maps from CP shape (participantId -> agentRef)', async () => {
      const cpMetrics = agentMetrics();
      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/agents/metrics', () => ({
        status: 200,
        body: cpMetrics
      }));

      const { getAgentMetrics } = await import('@/lib/api/client');
      const result = await getAgentMetrics(REAL);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('agentRef', 'fraud-detector');
      expect(result[0]).toHaveProperty('runs', 24);
      expect(result[0]).toHaveProperty('signals', 48);
      expect(result[0]).toHaveProperty('messages', 96);
      expect(result[0]).toHaveProperty('averageConfidence', 0.87);
    });

    it('returns empty array on failure', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/agents/metrics', () => ({
        status: 500,
        body: { error: 'unavailable' }
      }));

      const { getAgentMetrics } = await import('@/lib/api/client');
      const result = await getAgentMetrics(REAL);

      expect(result).toEqual([]);
    });
  });

  /* ─── normalizeRun ─── */

  describe('normalizeRun', () => {
    // normalizeRun is not exported, so we test it indirectly via getRun
    it('throws on missing id', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs/bad-id', () => ({
        status: 200,
        body: { status: 'running', runtimeKind: 'rust' }
      }));

      const { getRun } = await import('@/lib/api/client');
      await expect(getRun('bad-id', REAL)).rejects.toThrow("missing or invalid 'id'");
    });

    it('throws on missing status', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs/no-status', () => ({
        status: 200,
        body: { id: 'no-status', runtimeKind: 'rust' }
      }));

      const { getRun } = await import('@/lib/api/client');
      await expect(getRun('no-status', REAL)).rejects.toThrow("missing or invalid 'status'");
    });

    it('throws on missing runtimeKind', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs/no-kind', () => ({
        status: 200,
        body: { id: 'no-kind', status: 'running' }
      }));

      const { getRun } = await import('@/lib/api/client');
      await expect(getRun('no-kind', REAL)).rejects.toThrow("missing or invalid 'runtimeKind'");
    });
  });

  /* ─── getObservabilityRawMetrics ─── */

  describe('getObservabilityRawMetrics', () => {
    it('calls GET /api/proxy/macp-control-plane/metrics and returns text', async () => {
      const metricsText = '# HELP macp_runs_total Total runs\nmacp_runs_total 42';
      mocker.on('GET', '/api/proxy/macp-control-plane/metrics', () => ({
        status: 200,
        body: metricsText
      }));

      const { getObservabilityRawMetrics } = await import('@/lib/api/client');
      const result = await getObservabilityRawMetrics(REAL);

      expect(typeof result).toBe('string');
      expect(result).toContain('macp_runs_total');
    });
  });

  /* ─── createReplay ─── */

  describe('createReplay', () => {
    it('calls POST /api/proxy/macp-control-plane/runs/:id/replay and returns ReplayDescriptor', async () => {
      const descriptor = {
        runId: RUN_ID_1,
        mode: 'timed',
        speed: 1,
        streamUrl: `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/replay/stream`,
        stateUrl: `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/replay/state`
      };
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/replay`, () => ({
        status: 200,
        body: descriptor
      }));

      const { createReplay } = await import('@/lib/api/client');
      const result = await createReplay(RUN_ID_1, REAL);

      expect(result).toHaveProperty('runId', RUN_ID_1);
      expect(result).toHaveProperty('mode', 'timed');
      expect(result).toHaveProperty('streamUrl');
      expect(result).toHaveProperty('stateUrl');

      const req = mocker.requests.find((r) => r.url.includes('/replay'));
      expect(req!.method).toBe('POST');
      expect(req!.body).toEqual({ mode: 'timed', speed: 1 });
    });
  });

  /* ─── getRuntimeManifest ─── */

  describe('getRuntimeManifest', () => {
    it('calls GET /api/proxy/macp-control-plane/runtime/manifest', async () => {
      const manifest = runtimeManifest();
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/manifest', () => ({
        status: 200,
        body: manifest
      }));

      const { getRuntimeManifest } = await import('@/lib/api/client');
      const result = await getRuntimeManifest(REAL);

      expect(result).toHaveProperty('agentId', 'macp-runtime');
      expect(result).toHaveProperty('supportedModes');
    });
  });

  /* ─── getRuntimeModes ─── */

  describe('getRuntimeModes', () => {
    it('calls GET /api/proxy/macp-control-plane/runtime/modes', async () => {
      const modes = runtimeModes();
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/modes', () => ({
        status: 200,
        body: modes
      }));

      const { getRuntimeModes } = await import('@/lib/api/client');
      const result = await getRuntimeModes(REAL);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('mode', 'macp.mode.decision.v1');
    });
  });

  /* ─── getRuntimeRoots ─── */

  describe('getRuntimeRoots', () => {
    it('calls GET /api/proxy/macp-control-plane/runtime/roots', async () => {
      const roots = runtimeRoots();
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/roots', () => ({
        status: 200,
        body: roots
      }));

      const { getRuntimeRoots } = await import('@/lib/api/client');
      const result = await getRuntimeRoots(REAL);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('uri', 'file:///workspace');
    });
  });

  /* ─── getRuntimeHealth ─── */

  describe('getRuntimeHealth', () => {
    it('calls GET /api/proxy/macp-control-plane/runtime/health', async () => {
      const health = runtimeHealth();
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
        status: 200,
        body: health
      }));

      const { getRuntimeHealth } = await import('@/lib/api/client');
      const result = await getRuntimeHealth(REAL);

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('runtimeKind', 'rust');
    });
  });

  /* ─── getReadinessProbe ─── */

  describe('getReadinessProbe', () => {
    it('calls GET /api/proxy/macp-control-plane/readyz', async () => {
      const probe = readinessProbe();
      mocker.on('GET', '/api/proxy/macp-control-plane/readyz', () => ({
        status: 200,
        body: probe
      }));

      const { getReadinessProbe } = await import('@/lib/api/client');
      const result = await getReadinessProbe(REAL);

      expect(result).toHaveProperty('ok', true);
      expect(result).toHaveProperty('database');
      expect(result.database).toBe('ok');
    });
  });

  /* ─── getAuditLogs ─── */

  describe('getAuditLogs', () => {
    it('passes pagination params in URL', async () => {
      const logs = auditLogs();
      mocker.on('GET', '/api/proxy/macp-control-plane/audit', () => ({
        status: 200,
        body: logs
      }));

      const { getAuditLogs } = await import('@/lib/api/client');
      const result = await getAuditLogs(REAL, { limit: 50, offset: 10 });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total', 2);

      const req = mocker.requests.find((r) => r.url.includes('/audit'));
      expect(req!.url).toContain('limit=50');
      expect(req!.url).toContain('offset=10');
    });
  });

  /* ─── getRunEvents custom limit ─── */

  describe('getRunEvents custom limit', () => {
    it('includes custom limit in URL', async () => {
      const events = canonicalEvents(RUN_ID_1, 2);
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: events
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      await getRunEvents(RUN_ID_1, REAL, 100);

      const req = mocker.requests.find((r) => r.url.includes('/events'));
      expect(req!.url).toContain('limit=100');
    });
  });

  /* ─── getCircuitBreakerHistory ─── */

  describe('getCircuitBreakerHistory', () => {
    it('unwraps the CP { state, history } envelope into the history array', async () => {
      const history = [
        { state: 'CLOSED' as const, enteredAt: '2026-06-27T17:52:27.881Z', reason: 'initial' },
        { state: 'HALF_OPEN' as const, enteredAt: '2026-06-27T17:55:00.000Z', reason: 'timeout' }
      ];
      mocker.on('GET', '/api/proxy/macp-control-plane/admin/circuit-breaker/history', () => ({
        status: 200,
        body: { state: 'HALF_OPEN', history }
      }));

      const { getCircuitBreakerHistory } = await import('@/lib/api/client');
      const result = await getCircuitBreakerHistory(REAL);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('state', 'CLOSED');
    });

    it('passes a bare array response through unchanged', async () => {
      const history = [{ state: 'CLOSED' as const, enteredAt: '2026-06-27T17:52:27.881Z' }];
      mocker.on('GET', '/api/proxy/macp-control-plane/admin/circuit-breaker/history', () => ({
        status: 200,
        body: history
      }));

      const { getCircuitBreakerHistory } = await import('@/lib/api/client');
      const result = await getCircuitBreakerHistory(REAL);

      expect(result).toEqual(history);
    });
  });

  /* ─── Error handling ─── */

  describe('error handling', () => {
    it('throws ApiError with correct status and message for non-OK responses', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({
        status: 422,
        body: { error: 'Validation failed' }
      }));

      const { getRun } = await import('@/lib/api/client');

      try {
        await getRun(RUN_ID_1, REAL);
        expect.fail('Expected ApiError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(422);
        expect(apiErr.service).toBe('macp-control-plane');
        expect(apiErr.path).toBe(`/runs/${RUN_ID_1}`);
      }
    });

    it('throws ApiError with 500 status for server errors', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 500,
        body: { error: 'Internal server error' }
      }));

      const { listRuns } = await import('@/lib/api/client');

      await expect(listRuns(REAL)).rejects.toThrow(ApiError);

      try {
        await listRuns(REAL);
      } catch (err) {
        expect((err as ApiError).status).toBe(500);
      }
    });
  });
});
