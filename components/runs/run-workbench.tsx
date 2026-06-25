'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database, Download, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useConfirmation } from '@/lib/hooks/use-confirmation';
import { useToast } from '@/components/ui/toast';
import { ExecutionGraph } from '@/components/runs/execution-graph';
import { LiveEventFeed } from '@/components/runs/live-event-feed';
import { RunStoryPanel } from '@/components/runs/run-story-panel';
import { NodeInspector } from '@/components/runs/node-inspector';
import { DecisionPanel } from '@/components/runs/decision-panel';
import { PolicyPanel } from '@/components/runs/policy-panel';
import { RunOverviewCard } from '@/components/runs/run-overview-card';
import { SignalRail } from '@/components/runs/signal-rail';
import { TimelineScrubber } from '@/components/runs/timeline-scrubber';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/field';
import { JsonViewer } from '@/components/ui/json-viewer';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import {
  cancelRun,
  suspendRun,
  resumeRun,
  cloneRun,
  createReplay,
  deleteRun,
  exportRunBundle,
  getMockFrames,
  getQuickCompareTarget,
  getTimelineFrame,
  getRun,
  getRunArtifacts,
  getRunEvents,
  getRunMetrics,
  getRunState,
  getRunTraces,
  getJaegerTrace,
  getJaegerUiUrl,
  listRuns,
  rebuildProjection
} from '@/lib/api/client';
import { useLiveRun } from '@/lib/hooks/use-live-run';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatDateTime, formatRelativeDuration } from '@/lib/utils/format';
import { getRunDurationMs } from '@/lib/utils/macp';

