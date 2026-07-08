'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EventDetailDialog } from '@/components/ui/event-detail-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import type { CanonicalEvent } from '@/lib/types';
import { formatDateTime, titleCase } from '@/lib/utils/format';
import { summarizeEvent } from '@/lib/utils/events';
import { isImplicitAccept } from '@/lib/utils/macp';

/**
 * PR-B1 — LiveEventFeed redesign.
 *
 *  - Semantic one-line summary per row (via {@link summarizeEvent}).
 *  - Click a row to open the full payload in {@link EventDetailDialog}.
 *  - Size selector: 100 / 500 rows (default 100 per Q13).
 *  - Type filter: chips for observed types.
 *  - "Open in full view ↗" link to /logs?runId=... (PR-B3).
 *
 * Runs against whatever event stream is handed in (live SSE buffer or
 * replay events). The `runId` prop is used to build the deep-link only.
 */

const SIZE_OPTIONS = [100, 500] as const;
type Size = (typeof SIZE_OPTIONS)[number];

export function LiveEventFeed({
  events,
  runId,
  title = 'Live event rail',
  description = 'Streaming canonical events, tool calls, and decision transitions.'
}: {
  events: CanonicalEvent[];
  runId?: string;
  title?: string;
  description?: string;
}) {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [size, setSize] = useState<Size>(100);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const availableTypes = useMemo(() => {
    const types = new Set(events.map((event) => event.type));
    return Array.from(types).sort();
  }, [events]);

  const visible = useMemo(() => {
    const filtered = typeFilter ? events.filter((event) => event.type === typeFilter) : events;
    return filtered.slice(-size).reverse();
  }, [events, typeFilter, size]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  const fullViewHref = runId ? `/logs?runId=${runId}` : '/logs';

  return (
    <>
      <Card>
        <CardHeader>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'flex-start'
            }}
          >
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <Link href={fullViewHref} className="panel-action" aria-label="Open event history in full view">
              <ExternalLink size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              Open in full view
            </Link>
          </div>
        </CardHeader>
        <CardContent className="stack">
          <div className="section-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="inline-list" style={{ gap: 6 }}>
              <span className="muted small">Show</span>
              {SIZE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSize(option)}
                  className={`badge ${size === option ? 'badge-info' : 'badge-neutral'}`}
                  style={{
                    cursor: 'pointer',
                    border: 'none',
                    background: size === option ? undefined : 'transparent'
                  }}
                  aria-pressed={size === option}
                >
                  {option}
                </button>
              ))}
            </div>
            {availableTypes.length > 1 ? (
              <div className="inline-list" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="muted small">Type</span>
                <button
                  type="button"
                  onClick={() => setTypeFilter(null)}
                  className={`badge ${typeFilter === null ? 'badge-info' : 'badge-neutral'}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                  aria-pressed={typeFilter === null}
                >
                  all
                </button>
                {availableTypes.slice(0, 8).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                    className={`badge ${typeFilter === type ? 'badge-info' : 'badge-neutral'}`}
                    style={{ cursor: 'pointer', border: 'none' }}
                    aria-pressed={typeFilter === type}
                  >
                    {type}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="timeline-list">
            {visible.length === 0 ? (
              <EmptyState
                compact
                title={typeFilter ? `No ${typeFilter} events` : 'No events yet'}
                description={
                  typeFilter
                    ? 'Try clearing the type filter or waiting for the next frame.'
                    : 'Once the control plane publishes normalized events they will appear here.'
                }
              />
            ) : (
              visible.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="timeline-item event-feed-row"
                  onClick={() => setSelectedEventId(event.id)}
                  style={{
                    textAlign: 'left',
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  aria-label={`${event.type} event seq ${event.seq}`}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      alignItems: 'center'
                    }}
                  >
                    <span className="inline-list" style={{ gap: 6 }}>
                      <Badge label={event.type} tone="info" />
                      {isImplicitAccept(event) ? <Badge label="implicit" tone="neutral" /> : null}
                    </span>
                    <span className="muted small mono">seq:{event.seq}</span>
                  </div>
                  <div className="list-item-title" style={{ marginTop: 4 }}>
                    {summarizeEvent(event)}
                  </div>
                  <div className="list-item-meta">
                    {formatDateTime(event.ts)} · {titleCase(event.source?.kind ?? 'unknown')}
                    {event.source?.name ? ` / ${event.source.name}` : ''}
                  </div>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <EventDetailDialog
        open={selectedEvent !== null}
        onClose={() => setSelectedEventId(null)}
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
                  value: `${selectedEvent.source.kind}${selectedEvent.source.name ? ` · ${selectedEvent.source.name}` : ''}`
                },
                ...(selectedEvent.trace?.traceId
                  ? [{ label: 'Trace', value: <code>{selectedEvent.trace.traceId}</code> }]
                  : []),
                ...(isImplicitAccept(selectedEvent)
                  ? [{ label: 'Accept', value: <Badge label="implicit (runtime-emitted)" tone="neutral" /> }]
                  : []),
                { label: 'Event id', value: <code>{selectedEvent.id}</code> }
              ]
            : []
        }
        payload={selectedEvent?.data ?? {}}
      />
    </>
  );
}
