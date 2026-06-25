'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CanonicalEvent, RunRecord, RunStateProjection } from '@/lib/types';
import { formatDateTime, formatPercent, titleCase, truncate } from '@/lib/utils/format';

/**
 * PR-E1 / Findings #6a + #6b + #6c — Decision panel.
 *
 * Consumes the enriched projection (BE-3 / BE-5 / BE-6 / BE-7):
 *  - big action label with action→tone mapping (Q19 hard-coded)
 *  - bulleted reasons (one per line — not `·`-joined)
 *  - contributors view rendered from `current.proposals[]`
 *  - resolvedAt / resolvedBy sub-line
 *  - decision prompt separately labeled
 *  - outcome branching on `run.status` first, then
 *    `current.outcomePositive: boolean | null`
 *  - proposalId deep-links to `/logs?runId=&seq=` when a matching
 *    event is known
 *
 * Literal-string fallbacks (PR-A1) remain: mode / environment badges
 * only render when their values exist.
 */

const ACTION_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  approve: 'success',
  accept: 'success',
  allow: 'success',
  step_up: 'warning',
  stepup: 'warning',
  review: 'warning',
  hold: 'warning',
  decline: 'danger',
  deny: 'danger',
  reject: 'danger',
  block: 'danger'
};

function actionTone(action?: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (!action) return 'neutral';
  const key = action.toLowerCase().replace(/[\s-]/g, '_');
  return ACTION_TONE[key] ?? 'neutral';
}

function renderAction(action?: string): string {
  if (!action) return 'Pending';
  return action.replace(/_/g, ' ').toUpperCase();
}

