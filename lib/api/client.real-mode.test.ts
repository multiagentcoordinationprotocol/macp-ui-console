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
  runtimeSessionDrift,
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

  /* ─── getRuntimeSessionDrift ─── */

  describe('getRuntimeSessionDrift', () => {
    const URL = '/api/proxy/macp-control-plane/admin/runtime/sessions';

    it('issues exactly one GET to the admin drift endpoint and returns the payload', async () => {
      mocker.on('GET', URL, () => ({ status: 200, body: runtimeSessionDrift() }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const result = await getRuntimeSessionDrift(REAL);

      expect(mocker.requests.filter((r) => r.url.includes('/admin/runtime/sessions'))).toHaveLength(1);
      expect(result.complete).toBe(true);
      expect(result.untrackedSessions).toHaveLength(1);
      expect(result.missingFromRuntime).toHaveLength(1);
    });

    it('preserves missingFromRuntime as strictly null on a truncated drain', async () => {
      // `null` means "not computed" — a partial session prefix cannot prove absence. It must
      // never arrive as `[]` (which means a real "no drift") or `undefined`.
      mocker.on('GET', URL, () => ({
        status: 200,
        body: runtimeSessionDrift({ complete: false, missingFromRuntime: null })
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const result = await getRuntimeSessionDrift(REAL);

      expect(result.complete).toBe(false);
      expect(result.missingFromRuntime).toBeNull();
      expect(result.missingFromRuntime).not.toEqual([]);
      // untrackedSessions stays sound under truncation and must still be present.
      expect(result.untrackedSessions).toHaveLength(1);
    });

    it('preserves an empty missingFromRuntime as [] — a real "no drift" answer', async () => {
      // Counts adjusted to stay reachable: with nothing untracked, every live session is bound to
      // a tracked run, so live must not exceed trackedRunCount.
      mocker.on('GET', URL, () => ({
        status: 200,
        body: runtimeSessionDrift({
          runtimeSessionCount: 6,
          liveRuntimeSessionCount: 4,
          trackedRunCount: 4,
          missingFromRuntime: [],
          untrackedSessions: []
        })
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const result = await getRuntimeSessionDrift(REAL);

      expect(result.missingFromRuntime).toEqual([]);
      expect(result.missingFromRuntime).not.toBeNull();
    });

    it('surfaces CIRCUIT_BREAKER_OPEN and RUNTIME_UNAVAILABLE as distinguishable 503s', async () => {
      // Both are HTTP 503. Status alone cannot tell an operator which happened — only errorCode
      // can, which is why this depends on the structured-error phase.
      const { getRuntimeSessionDrift } = await import('@/lib/api/client');

      mocker.on('GET', URL, () => ({
        status: 503,
        body: { statusCode: 503, errorCode: 'CIRCUIT_BREAKER_OPEN', message: 'runtime circuit breaker is open' }
      }));
      const breaker = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);
      expect(breaker).toBeInstanceOf(ApiError);
      expect((breaker as ApiError).status).toBe(503);
      expect((breaker as ApiError).errorCode).toBe('CIRCUIT_BREAKER_OPEN');
      expect((breaker as ApiError).detail).toBe('runtime circuit breaker is open');

      mocker.on('GET', URL, () => ({
        status: 503,
        body: { statusCode: 503, errorCode: 'RUNTIME_UNAVAILABLE', message: 'runtime is not reachable' }
      }));
      const unavailable = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);
      expect((unavailable as ApiError).status).toBe(503);
      expect((unavailable as ApiError).errorCode).toBe('RUNTIME_UNAVAILABLE');

      // The point of the pair: same status, different code.
      expect((breaker as ApiError).status).toBe((unavailable as ApiError).status);
      expect((breaker as ApiError).errorCode).not.toBe((unavailable as ApiError).errorCode);
    });

    it('surfaces a 504 RUNTIME_TIMEOUT', async () => {
      mocker.on('GET', URL, () => ({
        status: 504,
        body: { statusCode: 504, errorCode: 'RUNTIME_TIMEOUT', message: 'listSessions timed out' }
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const err = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);

      expect((err as ApiError).status).toBe(504);
      expect((err as ApiError).errorCode).toBe('RUNTIME_TIMEOUT');
    });

    it('surfaces a 429 RATE_LIMITED, which only the runtime produces', async () => {
      // The CP maps the runtime's gRPC RESOURCE_EXHAUSTED to this. It is reachable only after the
      // page-size halving budget is spent, so it means "the runtime is shedding load", not "you
      // called too often".
      mocker.on('GET', URL, () => ({
        status: 429,
        body: { statusCode: 429, errorCode: 'RATE_LIMITED', message: 'runtime rejected the page as too large' }
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const err = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);

      expect((err as ApiError).status).toBe(429);
      expect((err as ApiError).errorCode).toBe('RATE_LIMITED');
    });

    it('surfaces the CP throttler 429, which is mislabelled INTERNAL_ERROR', async () => {
      // The single most misleading response this endpoint can return. ThrottlerException carries
      // a STRING body, so the CP's exception filter rewrites it into the AppException shape with
      // a hardcoded INTERNAL_ERROR. A consumer that renders errorCode would tell an operator the
      // control plane crashed when it actually rate-limited them. This test exists so a UI
      // branching on errorCode has a fixture proving the code can lie.
      mocker.on('GET', URL, () => ({
        status: 429,
        body: { statusCode: 429, errorCode: 'INTERNAL_ERROR', message: 'ThrottlerException: Too Many Requests' }
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const err = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);

      expect((err as ApiError).status).toBe(429);
      // Not RATE_LIMITED, despite being a rate limit — status is the trustworthy signal here.
      expect((err as ApiError).errorCode).toBe('INTERNAL_ERROR');
    });

    it('surfaces a 500 INTERNAL_ERROR', async () => {
      mocker.on('GET', URL, () => ({
        status: 500,
        body: { statusCode: 500, errorCode: 'INTERNAL_ERROR', message: 'Internal server error' }
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const err = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);

      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).errorCode).toBe('INTERNAL_ERROR');
    });

    it('handles a snapshot carrying only the three guaranteed fields, and empty-string extras', async () => {
      // The realistic shape. proto3 string defaults mean modeVersion/initiator arrive as '' rather
      // than absent, so a consumer using `??` would render blank instead of a placeholder.
      mocker.on('GET', URL, () => ({
        status: 200,
        body: runtimeSessionDrift({
          untrackedSessions: [
            { sessionId: 'session-bare-01', mode: 'macp.mode.decision.v1', state: 'SESSION_STATE_SUSPENDED' },
            {
              sessionId: 'session-empty-02',
              mode: 'macp.mode.decision.v1',
              state: 'SESSION_STATE_OPEN',
              modeVersion: '',
              initiator: ''
            }
          ]
        })
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const result = await getRuntimeSessionDrift(REAL);

      expect(result.untrackedSessions[0].startedAtUnixMs).toBeUndefined();
      expect(result.untrackedSessions[0].modeVersion).toBeUndefined();
      // Present but empty — the case `??` does not catch.
      expect(result.untrackedSessions[1].modeVersion).toBe('');
      expect(result.untrackedSessions[1].initiator).toBe('');
    });

    it('surfaces a 401 as a status with no errorCode — the CP auth guard uses the Nest default body', async () => {
      // Callers must treat this as "check the control-plane credential" based on the STATUS;
      // there is no code to branch on.
      mocker.on('GET', URL, () => ({
        status: 401,
        body: { statusCode: 401, message: 'Missing Authorization header', error: 'Unauthorized' }
      }));

      const { getRuntimeSessionDrift } = await import('@/lib/api/client');
      const err = await getRuntimeSessionDrift(REAL).catch((e: unknown) => e as ApiError);

      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).errorCode).toBeUndefined();
      expect((err as ApiError).detail).toBe('Missing Authorization header');
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
