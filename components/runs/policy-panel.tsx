'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PolicyBadge } from '@/components/ui/policy-badge';
import { PolicyRulesCard } from '@/components/ui/policy-rules-card';
import { Tooltip } from '@/components/ui/tooltip';
import { getRuntimePolicy } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CommitmentVoteTally, ExpectedCommitment, PolicyHints, PolicyProjection, QuorumStatus } from '@/lib/types';
import { formatDateTime, formatPercent } from '@/lib/utils/format';

/**
 * PR-E2 / Finding #5 — Policy governance panel.
 *
 * Consumes the enriched projection (BE-8 / BE-9 / BE-11):
 *  - Fetches the registered RuntimePolicyDescriptor and renders full
 *    rules via PolicyRulesCard (always — no more `hints.type !== 'none'`
 *    gate).
 *  - Renders `expectedCommitments[]` with tooltip on hover showing
 *    title + description (Q6 — layered tooltip+link affordance).
 *  - Renders `voteTally[]` inline under each expected commitment.
 *  - Surfaces `quorumStatus` as a header badge.
 *  - Falls back gracefully to the legacy `commitmentEvaluations[]` when
 *    new fields aren't yet populated (e.g. against an older macp-control-plane).
 */

function quorumTone(status?: QuorumStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'reached') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function findTally(tallies: CommitmentVoteTally[] | undefined, commitmentId: string): CommitmentVoteTally | undefined {
  return tallies?.find((t) => t.commitmentId === commitmentId);
}

