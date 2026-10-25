'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRunVerification } from '@/lib/api/client';
import type { RunVerification, RunVerificationStatus } from '@/lib/types';
import { exportToJson } from '@/lib/utils/export';
import { formatDateTime } from '@/lib/utils/format';
import { buildReceipt, receiptFilename, rfc3339Utc, toCommitmentProjection } from '@/lib/utils/receipt';

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
  runStatus,
  modeName
}: {
  runId: string;
  demoMode: boolean;
  runStatus?: string;
  /** Session mode identifier (e.g. `macp.mode.decision.v1`), required by the receipt's `mode`. */
  modeName?: string;
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
          <VerificationBody data={query.data} modeName={modeName} />
        )}
      </CardContent>
    </Card>
  );
}

function isTerminal(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function VerificationBody({ data, modeName }: { data: RunVerification; modeName?: string }) {
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
          {data.commitment && data.commitmentHash ? (
            <ReceiptDownload commitment={data.commitment} commitmentHash={data.commitmentHash} modeName={modeName} />
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

/**
 * W3.10 — exports an RFC-MACP-0013 Appendix A receipt (`macp-receipt/1`) for the run's Commitment.
 * Unsigned and integrity-only: the console holds no issuer keys, so `attestations` is `[]`. The hash
 * is recomputed from the projection and the download is refused if it disagrees with the control
 * plane's, so the file never records a hash its own `commitment` does not produce.
 */
function ReceiptDownload({
  commitment,
  commitmentHash,
  modeName
}: {
  commitment: NonNullable<RunVerification['commitment']>;
  commitmentHash: string;
  modeName?: string;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const sessionId = commitment.sessionId;
  const ready = Boolean(modeName && sessionId);

  async function download() {
    setError('');
    const projection = toCommitmentProjection(commitment.payload);
    if (!projection) {
      setError('The Commitment carries a field outside the RFC-MACP-0013 field set, so no receipt can be issued.');
      return;
    }
    setPending(true);
    try {
      const receipt = await buildReceipt(projection, {
        sessionId,
        mode: modeName!,
        issuer: `console:${window.location.host}`,
        issuedAt: rfc3339Utc()
      });
      if (receipt.commitment_hash !== commitmentHash) {
        setError(
          `The recomputed hash ${receipt.commitment_hash} does not match the control plane's, so no receipt was issued.`
        );
        return;
      }
      exportToJson(receipt, receiptFilename(sessionId));
    } catch (err) {
      setError(`Could not build the receipt: ${String(err)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="inline-list">
        <Button variant="secondary" onClick={() => void download()} disabled={!ready || pending}>
          <Download size={16} />
          Download receipt
        </Button>
        <span className="muted small">
          {ready
            ? 'macp-receipt/1, unsigned (integrity-only): it pins what was decided; nobody has signed it.'
            : 'The session mode is not known yet, so a receipt cannot be issued.'}
        </span>
      </div>
      {error ? (
        <div role="status" className="error-text">
          {error}
        </div>
      ) : null}
    </div>
  );
}
