'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Inbox, Play } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { LineChartCard } from '@/components/charts/line-chart-card';
import { BarChartCard } from '@/components/charts/bar-chart-card';
import { RunsTable } from '@/components/runs/runs-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { getAuditLogs, getDashboardOverview } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatCurrency, formatDateTime, formatNumber, formatPercent } from '@/lib/utils/format';

export default function DashboardPage() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const overviewQuery = useQuery({
    queryKey: ['dashboard-overview', demoMode],
    queryFn: () => getDashboardOverview(demoMode)
  });
  const auditQuery = useQuery({ queryKey: ['audit-log', demoMode], queryFn: () => getAuditLogs(demoMode) });

  const topScenarios = useMemo(() => {
    const counts = new Map<string, number>();
    (overviewQuery.data?.runs ?? []).forEach((run) => {
      const key = String(run.metadata?.scenarioRef ?? run.source?.ref ?? 'unknown');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [overviewQuery.data?.runs]);

  if (overviewQuery.isLoading) {
    return (
      <LoadingPanel
        title="Loading dashboard"
        description="Building KPI cards, charts, run health, and recent audit activity."
      />
    );
  }

  if (overviewQuery.error || !overviewQuery.data) {
    return (
      <ErrorPanel
        message={String(overviewQuery.error ?? 'Dashboard data is unavailable.')}
        actionHref="/runs"
        actionLabel="Open runs"
      />
    );
  }

  const { kpis, charts, runs, runtimeHealth, packs } = overviewQuery.data;
  const successRate = kpis.totalRuns === 0 ? 0 : kpis.completedRuns / kpis.totalRuns;
  const activeRuns = runs.filter((run) => ['queued', 'starting', 'binding_session', 'running'].includes(run.status));
  const recentRuns = runs.slice(0, 4);
  const recentAudit = auditQuery.data?.data.slice(0, 6) ?? [];

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Execution orchestration and observability</h1>
          <p>
            Launch MACP scenarios, watch multi-agent execution flow live, inspect traces and emitted signals, and
            correlate decisions against historical run analytics.
          </p>
        </div>
        <div className="section-actions">
          <Link href="/runs/new" className="button button-primary">
            <Play size={16} />
            Launch scenario
          </Link>
          <Link href="/observability" className="button button-secondary">
            Explore metrics
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {kpis.totalRuns === 0 && (
        <EmptyState
          icon={<Inbox size={20} />}
          title="Welcome to MACP Console"
          description="No runs recorded yet. Launch a scenario from the catalog to see execution data, charts, and analytics here."
          action={
            <Link href="/runs/new" className="button button-primary">
              <Play size={16} />
              Launch your first scenario
            </Link>
          }
        />
      )}

      <div className="grid-4">
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Total runs</div>
            <div className="kpi-value">{formatNumber(kpis.totalRuns)}</div>
            <div className="kpi-meta">Across {packs.length} packs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Success rate</div>
            <div className="kpi-value">{formatPercent(successRate)}</div>
            <div className="kpi-meta">Healthy decision completion rate</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Signals emitted</div>
            <div className="kpi-value">{formatNumber(kpis.totalSignals)}</div>
            <div className="kpi-meta">Across live + historical executions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Total cost</div>
            <div className="kpi-value">{kpis.totalCostUsd > 0 ? formatCurrency(kpis.totalCostUsd) : '—'}</div>
            <div className="kpi-meta">
              {kpis.totalTokens > 0 ? `${formatNumber(kpis.totalTokens)} tokens processed` : 'No token data'}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid-4">
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Completed</div>
            <div className="kpi-value" style={{ color: 'var(--success)' }}>
              {formatNumber(kpis.completedRuns)}
            </div>
            <div className="kpi-meta">Successfully resolved runs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Suspended</div>
            <div className="kpi-value" style={{ color: 'var(--warning)' }}>
              {formatNumber(kpis.suspendedRuns)}
            </div>
            <div className="kpi-meta">Paused runs with banked TTL</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Failed</div>
            <div className="kpi-value" style={{ color: 'var(--danger)' }}>
              {formatNumber(kpis.failedRuns)}
            </div>
            <div className="kpi-meta">Runs that encountered errors</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Cancelled</div>
            <div className="kpi-value" style={{ color: 'var(--warning)' }}>
              {formatNumber(kpis.cancelledRuns)}
            </div>
            <div className="kpi-meta">Manually or automatically cancelled</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid-2">
        <LineChartCard title="Run volume trend" data={charts.runVolume} />
        <LineChartCard title="Latency and signal trend" data={charts.latency} secondaryKey="secondary" />
        <BarChartCard title="Error classes over time" data={charts.errors} />
        <LineChartCard title="Signal frequency + active runs" data={charts.signals} secondaryKey="secondary" />
      </div>

      <div className="split-layout">
        <Card>
          <CardHeader>
            <CardTitle>Service health and runtime posture</CardTitle>
            <CardDescription>
              Control plane runtime connectivity, environment readiness, and active execution posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="inline-list">
              <StatusBadge status={runtimeHealth.ok ? 'ok' : 'failed'} />
              <Badge label={runtimeHealth.runtimeKind} tone="info" />
              <Badge label={`${kpis.activeRuns} active`} />
            </div>
            <div className="metric-strip">
              <div className="metric-box">
                <div className="muted small">Runtime kind</div>
                <div className="metric-box-value">{runtimeHealth.runtimeKind}</div>
              </div>
              <div className="metric-box">
                <div className="muted small">Active executions</div>
                <div className="metric-box-value">{kpis.activeRuns}</div>
              </div>
              <div className="metric-box">
                <div className="muted small">Avg execution time</div>
                <div className="metric-box-value">{Math.round(kpis.averageDurationMs / 1000)}s</div>
              </div>
            </div>
            <div className="list-item">
              <div className="list-item-title">Health detail</div>
              <div className="list-item-meta">
                {runtimeHealth.detail ?? 'Runtime health endpoint reports healthy status.'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most used scenarios</CardTitle>
            <CardDescription>Hotspots by scenario ref across recent activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="list">
              {topScenarios.map(([scenario, count]) => (
                <div key={scenario} className="list-item">
                  <div className="list-item-title">{scenario}</div>
                  <div className="list-item-meta">{count} runs</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <SectionHeader
        title="Live and recent runs"
        description="Open a running session to inspect agent behavior and streamed observability data in real time."
        actions={
          <Link href="/runs/live" className="button button-secondary">
            Open live runs
          </Link>
        }
      />
      <RunsTable runs={activeRuns.length ? activeRuns : recentRuns} />

      <div className="grid-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent audit trail</CardTitle>
            <CardDescription>User and system actions captured by the control plane audit feed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="timeline-list">
              {recentAudit.map((entry, index) => (
                <div key={`${entry.action}-${entry.createdAt}-${index}`} className="timeline-item">
                  <div className="list-item-title">{entry.action}</div>
                  <div className="list-item-meta">
                    {entry.actor} · {entry.actorType} · {formatDateTime(entry.createdAt)}
                  </div>
                  <div className="muted small">
                    {entry.resource}
                    {entry.resourceId ? ` / ${entry.resourceId}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently created runs</CardTitle>
            <CardDescription>Fast access to the most recent decisions and their current status.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="list">
              {recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={run.status === 'running' ? `/runs/live/${run.id}` : `/runs/${run.id}`}
                  className="list-item"
                >
                  <div className="list-item-title">
                    {String(run.metadata?.scenarioRef ?? run.source?.ref ?? run.id)}
                  </div>
                  <div className="list-item-meta">
                    {formatDateTime(run.startedAt ?? run.createdAt)} · {String(run.metadata?.environment ?? 'unknown')}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