export function PolicyPanel({ policy, policyHints }: { policy: PolicyProjection; policyHints?: PolicyHints }) {
  const demoMode = usePreferencesStore((state) => state.demoMode);

  // BE-side §2.5 — fetch descriptor when we have a policyVersion that
  // isn't the placeholder. Graceful when missing (UI falls back to hints).
  const descriptorQuery = useQuery({
    queryKey: ['runtime-policy', policy.policyVersion, demoMode],
    queryFn: () => getRuntimePolicy(policy.policyVersion, demoMode),
    enabled: Boolean(policy.policyVersion) && policy.policyVersion !== 'unknown',
    retry: false
  });

  const expected = policy.expectedCommitments ?? [];
  const tallies = policy.voteTally;
  const quorum = policy.quorumStatus;

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <CardTitle>Policy governance</CardTitle>
            <CardDescription>
              RFC-MACP-0012 policy evaluation status, commitment decisions, and governance constraints for this run.
            </CardDescription>
          </div>
          {policy.policyVersion ? (
            <Link href={`/policies/${encodeURIComponent(policy.policyVersion)}`} className="panel-action">
              View policy →
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="stack">
        <div className="inline-list">
          {policy.policyVersion ? (
            <Link href={`/policies/${encodeURIComponent(policy.policyVersion)}`}>
              <Badge label={policy.policyVersion} tone="info" />
            </Link>
          ) : null}
          {policy.resolvedAt ? <Badge label="resolved" tone="success" /> : <Badge label="pending" tone="warning" />}
          {quorum ? <Badge label={`quorum:${quorum}`} tone={quorumTone(quorum)} /> : null}
          {policy.outcomePositive === true ? <Badge label="Policy satisfied" tone="success" /> : null}
          {policy.outcomePositive === false ? <Badge label="Policy violated" tone="danger" /> : null}
        </div>

        {policy.policyDescription ? <p className="muted">{policy.policyDescription}</p> : null}

        {policy.resolvedAt ? (
          <div className="list-item">
            <div className="list-item-title">Resolved at</div>
            <div className="list-item-meta">{formatDateTime(policy.resolvedAt)}</div>
          </div>
        ) : null}

        {/* Full rules — prefer descriptor, fall back to hints when descriptor is unavailable. */}
        {descriptorQuery.data ? (
          <PolicyRulesCard
            hints={{
              type: descriptorQuery.data.mode as PolicyHints['type'],
              description: descriptorQuery.data.description
            }}
            policyVersion={policy.policyVersion}
            compact
          />
        ) : policyHints && policyHints.type && policyHints.type !== 'none' ? (
          <PolicyRulesCard hints={policyHints} policyVersion={policy.policyVersion} compact />
        ) : null}

        {/* Expected commitments — one row per declared commitment with tooltip,
            inline tally (when present), and evaluation decision (when completed). */}
        {expected.length > 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            <h4 className="small muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Expected commitments ({expected.length})
            </h4>
            <div className="table-wrap">
              <table className="table" aria-label="Commitment evaluations and tally">
                <thead>
                  <tr>
                    <th>Commitment</th>
                    <th>Allow / Deny</th>
                    <th>Quorum</th>
                    <th>Decision</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {expected.map((ec) => {
                    const tally = findTally(tallies, ec.commitmentId);
                    const evaluation = policy.commitmentEvaluations.find((e) => e.commitmentId === ec.commitmentId);
                    return <CommitmentRow key={ec.commitmentId} ec={ec} tally={tally} evaluation={evaluation} />;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : policy.commitmentEvaluations.length > 0 ? (
          // Legacy fallback when BE-8 expectedCommitments aren't populated.
          <div className="stack">
            <h4 className="small muted">Commitment evaluations</h4>
            <table className="table">
              <thead>
                <tr>
                  <th>Commitment</th>
                  <th>Decision</th>
                  <th>Reasons</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {policy.commitmentEvaluations.map((evaluation) => (
                  <tr key={evaluation.commitmentId}>
                    <td>
                      <code>{evaluation.commitmentId}</code>
                    </td>
                    <td>
                      <PolicyBadge type={evaluation.decision === 'allow' ? 'none' : 'unanimous'} />
                      <Badge
                        label={evaluation.decision}
                        tone={evaluation.decision === 'allow' ? 'success' : 'danger'}
                      />
                    </td>
                    <td>{evaluation.reasons.join('; ')}</td>
                    <td className="muted small">{formatDateTime(evaluation.ts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state compact">
            <h4>No commitments declared</h4>
            <p>
              This policy has no expected commitments to evaluate — outcome will be determined by the runtime mode
              alone.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommitmentRow({
  ec,
  tally,
  evaluation
}: {
  ec: ExpectedCommitment;
  tally?: CommitmentVoteTally;
  evaluation?: { decision: 'allow' | 'deny'; reasons: string[]; ts: string };
}) {
  return (
    <tr>
      <td style={{ maxWidth: 260 }}>
        <Tooltip
          label={
            <span>
              {ec.title ? <strong>{ec.title}</strong> : null}
              {ec.title && ec.description ? <br /> : null}
              {ec.description ?? (ec.title ? '' : 'No description registered for this commitment.')}
              {ec.requiredRoles && ec.requiredRoles.length > 0 ? (
                <span style={{ display: 'block', marginTop: 4, opacity: 0.8 }}>
                  Requires: {ec.requiredRoles.join(', ')}
                </span>
              ) : null}
            </span>
          }
        >
          <code>{ec.commitmentId}</code>
        </Tooltip>
        {ec.title ? <div className="muted small">{ec.title}</div> : null}
      </td>
      <td className="mono">
        {tally ? (
          <>
            <span style={{ color: 'var(--v2-green, var(--success))' }}>{tally.allow}</span>
            {' / '}
            <span style={{ color: 'var(--v2-red, var(--danger))' }}>{tally.deny}</span>
          </>
        ) : (
          <span className="muted small">—</span>
        )}
      </td>
      <td className="mono small">
        {tally ? (
          <>
            {tally.quorum.cast}/{tally.quorum.required}
            {typeof tally.threshold === 'number' ? ` · ≥${formatPercent(tally.threshold)}` : ''}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        {evaluation ? (
          <Badge label={evaluation.decision} tone={evaluation.decision === 'allow' ? 'success' : 'danger'} />
        ) : (
          <Badge label="pending" tone="warning" />
        )}
      </td>
      <td style={{ maxWidth: 320 }}>
        {evaluation?.reasons && evaluation.reasons.length > 0 ? (
          evaluation.reasons.join(' · ')
        ) : (
          <span className="muted small">—</span>
        )}
      </td>
    </tr>
  );
}
