import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ApiError } from '@/lib/api/fetcher';
import { FetchMocker } from './helpers/fetch-mocker';
import {
  RUN_ID_1,
  RUN_ID_2,
  TRACE_ID,
  runsListResponse,
  runRecord,
  runStateProjection,
  createRunResponse,
  validateRunResponse,
  batchExportResponse,
  canonicalEvents,
  auditLogs
} from './fixtures/backend-responses';

/**
 * Integration tests for run lifecycle operations through the API client.
 * Uses FetchMocker to intercept /api/proxy/... calls and return canned
 * backend responses, validating the client's request/response handling.
 */
describe('Runs Lifecycle (integration)', () => {
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

  describe('listRuns', () => {
    it('returns normalized RunRecord array', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: runsListResponse(3)
      }));

      const { listRuns } = await import('@/lib/api/client');
      const runs = await listRuns(false);

      expect(runs).toHaveLength(3);
      expect(runs[0]).toHaveProperty('id');
      expect(runs[0]).toHaveProperty('status');
      expect(runs[0]).toHaveProperty('runtimeKind');
    });

    it('passes search params as query string', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: runsListResponse(1)
      }));

      const { listRuns } = await import('@/lib/api/client');
      await listRuns(false, { status: 'running', limit: 5 });

      const lastReq = mocker.requests.at(-1)!;
      expect(lastReq.url).toContain('status=running');
      expect(lastReq.url).toContain('limit=5');
    });

    it('normalizes sourceKind/sourceRef into source object', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: {
          data: [runRecord(RUN_ID_1, { sourceKind: 'api', sourceRef: 'test-suite' })],
          total: 1
        }
      }));

      const { listRuns } = await import('@/lib/api/client');
      const runs = await listRuns(false);

      expect(runs[0].source).toEqual({ kind: 'api', ref: 'test-suite' });
    });

    it('listRuns handles empty result', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: { data: [], total: 0 }
      }));

      const { listRuns } = await import('@/lib/api/client');
      const runs = await listRuns(false);

      expect(runs).toEqual([]);
      expect(runs).toHaveLength(0);
    });

    it('passes through archivedAt from CP directly', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: {
          data: [
            runRecord(RUN_ID_1, {
              archivedAt: '2026-04-01T12:00:00Z'
            })
          ],
          total: 1
        }
      }));

      const { listRuns } = await import('@/lib/api/client');
      const runs = await listRuns(false);

      expect(runs[0].archivedAt).toBe('2026-04-01T12:00:00Z');
    });

    it('returns null archivedAt when CP does not set it', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: {
          data: [runRecord(RUN_ID_1)],
          total: 1
        }
      }));

      const { listRuns } = await import('@/lib/api/client');
      const runs = await listRuns(false);

      expect(runs[0].archivedAt).toBeNull();
    });
  });

  describe('getRun', () => {
    it('returns a single normalized run', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({
        status: 200,
        body: runRecord(RUN_ID_1)
      }));

      const { getRun } = await import('@/lib/api/client');
      const run = await getRun(RUN_ID_1, false);

      expect(run.id).toBe(RUN_ID_1);
      expect(run.status).toBe('running');
      expect(run.runtimeKind).toBe('rust');
    });

    it('throws on 404', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs/nonexistent', () => ({
        status: 404,
        body: { error: 'not found' }
      }));

      const { getRun } = await import('@/lib/api/client');
      await expect(getRun('nonexistent', false)).rejects.toThrow();
    });

    it('getRun returns ApiError on 500', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({
        status: 500,
        body: { error: 'internal server error' }
      }));

      const { getRun } = await import('@/lib/api/client');
      await expect(getRun(RUN_ID_1, false)).rejects.toThrow(ApiError);

      try {
        await getRun(RUN_ID_1, false);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
      }
    });
  });

  describe('getRunState', () => {
    it('returns run state projection', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/state`, () => ({
        status: 200,
        body: runStateProjection(RUN_ID_1)
      }));

      const { getRunState } = await import('@/lib/api/client');
      const state = await getRunState(RUN_ID_1, false);

      expect(state.run.runId).toBe(RUN_ID_1);
      expect(state.participants).toHaveLength(2);
      expect(state.graph.nodes).toHaveLength(2);
      expect(state.decision.current).toHaveProperty('action', 'approve');
      expect(state.timeline.latestSeq).toBe(5);
    });

    it('returns policy field with commitmentEvaluations', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/state`, () => ({
        status: 200,
        body: runStateProjection(RUN_ID_1)
      }));

      const { getRunState } = await import('@/lib/api/client');
      const state = await getRunState(RUN_ID_1, false);

      expect(state.policy).toBeDefined();
      expect(state.policy!.policyVersion).toBe('policy.default');
      expect(state.policy!.policyDescription).toBe('Default policy');
      expect(state.policy!.resolvedAt).toBe('2026-04-01T10:05:00Z');
      expect(Array.isArray(state.policy!.commitmentEvaluations)).toBe(true);
      expect(state.policy!.commitmentEvaluations).toHaveLength(1);
      expect(state.policy!.commitmentEvaluations[0]).toHaveProperty('commitmentId', 'eval-001');
      expect(state.policy!.commitmentEvaluations[0]).toHaveProperty('decision', 'allow');
    });
  });

  describe('createRun', () => {
    it('sends POST and returns runId + status', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs', () => ({
        status: 201,
        body: createRunResponse()
      }));

      const { createRun } = await import('@/lib/api/client');
      const result = await createRun({ mode: 'live', session: { modeName: 'macp.mode.decision.v1' } }, false);

      expect(result.runId).toBe(RUN_ID_1);
      expect(result.status).toBe('queued');
      expect(result.traceId).toBe(TRACE_ID);

      // Verify the POST body was sent
      const postReq = mocker.requests.find((r) => r.method === 'POST');
      expect(postReq).toBeDefined();
      expect((postReq!.body as Record<string, unknown>).mode).toBe('live');
    });
  });

  describe('validateRun', () => {
    it('maps valid response to ok: true', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/validate', () => ({
        status: 200,
        body: validateRunResponse(true)
      }));

      const { validateRun } = await import('@/lib/api/client');
      const result = await validateRun({ mode: 'live' }, false);

      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.runtime.reachable).toBe(true);
    });

    it('maps invalid response to ok: false with errors', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/validate', () => ({
        status: 200,
        body: validateRunResponse(false)
      }));

      const { validateRun } = await import('@/lib/api/client');
      const result = await validateRun({}, false);

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('cancelRun', () => {
    it('sends POST with cancellation reason', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/cancel`, () => ({
        status: 200,
        body: { id: RUN_ID_1, status: 'cancelled' }
      }));

      const { cancelRun } = await import('@/lib/api/client');
      const result = await cancelRun(RUN_ID_1, false);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('cancelled');

      const postReq = mocker.requests.find((r) => r.method === 'POST');
      expect((postReq!.body as Record<string, unknown>).reason).toBe('Cancelled from MACP UI');
    });

    it('cancelRun propagates ApiError on 422', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/cancel`, () => ({
        status: 422,
        body: { error: 'Run is not in a cancellable state' }
      }));

      const { cancelRun } = await import('@/lib/api/client');
      await expect(cancelRun(RUN_ID_1, false)).rejects.toThrow(ApiError);

      try {
        await cancelRun(RUN_ID_1, false);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(422);
      }
    });
  });

  describe('archiveRun', () => {
    it('sends POST and returns archived flag', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/archive`, () => ({
        status: 200,
        body: { id: RUN_ID_1, status: 'completed' }
      }));

      const { archiveRun } = await import('@/lib/api/client');
      const result = await archiveRun(RUN_ID_1, false);

      expect(result.ok).toBe(true);
      expect(result.archived).toBe(true);
    });
  });

  describe('cloneRun', () => {
    it('creates a new run from an existing one', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/clone`, () => ({
        status: 201,
        body: { runId: RUN_ID_2, status: 'queued', traceId: 'trace-002' }
      }));

      const { cloneRun } = await import('@/lib/api/client');
      const result = await cloneRun(RUN_ID_1, false);

      expect(result).toHaveProperty('runId', RUN_ID_2);
    });
  });

  describe('deleteRun', () => {
    it('sends DELETE request', async () => {
      mocker.on('DELETE', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}`, () => ({
        status: 204
      }));

      const { deleteRun } = await import('@/lib/api/client');
      await deleteRun(RUN_ID_1, false);

      const delReq = mocker.requests.find((r) => r.method === 'DELETE');
      expect(delReq).toBeDefined();
      expect(delReq!.url).toContain(RUN_ID_1);
    });
  });

  describe('Batch operations', () => {
    const ids = [RUN_ID_1, RUN_ID_2];

    it('batchCancelRuns sends all IDs', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/batch/cancel', (url, init) => ({
        status: 200,
        body: { results: ids.map((id) => ({ runId: id, ok: true })) }
      }));

      const { batchCancelRuns } = await import('@/lib/api/client');
      const result = await batchCancelRuns(ids, false);

      expect((result as { results: unknown[] }).results).toHaveLength(2);

      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody.runIds).toEqual(ids);
    });

    it('batchArchiveRuns sends all IDs', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/batch/archive', () => ({
        status: 200,
        body: { results: ids.map((id) => ({ runId: id, ok: true })) }
      }));

      const { batchArchiveRuns } = await import('@/lib/api/client');
      const result = await batchArchiveRuns(ids, false);

      expect((result as { results: unknown[] }).results).toHaveLength(2);
    });

    it('batchDeleteRuns sends all IDs', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/batch/delete', () => ({
        status: 200,
        body: { results: ids.map((id) => ({ runId: id, ok: true })) }
      }));

      const { batchDeleteRuns } = await import('@/lib/api/client');
      const result = await batchDeleteRuns(ids, false);

      expect((result as { results: unknown[] }).results).toHaveLength(2);
    });
  });

  describe('Run export', () => {
    it('exportRunBundle returns full bundle', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/export`, () => ({
        status: 200,
        body: {
          run: runRecord(RUN_ID_1),
          projection: runStateProjection(RUN_ID_1),
          canonicalEvents: [],
          rawEvents: [],
          artifacts: [],
          metrics: { runId: RUN_ID_1, eventCount: 0, messageCount: 0 },
          exportedAt: new Date().toISOString()
        }
      }));

      const { exportRunBundle } = await import('@/lib/api/client');
      const bundle = await exportRunBundle(RUN_ID_1, false);

      expect(bundle.run).toBeDefined();
      expect(bundle.projection).toBeDefined();
      expect(bundle.canonicalEvents).toEqual([]);
    });
  });

  describe('Projection rebuild', () => {
    it('sends POST and returns rebuild result', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/projection/rebuild`, () => ({
        status: 200,
        body: { rebuilt: true, latestSeq: 42 }
      }));

      const { rebuildProjection } = await import('@/lib/api/client');
      const result = await rebuildProjection(RUN_ID_1, false);

      expect(result).toEqual({ rebuilt: true, latestSeq: 42 });
    });
  });

  describe('compareRuns', () => {
    it('sends both run IDs and returns comparison', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/compare', () => ({
        status: 200,
        body: {
          left: { runId: RUN_ID_1, status: 'completed', modeName: 'decision', durationMs: 8000 },
          right: { runId: RUN_ID_2, status: 'completed', modeName: 'decision', durationMs: 9500 },
          statusMatch: true,
          durationDeltaMs: 1500,
          participantsDiff: { added: [], removed: [], common: ['agent-a', 'agent-b'] },
          signalsDiff: { added: [], removed: [] }
        }
      }));

      const { compareRuns } = await import('@/lib/api/client');
      const result = await compareRuns(RUN_ID_1, RUN_ID_2, false);

      expect(result.statusMatch).toBe(true);
      expect(result.durationDeltaMs).toBe(1500);
      expect(result.participantsDiff.common).toContain('agent-a');
    });
  });

  describe('cloneRun with overrides', () => {
    it('sends tags and context overrides in POST body', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/clone`, () => ({
        status: 201,
        body: { runId: RUN_ID_2, status: 'queued', traceId: 'trace-clone-001' }
      }));

      const { cloneRun } = await import('@/lib/api/client');
      const result = await cloneRun(RUN_ID_1, false, {
        tags: ['cloned', 'experiment'],
        context: { overrideKey: 'value' }
      });

      expect(result.runId).toBe(RUN_ID_2);

      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody.tags).toEqual(['cloned', 'experiment']);
      expect(postBody.context).toEqual({ overrideKey: 'value' });
    });

    it('sends empty body when no overrides provided', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/clone`, () => ({
        status: 201,
        body: { runId: RUN_ID_2, status: 'queued', traceId: 'trace-clone-002' }
      }));

      const { cloneRun } = await import('@/lib/api/client');
      await cloneRun(RUN_ID_1, false);

      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody).toEqual({});
    });
  });

  describe('batchExportRuns', () => {
    it('sends run IDs and returns export bundles', async () => {
      const ids = [RUN_ID_1, RUN_ID_2];
      mocker.on('POST', '/api/proxy/macp-control-plane/runs/batch/export', () => ({
        status: 200,
        body: batchExportResponse(ids)
      }));

      const { batchExportRuns } = await import('@/lib/api/client');
      const bundles = await batchExportRuns(ids, false);

      expect(bundles).toHaveLength(2);
      expect(bundles[0]).toHaveProperty('run');
      expect(bundles[0]).toHaveProperty('projection');
      expect(bundles[0]).toHaveProperty('canonicalEvents');
      expect(bundles[0]).toHaveProperty('metrics');

      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody.runIds).toEqual(ids);
    });
  });

  describe('getRunEvents with custom limit', () => {
    it('getRunEvents respects custom limit parameter', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: canonicalEvents(RUN_ID_1, 3)
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      await getRunEvents(RUN_ID_1, false, 100);

      const lastReq = mocker.requests.at(-1)!;
      expect(lastReq.url).toContain('afterSeq=0');
      expect(lastReq.url).toContain('limit=100');
    });
  });

  describe('getAuditLogs with pagination', () => {
    it('getAuditLogs passes pagination parameters', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/audit', () => ({
        status: 200,
        body: auditLogs()
      }));

      const { getAuditLogs } = await import('@/lib/api/client');
      await getAuditLogs(false, { limit: 50, offset: 10 });

      const lastReq = mocker.requests.at(-1)!;
      expect(lastReq.url).toContain('limit=50');
      expect(lastReq.url).toContain('offset=10');
    });
  });

  describe('Server-side filters', () => {
    it('passes environment and search params to GET /runs', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runs', () => ({
        status: 200,
        body: runsListResponse(1)
      }));

      const { listRuns } = await import('@/lib/api/client');
      await listRuns(false, { status: 'completed', environment: 'prod', search: 'fraud' });

      const lastReq = mocker.requests.at(-1)!;
      expect(lastReq.url).toContain('status=completed');
      expect(lastReq.url).toContain('environment=prod');
      expect(lastReq.url).toContain('search=fraud');
    });
  });
});
