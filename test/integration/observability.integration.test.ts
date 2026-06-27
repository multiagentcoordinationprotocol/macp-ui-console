import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FetchMocker } from './helpers/fetch-mocker';
import {
  RUN_ID_1,
  canonicalEvents,
  metricsSummary,
  traceSummary,
  artifactsList,
  auditLogs,
  webhooksList,
  runtimeHealth,
  runtimeManifest,
  runtimeModes,
  runtimeRoots,
  readinessProbe,
  agentMetrics,
  prometheusMetrics,
  readinessProbeResponse,
  runtimeManifestResponse,
  runtimeModesResponse,
  runtimeRootsResponse
} from './fixtures/backend-responses';

/**
 * Integration tests for observability and runtime endpoints through
 * the API client: events, metrics, traces, artifacts, audit logs,
 * webhooks, runtime health/manifest/modes, readiness probe.
 */
describe('Observability (integration)', () => {
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

  describe('Run events', () => {
    it('getRunEvents returns canonical events for a run', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: canonicalEvents(RUN_ID_1, 5)
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      const events = await getRunEvents(RUN_ID_1, false);

      expect(events).toHaveLength(5);
      expect(events[0]).toHaveProperty('id');
      expect(events[0]).toHaveProperty('runId', RUN_ID_1);
      expect(events[0]).toHaveProperty('seq', 1);
      expect(events[0]).toHaveProperty('type');
      expect(events[0]).toHaveProperty('source');
      expect(events[0].source.kind).toBe('runtime');
    });

    it('requests events with limit=500', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/events`, () => ({
        status: 200,
        body: canonicalEvents(RUN_ID_1)
      }));

      const { getRunEvents } = await import('@/lib/api/client');
      await getRunEvents(RUN_ID_1, false);

      const req = mocker.requests.at(-1)!;
      expect(req.url).toContain('limit=500');
    });
  });

  describe('Run metrics', () => {
    it('getRunMetrics returns metrics summary', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/metrics`, () => ({
        status: 200,
        body: metricsSummary(RUN_ID_1)
      }));

      const { getRunMetrics } = await import('@/lib/api/client');
      const metrics = await getRunMetrics(RUN_ID_1, false);

      expect(metrics.runId).toBe(RUN_ID_1);
      expect(metrics.eventCount).toBe(12);
      expect(metrics.messageCount).toBe(8);
      expect(metrics.signalCount).toBe(2);
      expect(metrics.durationMs).toBe(11000);
    });

    it('getRunMetrics returns token usage fields', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/metrics`, () => ({
        status: 200,
        body: metricsSummary(RUN_ID_1)
      }));

      const { getRunMetrics } = await import('@/lib/api/client');
      const metrics = await getRunMetrics(RUN_ID_1, false);

      expect(metrics.promptTokens).toBe(1500);
      expect(metrics.completionTokens).toBe(400);
      expect(metrics.totalTokens).toBe(1900);
      expect(metrics.estimatedCostUsd).toBe(0.005);
    });
  });

  describe('Run traces', () => {
    it('getRunTraces returns trace summary', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/traces`, () => ({
        status: 200,
        body: traceSummary()
      }));

      const { getRunTraces } = await import('@/lib/api/client');
      const traces = await getRunTraces(RUN_ID_1, false);

      expect(traces.traceId).toBeDefined();
      expect(traces.spanCount).toBe(8);
      expect(traces.linkedArtifacts).toContain('artifact-001');
    });
  });

  describe('Run artifacts', () => {
    it('getRunArtifacts returns artifacts list', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/artifacts`, () => ({
        status: 200,
        body: artifactsList(RUN_ID_1)
      }));

      const { getRunArtifacts } = await import('@/lib/api/client');
      const artifacts = await getRunArtifacts(RUN_ID_1, false);

      expect(artifacts).toHaveLength(2);
      expect(artifacts[0].kind).toBe('trace');
      expect(artifacts[1].kind).toBe('json');
      expect(artifacts[1].inline).toHaveProperty('action', 'approve');
    });

    it('returns empty array when no artifacts', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/artifacts`, () => ({
        status: 200,
        body: []
      }));

      const { getRunArtifacts } = await import('@/lib/api/client');
      const artifacts = await getRunArtifacts(RUN_ID_1, false);

      expect(artifacts).toEqual([]);
    });
  });

  describe('Audit logs', () => {
    it('getAuditLogs returns paginated audit entries', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/audit', () => ({
        status: 200,
        body: auditLogs()
      }));

      const { getAuditLogs } = await import('@/lib/api/client');
      const result = await getAuditLogs(false);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.data[0].action).toBe('run.create');
      expect(result.data[1].action).toBe('run.complete');
    });
  });

  describe('Webhooks', () => {
    it('getWebhooks returns subscription list', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/webhooks', () => ({
        status: 200,
        body: webhooksList()
      }));

      const { getWebhooks } = await import('@/lib/api/client');
      const webhooks = await getWebhooks(false);

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].url).toContain('hooks.example.com');
      expect(webhooks[0].events).toContain('run.completed');
    });

    it('createWebhook sends POST with url, secret, events', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/webhooks', () => ({
        status: 201,
        body: {
          id: 'wh-new',
          url: 'https://test.example.com/hook',
          events: ['run.completed'],
          secret: 'sec_123',
          active: true,
          createdAt: '2026-04-04T00:00:00Z',
          updatedAt: '2026-04-04T00:00:00Z'
        }
      }));

      const { createWebhook } = await import('@/lib/api/client');
      const webhook = await createWebhook(
        { url: 'https://test.example.com/hook', secret: 'sec_123', events: ['run.completed'] },
        false
      );

      expect(webhook.id).toBe('wh-new');
      expect(webhook.active).toBe(true);

      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody.url).toBe('https://test.example.com/hook');
      expect(postBody.events).toEqual(['run.completed']);
    });

    it('updateWebhook sends PATCH', async () => {
      mocker.on('PATCH', '/api/proxy/macp-control-plane/webhooks/wh-001', () => ({
        status: 200,
        body: { ...webhooksList()[0], active: false }
      }));

      const { updateWebhook } = await import('@/lib/api/client');
      const result = await updateWebhook('wh-001', { active: false }, false);

      expect(result).toHaveProperty('active', false);
      expect(mocker.requests.at(-1)!.method).toBe('PATCH');
    });

    it('deleteWebhook sends DELETE', async () => {
      mocker.on('DELETE', '/api/proxy/macp-control-plane/webhooks/wh-001', () => ({
        status: 204
      }));

      const { deleteWebhook } = await import('@/lib/api/client');
      await deleteWebhook('wh-001', false);

      expect(mocker.requests.at(-1)!.method).toBe('DELETE');
    });
  });

  describe('Runtime endpoints', () => {
    it('getRuntimeHealth returns health status', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
        status: 200,
        body: runtimeHealth()
      }));

      const { getRuntimeHealth } = await import('@/lib/api/client');
      const health = await getRuntimeHealth(false);

      expect(health.ok).toBe(true);
      expect(health.runtimeKind).toBe('rust');
    });

    it('getRuntimeManifest returns manifest', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/manifest', () => ({
        status: 200,
        body: runtimeManifest()
      }));

      const { getRuntimeManifest } = await import('@/lib/api/client');
      const manifest = await getRuntimeManifest(false);

      expect(manifest.agentId).toBe('macp-runtime');
      expect(manifest.supportedModes).toContain('macp.mode.decision.v1');
    });

    it('getRuntimeModes returns mode descriptors', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/modes', () => ({
        status: 200,
        body: runtimeModes()
      }));

      const { getRuntimeModes } = await import('@/lib/api/client');
      const modes = await getRuntimeModes(false);

      expect(modes).toHaveLength(1);
      expect(modes[0].mode).toBe('macp.mode.decision.v1');
      expect(modes[0].messageTypes).toContain('Proposal');
    });

    it('getRuntimeRoots returns root descriptors', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/roots', () => ({
        status: 200,
        body: runtimeRoots()
      }));

      const { getRuntimeRoots } = await import('@/lib/api/client');
      const roots = await getRuntimeRoots(false);

      expect(roots).toHaveLength(1);
      expect(roots[0].uri).toBe('file:///workspace');
    });
  });

  describe('Readiness and admin', () => {
    it('getReadinessProbe returns health checks', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/readyz', () => ({
        status: 200,
        body: readinessProbe()
      }));

      const { getReadinessProbe } = await import('@/lib/api/client');
      const result = await getReadinessProbe(false);

      expect(result.ok).toBe(true);
      expect(result.database).toBe('ok');
      expect(result.streamConsumer).toBe('ok');
      expect(result.circuitBreaker).toBe('CLOSED');
    });

    it('resetCircuitBreaker sends POST', async () => {
      mocker.on('POST', '/api/proxy/macp-control-plane/admin/circuit-breaker/reset', () => ({
        status: 200,
        body: { status: 'ok', state: 'CLOSED' }
      }));

      const { resetCircuitBreaker } = await import('@/lib/api/client');
      const result = await resetCircuitBreaker(false);

      expect(result).toEqual({ status: 'ok', state: 'CLOSED' });
    });
  });

  describe('Artifacts (write)', () => {
    it('createArtifact sends artifact payload', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/artifacts`, () => ({
        status: 201,
        body: { id: 'artifact-new', runId: RUN_ID_1, kind: 'json', label: 'Result' }
      }));

      const { createArtifact } = await import('@/lib/api/client');
      const result = await createArtifact(RUN_ID_1, { kind: 'json', label: 'Result', inline: { value: 42 } }, false);

      expect(result).toHaveProperty('id', 'artifact-new');
    });
  });

  describe('Agent metrics', () => {
    it('getAgentMetrics returns per-agent metrics from CP', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/agents/metrics', () => ({
        status: 200,
        body: agentMetrics()
      }));

      const { getAgentMetrics } = await import('@/lib/api/client');
      const metrics = await getAgentMetrics(false);

      expect(metrics).toHaveLength(2);
      expect(metrics[0]).toHaveProperty('agentRef', 'fraud-detector');
      expect(metrics[0]).toHaveProperty('runs', 24);
      expect(metrics[0]).toHaveProperty('signals', 48);
      expect(metrics[0]).toHaveProperty('messages', 96);
      expect(metrics[0].averageLatencyMs).toBeUndefined();
      expect(metrics[0]).toHaveProperty('averageConfidence', 0.87);
    });

    it('returns empty array when endpoint fails', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/agents/metrics', () => ({
        status: 500,
        body: { error: 'internal error' }
      }));

      const { getAgentMetrics } = await import('@/lib/api/client');
      const metrics = await getAgentMetrics(false);

      expect(metrics).toEqual([]);
    });
  });

  describe('Observability raw metrics', () => {
    it('getObservabilityRawMetrics returns prometheus text', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/metrics', () => ({
        status: 200,
        body: prometheusMetrics()
      }));

      const { getObservabilityRawMetrics } = await import('@/lib/api/client');
      const result = await getObservabilityRawMetrics(false);

      expect(typeof result).toBe('string');
      expect(result).toContain('macp_runs_total');
      expect(result).toContain('macp_events_total');
    });
  });

  describe('Readiness probe (extended)', () => {
    it('getReadinessProbe returns health checks with messageQueue', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/readyz', () => ({
        status: 200,
        body: readinessProbeResponse()
      }));

      const { getReadinessProbe } = await import('@/lib/api/client');
      const result = await getReadinessProbe(false);

      expect(result.ok).toBe(true);
      expect(result.database).toBe('ok');
      expect(result.streamConsumer).toBe('ok');
      expect(result.circuitBreaker).toBe('CLOSED');
    });
  });

  describe('Runtime endpoints (extended)', () => {
    it('getRuntimeManifest returns manifest with full fields', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/manifest', () => ({
        status: 200,
        body: runtimeManifestResponse()
      }));

      const { getRuntimeManifest } = await import('@/lib/api/client');
      const manifest = await getRuntimeManifest(false);

      expect(manifest.agentId).toBe('macp-runtime-1');
      expect(manifest.title).toBe('MACP Runtime');
      expect(manifest.supportedModes).toContain('negotiation');
      expect(manifest.supportedModes).toContain('decision');
      expect(manifest.metadata).toEqual({ version: '1.0.0' });
    });

    it('getRuntimeModes returns mode descriptors', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/modes', () => ({
        status: 200,
        body: runtimeModesResponse()
      }));

      const { getRuntimeModes } = await import('@/lib/api/client');
      const modes = await getRuntimeModes(false);

      expect(modes).toHaveLength(1);
      expect(modes[0].mode).toBe('negotiation');
      expect(modes[0].title).toBe('Negotiation Mode');
      expect(modes[0].messageTypes).toContain('Offer');
      expect(modes[0].terminalMessageTypes).toContain('Accept');
    });

    it('getRuntimeRoots returns root descriptors', async () => {
      mocker.on('GET', '/api/proxy/macp-control-plane/runtime/roots', () => ({
        status: 200,
        body: runtimeRootsResponse()
      }));

      const { getRuntimeRoots } = await import('@/lib/api/client');
      const roots = await getRuntimeRoots(false);

      expect(roots).toHaveLength(1);
      expect(roots[0].uri).toBe('file:///opt/macp/workspace');
      expect(roots[0].name).toBe('macp-workspace');
    });
  });

  describe('Replay', () => {
    it('createReplay sends POST with mode and speed', async () => {
      mocker.on('POST', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/replay`, () => ({
        status: 200,
        body: {
          runId: RUN_ID_1,
          mode: 'timed',
          speed: 1,
          streamUrl: `/runs/${RUN_ID_1}/replay/stream`,
          stateUrl: `/runs/${RUN_ID_1}/replay/state`
        }
      }));

      const { createReplay } = await import('@/lib/api/client');
      const replay = await createReplay(RUN_ID_1, false);

      expect(replay.runId).toBe(RUN_ID_1);
      expect(replay.mode).toBe('timed');
      expect(replay.streamUrl).toContain('replay/stream');
    });

    it('getTimelineFrame fetches state at specific seq', async () => {
      mocker.on('GET', `/api/proxy/macp-control-plane/runs/${RUN_ID_1}/replay/state`, () => ({
        status: 200,
        body: {
          run: { runId: RUN_ID_1, status: 'running' },
          participants: [],
          graph: { nodes: [], edges: [] },
          decision: {},
          signals: { signals: [] },
          progress: { entries: [] },
          timeline: { latestSeq: 10, totalEvents: 10, recent: [] },
          trace: { spanCount: 0, linkedArtifacts: [] },
          outboundMessages: { total: 0, queued: 0, accepted: 0, rejected: 0 }
        }
      }));

      const { getTimelineFrame } = await import('@/lib/api/client');
      const frame = await getTimelineFrame(RUN_ID_1, 10, false);

      expect(frame).toBeDefined();
      expect(frame!.timeline.latestSeq).toBe(10);

      const req = mocker.requests.at(-1)!;
      expect(req.url).toContain('seq=10');
    });
  });
});
