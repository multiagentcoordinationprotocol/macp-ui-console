'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CircuitBreakerHistoryEntry } from '@/lib/api/client';
import { formatDateTime, formatRelativeDuration } from '@/lib/utils/format';

/**
 * PR-F5 — Circuit breaker state history timeline.
 *
 * Horizontal band for each state transition: width proportional to time
 * in that state, color by state. Answers the on-call question "when did
 * the breaker trip?" at a glance.
 *
 * Consumes the BE §5.3 history endpoint; component renders nothing when
 * the history is empty (caller guards on `data.length`).
 */

const STATE_TONE: Record<CircuitBreakerHistoryEntry['state'], 'success' | 'warning' | 'danger'> = {
  CLOSED: 'success',
  HALF_OPEN: 'warning',
  OPEN: 'danger'
};

const STATE_BG: Record<CircuitBreakerHistoryEntry['state'], string> = {
  CLOSED: 'var(--v2-green, var(--success))',
  HALF_OPEN: 'var(--v2-amber, var(--warning))',
  OPEN: 'var(--v2-red, var(--danger))'
};

export function CircuitBreakerTimeline({ entries }: { entries: CircuitBreakerHistoryEntry[] }) {
  // Freeze `now` once per mount/entries-change so the render is pure.
  // Operators can reload the page to refresh — the value is
  // accurate-enough for visualization purposes.
  const [now] = useState(() => Date.now());

  const segments = useMemo(() => {
    if (entries.length === 0) return [];
    const withEnd = entries.map((entry, i) => {
      const start = new Date(entry.enteredAt).getTime();
      const end = i === entries.length - 1 ? now : new Date(entries[i + 1].enteredAt).getTime();
      return { ...entry, start, end, duration: Math.max(end - start, 0) };
    });
    const totalSpan = (withEnd[withEnd.length - 1]?.end ?? now) - (withEnd[0]?.start ?? now);
    return withEnd.map((segment) => ({
      ...segment,
      percent: totalSpan > 0 ? (segment.duration / totalSpan) * 100 : 0
    }));
  }, [entries, now]);

  if (segments.length === 0) return null;

  const current = segments[segments.length - 1];
  const currentDurationMs = now - current.start;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Circuit breaker history</CardTitle>
        <CardDescription>
          Recent state transitions of the macp-control-plane circuit breaker. Hover a band for the reason.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        <div className="inline-list">
          <Badge label={`Current: ${current.state}`} tone={STATE_TONE[current.state]} />
          <span className="muted small">for {formatRelativeDuration(currentDurationMs)}</span>
        </div>
        <div
          role="list"
          aria-label="Circuit breaker state timeline"
          style={{
            display: 'flex',
            height: 18,
            borderRadius: 4,
            overflow: 'hidden',
            border: '1px solid var(--v2-border, var(--border))'
          }}
        >
          {segments.map((segment, i) => (
            <div
              key={i}
              role="listitem"
              title={`${segment.state} · ${formatDateTime(segment.enteredAt)}${segment.reason ? ` · ${segment.reason}` : ''}`}
              style={{
                width: `${segment.percent}%`,
                background: STATE_BG[segment.state],
                opacity: i === segments.length - 1 ? 0.9 : 0.75,
                minWidth: segment.percent > 0 && segment.percent < 1 ? '2px' : undefined
              }}
            />
          ))}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>State</th>
                <th>Entered</th>
                <th>Duration</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {segments
                .slice()
                .reverse()
                .map((segment, i) => (
                  <tr key={i}>
                    <td>
                      <Badge label={segment.state} tone={STATE_TONE[segment.state]} />
                    </td>
                    <td className="mono muted small">{formatDateTime(segment.enteredAt)}</td>
                    <td className="mono small">{formatRelativeDuration(segment.duration)}</td>
                    <td className="muted small">{segment.reason ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
