'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EventDetailDialog } from '@/components/ui/event-detail-dialog';
import { Input, Select } from '@/components/ui/field';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { RunSelectorFilters, type RunSelectorFiltersValue } from '@/components/runs/run-selector-filters';
import { listEvents, listRuns } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CanonicalEvent } from '@/lib/types';
import { summarizeEvent } from '@/lib/utils/events';
import { formatDateTime } from '@/lib/utils/format';

/**
 * PR-F1 — `/logs` with shared filter bar + cross-run `/events` endpoint
 * + date-range + cursor pagination + semantic summaries.
 *
 * Consumes backend §4.1 (`/events`) and §4.2 (`afterTs`/`beforeTs` on
 * per-run events) to support filtering across runs by scenario + type +
 * time window without client-side fan-out.
 *
 * URL state is the source of truth for shareable deep-links (finding
 * #3d / PR-B3): `?runId=...&scenario=...&type=...&from=...&to=...`.
 */

const EVENT_TYPE_GROUPS: Record<string, string[]> = {
  // `run.suspended` / `run.resumed` are macp-proto 0.1.3 canonical events emitted
  // by the macp-control-plane on pause/resume. Session suspend/cancel transitions arrive
  // as `session.state.changed` (with `data.state`), not as discrete session events.
  Run: ['run.created', 'run.started', 'run.completed', 'run.failed', 'run.cancelled', 'run.suspended', 'run.resumed'],
  Session: ['session.opened', 'session.resolved', 'session.expired'],
  Participant: ['participant.joined', 'participant.left', 'participant.progress'],
  Message: ['message.sent', 'message.received', 'message.send_failed'],
  Signal: ['signal.emitted', 'signal.acknowledged'],
  Proposal: ['proposal.submitted', 'proposal.accepted', 'proposal.rejected'],
  Decision: ['decision.proposed', 'decision.finalized'],
  Policy: ['policy.resolved', 'policy.commitment.evaluated', 'policy.denied'],
  Tool: ['tool.call.started', 'tool.call.completed'],
  LLM: ['llm.call.completed']
};

const PAGE_SIZE = 250;

function windowToAfterTs(window?: string): string | undefined {
  if (!window || window === 'all') return undefined;
  const now = Date.now();
  const map: Record<string, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  const ms = map[window];
  if (!ms) return undefined;
  return new Date(now - ms).toISOString();
}

export default function LogsPage() {
  return (
    <Suspense>
      <LogsPageContent />
    </Suspense>
  );
}

