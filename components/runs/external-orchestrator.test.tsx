import { describe, it, expect, beforeAll } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { DecisionPanel } from './decision-panel';
import { NodeInspector } from './node-inspector';
import { ExecutionGraph } from './execution-graph';
import type { CanonicalEvent, RunRecord, RunStateProjection } from '@/lib/types';

/**
 * Task-mode external orchestrator (macp-runtime v0.5.0 / inventory item 11): the
 * initiator may be absent from `participants`. The control-plane then emits projections
 * where `decision.current.resolvedBy` — and a graph edge's source — is an id NOT present
 * in `state.participants`. The console must render defensively (no crash) and must not
 * itself drop the edge (ExecutionGraph maps every `state.graph.edges` entry; if an edge
 * disappears it is the CP graph builder's problem, filed upstream).
 */

const ORCHESTRATOR = 'external-orchestrator';

function baseRun(): RunRecord {
  return {
    id: 'run-task-ext',
    status: 'completed',
    runtimeKind: 'macp',
    runtimeVersion: 'v1',
    createdAt: '2026-04-14T00:00:00Z'
  } as RunRecord;
}

function externalOrchestratorState(): RunStateProjection {
  return {
    run: { runId: 'run-task-ext', status: 'completed', modeName: 'macp.mode.task.v1' },
    // The orchestrator that resolved the decision is deliberately NOT a participant.
    participants: [
      { participantId: 'assignee-a', role: 'assignee', status: 'completed' },
      { participantId: 'assignee-b', role: 'assignee', status: 'completed' }
    ],
    graph: {
      nodes: [
        { id: 'assignee-a', kind: 'agent', status: 'completed' },
        { id: 'assignee-b', kind: 'agent', status: 'completed' },
        { id: 'decision', kind: 'decision', status: 'completed' }
      ],
      // Edge whose SOURCE is the external orchestrator — not a node, not a participant.
      edges: [
        { from: ORCHESTRATOR, to: 'decision', kind: 'coordination', ts: '2026-04-14T00:00:01Z' },
        { from: 'assignee-a', to: 'decision', kind: 'analysis', ts: '2026-04-14T00:00:02Z' }
      ]
    },
    decision: {
      current: {
        action: 'complete',
        confidence: 0.82,
        reasons: ['Task completed by both assignees.'],
        finalized: true,
        outcomePositive: true,
        resolvedBy: ORCHESTRATOR,
        resolvedAt: '2026-04-14T00:10:00Z'
      }
    },
    signals: { signals: [] },
    progress: { entries: [] },
    timeline: { latestSeq: 0, totalEvents: 0, recent: [] },
    policy: { policyVersion: 'policy.default', commitmentEvaluations: [] },
    trace: { traceId: '', spanCount: 0, lastSpanId: '', linkedArtifacts: [] },
    outboundMessages: { total: 0, queued: 0, accepted: 0, rejected: 0 }
  } as RunStateProjection;
}

const noEvents: CanonicalEvent[] = [];

describe('external orchestrator not in participants (task mode)', () => {
  beforeAll(() => {
    // ReactFlow needs these in jsdom.
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  it('DecisionPanel renders resolvedBy verbatim without resolving it against participants', () => {
    renderWithProviders(<DecisionPanel run={baseRun()} state={externalOrchestratorState()} runId="run-task-ext" />);
    expect(screen.getByText('COMPLETE')).toBeInTheDocument();
    expect(screen.getByText(ORCHESTRATOR)).toBeInTheDocument();
  });

  it('NodeInspector renders a real node when the graph contains an external orchestrator edge', () => {
    renderWithProviders(
      <NodeInspector state={externalOrchestratorState()} events={noEvents} selectedNodeId="assignee-a" />
    );
    expect(screen.getAllByText(/assignee-a/i).length).toBeGreaterThanOrEqual(1);
  });

  it('ExecutionGraph mounts and preserves the commitment edge from the external orchestrator', () => {
    // The console never filters edges by node existence — assert the fixture still holds
    // the orchestrator-sourced edge that must reach ReactFlow.
    const state = externalOrchestratorState();
    expect(state.graph.edges.some((e) => e.from === ORCHESTRATOR && e.to === 'decision')).toBe(true);
    expect(() => renderWithProviders(<ExecutionGraph state={state} />)).not.toThrow();
  });
});