export function RunWorkbench({ runId, liveMode = false }: { runId: string; liveMode?: boolean }) {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const autoFollow = usePreferencesStore((state) => state.autoFollow);
  const setAutoFollow = usePreferencesStore((state) => state.setAutoFollow);
  const showCriticalPath = usePreferencesStore((state) => state.showCriticalPath);
  const setShowCriticalPath = usePreferencesStore((state) => state.setShowCriticalPath);
  const showParallelBranches = usePreferencesStore((state) => state.showParallelBranches);
  const setShowParallelBranches = usePreferencesStore((state) => state.setShowParallelBranches);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirmation = useConfirmation();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [replayDescriptorJson, setReplayDescriptorJson] = useState<Record<string, unknown> | undefined>();
  const [replaySeq, setReplaySeq] = useState<number | undefined>();
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneTagsText, setCloneTagsText] = useState('');
  const [cloneContextText, setCloneContextText] = useState('{}');
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [exportIncludeCanonical, setExportIncludeCanonical] = useState(true);
  const [exportIncludeRaw, setExportIncludeRaw] = useState(false);
  const [exportEventLimit, setExportEventLimit] = useState(10000);
  const [exportFormat, setExportFormat] = useState<'json' | 'jsonl'>('json');

  const runQuery = useQuery({ queryKey: ['run', runId, demoMode], queryFn: () => getRun(runId, demoMode) });
  const stateQuery = useQuery({
    queryKey: ['run-state', runId, demoMode],
    queryFn: () => getRunState(runId, demoMode)
  });
  const eventsQuery = useQuery({
    queryKey: ['run-events', runId, demoMode],
    queryFn: () => getRunEvents(runId, demoMode)
  });
  const metricsQuery = useQuery({
    queryKey: ['run-metrics', runId, demoMode],
    queryFn: () => getRunMetrics(runId, demoMode)
  });
  const tracesQuery = useQuery({
    queryKey: ['run-traces', runId, demoMode],
    queryFn: () => getRunTraces(runId, demoMode)
  });
  const artifactsQuery = useQuery({
    queryKey: ['run-artifacts', runId, demoMode],
    queryFn: () => getRunArtifacts(runId, demoMode)
  });

  const traceId = tracesQuery.data?.traceId ?? '';
  const jaegerQuery = useQuery({
    queryKey: ['jaeger-trace', traceId],
    queryFn: () => getJaegerTrace(traceId),
    enabled: Boolean(traceId) && !demoMode && traceId !== '00000000000000000000000000000000'
  });

  const live = useLiveRun({
    runId,
    demoMode,
    initialState: stateQuery.data,
    initialEvents: eventsQuery.data,
    autoStart: liveMode
  });

  const effectiveState = liveMode ? (live.state ?? stateQuery.data) : stateQuery.data;
  const effectiveEvents = liveMode
    ? live.events.length
      ? live.events
      : (eventsQuery.data ?? [])
    : (eventsQuery.data ?? []);
  const connectionStatus = liveMode ? live.connectionStatus : 'ended';

  useEffect(() => {
    if (!effectiveState) return;
    if (selectedNodeId && effectiveState.graph.nodes.some((node) => node.id === selectedNodeId)) return;
    const activeNode = effectiveState.graph.nodes.find((node) => node.status === 'active');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selecting initial/active node from graph state
    setSelectedNodeId(activeNode?.id ?? effectiveState.graph.nodes[0]?.id);
  }, [effectiveState, selectedNodeId]);

  useEffect(() => {
    if (!autoFollow || !effectiveState) return;
    const activeNode = effectiveState.graph.nodes.find((node) => node.status === 'active');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-follow active node
    if (activeNode) setSelectedNodeId(activeNode.id);
  }, [autoFollow, effectiveState]);

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(runId, demoMode),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['run', runId] }),
        queryClient.invalidateQueries({ queryKey: ['run-state', runId] })
      ]);
      toast('success', 'Run cancelled.');
    },
    onError: (error) => {
      toast('error', `Failed to cancel run.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const invalidateRun = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['run', runId] }),
      queryClient.invalidateQueries({ queryKey: ['run-state', runId] })
    ]);
  };

  const suspendMutation = useMutation({
    mutationFn: () => suspendRun(runId, demoMode),
    onSuccess: async () => {
      await invalidateRun();
      toast('success', 'Run suspended.');
    },
    onError: (error) => {
      toast('error', `Failed to suspend run.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeRun(runId, demoMode),
    onSuccess: async () => {
      await invalidateRun();
      toast('success', 'Run resumed.');
    },
    onError: (error) => {
      toast('error', `Failed to resume run.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const replayMutation = useMutation({
    mutationFn: () => createReplay(runId, demoMode),
    onSuccess: (data) => {
      setReplayDescriptorJson(data as unknown as Record<string, unknown>);
      toast('success', 'Replay descriptor generated.');
    },
    onError: (error) => {
      toast('error', `Failed to create replay.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildProjection(runId, demoMode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run-state', runId] });
      toast('success', 'Projection rebuilt.');
    },
    onError: (error) => {
      toast('error', `Failed to rebuild projection.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRun(runId, demoMode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] });
      toast('success', 'Run deleted.');
      router.push('/runs');
    },
    onError: (error) => {
      toast('error', `Failed to delete run.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const cloneMutation = useMutation({
    mutationFn: () => {
      const tags = cloneTagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      let context: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(cloneContextText);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) context = parsed;
      } catch {
        /* keep undefined */
      }
      return cloneRun(runId, demoMode, { tags: tags.length ? tags : undefined, context });
    },
    onSuccess: (data) => {
      setShowCloneForm(false);
      toast('success', 'Run cloned successfully.');
      router.push(`/runs/live/${data.runId}`);
    },
    onError: (error) => {
      toast('error', `Failed to clone run.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const bundle = await exportRunBundle(runId, demoMode, {
        includeCanonical: exportIncludeCanonical,
        includeRaw: exportIncludeRaw,
        eventLimit: exportEventLimit,
        format: exportFormat
      });
      const ts = bundle.exportedAt ? new Date(bundle.exportedAt).toISOString().replace(/[:.]/g, '-') : 'now';
      const ext = exportFormat === 'jsonl' ? 'jsonl' : 'json';
      const content =
        exportFormat === 'jsonl'
          ? [bundle.run, ...(bundle.canonicalEvents ?? []), ...(bundle.rawEvents ?? [])]
              .map((item) => JSON.stringify(item))
              .join('\n')
          : JSON.stringify(bundle, null, 2);
      const mimeType = exportFormat === 'jsonl' ? 'application/x-ndjson' : 'application/json';
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${runId.slice(0, 8)}-${ts}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  const isLoading = runQuery.isLoading || stateQuery.isLoading;
  const isError = runQuery.error || stateQuery.error;

  const jaegerSpanCount = jaegerQuery.data
    ? jaegerQuery.data.spans.filter((s) => !s.operationName.startsWith('middleware')).length
    : 0;

  const observabilitySummary = useMemo(() => {
    if (!metricsQuery.data || !tracesQuery.data) return [];
    const items = [
      { label: 'Event count', value: String(metricsQuery.data.eventCount) },
      { label: 'Tool calls', value: String(metricsQuery.data.toolCallCount) },
      { label: 'Signals', value: String(metricsQuery.data.signalCount) },
      { label: 'Trace spans', value: String(jaegerSpanCount || tracesQuery.data.spanCount) }
    ];
    // CP `RunStateProjection.llm.totals` aggregates message-metadata
    // LLM calls into `callCount`, token counts, and estimated cost.
    // Prefer these over MetricsSummary when available, and fall back to
    // MetricsSummary for older CP builds.
    const llmTotals = effectiveState?.llm?.totals;
    const callCount = llmTotals?.callCount;
    if (callCount && callCount > 0) {
      items.push({ label: 'LLM calls', value: String(callCount) });
    }
    const totalTokens = llmTotals?.totalTokens ?? metricsQuery.data.totalTokens;
    if (totalTokens) {
      items.push({ label: 'Tokens', value: String(totalTokens) });
    }
    const estimatedCostUsd = llmTotals?.estimatedCostUsd ?? metricsQuery.data.estimatedCostUsd;
    if (estimatedCostUsd) {
      items.push({ label: 'Est. cost', value: `$${estimatedCostUsd.toFixed(4)}` });
    }
    return items;
  }, [metricsQuery.data, tracesQuery.data, jaegerSpanCount, effectiveState?.llm?.totals]);

  const replayFrames = useMemo(() => (liveMode ? [] : getMockFrames(runId)), [liveMode, runId]);
  const replayFrameQuery = useQuery({
    queryKey: ['replay-frame', runId, replaySeq, demoMode],
    queryFn: () => getTimelineFrame(runId, replaySeq as number, demoMode),
    enabled: replaySeq !== undefined
  });

  // In real mode, find the previous run of the same scenario for comparison
  const scenarioRef = runQuery.data?.source?.ref;
  const previousRunQuery = useQuery({
    queryKey: ['previous-run', runId, scenarioRef, demoMode],
    queryFn: async () => {
      const runs = await listRuns(demoMode, { search: scenarioRef });
      return runs.find((r) => r.id !== runId && r.status === 'completed') ?? null;
    },
    enabled: !demoMode && Boolean(scenarioRef)
  });
  const compareTarget = demoMode ? getQuickCompareTarget(runId) : previousRunQuery.data?.id;
  const compareHref = compareTarget ? `/runs/${runId}/compare/${compareTarget}` : undefined;

  if (isLoading)
    return (
      <LoadingPanel
        title="Loading run workbench"
        description="Fetching run state, events, metrics, and linked artifacts."
      />
    );
  if (isError || !runQuery.data || !effectiveState) {
    return (
      <ErrorPanel
        message={String(runQuery.error ?? stateQuery.error ?? 'Run data is unavailable.')}
        actionHref="/runs"
        actionLabel="Open run history"
      />
    );
  }

  const replayState = !liveMode && replaySeq !== undefined ? replayFrameQuery.data : undefined;
  const projectedState = replayState ?? effectiveState;
  const projectedEvents =
    !liveMode && replaySeq !== undefined ? effectiveEvents.filter((event) => event.seq <= replaySeq) : effectiveEvents;

  const run = runQuery.data;
  const runtimeDurationMs = metricsQuery.data?.durationMs ?? getRunDurationMs(run);

  return (
    <div className="stack">
      <RunOverviewCard
        run={run}
        state={projectedState}
        connectionStatus={connectionStatus}
        reconnectAttempt={liveMode ? live.reconnectAttempt : undefined}
        onCancel={run.status === 'running' || run.status === 'suspended' ? () => cancelMutation.mutate() : undefined}
        onSuspend={run.status === 'running' ? () => suspendMutation.mutate() : undefined}
        onResume={run.status === 'suspended' ? () => resumeMutation.mutate() : undefined}
        onReplay={() => replayMutation.mutate()}
        metrics={metricsQuery.data}
        compareHref={compareHref}
        traceId={traceId}
        jaegerUiUrl={traceId && traceId !== '00000000000000000000000000000000' ? getJaegerUiUrl(traceId) : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>Execution graph and live orchestration view</CardTitle>
          <CardDescription>
            Graph view of runtime flow, context gathering, specialist agents, aggregation, and final emission.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="section-actions">
            {liveMode ? (
              <Button variant="secondary" onClick={() => live.setPaused(!live.paused)}>
                {live.paused ? <Play size={16} /> : <Pause size={16} />}
                {live.paused ? 'Resume live stream' : 'Pause live stream'}
              </Button>
            ) : null}
            <label className="switch-row">
              <input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} />
              <span>Auto-follow active node</span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={showCriticalPath}
                onChange={(event) => setShowCriticalPath(event.target.checked)}
              />
              <span>Animate critical path</span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={showParallelBranches}
                onChange={(event) => setShowParallelBranches(event.target.checked)}
              />
              <span>Show parallel branches</span>
            </label>
            <Badge label={`latest-seq:${projectedState.timeline.latestSeq}`} tone="info" />
          </div>
          <ErrorBoundary>
            <ExecutionGraph
              state={projectedState}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              showCriticalPath={showCriticalPath}
              showParallelBranches={showParallelBranches}
            />
          </ErrorBoundary>
        </CardContent>
      </Card>

      <div className="triple-layout">
        <ErrorBoundary>
          <NodeInspector
            state={projectedState}
            events={projectedEvents}
            selectedNodeId={selectedNodeId}
            metrics={metricsQuery.data}
            traceSummary={tracesQuery.data}
            artifacts={artifactsQuery.data}
          />
        </ErrorBoundary>
        <ErrorBoundary>
          <LiveEventFeed
            events={projectedEvents}
            runId={runId}
            title={liveMode ? 'Live event rail' : 'Canonical event history'}
          />
        </ErrorBoundary>
        <SignalRail state={projectedState} runId={runId} />
      </div>

      {/* Row 1: Run story + Final decision (side by side) */}
      <div className="grid-2">
        <ErrorBoundary>
          <RunStoryPanel run={run} state={projectedState} events={projectedEvents} metrics={metricsQuery.data} />
        </ErrorBoundary>
        <DecisionPanel run={run} state={projectedState} events={projectedEvents} runId={runId} />
      </div>

      {!liveMode && replayFrames.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Replay preview</CardTitle>
            <CardDescription>
              Step through captured frame snapshots and watch the workbench rewind to earlier states.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimelineScrubber frames={replayFrames} currentSeq={replaySeq} onSeqChange={setReplaySeq} />
          </CardContent>
        </Card>
      ) : null}

      {/* Row 2: Policy governance + Artifacts + Replay and diagnostics (3 across) */}
      <div className="grid-3">
        {projectedState.policy && (
          <PolicyPanel
            policy={projectedState.policy}
            policyHints={run.metadata?.policyHints as import('@/lib/types').PolicyHints | undefined}
          />
        )}
        <Card>
          <CardHeader>
            <CardTitle>Artifacts</CardTitle>
            <CardDescription>Trace bundles, decision reports, and other artifacts linked to this run.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <JsonViewer value={{ artifacts: artifactsQuery.data ?? [] }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Replay and diagnostics</CardTitle>
            <CardDescription>
              Request a replay descriptor from the control plane and inspect generated stream metadata.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="section-actions">
              <Button variant="secondary" onClick={() => replayMutation.mutate()} disabled={replayMutation.isPending}>
                <RefreshCw size={16} />
                {replayMutation.isPending ? 'Preparing replay...' : 'Request replay descriptor'}
              </Button>
              <Button variant="secondary" onClick={() => setShowExportOptions(!showExportOptions)}>
                <Download size={16} />
                Export bundle
              </Button>
              <Button variant="secondary" onClick={() => rebuildMutation.mutate()} disabled={rebuildMutation.isPending}>
                <Database size={16} />
                {rebuildMutation.isPending ? 'Rebuilding...' : 'Rebuild projection'}
              </Button>
              {['completed', 'failed', 'cancelled'].includes(run.status) && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    const confirmed = await confirmation.confirm({
                      title: 'Delete run permanently',
                      description: `Permanently delete run ${runId.slice(0, 8)}...? This action cannot be undone.`,
                      confirmLabel: 'Delete'
                    });
                    if (confirmed) deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                  aria-label="Permanently delete this run"
                >
                  <Trash2 size={16} />
                  {deleteMutation.isPending ? 'Deleting...' : 'Permanent delete'}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setShowCloneForm(!showCloneForm)}>
                <Copy size={16} />
                Clone run
              </Button>
              <Link href="/runs" className="button button-ghost">
                Open run history
              </Link>
            </div>
            {showExportOptions && (
              <Card>
                <CardContent className="stack" style={{ padding: '1rem' }}>
                  <div className="field-grid">
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={exportIncludeCanonical}
                        onChange={(e) => setExportIncludeCanonical(e.target.checked)}
                      />
                      <span>Include canonical events</span>
                    </label>
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={exportIncludeRaw}
                        onChange={(e) => setExportIncludeRaw(e.target.checked)}
                      />
                      <span>Include raw events</span>
                    </label>
                  </div>
                  <div className="field-grid">
                    <div>
                      <FieldLabel>Event limit</FieldLabel>
                      <Input
                        type="number"
                        value={String(exportEventLimit)}
                        min={1}
                        max={50000}
                        onChange={(e) => setExportEventLimit(Number(e.target.value) || 10000)}
                      />
                    </div>
                    <div>
                      <FieldLabel>Format</FieldLabel>
                      <Select
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as 'json' | 'jsonl')}
                      >
                        <option value="json">JSON</option>
                        <option value="jsonl">JSONL (newline-delimited)</option>
                      </Select>
                    </div>
                  </div>
                  <Button variant="primary" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                    <Download size={16} />
                    {exportMutation.isPending ? 'Exporting...' : 'Download'}
                  </Button>
                </CardContent>
              </Card>
            )}
            {showCloneForm && (
              <Card>
                <CardContent className="stack" style={{ padding: '1rem' }}>
                  <div>
                    <FieldLabel>Override tags (comma-separated)</FieldLabel>
                    <Input
                      value={cloneTagsText}
                      onChange={(event) => setCloneTagsText(event.target.value)}
                      placeholder="clone,experiment-2"
                    />
                  </div>
                  <div>
                    <FieldLabel>Override context (JSON)</FieldLabel>
                    <Textarea value={cloneContextText} onChange={(event) => setCloneContextText(event.target.value)} />
                  </div>
                  <Button variant="primary" onClick={() => cloneMutation.mutate()} disabled={cloneMutation.isPending}>
                    <Copy size={16} />
                    {cloneMutation.isPending ? 'Cloning...' : 'Clone with overrides'}
                  </Button>
                </CardContent>
              </Card>
            )}
            {replayDescriptorJson ? (
              <JsonViewer value={replayDescriptorJson} />
            ) : (
              <div className="empty-state compact">
                <h4>No replay requested yet</h4>
                <p>Generate a replay descriptor to inspect stream URLs and time-window controls.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Run observability summary (full width) */}
      <Card>
        <CardHeader>
          <CardTitle>Run observability summary</CardTitle>
          <CardDescription>
            Aggregate runtime telemetry, session lifecycle, and linked trace coverage for this run.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="metric-strip">
            {observabilitySummary.map((item) => (
              <div key={item.label} className="metric-box">
                <div className="muted small">{item.label}</div>
                <div className="metric-box-value">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="list-item">
            <div className="list-item-title">Runtime session</div>
            <div className="list-item-meta">
              {projectedState.run.runtimeSessionId ?? '—'} · started {formatDateTime(run.startedAt ?? run.createdAt)} ·
              elapsed {formatRelativeDuration(runtimeDurationMs)}
            </div>
          </div>
          <JsonViewer value={{ metrics: metricsQuery.data, traces: tracesQuery.data }} />
        </CardContent>
      </Card>
      <ConfirmationDialog
        open={confirmation.state.open}
        title={confirmation.state.title}
        description={confirmation.state.description}
        confirmLabel={confirmation.state.confirmLabel}
        variant={confirmation.state.variant}
        onConfirm={confirmation.state.onConfirm}
        onCancel={confirmation.cancel}
      />
    </div>
  );
}
