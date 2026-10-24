'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRunVerification } from '@/lib/api/client';
import type { RunVerification, RunVerificationStatus } from '@/lib/types';
import { formatDateTime } from '@/lib/utils/format';

/**
 * W2.3 — Verify panel for audit-grade decisions.
 *
 * Shows the control plane's RFC-MACP-0013 check of the run's binding outcome: the canonical
 * commitment hash of the stored Commitment, the same hash recomputed from the envelope's raw
 * payload bytes, each check that ran, and what the result does NOT establish. While the run has
 * no Commitment yet the query polls, so a live run flips to Verified once it resolves.
 */

const STATUS_VIEW: Record<
  RunVerificationStatus,
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  verified: { label: 'Verified ✓', tone: 'success' },
  mismatch: { label: 'Not verified ✗', tone: 'danger' },
  cannot_verify: { label: 'Cannot verify', tone: 'warning' },
  pending: { label: 'Awaiting commitment', tone: 'neutral' }
};

const POLL_MS = 3000;

export function VerificationPanel({
  runId,
  demoMode,
  runStatus
}: {
  runId: string;
  demoMode: boolean;
  runStatus?: string;
}) {
  const query = useQuery({
    queryKey: ['run-verification', runId, demoMode, runStatus],
    queryFn: () => getRunVerification(runId, demoMode),
    refetchInterval: (q) => (q.state.data?.status === 'pending' && !isTerminal(runStatus) ? POLL_MS : false)
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verification</CardTitle>
        <CardDescription>
          RFC-MACP-0013 canonical commitment hash of this run&apos;s binding outcome, recomputed by the control plane.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {query.isLoading ? (
          <div className="muted small">Checking…</div>
        ) : query.isError || !query.data ? (
          <div className="empty-state compact">
            <div className="muted small">Verification is unavailable for this run.</div>
          </div>
        ) : (
          <VerificationBody data={query.data} />
        )}
      </CardContent>
    </Card>
  );
}

function isTerminal(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function VerificationBody({ data }: { data: RunVerification }) {
  const view = STATUS_VIEW[data.status] ?? STATUS_VIEW.mismatch;
  return (
    <>
      <div className="inline-list" data-testid="verification-status">
        <Badge label={view.label} tone={view.tone} />
        <span className="muted small mono">{data.label}</span>
      </div>

      {data.status === 'pending' ? (
        <div className="muted small">No Commitment has been accepted for this run yet.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <HashRow label="Commitment hash" value={data.commitmentHash} testId="verification-hash" />
          <HashRow label="Recomputed from wire bytes" value={data.recomputed} testId="verification-recomputed" />
          {data.commitment ? (
            <div className="muted small">
              Commitment <code>{data.commitment.messageId}</code> from <code>{data.commitment.sender}</code>, accepted{' '}
              {formatDateTime(data.commitment.acceptedAt)}
            </div>
          ) : null}
        </div>
      )}

      {data.checks.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <h4 className="small muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            What was checked
          </h4>
          <ul style={{ margin: 0, paddingLeft: 18 }} aria-label="Verification checks">
            {data.checks.map((check) => (
              <li key={check.id} className="small">
                <span aria-label={check.passed ? 'passed' : 'failed'}>{check.passed ? '✓' : '✗'}</span>{' '}
                {check.description}
                {check.detail && !check.passed ? <span className="muted"> ({check.detail})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.notVerified.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <h4 className="small muted" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
            Not verified
          </h4>
          <ul style={{ margin: 0, paddingLeft: 18 }} aria-label="Not verified">
            {data.notVerified.map((item) => (
              <li key={item} className="muted small">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="muted small">Checked {formatDateTime(data.checkedAt)}</div>
    </>
  );
}

function HashRow({ label, value, testId }: { label: string; value: string | null; testId: string }) {
  return (
    <div className="list-item">
      <div className="list-item-title">{label}</div>
      <code data-testid={testId} style={{ wordBreak: 'break-all' }}>
        {value ?? '—'}
      </code>
    </div>
  );
}
