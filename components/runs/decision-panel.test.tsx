import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { DecisionPanel } from './decision-panel';
import type { CanonicalEvent, RunRecord, RunStateProjection } from '@/lib/types';

/**
 * Integration-style tests for PR-E1 (findings #6a / #6b / #6c).
 * Asserts the panel behaves correctly across the three backend-shipped
 * field shapes (BE-3 / BE-5 / BE-6 / BE-7) and the R.status branches.
 */

function baseRun(over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-test-1',
    status: 'completed',
    runtimeKind: 'macp',
    runtimeVersion: 'v1',
    createdAt: '2026-04-14T00:00:00Z',
    ...over
  } as RunRecord;
}

function baseState(
  currentOver: Partial<NonNullable<RunStateProjection['decision']['current']>> = {}
): RunStateProjection {
  return {
    run: { runId: 'run-test-1', status: 'completed' },
    participants: [],
    graph: { nodes: [], edges: [] },
    decision: {
      current: {
        action: 'approve',
        confidence: 0.9,
        reasons: ['reason A', 'reason B'],
        finalized: true,
        outcomePositive: true,
        ...currentOver
      }
    },
    signals: { signals: [] },
    progress: { entries: [] },
    timeline: { latestSeq: 0, totalEvents: 0, recent: [] },
    policy: {
      policyVersion: 'policy.default',
      resolvedAt: undefined,
      commitmentEvaluations: []
    },
    trace: { traceId: '', spanCount: 0, lastSpanId: '', linkedArtifacts: [] },
    outboundMessages: { total: 0, queued: 0, accepted: 0, rejected: 0 }
  } as RunStateProjection;
}

describe('DecisionPanel — action tone and outcome branching', () => {
  it('renders the action in uppercase with success-tone coloring for approve', () => {
    renderWithProviders(<DecisionPanel run={baseRun()} state={baseState()} />);
    expect(screen.getByText('APPROVE')).toBeInTheDocument();
    // Badge runs titleCase over the label, so "Positive outcome" → "Positive Outcome".
    expect(screen.getByText('Positive Outcome')).toBeInTheDocument();
  });

  it('renders DECLINE with a negative outcome badge when outcomePositive is false', () => {
    renderWithProviders(
      <DecisionPanel run={baseRun()} state={baseState({ action: 'decline', outcomePositive: false })} />
    );
    expect(screen.getByText('DECLINE')).toBeInTheDocument();
    expect(screen.getByText('Negative Outcome')).toBeInTheDocument();
  });

  it('renders "No outcome reported" when outcomePositive is null (BE-3 finalized-without-semantics)', () => {
    renderWithProviders(
      <DecisionPanel run={baseRun({ status: 'completed' })} state={baseState({ outcomePositive: null })} />
    );
    expect(screen.getByText('No Outcome Reported')).toBeInTheDocument();
  });

  it('renders the run status badge when the run failed or was cancelled', () => {
    renderWithProviders(
      <DecisionPanel run={baseRun({ status: 'failed' })} state={baseState({ outcomePositive: undefined })} />
    );
    // Failed badge appears in both inline-list (status header) and outcome cell.
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
  });

  it('renders "Awaiting decision" only for live statuses', () => {
    renderWithProviders(
      <DecisionPanel
        run={baseRun({ status: 'running' })}
        state={{
          ...baseState(),
          run: { runId: 'run-test-1', status: 'running' },
          decision: { current: { action: 'pending', finalized: false } }
        }}
      />
    );
    expect(screen.getByText('Awaiting Decision')).toBeInTheDocument();
  });
});

describe('DecisionPanel — prompt, reasons, contributors (BE-5/6/7)', () => {
  it('renders the scenario prompt labeled and distinct from reasons', () => {
    renderWithProviders(
      <DecisionPanel run={baseRun()} state={baseState({ prompt: 'Decide whether to APPROVE, STEP_UP, or DECLINE.' })} />
    );
    expect(screen.getByText('Decision prompt (from scenario)')).toBeInTheDocument();
    expect(screen.getByText('Decide whether to APPROVE, STEP_UP, or DECLINE.')).toBeInTheDocument();
  });

  it('renders reasons as a bulleted list (one <li> per reason)', () => {
    renderWithProviders(<DecisionPanel run={baseRun()} state={baseState()} />);
    const items = screen.getAllByRole('listitem');
    expect(items.some((item) => item.textContent === 'reason A')).toBe(true);
    expect(items.some((item) => item.textContent === 'reason B')).toBe(true);
  });

  it('renders the contributors table from proposals[]', () => {
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          proposals: [
            {
              participantId: 'fraud-agent',
              action: 'approve',
              confidence: 0.78,
              reasons: ['OK'],
              ts: '2026-04-14T00:00:00Z',
              vote: 'allow'
            },
            {
              participantId: 'risk-agent',
              action: 'decline',
              confidence: 0.65,
              reasons: ['Risk too high'],
              ts: '2026-04-14T00:00:01Z',
              vote: 'deny'
            }
          ]
        })}
      />
    );
    expect(screen.getByText('fraud-agent')).toBeInTheDocument();
    expect(screen.getByText('risk-agent')).toBeInTheDocument();
    // Actions appear in the main header + contributor rows
    expect(screen.getAllByText('APPROVE').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('DECLINE')).toBeInTheDocument();
    expect(screen.getByText('Allow')).toBeInTheDocument(); // Badge.titleCase
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('renders resolvedBy / resolvedAt sub-line and deep-links to originating event seq', () => {
    const events: CanonicalEvent[] = [
      {
        id: 'ev-1',
        runId: 'run-test-1',
        seq: 42,
        ts: '2026-04-14T00:00:00Z',
        type: 'proposal.created',
        source: { kind: 'runtime', name: 'macp' },
        data: { proposalId: 'prop-xyz' }
      }
    ];
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          proposalId: 'prop-xyz',
          resolvedBy: 'risk-agent',
          resolvedAt: '2026-04-14T00:10:00Z'
        })}
        events={events}
        runId="run-test-1"
      />
    );
    expect(screen.getByText('risk-agent')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /jump to event seq 42/i });
    expect(link).toHaveAttribute('href', '/logs?runId=run-test-1&seq=42');
  });
});

