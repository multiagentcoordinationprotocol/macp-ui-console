'use client';

import Link from 'next/link';
import { ArrowRightLeft, ExternalLink, Pause, Play, RotateCcw, Search, Square, TimerReset } from 'lucide-react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { MetricsSummary, RunRecord, RunStateProjection } from '@/lib/types';
import { formatDateTime, formatNumber, formatRelativeDuration } from '@/lib/utils/format';
import { getRunDurationMs } from '@/lib/utils/macp';

/**
 * Run statuses considered "live" for the purposes of counter sourcing.
 * Decision Q1 (plans/ui-improvement-plan.md): during live statuses the
 * counters tick from the SSE projection; once terminal, from the
 * persisted metrics aggregate.
 */
const LIVE_STATUSES = new Set(['queued', 'starting', 'binding_session', 'running']);

export function RunOverviewCard({
  run,
  state,
  metrics,
  connectionStatus,
  reconnectAttempt,
  onCancel,
  onSuspend,
  onResume,
  onReplay,
  compareHref,
  traceId,
  jaegerUiUrl
}: {
  run: RunRecord;
  /** SSE projection — used for live counter sources (Q1). Omit for historical replay contexts. */
  state?: RunStateProjection;
  metrics?: MetricsSummary | null;
  connectionStatus?: string;
  reconnectAttempt?: number;
  onCancel?: () => void;
  /** macp-proto 0.1.3 — pause a running run (control-plane suspend). */
  onSuspend?: () => void;
  /** macp-proto 0.1.3 — resume a suspended run. */
  onResume?: () => void;
  onReplay?: () => void;
  compareHref?: string;
  traceId?: string;
  jaegerUiUrl?: string;
}) {
  const durationMs = metrics?.durationMs ?? Number(run.metadata?.durationMs ?? getRunDurationMs(run));

  const scenarioRef = run.source?.ref ?? run.metadata?.scenarioRef;
  const environment = process.env.NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL ?? run.metadata?.environment;
  const showStream = connectionStatus && connectionStatus !== 'ended';

  // Q1 decision — event/message counter sources switch on run.status.
  // Live: SSE projection (ticks in real time). Terminal: metrics aggregate.
  const isLive = LIVE_STATUSES.has(run.status);
  const eventCount = isLive ? (state?.timeline.totalEvents ?? 0) : (metrics?.eventCount ?? 0);
  const messageCount = isLive ? (state?.outboundMessages?.total ?? 0) : (metrics?.messageCount ?? 0);
  const signalCount = metrics?.signalCount ?? state?.signals?.signals.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{scenarioRef ? `Scenario: ${String(scenarioRef)}` : 'Run detail'}</CardTitle>
        <CardDescription>
          Run {run.id} · started {formatDateTime(run.startedAt ?? run.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        <div className="inline-list">
          <StatusBadge status={run.status} />
          {run.metadata?.templateId ? <Badge label={String(run.metadata.templateId)} /> : null}
          {environment ? <Badge label={String(environment)} tone="info" /> : null}
          {showStream ? (
            <Badge
              label={
                connectionStatus === 'reconnecting' && reconnectAttempt
                  ? `stream:reconnecting (${reconnectAttempt})`
                  : `stream:${connectionStatus}`
              }
              tone={
                connectionStatus === 'live'
                  ? 'success'
                  : connectionStatus === 'reconnecting'
                    ? 'warning'
                    : connectionStatus === 'error'
                      ? 'danger'
                      : 'neutral'
              }
            />
          ) : null}
        </div>

        {(state?.run.contextId ||
          (state?.run.extensionKeys && state.run.extensionKeys.length > 0) ||
          metrics?.sessionState) && (
          <div className="inline-list">
            {metrics?.sessionState && metrics.sessionState !== 'SESSION_STATE_UNSPECIFIED' && (
              <Badge
                label={metrics.sessionState.replace('SESSION_STATE_', '').toLowerCase()}
                tone={
                  metrics.sessionState === 'SESSION_STATE_OPEN'
                    ? 'info'
                    : metrics.sessionState === 'SESSION_STATE_RESOLVED'
                      ? 'success'
                      : // SUSPENDED is a non-terminal pause (macp-proto 0.1.3) — warn, don't alarm.
                        metrics.sessionState === 'SESSION_STATE_SUSPENDED'
                        ? 'warning'
                        : 'danger'
                }
              />
            )}
            {state?.run.contextId && (
              <Badge
                label={`ctx: ${state.run.contextId.length > 24 ? state.run.contextId.slice(0, 24) + '...' : state.run.contextId}`}
                tone="neutral"
              />
            )}
            {(state?.run.extensionKeys ?? []).map((key) => (
              <Badge key={key} label={key} tone="neutral" />
            ))}
          </div>
        )}

        <div className="metric-strip">
          <div className="metric-box">
            <div className="muted small">Elapsed</div>
            <div className="metric-box-value">{formatRelativeDuration(durationMs)}</div>
          </div>
          <div className="metric-box">
            <div className="muted small">Events</div>
            <div className="metric-box-value">{formatNumber(eventCount)}</div>
          </div>
          <div className="metric-box">
            <div className="muted small">Messages</div>
            <div className="metric-box-value">{formatNumber(messageCount)}</div>
          </div>
          <div className="metric-box">
            <div className="muted small">Signals</div>
            <div className="metric-box-value">{formatNumber(signalCount)}</div>
          </div>
          {/* Q3: Tokens + Est. cost live in the Run observability summary,
              not the top overview card. Removed from here to avoid duplication. */}
        </div>

        {run.status === 'failed' && run.metadata?.error != null && (
          <div
            style={{
              padding: 'var(--space-sm)',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid var(--danger, #ef4444)'
            }}
          >
            <div className="muted small" style={{ marginBottom: '4px', fontWeight: 600 }}>
              Failure reason
            </div>
            <div style={{ fontSize: '0.875rem' }}>{String(run.metadata.error as string)}</div>
          </div>
        )}

        <div className="section-actions">
          {run.status === 'running' && onSuspend ? (
            <Button variant="secondary" onClick={onSuspend}>
              <Pause size={16} />
              Suspend
            </Button>
          ) : null}
          {run.status === 'suspended' && onResume ? (
            <Button variant="primary" onClick={onResume}>
              <Play size={16} />
              Resume
            </Button>
          ) : null}
          {(run.status === 'running' || run.status === 'suspended') && onCancel ? (
            <Button variant="danger" onClick={onCancel}>
              <Square size={16} />
              Cancel run
            </Button>
          ) : null}
          {onReplay ? (
            <Button variant="secondary" onClick={onReplay}>
              <TimerReset size={16} />
              Replay
            </Button>
          ) : null}
          <Link href="/runs/new" className="button button-secondary">
            <RotateCcw size={16} />
            Clone / rerun
          </Link>
          {compareHref ? (
            <Link href={compareHref} className="button button-ghost">
              <ArrowRightLeft size={16} />
              Compare
            </Link>
          ) : null}
          {traceId && traceId !== '00000000000000000000000000000000' ? (
            <Link href={`/traces?runId=${run.id}`} className="button button-ghost">
              <Search size={16} />
              Traces
            </Link>
          ) : null}
          {jaegerUiUrl ? (
            <a href={jaegerUiUrl} target="_blank" rel="noopener noreferrer" className="button button-ghost">
              <ExternalLink size={16} />
              Jaeger
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
