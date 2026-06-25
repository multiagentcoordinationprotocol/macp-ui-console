'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Play } from 'lucide-react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { getRunState, listRuns } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

export default function LiveRunsPage() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const runsQuery = useQuery({
    queryKey: ['live-runs', demoMode],
    // Non-terminal runs: actively streaming (`running`) plus paused-but-resumable
    // (`suspended`, macp-proto 0.1.3). Both belong in the live workbench surface.
    queryFn: async () => {
      const [running, suspended] = await Promise.all([
        listRuns(demoMode, { status: 'running' }),
        listRuns(demoMode, { status: 'suspended' })
      ]);
      return [...running, ...suspended];
    }
  });

  const activeRunIds = useMemo(() => (runsQuery.data ?? []).map((run) => run.id), [runsQuery.data]);
  const stateQueries = useQuery({
    queryKey: ['live-run-states', activeRunIds.join(','), demoMode],
    queryFn: async () => Promise.all(activeRunIds.map((runId) => getRunState(runId, demoMode))),
    enabled: activeRunIds.length > 0
  });

  if (runsQuery.isLoading)
    return (
      <LoadingPanel
        title="Loading live runs"
        description="Discovering actively streaming runs and their current graph state."
      />
    );
  if (runsQuery.error)
    return <ErrorPanel message={String(runsQuery.error)} actionHref="/runs" actionLabel="Open run history" />;

  const activeRuns = runsQuery.data ?? [];

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Live runs</h1>
          <p>
            Watch active executions unfold, inspect current participants, and jump straight into the live workbench.
          </p>
        </div>
        <Link href="/runs/new" className="button button-primary">
          <Play size={16} />
          Start another run
        </Link>
      </div>

      {activeRuns.length === 0 ? (
        <div className="empty-state">
          <h4>No active runs right now</h4>
          <p>All current executions are complete. Start a new scenario or inspect historical runs.</p>
          <Link href="/runs/new" className="button button-secondary">
            Launch run
          </Link>
        </div>
      ) : (
        <>
          <div className="grid-2">
            {activeRuns.map((run, index) => {
              const state = stateQueries.data?.[index];
              return (
                <Card key={run.id}>
                  <CardHeader>
                    <CardTitle>{String(run.metadata?.scenarioRef ?? run.source?.ref ?? run.id)}</CardTitle>
                    <CardDescription>Currently streaming from the control plane SSE endpoint.</CardDescription>
                  </CardHeader>
                  <CardContent className="stack">
                    <div className="inline-list">
                      <StatusBadge status={run.status} />
                      <Badge label={String(run.metadata?.environment ?? 'unknown')} tone="info" />
                      <Badge label={`${state?.timeline.totalEvents ?? 0} events`} />
                    </div>
                    <div className="list-item">
                      <div className="list-item-title">Active participants</div>
                      <div className="list-item-meta">
                        {state?.participants
                          .filter((participant) => participant.status === 'active')
                          .map((participant) => participant.participantId)
                          .join(', ') || 'Awaiting active participant transitions'}
                      </div>
                    </div>
                    <div className="section-actions">
                      <Link href={`/runs/live/${run.id}`} className="button button-primary">
                        <Eye size={16} />
                        Watch live
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