describe('DecisionPanel — supersession lineage canonicality (RFC-MACP-0013 §9)', () => {
  const CANONICAL_HASH = 'sha256:9f2c1ab7e4d8c3061f5a2b9d7e0c4a18b6d35f92ac71e0d4b8f6a23c1e5079db';
  const LEGACY_HASH = 'A41F09C7B2E5D8306';

  // Badge runs titleCase over its label, so "Legacy hash format" → "Legacy Hash Format".
  const BADGE_TEXT = 'Legacy Hash Format';
  const EXPLAINER = /predates RFC-MACP-0013/;

  it('badges a non-canonical hash with warning tone and still renders the hash and session id', () => {
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          supersedes: {
            sessionId: 'session-prior-incident-000',
            commitmentHash: LEGACY_HASH,
            canonical: false
          }
        })}
      />
    );

    const badge = screen.getByText(BADGE_TEXT);
    expect(badge).toBeInTheDocument();
    // Tone is part of the acceptance criterion, not decoration — a silent regression to
    // neutral/danger would otherwise ship green.
    expect(badge).toHaveClass('badge-warning');
    // The point of the upstream change was to badge the format, not to drop the lineage.
    expect(screen.getByText(LEGACY_HASH)).toBeInTheDocument();
    expect(screen.getByText('session-prior-incident-000')).toBeInTheDocument();
    expect(screen.getByText('Supersedes prior commitment')).toBeInTheDocument();
    // The explanatory copy is what makes the badge intelligible; it is a second `=== false`
    // gate that must stay in sync with the first.
    expect(screen.getByText(EXPLAINER)).toBeInTheDocument();
  });

  it('exposes the full hash via title even when the rendered value is truncated', () => {
    // A production non-canonical hash can be long enough that the badged defect sits past the
    // 24-char cut, leaving an operator unable to see what was flagged.
    const LONG_LEGACY_HASH = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          supersedes: {
            sessionId: 'session-prior-incident-001',
            commitmentHash: LONG_LEGACY_HASH,
            canonical: false
          }
        })}
      />
    );

    expect(screen.getByText(BADGE_TEXT)).toBeInTheDocument();
    // Truncated in the DOM text...
    expect(screen.queryByText(LONG_LEGACY_HASH)).not.toBeInTheDocument();
    // ...but recoverable in full from the title attribute.
    expect(screen.getByTitle(LONG_LEGACY_HASH)).toBeInTheDocument();
  });

  it('renders no badge when the hash is canonical', () => {
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          supersedes: {
            sessionId: 'session-prior-fraud-000',
            commitmentHash: CANONICAL_HASH,
            canonical: true
          }
        })}
      />
    );

    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(EXPLAINER)).not.toBeInTheDocument();
    expect(screen.getByText('Supersedes prior commitment')).toBeInTheDocument();
  });

  it('renders no badge when canonical is absent — the version-skew regression guard', () => {
    // `undefined` means an OLDER control plane, one deployed before the canonical backfill —
    // not a non-canonical hash. The CP's own ASSUMPTIONS.md P6 names this component as the
    // blast radius and warns that `if (!s.canonical) badge()` would mis-label
    // legacy-but-actually-canonical history. This test is what stops us being that consumer.
    renderWithProviders(
      <DecisionPanel
        run={baseRun()}
        state={baseState({
          supersedes: {
            sessionId: 'session-prior-fraud-000',
            commitmentHash: CANONICAL_HASH
          }
        })}
      />
    );

    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(EXPLAINER)).not.toBeInTheDocument();
    expect(screen.getByText('Supersedes prior commitment')).toBeInTheDocument();
  });

  it('renders no supersession block at all when supersedes is absent', () => {
    renderWithProviders(<DecisionPanel run={baseRun()} state={baseState()} />);
    expect(screen.queryByText('Supersedes prior commitment')).not.toBeInTheDocument();
    expect(screen.queryByText(BADGE_TEXT)).not.toBeInTheDocument();
  });
});
