'use client';

import { Suspense, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowRightLeft, Clock4, Download, History, Play, RotateCcw } from 'lucide-react';
import { RunsTable } from '@/components/runs/runs-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { SectionHeader } from '@/components/ui/section-header';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { listRuns } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatCurrency, formatNumber, formatRelativeDuration } from '@/lib/utils/format';
import { exportToCsv, exportToJson, flattenRunForCsv } from '@/lib/utils/export';
import { getRunDurationMs } from '@/lib/utils/macp';
import type { ListRunsQuery } from '@/lib/types';

function RunHistoryContent() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const searchParams = useSearchParams();
  const router = useRouter();

  const status = searchParams.get('status') ?? 'all';
  const environment = searchParams.get('environment') ?? 'all';
  const search = searchParams.get('search') ?? '';
  const sortBy = (searchParams.get('sortBy') as ListRunsQuery['sortBy']) ?? 'createdAt';
  const sortOrder = (searchParams.get('sortOrder') as ListRunsQuery['sortOrder']) ?? 'desc';
  const createdAfter = searchParams.get('createdAfter') ?? '';
  const createdBefore = searchParams.get('createdBefore') ?? '';
  const includeArchived = searchParams.get('includeArchived') === 'true';
  const scenarioRef = searchParams.get('scenarioRef') ?? '';

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const clearFilters = useCallback(() => {
    router.replace('/runs', { scroll: false });
  }, [router]);

  const hasActiveFilters =
    status !== 'all' ||
    environment !== 'all' ||
    search ||
    createdAfter ||
    createdBefore ||
    includeArchived ||
    scenarioRef;

  const serverParams = useMemo<Partial<ListRunsQuery>>(() => {
    const params: Partial<ListRunsQuery> = { sortBy, sortOrder };
    if (status !== 'all') params.status = status as ListRunsQuery['status'];
    if (environment !== 'all') params.environment = environment;
    if (search.trim()) params.search = search.trim();
    if (createdAfter) params.createdAfter = createdAfter;
    if (createdBefore) params.createdBefore = createdBefore;
    if (includeArchived) params.includeArchived = true;
    if (scenarioRef.trim()) params.scenarioRef = scenarioRef.trim();
    return params;
  }, [status, environment, search, sortBy, sortOrder, createdAfter, createdBefore, includeArchived, scenarioRef]);

  const runsQuery = useQuery({
    queryKey: ['runs', demoMode, serverParams],
    queryFn: () => listRuns(demoMode, serverParams)
  });

  const filteredRuns = useMemo(() => {
    if (!demoMode) return runsQuery.data ?? [];
    return runsQuery.data ?? [];
  }, [demoMode, runsQuery.data]);

  const aggregate = useMemo(() => {
    const totalCost = filteredRuns.reduce((sum, run) => sum + Number(run.metadata?.estimatedCostUsd ?? 0), 0);
    const totalTokens = filteredRuns.reduce((sum, run) => sum + Number(run.metadata?.totalTokens ?? 0), 0);
    const averageDuration = filteredRuns.length
      ? filteredRuns.reduce((sum, run) => sum + getRunDurationMs(run), 0) / filteredRuns.length
      : 0;
    return { totalCost, totalTokens, averageDuration };
  }, [filteredRuns]);

  const environments = useMemo(() => {
    const envs = new Set<string>();
    for (const run of runsQuery.data ?? []) {
      const env = String(run.metadata?.environment ?? '');
      if (env) envs.add(env);
    }
    return Array.from(envs).sort();
  }, [runsQuery.data]);

  if (runsQuery.isLoading)
    return (
      <LoadingPanel
        title="Loading run history"
        description="Fetching historical runs, filters, and analytics aggregates."
      />
    );
  if (runsQuery.error || !runsQuery.data)
    return <ErrorPanel message={String(runsQuery.error ?? 'Run history is unavailable.')} actionHref="/" />;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Run history</h1>
          <p>
            Search completed and failed executions, compare outcomes across modes, and reopen any run for detailed
            forensics.
          </p>
        </div>
        <div className="section-actions">
          <Link href="/runs/new" className="button button-primary">
            <Play size={16} />
            New run
          </Link>
          <button
            className="button button-secondary"
            onClick={() => exportToCsv(filteredRuns.map(flattenRunForCsv), 'macp-runs.csv')}
          >
            <Download size={16} />
            Export CSV
          </button>
          <button className="button button-ghost" onClick={() => exportToJson(filteredRuns, 'macp-runs.json')}>
            <Download size={16} />
            Export JSON
          </button>
          <Link href="/runs/live" className="button button-secondary">
            <Clock4 size={16} />
            Live runs
          </Link>
        </div>
      </div>

      <div className="grid-4">
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Filtered runs</div>
            <div className="kpi-value">{filteredRuns.length}</div>
            <div className="kpi-meta">Based on current search and status filters</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Avg duration</div>
            <div className="kpi-value">{formatRelativeDuration(aggregate.averageDuration)}</div>
            <div className="kpi-meta">Execution time across filtered runs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Tokens</div>
            <div className="kpi-value">{aggregate.totalTokens > 0 ? formatNumber(aggregate.totalTokens) : '—'}</div>
            <div className="kpi-meta">{aggregate.totalTokens > 0 ? 'Prompt + completion usage' : 'No token data'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Estimated cost</div>
            <div className="kpi-value">{aggregate.totalCost > 0 ? formatCurrency(aggregate.totalCost) : '—'}</div>
            <div className="kpi-meta">{aggregate.totalCost > 0 ? 'Across the filtered sample' : 'No cost data'}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Slice by run status, environment, date range, or search terms embedded in scenario refs and tags.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="grid-3">
            <div>
              <label className="field-label">Search</label>
              <Input
                value={search}
                onChange={(event) => setFilter('search', event.target.value)}
                placeholder="run id, scenario ref, tag..."
              />
            </div>
            <div>
              <label className="field-label">Status</label>
              <Select value={status} onChange={(event) => setFilter('status', event.target.value)}>
                <option value="all">All statuses</option>
                <option value="running">Running</option>
                <option value="suspended">Suspended</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div>
              <label className="field-label">Environment</label>
              <Select value={environment} onChange={(event) => setFilter('environment', event.target.value)}>
                <option value="all">All environments</option>
                {environments.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid-4">
            <div>
              <label className="field-label">Sort by</label>
              <Select value={sortBy} onChange={(event) => setFilter('sortBy', event.target.value)}>
                <option value="createdAt">Created at</option>
                <option value="updatedAt">Updated at</option>
              </Select>
            </div>
            <div>
              <label className="field-label">Order</label>
              <Select value={sortOrder} onChange={(event) => setFilter('sortOrder', event.target.value)}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </Select>
            </div>
            <div>
              <label className="field-label">Created after</label>
              <Input
                type="date"
                value={createdAfter}
                onChange={(event) => setFilter('createdAfter', event.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Created before</label>
              <Input
                type="date"
                value={createdBefore}
                onChange={(event) => setFilter('createdBefore', event.target.value)}
              />
            </div>
          </div>
          <div className="grid-3">
            <div>
              <label className="field-label">Scenario ref</label>
              <Input
                value={scenarioRef}
                onChange={(event) => setFilter('scenarioRef', event.target.value)}
                placeholder="e.g. high-value-new-device"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => setFilter('includeArchived', event.target.checked ? 'true' : '')}
                />
                <span>Include archived</span>
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              {hasActiveFilters && (
                <button className="button button-ghost" onClick={clearFilters}>
                  <RotateCcw size={14} />
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <SectionHeader
        title="Historical runs"
        description="Open any run to inspect traces, signals, context, and final decisions."
        actions={
          <Link href="/runs/live" className="button button-ghost">
            <History size={16} />
            Open running sessions
          </Link>
        }
      />
      <RunsTable runs={filteredRuns} />

      <div className="grid-2">
        {filteredRuns.slice(0, 2).map((run) => (
          <Card key={run.id}>
            <CardHeader>
              <CardTitle>{String(run.metadata?.scenarioRef ?? run.source?.ref ?? run.id)}</CardTitle>
              <CardDescription>Quick snapshot for compare and replay routing.</CardDescription>
            </CardHeader>
            <CardContent className="stack">
              <div className="inline-list">
                <StatusBadge status={run.status} />
                <Badge label={String(run.metadata?.environment ?? 'unknown')} tone="info" />
              </div>
              <div className="metric-strip">
                <div className="metric-box">
                  <div className="muted small">Duration</div>
                  <div className="metric-box-value">{formatRelativeDuration(getRunDurationMs(run))}</div>
                </div>
                <div className="metric-box">
                  <div className="muted small">Tokens</div>
                  <div className="metric-box-value">{formatNumber(Number(run.metadata?.totalTokens ?? 0))}</div>
                </div>
                <div className="metric-box">
                  <div className="muted small">Action</div>
                  <div className="metric-box-value" style={{ fontSize: '1rem' }}>
                    {String(run.metadata?.finalAction ?? 'pending')}
                  </div>
                </div>
              </div>
              <div className="section-actions">
                <Link href={`/runs/${run.id}`} className="button button-secondary">
                  Open run
                </Link>
                <Link
                  href={`/runs/${run.id}/compare/${filteredRuns.find((candidate) => candidate.id !== run.id)?.id ?? run.id}`}
                  className="button button-ghost"
                >
                  <ArrowRightLeft size={16} />
                  Compare
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function RunHistoryPage() {
  return (
    <Suspense
      fallback={
        <LoadingPanel
          title="Loading run history"
          description="Fetching historical runs, filters, and analytics aggregates."
        />
      }
    >
      <RunHistoryContent />
    </Suspense>
  );
}
