'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { DecisionReasonCompare } from '@/components/runs/decision-reason-compare';
import { PayloadDiffViewer } from '@/components/runs/payload-diff-viewer';
import { SignalTimelineOverlay } from '@/components/runs/signal-timeline-overlay';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { compareRuns, getRun, getRunState } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatPercent, formatRelativeDuration } from '@/lib/utils/format';
import { getRunDurationMs } from '@/lib/utils/macp';

export default function RunComparePage() {
  const params = useParams<{ runId: string; otherRunId: string }>();
  const demoMode = usePreferencesStore((state) => state.demoMode);

  const comparisonQuery = useQuery({
    queryKey: ['run-compare', params.runId, params.otherRunId, demoMode],
    queryFn: () => compareRuns(params.runId, params.otherRunId, demoMode)
  });

  const runsQuery = useQuery({
    queryKey: ['run-compare-runs', params.runId, params.otherRunId, demoMode],
    queryFn: async () => {
      const [leftRun, rightRun, leftState, rightState] = await Promise.all([
        getRun(params.runId, demoMode),
        getRun(params.otherRunId, demoMode),
        getRunState(params.runId, demoMode),
        getRunState(params.otherRunId, demoMode)
      ]);
      return { leftRun, rightRun, leftState, rightState };
    }
  });

  const signalNames = useMemo(() => {
    const left = runsQuery.data?.leftState.signals.signals.map((signal) => signal.name) ?? [];
    const right = runsQuery.data?.rightState.signals.signals.map((signal) => signal.name) ?? [];
    return { left, right };
  }, [runsQuery.data]);

  if (comparisonQuery.isLoading || runsQuery.isLoading) {
    return (
      <LoadingPanel
        title="Comparing runs"
        description="Fetching both run records, states, and macp-control-plane comparison results."
      />
    );
  }

  if (comparisonQuery.error || runsQuery.error || !comparisonQuery.data || !runsQuery.data) {
    return (
      <ErrorPanel
        message={String(comparisonQuery.error ?? runsQuery.error ?? 'Unable to compare runs.')}
        actionHref="/runs"
        actionLabel="Open run history"
      />
    );
  }

  const comparison = comparisonQuery.data;
  const { leftRun, rightRun, leftState, rightState } = runsQuery.data;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Run comparison</h1>
          <p>
            Compare mode outcomes, participant coverage, emitted signals, and final confidence across two executions.
          </p>
        </div>
        <Link href="/runs" className="button button-secondary">
          <ArrowLeftRight size={16} />
          Back to runs
        </Link>
      </div>

      <div className="grid-2">
        {[
          { key: 'left', run: leftRun, state: leftState },
          { key: 'right', run: rightRun, state: rightState }
        ].map(({ key, run, state }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{String(run.metadata?.scenarioRef ?? run.source?.ref ?? run.id)}</CardTitle>
              <CardDescription>{run.id}</CardDescription>
            </CardHeader>
            <CardContent className="stack">
              <div className="inline-list">
                <StatusBadge status={run.status} />
                <Badge label={String(run.metadata?.environment ?? 'unknown')} tone="info" />
                <Badge label={String(run.metadata?.templateId ?? 'default')} />
              </div>
              <div className="metric-strip">
                <div className="metric-box">
                  <div className="muted small">Duration</div>
                  <div className="metric-box-value">{formatRelativeDuration(getRunDurationMs(run))}</div>
                </div>
                <div className="metric-box">
                  <div className="muted small">Decision</div>
                  <div className="metric-box-value" style={{ fontSize: '1rem' }}>
                    {String(run.metadata?.finalAction ?? state.decision.current?.action ?? 'pending')}
                  </div>
                </div>
                <div className="metric-box">
                  <div className="muted small">Confidence</div>
                  <div className="metric-box-value">
                    {formatPercent(Number(run.metadata?.finalConfidence ?? state.decision.current?.confidence ?? 0))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Comparison summary</CardTitle>
          <CardDescription>Control-plane generated diff between both run projections.</CardDescription>
        </CardHeader>
        <CardContent className="grid-3">
          <div className="metric-box">
            <div className="muted small">Status match</div>
            <div className="metric-box-value">{comparison.statusMatch ? 'Yes' : 'No'}</div>
          </div>
          <div className="metric-box">
            <div className="muted small">Duration delta</div>
            <div className="metric-box-value">{formatRelativeDuration(Math.abs(comparison.durationDeltaMs ?? 0))}</div>
          </div>
          <div className="metric-box">
            <div className="muted small">Confidence delta</div>
            <div className="metric-box-value">{formatPercent(Math.abs(comparison.confidenceDelta ?? 0))}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHeader>
            <CardTitle>Participants diff</CardTitle>
            <CardDescription>Which agent participants were common, added, or removed.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <JsonViewer value={comparison.participantsDiff} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Signals diff</CardTitle>
            <CardDescription>Compare side-channel emissions and decision-support indicators.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="code-grid">
              <JsonViewer value={{ leftSignals: signalNames.left }} />
              <JsonViewer value={{ rightSignals: signalNames.right }} />
            </div>
            <JsonViewer value={comparison.signalsDiff} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Decision comparison</CardTitle>
          <CardDescription>Compare decision actions, confidence, and reasoning between both runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <DecisionReasonCompare
            leftState={leftState}
            rightState={rightState}
            leftLabel={leftRun.id.slice(0, 8)}
            rightLabel={rightRun.id.slice(0, 8)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision payload diff</CardTitle>
          <CardDescription>Structural diff of the decision current payloads.</CardDescription>
        </CardHeader>
        <CardContent>
          <PayloadDiffViewer
            left={(leftState.decision.current ?? {}) as Record<string, unknown>}
            right={(rightState.decision.current ?? {}) as Record<string, unknown>}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signal timeline</CardTitle>
          <CardDescription>Chronological overlay of signals from both runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignalTimelineOverlay
            leftSignals={leftState.signals.signals}
            rightSignals={rightState.signals.signals}
            leftLabel={leftRun.id.slice(0, 8)}
            rightLabel={rightRun.id.slice(0, 8)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Raw compare payload</CardTitle>
          <CardDescription>Useful when integrating a more advanced diff UI or regression dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <JsonViewer value={comparison} />
        </CardContent>
      </Card>
    </div>
  );
}