export function DecisionPanel({
  run,
  state,
  events,
  runId
}: {
  run: RunRecord;
  state: RunStateProjection;
  /** Used to resolve `proposalId` → seq for deep-link. Optional — link only renders when a match is found. */
  events?: CanonicalEvent[];
  runId?: string;
}) {
  const current = state.decision.current;
  const effectiveRunId = runId ?? run.id;

  // Map proposalId → seq once so we can link each proposal and the final
  // decision row to the originating canonical event in /logs.
  const proposalSeqIndex = useMemo(() => {
    const index = new Map<string, number>();
    if (!events) return index;
    for (const event of events) {
      const pid = typeof event.data?.proposalId === 'string' ? event.data.proposalId : undefined;
      if (pid && !index.has(pid)) index.set(pid, event.seq);
    }
    return index;
  }, [events]);

  const finalSeq =
    current?.proposalId && proposalSeqIndex.get(current.proposalId)
      ? proposalSeqIndex.get(current.proposalId)
      : undefined;

  const tone = actionTone(current?.action);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Final decision and resolution path</CardTitle>
        <CardDescription>
          Decision transparency across contributors, fallback handling, and final emitted output.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        <div className="inline-list">
          <StatusBadge status={run.status} />
          {run.metadata?.modeName || state.run.modeName ? (
            <Link href={`/modes/${encodeURIComponent(String(run.metadata?.modeName ?? state.run.modeName))}`}>
              <Badge label={String(run.metadata?.modeName ?? state.run.modeName)} tone="info" />
            </Link>
          ) : null}
          {run.metadata?.environment || process.env.NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL ? (
            <Badge label={String(run.metadata?.environment ?? process.env.NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL)} />
          ) : null}
        </div>

        {/* Action header + outcome + resolvedBy/at */}
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span
              className="display"
              style={{
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '-1px',
                lineHeight: 1,
                color:
                  tone === 'success'
                    ? 'var(--v2-green, var(--success))'
                    : tone === 'warning'
                      ? 'var(--v2-amber, var(--warning))'
                      : tone === 'danger'
                        ? 'var(--v2-red, var(--danger))'
                        : 'var(--v2-text-main, var(--text))'
              }}
            >
              {renderAction(current?.action)}
            </span>
            {typeof current?.confidence === 'number' ? (
              <span className="muted mono">conf {formatPercent(current.confidence)}</span>
            ) : null}
            {current?.outcomePositive === true ? (
              <Badge label="Positive outcome" tone="success" />
            ) : current?.outcomePositive === false ? (
              <Badge label="Negative outcome" tone="danger" />
            ) : current?.outcomePositive === null ? (
              // Finding #6b — completed run with no outcome semantics declared.
              <Badge label="No outcome reported" tone="neutral" />
            ) : run.status === 'failed' || run.status === 'cancelled' ? (
              <Badge label={titleCase(run.status)} tone="danger" />
            ) : run.status === 'completed' ? (
              <Badge label="No outcome reported" tone="neutral" />
            ) : (
              <Badge label="Awaiting decision" tone="warning" />
            )}
          </div>
          {current?.resolvedBy || current?.resolvedAt ? (
            <div className="muted small">
              {current.resolvedBy ? (
                <>
                  Resolved by <code>{current.resolvedBy}</code>
                </>
              ) : null}
              {current.resolvedAt ? (
                <>
                  {current.resolvedBy ? ' · ' : 'Resolved '}
                  {formatDateTime(current.resolvedAt)}
                </>
              ) : null}
              {finalSeq !== undefined ? (
                <>
                  {' · '}
                  <Link href={`/logs?runId=${effectiveRunId}&seq=${finalSeq}`}>jump to event seq {finalSeq}</Link>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Supersession lineage (macp-proto 0.1.3 §7.3) — the finalized commitment
            replaced a prior cross-session commitment. Observed-only. */}
        {current?.supersedes ? (
          <div className="list-item">
            <div className="list-item-title">Supersedes prior commitment</div>
            <div className="muted small">
              Replaces commitment <code>{truncate(current.supersedes.commitmentHash, 24)}</code> from session{' '}
              <code>{current.supersedes.sessionId}</code>.
            </div>
          </div>
        ) : null}

        {/* Decision prompt (from scenario) — labeled so it's distinct from reasons. */}
        {current?.prompt ? (
          <div className="list-item">
            <div className="list-item-title">Decision prompt (from scenario)</div>
            <div className="muted small">{current.prompt}</div>
          </div>
        ) : null}

        {/* Reasons — bulleted list, not `·`-joined. */}
        {current?.reasons && current.reasons.length > 0 ? (
          <div className="list-item">
            <div className="list-item-title">Reasons</div>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {current.reasons.map((reason, i) => (
                <li key={i} style={{ margin: '4px 0' }}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Contributors — from BE-5 proposals[]. */}
        {current?.proposals && current.proposals.length > 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            <h4 className="small muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Contributors ({current.proposals.length})
            </h4>
            <div className="table-wrap">
              <table className="table" aria-label="Per-contributor proposals">
                <thead>
                  <tr>
                    <th>Participant</th>
                    <th>Action</th>
                    <th>Confidence</th>
                    <th>Vote</th>
                    <th>Reasons</th>
                    <th>At</th>
                  </tr>
                </thead>
                <tbody>
                  {current.proposals.map((proposal, i) => (
                    <tr key={`${proposal.participantId}-${i}`}>
                      <td>
                        <code>{proposal.participantId}</code>
                      </td>
                      <td>
                        <Badge label={renderAction(proposal.action)} tone={actionTone(proposal.action)} />
                      </td>
                      <td className="mono">
                        {typeof proposal.confidence === 'number' ? formatPercent(proposal.confidence) : '—'}
                      </td>
                      <td>
                        {proposal.vote ? (
                          <Badge label={proposal.vote} tone={proposal.vote === 'allow' ? 'success' : 'danger'} />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        {proposal.reasons && proposal.reasons.length > 0 ? (
                          proposal.reasons.join(' · ')
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td className="mono muted small">{formatDateTime(proposal.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : current?.finalized ? (
          <div className="empty-state compact">
            <h4>No contributor proposals recorded</h4>
            <p>The decision was finalized without per-contributor data. Check the canonical event log.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
