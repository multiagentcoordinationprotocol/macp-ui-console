'use client';

import { Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EventDetailDialog } from '@/components/ui/event-detail-dialog';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { RunSelectorFilters, type RunSelectorFiltersValue } from '@/components/runs/run-selector-filters';
import {
  getRunTraces,
  getTraceData,
  getJaegerTrace,
  getJaegerUiUrl,
  listRuns,
  type JaegerSpan,
  type JaegerTrace
} from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatDateTime } from '@/lib/utils/format';
import { buildSpanTree, findCriticalPath, type SpanTreeNode } from '@/lib/utils/traces';

/**
 * PR-D4 — tree-indented span waterfall.
 *
 * Builds a tree from `span.references[CHILD_OF]`, renders each span at
 * its depth with a connector line and a timeline bar. Critical path
 * (longest root→leaf by cumulative duration) is highlighted. Click a
 * row → opens the EventDetailDialog with the full span JSON.
 *
 * Graceful fallback: when `references[]` is missing (runtime-side fix
 * still pending — see backend-changes-plan.md §10), `buildSpanTree`
 * treats every span as a root and the layout degrades to a flat time-
 * sorted list — same as the legacy waterfall.
 */
interface SpanRowProps {
  node: SpanTreeNode;
  trace: JaegerTrace;
  minTime: number;
  maxTime: number;
  critical: Set<string>;
  onSelect: (span: JaegerSpan) => void;
}