function LogsPageContent() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<RunSelectorFiltersValue>(() => ({
    runId: searchParams.get('runId') ?? undefined,
    scenario: searchParams.get('scenario') ?? undefined,
    window: (searchParams.get('window') as RunSelectorFiltersValue['window']) ?? 'all'
  }));
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') ?? 'all');
  const [search, setSearch] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CanonicalEvent | null>(null);

  // Cursor-based pagination: keep an append-only array of page cursors.
  // Filter changes reset cursors in the setters (`updateFilters` /
  // `updateTypeFilter`) — avoids setState-in-render / setState-in-effect
  // cascades. Each cursor produces a separate page fetch that we merge
  // with dedup inside the queryFn.
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);

  const runsQuery = useQuery({ queryKey: ['log-runs', demoMode], queryFn: () => listRuns(demoMode) });

  // When a specific runId is selected, ignore the time window — show all events for that run
  const afterTs = filters.runId ? undefined : windowToAfterTs(filters.window);
  const queryType = typeFilter === 'all' ? undefined : typeFilter;

  // Fetch ALL pages as one concatenated response keyed by the cursor list.
  // React Query caches each page naturally via the last cursor in the key.
  const logsQuery = useQuery({
    queryKey: ['logs-events', demoMode, filters.runId, filters.scenario, queryType, afterTs, cursors],
    queryFn: async () => {
      const pages = await Promise.all(
        cursors.map((cursor) =>
          listEvents(demoMode, {
            runId: filters.runId,
            scenarioRef: filters.scenario,
            type: queryType,
            afterTs,
            afterSeq: cursor,
            limit: PAGE_SIZE
          })
        )
      );
      const seen = new Set<string>();
      const merged: CanonicalEvent[] = [];
      for (const page of pages) {
        for (const event of page.data) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          merged.push(event);
        }
      }
      return {
        data: merged,
        total: pages[pages.length - 1]?.total ?? merged.length,
        nextCursor: pages[pages.length - 1]?.nextCursor
      };
    }
  });

  const accumulated = useMemo<CanonicalEvent[]>(() => logsQuery.data?.data ?? [], [logsQuery.data]);

  // Keep URL in sync with filter state. Also reset pagination cursors
  // because the event stream semantics change when a filter moves.
  const updateFilters = useCallback(
    (next: RunSelectorFiltersValue) => {
      setFilters(next);
      setCursors([undefined]);
      const params = new URLSearchParams();
      if (next.runId) params.set('runId', next.runId);
      if (next.scenario) params.set('scenario', next.scenario);
      if (next.window) params.set('window', next.window);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const suffix = params.toString();
      router.replace(`/logs${suffix ? `?${suffix}` : ''}`, { scroll: false });
    },
    [router, typeFilter]
  );

  const updateTypeFilter = useCallback(
    (nextType: string) => {
      setTypeFilter(nextType);
      setCursors([undefined]);
      const params = new URLSearchParams();
      if (filters.runId) params.set('runId', filters.runId);
      if (filters.scenario) params.set('scenario', filters.scenario);
      if (filters.window) params.set('window', filters.window);
      if (nextType !== 'all') params.set('type', nextType);
      const suffix = params.toString();
      router.replace(`/logs${suffix ? `?${suffix}` : ''}`, { scroll: false });
    },
    [router, filters.runId, filters.scenario, filters.window]
  );

  const filtered = useMemo(() => {
    const lower = search.toLowerCase();
    if (!lower) return accumulated;
    return accumulated.filter((event) => {
      const haystack = [event.type, event.subject?.id, event.subject?.kind, JSON.stringify(event.data)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(lower);
    });
  }, [accumulated, search]);

  const eventTypes = useMemo(() => {
    const dynamicTypes = new Set(accumulated.map((event) => event.type));
    const staticTypes = Object.values(EVENT_TYPE_GROUPS).flat();
    return Array.from(new Set([...staticTypes, ...dynamicTypes])).sort();
  }, [accumulated]);

  const hasMore = Boolean(logsQuery.data?.nextCursor);
  const total = logsQuery.data?.total ?? accumulated.length;

  if (runsQuery.isLoading) {
    return <LoadingPanel title="Loading logs" description="Fetching scenarios and recent runs." />;
  }
  if (runsQuery.error || logsQuery.error) {
    return (
      <ErrorPanel
        message={String(runsQuery.error ?? logsQuery.error ?? 'Unable to load logs.')}
        actionHref="/runs"
        actionLabel="Open runs"
      />
    );
  }

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Logs and canonical events</h1>
          <p>
            Filter by scenario, run, type, or time window. Backend §4.1 powers cross-run queries; cursor-based Load-More
            pagination keeps large scrolls responsive.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Every change updates the URL so the view is shareable. Search is client-side over the current page.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <RunSelectorFilters
            value={filters}
            onChange={updateFilters}
            runs={runsQuery.data ?? []}
            showScenario
            showRunId
            showWindow
          />
          <div className="grid-2">
            <div>
              <label className="field-label">Event type</label>
              <Select value={typeFilter} onChange={(event) => updateTypeFilter(event.target.value)}>
                <option value="all">all</option>
                {Object.entries(EVENT_TYPE_GROUPS).map(([group, types]) => (
                  <optgroup key={group} label={group}>
                    {types.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {eventTypes
                  .filter((t) => !Object.values(EVENT_TYPE_GROUPS).flat().includes(t))
                  .map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <label className="field-label">Search (client-side, current page)</label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="participant, proposal, decision, signal..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid-3">
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Events loaded</div>
            <div className="kpi-value">{filtered.length}</div>
            <div className="kpi-meta">
              of {total.toLocaleString()} total{hasMore ? ' · more available' : ''}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Distinct types</div>
            <div className="kpi-value">{new Set(accumulated.map((e) => e.type)).size}</div>
            <div className="kpi-meta">In this slice</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="kpi-card">
            <div className="kpi-label">Scope</div>
            <div className="kpi-value" style={{ fontSize: '0.95rem' }}>
              {filters.scenario ? filters.scenario : filters.runId ? `run ${filters.runId.slice(0, 8)}…` : 'all runs'}
            </div>
            <div className="kpi-meta">{filters.window ? `window: ${filters.window}` : 'all time'}</div>
          </CardContent>
        </Card>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Seq</th>
              <th style={{ width: 180 }}>Timestamp</th>
              <th style={{ width: 160 }}>Type</th>
              <th>Summary</th>
              <th style={{ width: 180 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="empty-state compact">
                    <h4>No events in this slice</h4>
                    <p>Try widening the time window, clearing the type filter, or picking a different scenario.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((event) => (
                <tr
                  key={event.id}
                  className="expandable-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`Event ${event.seq}: ${event.type}. Enter to open payload.`}
                  onClick={() => setSelectedEvent(event)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedEvent(event);
                    }
                  }}
                >
                  <td>
                    <Badge label={String(event.seq)} />
                  </td>
                  <td className="mono">{formatDateTime(event.ts)}</td>
                  <td>
                    <code>{event.type}</code>
                  </td>
                  <td>{summarizeEvent(event)}</td>
                  <td className="muted small">{event.source?.name ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              const next = logsQuery.data?.nextCursor;
              if (next !== undefined) setCursors((prev) => [...prev, next]);
            }}
            disabled={logsQuery.isFetching}
          >
            {logsQuery.isFetching ? 'Loading…' : `Load more (${total - accumulated.length} remaining)`}
          </button>
        </div>
      ) : null}

      <EventDetailDialog
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.type ?? 'Event'}
        subtitle={selectedEvent ? `seq ${selectedEvent.seq} · ${formatDateTime(selectedEvent.ts)}` : undefined}
        meta={
          selectedEvent
            ? [
                {
                  label: 'Subject',
                  value: selectedEvent.subject ? `${selectedEvent.subject.kind}:${selectedEvent.subject.id}` : '—'
                },
                {
                  label: 'Source',
                  value: `${selectedEvent.source?.kind ?? 'unknown'}${selectedEvent.source?.name ? ` · ${selectedEvent.source.name}` : ''}`
                },
                {
                  label: 'Run',
                  value: <code>{selectedEvent.runId}</code>
                },
                ...(selectedEvent.trace?.traceId
                  ? [{ label: 'Trace', value: <code>{selectedEvent.trace.traceId}</code> }]
                  : []),
                { label: 'Event id', value: <code>{selectedEvent.id}</code> }
              ]
            : []
        }
        payload={selectedEvent?.data ?? {}}
      />
    </div>
  );
}
