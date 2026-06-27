import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FetchMocker } from './helpers/fetch-mocker';
import { RUN_ID_1, runsListResponse, dashboardOverview, runtimeHealth, packsList } from './fixtures/backend-responses';

/**
 * Integration tests for the dashboard overview aggregation.
 * getDashboardOverview fetches from multiple endpoints in parallel and
 * normalizes the response — these tests verify that composition logic.
 */
describe('Dashboard (integration)', () => {
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

  function setupAllEndpoints() {
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 200,
      body: dashboardOverview()
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: runsListResponse(5)
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));
  }

  it('aggregates data from all endpoints', async () => {
    setupAllEndpoints();

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.kpis).toBeDefined();
    expect(result.kpis.totalRuns).toBe(42);
    expect(result.kpis.activeRuns).toBe(3);
    // CP overview now includes `recentRuns`; the client prefers those
    // over a separate listRuns round-trip. The fixture embeds two.
    expect(result.runs).toHaveLength(2);
    expect(result.packs).toHaveLength(2);
    expect(result.runtimeHealth.ok).toBe(true);
  });

  it('falls back to listRuns when CP overview omits recentRuns', async () => {
    // Older CP builds don't include recentRuns — confirm the client
    // still populates runs by calling listRuns.
    const overviewWithoutRecentRuns = { ...dashboardOverview() } as Record<string, unknown>;
    delete overviewWithoutRecentRuns.recentRuns;
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 200,
      body: overviewWithoutRecentRuns
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: runsListResponse(5)
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.runs).toHaveLength(5);
  });

  it('returns run breakdown counts from CP kpis', async () => {
    setupAllEndpoints();

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    // totalRuns=42, completedRuns=35
    expect(result.kpis.completedRuns).toBe(35);
    expect(result.kpis.failedRuns).toBeDefined();
    expect(result.kpis.cancelledRuns).toBeDefined();
  });

  it('converts chart data to ChartPoint arrays', async () => {
    setupAllEndpoints();

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.charts.runVolume).toEqual([
      { label: 'Mon', value: 10 },
      { label: 'Tue', value: 12 },
      { label: 'Wed', value: 8 }
    ]);
    expect(result.charts.latency).toHaveLength(3);
    expect(result.charts.errors).toHaveLength(2);
    expect(result.charts.signals).toHaveLength(3);
  });

  it('uses runtime health from CP overview when available', async () => {
    setupAllEndpoints();

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    // CP overview provides runtimeHealth, so it should use that
    expect(result.runtimeHealth.runtimeKind).toBe('rust');
  });

  it('handles CP overview failure gracefully', async () => {
    // CP overview fails but other endpoints succeed
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 500,
      body: { error: 'internal error' }
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: runsListResponse(3)
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    // Falls back to computing from runs list
    expect(result.kpis.totalRuns).toBe(3);
    expect(result.runs).toHaveLength(3);
    expect(result.packs).toHaveLength(2);
    // Falls back to direct runtime health
    expect(result.runtimeHealth.ok).toBe(true);
  });

  it('computes KPIs from runs when CP overview has no kpis', async () => {
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 200,
      body: {} // empty overview
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: {
        data: [
          { id: '1', status: 'running', runtimeKind: 'rust', createdAt: '2026-04-01T10:00:00Z', tags: [] },
          { id: '2', status: 'completed', runtimeKind: 'rust', createdAt: '2026-04-01T10:01:00Z', tags: [] },
          { id: '3', status: 'completed', runtimeKind: 'rust', createdAt: '2026-04-01T10:02:00Z', tags: [] }
        ],
        total: 3
      }
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.kpis.totalRuns).toBe(3);
    expect(result.kpis.activeRuns).toBe(1); // 1 running
    expect(result.kpis.completedRuns).toBe(2); // 2 completed out of 3
  });

  it('extracts totalTokens and totalCostUsd from CP kpis when available', async () => {
    setupAllEndpoints();

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.kpis.totalTokens).toBe(84200);
    expect(result.kpis.totalCostUsd).toBe(3.42);
  });

  it('falls back to zero when CP kpis omit token/cost fields', async () => {
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 200,
      body: {
        kpis: { totalRuns: 10, activeRuns: 1, completedRuns: 8, failedRuns: 1, avgDurationMs: 5000, totalSignals: 20 },
        charts: {},
        runtimeHealth: { ok: true, runtimeKind: 'rust' }
      }
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: runsListResponse(2)
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.kpis.totalTokens).toBe(0);
    expect(result.kpis.totalCostUsd).toBe(0);
  });

  it('getDashboardOverview returns degraded flag when overview endpoint returns 500', async () => {
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 500,
      body: { error: 'internal server error' }
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: runsListResponse(4)
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    expect(result.degraded).toBe(true);
    expect(result.runs).toHaveLength(4);
    expect(result.packs).toHaveLength(2);
    expect(result.runtimeHealth.ok).toBe(true);
  });

  it('getDashboardOverview succeeds even when overview fails', async () => {
    mocker.on('GET', '/api/proxy/macp-control-plane/dashboard/overview', () => ({
      status: 500,
      body: { error: 'internal server error' }
    }));
    mocker.onPrefix('GET', '/api/proxy/macp-control-plane/runs', () => ({
      status: 200,
      body: {
        data: [
          { id: '1', status: 'running', runtimeKind: 'rust', createdAt: '2026-04-01T10:00:00Z', tags: [] },
          { id: '2', status: 'completed', runtimeKind: 'rust', createdAt: '2026-04-01T10:01:00Z', tags: [] },
          { id: '3', status: 'completed', runtimeKind: 'rust', createdAt: '2026-04-01T10:02:00Z', tags: [] },
          { id: '4', status: 'failed', runtimeKind: 'rust', createdAt: '2026-04-01T10:03:00Z', tags: [] }
        ],
        total: 4
      }
    }));
    mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
      status: 200,
      body: packsList()
    }));
    mocker.on('GET', '/api/proxy/macp-control-plane/runtime/health', () => ({
      status: 200,
      body: runtimeHealth()
    }));

    const { getDashboardOverview } = await import('@/lib/api/client');
    const result = await getDashboardOverview(false);

    // KPIs are computed from the runs fallback when overview fails
    expect(result.kpis.totalRuns).toBe(4);
    expect(result.kpis.activeRuns).toBe(1); // 1 running
    expect(result.kpis.completedRuns).toBe(2); // 2 completed out of 4
    expect(result.kpis.failedRuns).toBe(1);
  });
});