function SpanRow({ node, trace, minTime, maxTime, critical, onSelect }: SpanRowProps) {
  const { span, depth } = node;
  const totalDuration = maxTime - minTime || 1;
  const left = ((span.startTime - minTime) / totalDuration) * 100;
  const width = Math.max((span.duration / totalDuration) * 100, 0.5);
  const durationMs = span.duration / 1000;
  const serviceName = trace.processes[span.processID]?.serviceName ?? '';
  const isError = span.tags.some((t) => t.key === 'otel.status_code' && t.value === 'ERROR');
  const isOnCritical = critical.has(span.spanID);

  return (
    <button
      type="button"
      className="span-row"
      onClick={() => onSelect(span)}
      aria-label={`${span.operationName} — ${durationMs.toFixed(1)}ms`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        fontSize: '0.8rem',
        width: '100%',
        background: isOnCritical ? 'var(--v2-accent-glow, rgba(79,110,247,0.1))' : 'transparent',
        border: 'none',
        borderLeft: isOnCritical ? '2px solid var(--v2-accent, var(--brand))' : '2px solid transparent',
        borderRadius: 4,
        cursor: 'pointer',
        textAlign: 'left'
      }}
    >
      <div
        style={{
          width: 260,
          flexShrink: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingLeft: depth * 16
        }}
      >
        {depth > 0 ? (
          <span aria-hidden="true" style={{ color: 'var(--v2-text-faint, var(--muted))', marginRight: 4 }}>
            └
          </span>
        ) : null}
        <span style={{ color: 'var(--v2-text-faint, var(--muted))', fontSize: '0.7rem' }}>{serviceName} </span>
        <strong>{span.operationName}</strong>
      </div>
      <div
        style={{
          flex: 1,
          position: 'relative',
          height: 18,
          background: 'var(--v2-panel-lifted, var(--panel-2))',
          borderRadius: 4
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${left}%`,
            width: `${width}%`,
            height: '100%',
            borderRadius: 3,
            background: isError
              ? 'var(--v2-red, var(--danger))'
              : isOnCritical
                ? 'var(--v2-accent, var(--brand))'
                : 'var(--v2-accent-2, var(--info))',
            minWidth: 2,
            opacity: 0.85
          }}
        />
      </div>
      <div
        style={{
          width: 80,
          flexShrink: 0,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--font-jetbrains-mono, ui-monospace)'
        }}
      >
        {durationMs < 1 ? `${span.duration.toFixed(0)}µs` : `${durationMs.toFixed(1)}ms`}
      </div>
      {isError ? <Badge label="error" tone="danger" /> : null}
    </button>
  );
}

function SpanWaterfall({ trace, onSelect }: { trace: JaegerTrace; onSelect: (span: JaegerSpan) => void }) {
  const visibleTrace = useMemo(
    () => ({
      ...trace,
      spans: trace.spans.filter((s) => !s.operationName.startsWith('middleware'))
    }),
    [trace]
  );

  const tree = useMemo(() => buildSpanTree(visibleTrace), [visibleTrace]);
  const critical = useMemo(() => findCriticalPath(tree), [tree]);

  if (tree.length === 0) return null;
  const minTime = Math.min(...tree.map((n) => n.span.startTime));
  const maxTime = tree.reduce((max, n) => Math.max(max, n.span.startTime + n.span.duration), 0);
  const totalMs = (maxTime - minTime) / 1000;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
          fontSize: '0.75rem',
          color: 'var(--v2-text-faint, var(--muted))'
        }}
      >
        <span>0ms · {tree.length} spans · critical path highlighted</span>
        <span>{totalMs.toFixed(0)}ms</span>
      </div>
      {tree.map((node) => (
        <SpanRow
          key={node.span.spanID}
          node={node}
          trace={trace}
          minTime={minTime}
          maxTime={maxTime}
          critical={critical}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense>
      <TracesPageContent />
    </Suspense>
  );
}

function TracesPageContent() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRunId = searchParams.get('runId') ?? '';
  const initialScenario = searchParams.get('scenario') ?? '';
  const initialStatus = searchParams.get('status') ?? '';

  const [filters, setFilters] = useState<RunSelectorFiltersValue>({
    runId: initialRunId || undefined,
    scenario: initialScenario || undefined,
    status: initialStatus ? (initialStatus as RunSelectorFiltersValue['status']) : undefined
  });
  const [selectedSpan, setSelectedSpan] = useState<JaegerSpan | null>(null);

  const runsQuery = useQuery({
    queryKey: ['trace-runs', demoMode],
    queryFn: () => listRuns(demoMode)
  });

  // Filter runs by scenario / status from the shared selector before picking
  // which run's trace to render.
  const filteredRuns = useMemo(() => {
    const all = runsQuery.data ?? [];
    return all.filter((run) => {
      if (filters.scenario) {
        const ref = run.source?.ref ?? (run.metadata?.scenarioRef as string | undefined);
        if (ref !== filters.scenario) return false;
      }
      if (filters.status && filters.status !== 'all' && run.status !== filters.status) return false;
      return true;
    });
  }, [runsQuery.data, filters.scenario, filters.status]);

  const effectiveRunId = filters.runId || filteredRuns[0]?.id || '';

  // Keep the URL in sync so deep-links share the current filter state.
  const updateFilters = (next: RunSelectorFiltersValue) => {
    setFilters(next);
    const params = new URLSearchParams();
    if (next.runId) params.set('runId', next.runId);
    if (next.scenario) params.set('scenario', next.scenario);
    if (next.status) params.set('status', next.status);
    const suffix = params.toString();
    router.replace(`/traces${suffix ? `?${suffix}` : ''}`, { scroll: false });
  };

  const tracesQuery = useQuery({
    queryKey: ['trace-summary', effectiveRunId, demoMode],
    queryFn: () => getRunTraces(effectiveRunId, demoMode),
    enabled: Boolean(effectiveRunId)
  });
  const artifactsQuery = useQuery({
    queryKey: ['trace-artifacts', effectiveRunId, demoMode],
    queryFn: () => getTraceData(demoMode, effectiveRunId),
    enabled: Boolean(effectiveRunId)
  });

  const traceId = tracesQuery.data?.traceId ?? '';
  const jaegerQuery = useQuery({
    queryKey: ['jaeger-trace', traceId],
    queryFn: () => getJaegerTrace(traceId),
    enabled: Boolean(traceId) && !demoMode && traceId !== '00000000000000000000000000000000'
  });

  const spanRows = useMemo(() => {
    return (artifactsQuery.data ?? []).flatMap((artifact) =>
      Array.isArray((artifact.inline as { spans?: unknown[] } | undefined)?.spans)
        ? ((artifact.inline as { spans: unknown[] }).spans as Array<Record<string, unknown>>).map((span) => ({
            artifact,
            span
          }))
        : []
    );
  }, [artifactsQuery.data]);

  if (runsQuery.isLoading || tracesQuery.isLoading || artifactsQuery.isLoading) {
    return (
      <LoadingPanel title="Loading traces" description="Fetching trace summary artifacts and inline span bundles." />
    );
  }
  if (runsQuery.error || tracesQuery.error || artifactsQuery.error || !tracesQuery.data) {
    return (
      <ErrorPanel
        message={String(runsQuery.error ?? tracesQuery.error ?? artifactsQuery.error ?? 'Unable to load traces.')}
        actionHref="/runs"
      />
    );
  }

  const jaegerTrace = jaegerQuery.data;
  const jaegerSpanCount = jaegerTrace
    ? jaegerTrace.spans.filter((s) => !s.operationName.startsWith('middleware')).length
    : 0;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Traces and artifacts</h1>
          <p>Inspect trace summaries, span waterfalls, and artifacts associated with a run.</p>
        </div>
        {traceId && traceId !== '00000000000000000000000000000000' && (
          <div className="section-actions">
            <Button variant="secondary" onClick={() => window.open(getJaegerUiUrl(traceId), '_blank')}>
              <ExternalLink size={16} />
              Open in Jaeger
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trace scope</CardTitle>
          <CardDescription>Filter by scenario, run, or status. URL stays in sync for shareable links.</CardDescription>
        </CardHeader>
        <CardContent>
          <RunSelectorFilters
            value={filters}
            onChange={updateFilters}
            runs={filteredRuns.length > 0 ? filteredRuns : (runsQuery.data ?? [])}
            showScenario
            showStatus
            showRunId
          />
        </CardContent>
      </Card>

      <div className="grid-3">
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Trace ID</div>
            <div className="kpi-value" style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
              {traceId || 'n/a'}
            </div>
            <div className="kpi-meta">Primary trace for this run</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Spans</div>
            <div className="kpi-value">{jaegerSpanCount || tracesQuery.data.spanCount}</div>
            <div className="kpi-meta">{jaegerTrace ? 'From Jaeger' : 'From control plane'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Artifacts</div>
            <div className="kpi-value">{(artifactsQuery.data ?? []).length}</div>
            <div className="kpi-meta">Trace bundles and reports</div>
          </CardContent>
        </Card>
      </div>

      {jaegerTrace && (
        <Card>
          <CardHeader>
            <CardTitle>Span waterfall (tree)</CardTitle>
            <CardDescription>
              {jaegerSpanCount} spans from{' '}
              {Object.values(jaegerTrace.processes)
                .map((p) => p.serviceName)
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SpanWaterfall trace={jaegerTrace} onSelect={setSelectedSpan} />
          </CardContent>
        </Card>
      )}

      {jaegerTrace && (
        <Card>
          <CardHeader>
            <CardTitle>Span details</CardTitle>
            <CardDescription>All spans sorted by start time with duration and status.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Operation</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...jaegerTrace.spans]
                    .filter((s) => !s.operationName.startsWith('middleware'))
                    .sort((a, b) => a.startTime - b.startTime)
                    .map((span) => {
                      const service = jaegerTrace.processes[span.processID]?.serviceName ?? '';
                      const durationMs = span.duration / 1000;
                      const statusTag = span.tags.find((t) => t.key === 'otel.status_code');
                      const status = statusTag ? String(statusTag.value) : 'OK';
                      return (
                        <tr key={span.spanID}>
                          <td>{service}</td>
                          <td>
                            <strong>{span.operationName}</strong>
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {durationMs < 1 ? `${span.duration}µs` : `${durationMs.toFixed(1)}ms`}
                          </td>
                          <td>
                            <Badge label={status} tone={status === 'ERROR' ? 'danger' : 'success'} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!jaegerTrace && !jaegerQuery.isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>No spans for this run</CardTitle>
            <CardDescription>Finding #3c — show the diagnostic inline instead of a silent empty state.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="empty-state compact">
              <h4>What to check</h4>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li>Is the runtime emitting OTEL spans for this scenario?</li>
                <li>
                  Is the trace ID a placeholder?{' '}
                  <code>{traceId && traceId !== '00000000000000000000000000000000' ? traceId : 'zero-valued'}</code>
                </li>
                <li>Is Jaeger reachable at the configured base URL?</li>
              </ul>
            </div>
            <div>
              <div className="muted small" style={{ marginBottom: 6 }}>
                Raw macp-control-plane trace summary payload
              </div>
              <JsonViewer value={tracesQuery.data} />
            </div>
          </CardContent>
        </Card>
      )}

      {(artifactsQuery.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Reports, traces, logs, and bundles attached to the run.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="list">
              {(artifactsQuery.data ?? []).map((artifact) => (
                <div key={artifact.id} className="list-item">
                  <div className="list-item-title">{artifact.label}</div>
                  <div className="list-item-meta">
                    {artifact.kind} · {formatDateTime(artifact.createdAt)}
                  </div>
                  <div className="inline-list">
                    <Badge label={artifact.kind} tone="info" />
                    {artifact.uri ? <Badge label="uri" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {spanRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Inline spans</CardTitle>
            <CardDescription>Span data embedded in artifact payloads.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Artifact</th>
                    <th>Span ID</th>
                    <th>Operation</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {spanRows.map(({ artifact, span }, index) => (
                    <tr key={`${artifact.id}-${index}`}>
                      <td>{artifact.label}</td>
                      <td>{String(span.spanId ?? 'n/a')}</td>
                      <td>{String(span.operation ?? 'n/a')}</td>
                      <td>{String(span.durationMs ?? 'n/a')}ms</td>
                      <td>{String(span.status ?? 'unknown')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PR-D4 — click-a-span modal. */}
      <EventDetailDialog
        open={selectedSpan !== null}
        onClose={() => setSelectedSpan(null)}
        title={selectedSpan?.operationName ?? 'Span'}
        subtitle={
          selectedSpan
            ? `${(selectedSpan.duration / 1000).toFixed(1)}ms · ${jaegerTrace?.processes[selectedSpan.processID]?.serviceName ?? ''}`
            : undefined
        }
        meta={
          selectedSpan
            ? [
                { label: 'Span ID', value: <code>{selectedSpan.spanID}</code> },
                { label: 'Trace ID', value: <code>{selectedSpan.traceID}</code> },
                {
                  label: 'Start',
                  value: new Date(selectedSpan.startTime / 1000).toISOString()
                },
                {
                  label: 'Status',
                  value: selectedSpan.tags.find((t) => t.key === 'otel.status_code')?.value?.toString() ?? 'OK'
                }
              ]
            : []
        }
        payload={selectedSpan ?? {}}
      />
    </div>
  );
}
