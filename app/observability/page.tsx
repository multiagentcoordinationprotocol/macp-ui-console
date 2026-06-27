'use client';

import { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, AlertTriangle, Database, ExternalLink, HeartPulse, RotateCcw, ShieldCheck } from 'lucide-react';
import { LineChartCard } from '@/components/charts/line-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { Tabs } from '@/components/ui/tabs';
import {
  RunSelectorFilters,
  type RunSelectorFiltersValue,
  type TimeWindow
} from '@/components/runs/run-selector-filters';
import { PrometheusMetricsTable } from '@/components/observability/prometheus-metrics-table';
import { CircuitBreakerTimeline } from '@/components/observability/circuit-breaker-timeline';
import {
  getAuditLogs,
  getCircuitBreakerHistory,
  getDashboardOverview,
  getObservabilityRawMetrics,
  getReadinessProbe,
  getRuntimeHealth,
  resetCircuitBreaker
} from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { histogramQuantile, parsePrometheusText } from '@/lib/utils/prometheus';

export default function ObservabilityPage() {
  return (
    <Suspense>
      <ObservabilityPageContent />
    </Suspense>
  );
}

function ObservabilityPageContent() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<RunSelectorFiltersValue>(() => ({
    scenario: searchParams.get('scenario') ?? undefined,
    environment: searchParams.get('environment') ?? undefined,
    window: (searchParams.get('window') as TimeWindow) ?? '24h'
  }));

  const activeTab = searchParams.get('tab') ?? 'overview';

  const syncUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = {
      scenario: filters.scenario,
      environment: filters.environment,
      window: filters.window,
      tab: activeTab,
      ...overrides
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== 'overview') params.set(k, v);
    }
    const suffix = params.toString();
    router.replace(`/observability${suffix ? `?${suffix}` : ''}`, { scroll: false });
  };

  const updateFilters = (next: RunSelectorFiltersValue) => {
    setFilters(next);
    syncUrl({ scenario: next.scenario, environment: next.environment, window: next.window });
  };

  const overviewQuery = useQuery({
    queryKey: ['observability-overview', demoMode, filters.scenario, filters.environment, filters.window],
    queryFn: () =>
      getDashboardOverview(demoMode, {
        window:
          filters.window === 'all' || !filters.window ? undefined : (filters.window as Exclude<TimeWindow, 'all'>),
        scenarioRef: filters.scenario,
        environment: filters.environment
      })
  });
  const healthQuery = useQuery({ queryKey: ['runtime-health', demoMode], queryFn: () => getRuntimeHealth(demoMode) });
  const metricsTextQuery = useQuery({
    queryKey: ['raw-metrics', demoMode],
    queryFn: () => getObservabilityRawMetrics(demoMode)
  });
  const auditQuery = useQuery({ queryKey: ['observability-audit', demoMode], queryFn: () => getAuditLogs(demoMode) });
  const readinessQuery = useQuery({ queryKey: ['readiness', demoMode], queryFn: () => getReadinessProbe(demoMode) });
  const breakerHistoryQuery = useQuery({
    queryKey: ['circuit-breaker-history', demoMode, filters.window],
    queryFn: () =>
      getCircuitBreakerHistory(
        demoMode,
        filters.window === 'all' ? undefined : (filters.window as Exclude<TimeWindow, 'all'>)
      )
  });
  const resetBreakerMutation = useMutation({ mutationFn: () => resetCircuitBreaker(demoMode) });

  // Parse Prometheus text once per response; derive latency percentiles from
  // `macp_run_duration_seconds` histogram buckets (BE §5.4 / PR-F6).
  const parsedMetrics = useMemo(
    () => (metricsTextQuery.data ? parsePrometheusText(metricsTextQuery.data) : []),
    [metricsTextQuery.data]
  );
  const latencyHistogram = useMemo(
    () => parsedMetrics.find((m) => m.name === 'macp_run_duration_seconds' && m.type === 'histogram'),
    [parsedMetrics]
  );
  const latencyPercentiles = useMemo(() => {
    if (!latencyHistogram) return null;
    return {
      p50: histogramQuantile(latencyHistogram, 0.5),
      p95: histogramQuantile(latencyHistogram, 0.95),
      p99: histogramQuantile(latencyHistogram, 0.99)
    };
  }, [latencyHistogram]);

  if (overviewQuery.isLoading || healthQuery.isLoading) {
    return (
      <LoadingPanel
        title="Loading observability dashboard"
        description="Querying runtime health, audit activity, and metrics snapshots."
      />
    );
  }
  if (overviewQuery.error || healthQuery.error || !overviewQuery.data || !healthQuery.data) {
    const errors = [
      overviewQuery.error ? `Overview: ${String(overviewQuery.error)}` : '',
      healthQuery.error ? `Health: ${String(healthQuery.error)}` : '',
      !overviewQuery.data && !overviewQuery.error ? 'Overview data is unavailable.' : '',
      !healthQuery.data && !healthQuery.error ? 'Health data is unavailable.' : ''
    ]
      .filter(Boolean)
      .join(' · ');
    return <ErrorPanel message={errors} actionHref="/" />;
  }

  const subsidiaryErrors = [
    metricsTextQuery.error ? 'Metrics' : '',
    auditQuery.error ? 'Audit' : '',
    readinessQuery.error ? 'Readiness' : ''
  ].filter(Boolean);

  const { charts, kpis } = overviewQuery.data;
  const health = healthQuery.data;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Observability</h1>
          <p>Monitor runtime health, chart latency and error trends, inspect raw metrics, and review audit activity.</p>
        </div>
      </div>

      {subsidiaryErrors.length > 0 && (
        <div className="empty-state compact" style={{ borderColor: 'var(--warning)' }}>
          <h4 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} /> Partial data load
          </h4>
          <p>
            Some data sources failed to load: {subsidiaryErrors.join(', ')}. The page may show incomplete information.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scope</CardTitle>
          <CardDescription>
            Scenario, environment, and time window filter the KPI aggregates + chart series below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunSelectorFilters
            value={filters}
            onChange={updateFilters}
            runs={overviewQuery.data.runs}
            showScenario
            showEnvironment
            showWindow
          />
        </CardContent>
      </Card>

      <Tabs
        defaultValue={activeTab}
        onTabChange={(id) => syncUrl({ tab: id })}
        items={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <div className="stack">
                <div className="grid-4">
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Runtime health</div>
                      <div className="kpi-value" style={{ fontSize: '1.4rem' }}>
                        {health.ok ? 'Healthy' : 'Degraded'}
                      </div>
                      <div className="kpi-meta">{health.runtimeKind}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Total runs</div>
                      <div className="kpi-value">{kpis.totalRuns}</div>
                      <div className="kpi-meta">Active {kpis.activeRuns}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Success rate</div>
                      <div className="kpi-value">
                        {kpis.totalRuns > 0 ? `${Math.round((kpis.completedRuns / kpis.totalRuns) * 100)}%` : '—'}
                      </div>
                      <div className="kpi-meta">
                        {kpis.completedRuns}/{kpis.totalRuns} completed
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Failure rate</div>
                      <div className="kpi-value">
                        {kpis.totalRuns > 0 ? `${Math.round((kpis.failedRuns / kpis.totalRuns) * 100)}%` : '—'}
                      </div>
                      <div className="kpi-meta">
                        {kpis.failedRuns} failed · {kpis.cancelledRuns} cancelled
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Avg duration</div>
                      <div className="kpi-value">
                        {kpis.averageDurationMs > 0
                          ? kpis.averageDurationMs < 1000
                            ? `${Math.round(kpis.averageDurationMs)}ms`
                            : `${(kpis.averageDurationMs / 1000).toFixed(1)}s`
                          : '—'}
                      </div>
                      <div className="kpi-meta">Across completed runs</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Signals</div>
                      <div className="kpi-value">{kpis.totalSignals}</div>
                      <div className="kpi-meta">Decision-support observations</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Total cost</div>
                      <div className="kpi-value">
                        {kpis.totalCostUsd > 0 ? `$${kpis.totalCostUsd.toFixed(2)}` : '—'}
                      </div>
                      <div className="kpi-meta">Estimated (all runs)</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="kpi-card">
                      <div className="kpi-label">Total tokens</div>
                      <div className="kpi-value">{kpis.totalTokens > 0 ? kpis.totalTokens.toLocaleString() : '—'}</div>
                      <div className="kpi-meta">Prompt + completion</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid-2">
                  <LineChartCard title="Latency over time" data={charts.latency} secondaryKey="secondary" />
                  <LineChartCard title="Run and error volume" data={charts.runVolume} secondaryKey="secondary" />
                  <BarChartCard title="Error histogram" data={charts.errors} />
                  <LineChartCard title="Signal throughput" data={charts.signals} secondaryKey="secondary" />
                </div>

                {(charts.throughput?.length ?? 0) > 0 ||
                (charts.queueDepth?.length ?? 0) > 0 ||
                (charts.latencyP95?.length ?? 0) > 0 ||
                (charts.cost?.length ?? 0) > 0 ? (
                  <div className="grid-2">
                    {(charts.throughput?.length ?? 0) > 0 ? (
                      <LineChartCard
                        title="Throughput (runs / min)"
                        data={charts.throughput}
                        secondaryKey="secondary"
                      />
                    ) : null}
                    {(charts.queueDepth?.length ?? 0) > 0 ? (
                      <LineChartCard title="Queue depth" data={charts.queueDepth} secondaryKey="secondary" />
                    ) : null}
                    {(charts.latencyP95?.length ?? 0) > 0 ? (
                      <LineChartCard
                        title="Latency p50 / p95 / p99"
                        data={charts.latencyP95}
                        secondaryKey="secondary"
                      />
                    ) : null}
                    {(charts.cost?.length ?? 0) > 0 ? (
                      <LineChartCard title="Estimated cost over time" data={charts.cost} secondaryKey="secondary" />
                    ) : null}
                  </div>
                ) : null}

                {latencyPercentiles ? (
                  <div className="grid-3">
                    <Card>
                      <CardContent className="kpi-card">
                        <div className="kpi-label">p50 latency</div>
                        <div className="kpi-value">
                          {latencyPercentiles.p50 !== null ? `${latencyPercentiles.p50.toFixed(2)}s` : '—'}
                        </div>
                        <div className="kpi-meta">from Prometheus histogram</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="kpi-card">
                        <div className="kpi-label">p95 latency</div>
                        <div className="kpi-value">
                          {latencyPercentiles.p95 !== null ? `${latencyPercentiles.p95.toFixed(2)}s` : '—'}
                        </div>
                        <div className="kpi-meta">from Prometheus histogram</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="kpi-card">
                        <div className="kpi-label">p99 latency</div>
                        <div className="kpi-value">
                          {latencyPercentiles.p99 !== null ? `${latencyPercentiles.p99.toFixed(2)}s` : '—'}
                        </div>
                        <div className="kpi-meta">from Prometheus histogram</div>
                      </CardContent>
                    </Card>
                  </div>
                ) : null}
              </div>
            )
          },
          {
            id: 'infrastructure',
            label: 'Infrastructure',
            content: (
              <div className="stack">
                {!health.ok ? (
                  <div className="empty-state compact">
                    <h4 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={16} /> Runtime is degraded
                    </h4>
                    <p>
                      Inspect the health detail and readiness probe below, then review traces and audit logs for
                      correlated failures.
                    </p>
                  </div>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <HeartPulse size={18} /> Readiness probe
                    </CardTitle>
                    <CardDescription>
                      Live readiness status from the Control Plane, checking database, runtime, stream consumer, and
                      circuit breaker.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="stack">
                    <div className="inline-list">
                      <StatusBadge status={readinessQuery.data?.ok ? 'ok' : 'failed'} />
                      {readinessQuery.data && (
                        <>
                          <Badge
                            label={`Database: ${readinessQuery.data.database}`}
                            tone={readinessQuery.data.database === 'ok' ? 'success' : 'danger'}
                          />
                          <Badge
                            label={`Stream: ${readinessQuery.data.streamConsumer}`}
                            tone={readinessQuery.data.streamConsumer === 'ok' ? 'success' : 'danger'}
                          />
                          <Badge
                            label={`Circuit breaker: ${readinessQuery.data.circuitBreaker}`}
                            tone={readinessQuery.data.circuitBreaker === 'CLOSED' ? 'success' : 'danger'}
                          />
                          <Badge
                            label={`Runtime: ${readinessQuery.data.runtime?.ok ? 'healthy' : 'degraded'}`}
                            tone={readinessQuery.data.runtime?.ok ? 'success' : 'danger'}
                          />
                        </>
                      )}
                    </div>
                    {readinessQuery.data ? <JsonViewer value={readinessQuery.data} /> : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Activity size={18} /> Health detail
                    </CardTitle>
                    <CardDescription>
                      Root-cause friendly payloads for runtime health troubleshooting and deployment verification.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <JsonViewer value={health} />
                  </CardContent>
                </Card>

                {(breakerHistoryQuery.data?.length ?? 0) > 0 ? (
                  <CircuitBreakerTimeline entries={breakerHistoryQuery.data!} />
                ) : null}

                <div className="grid-2">
                  <Card>
                    <CardHeader>
                      <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <RotateCcw size={18} /> Circuit breaker
                      </CardTitle>
                      <CardDescription>
                        Reset the control plane circuit breaker if runtime connections are stuck.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="stack">
                      <div className="inline-list">
                        <Badge
                          label={readinessQuery.data?.circuitBreaker ?? 'unknown'}
                          tone={readinessQuery.data?.circuitBreaker === 'CLOSED' ? 'success' : 'danger'}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => resetBreakerMutation.mutate()}
                        disabled={resetBreakerMutation.isPending}
                      >
                        <RotateCcw size={14} />
                        {resetBreakerMutation.isPending ? 'Resetting...' : 'Reset circuit breaker'}
                      </Button>
                      {resetBreakerMutation.data ? <JsonViewer value={resetBreakerMutation.data} /> : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <ExternalLink size={18} /> External tools
                      </CardTitle>
                      <CardDescription>Links to external monitoring infrastructure.</CardDescription>
                    </CardHeader>
                    <CardContent className="stack">
                      <a
                        href="/api/proxy/macp-control-plane/metrics"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button button-secondary"
                      >
                        <ExternalLink size={14} />
                        Open raw Prometheus metrics
                      </a>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )
          },
          {
            id: 'metrics',
            label: 'Metrics',
            content: (
              <div className="stack">
                <Card>
                  <CardHeader>
                    <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Database size={18} /> Prometheus metrics
                    </CardTitle>
                    <CardDescription>
                      Parsed exposition format. Click a metric for label breakdown; raw text is available via the link
                      below.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="stack">
                    <PrometheusMetricsTable metrics={parsedMetrics} />
                    <a
                      href="/api/proxy/macp-control-plane/metrics"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="panel-action"
                      style={{ alignSelf: 'flex-end' }}
                    >
                      Open raw exposition ↗
                    </a>
                  </CardContent>
                </Card>
              </div>
            )
          },
          {
            id: 'audit',
            label: 'Audit',
            content: (
              <div className="stack">
                <Card>
                  <CardHeader>
                    <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <ShieldCheck size={18} /> Audit stream
                    </CardTitle>
                    <CardDescription>Administrative and user actions emitted by the control plane.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="timeline-list">
                      {(auditQuery.data?.data ?? []).slice(0, 20).map((entry, index) => (
                        <div key={`${entry.action}-${index}`} className="timeline-item">
                          <div className="list-item-title">{entry.action}</div>
                          <div className="list-item-meta">
                            {entry.actor} · {entry.resource}
                            {entry.resourceId ? ` · ${entry.resourceId}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          }
        ]}
      />
    </div>
  );
}
