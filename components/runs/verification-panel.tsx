'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getReceiptKeys, getRunReceipt, getRunVerification, getRuntimeCapabilities } from '@/lib/api/client';
import { ApiError, describeApiError } from '@/lib/api/fetcher';
import type { RunDecisionReceipt, RunVerification, RunVerificationStatus } from '@/lib/types';
import { exportRawJson, exportToJson } from '@/lib/utils/export';
import { formatDateTime } from '@/lib/utils/format';
import {
  buildReceipt,
  checkRuntimeReceipt,
  commitmentFromProjection,
  receiptFilename,
  rfc3339Utc,
  toCommitmentProjection,
  type RuntimeReceiptCheck,
  type RuntimeReceiptVerdict
} from '@/lib/utils/receipt';

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
          <VerificationBody runId={runId} demoMode={demoMode} data={query.data} modeName={modeName} />
        )}
      </CardContent>
    </Card>
  );
}

function isTerminal(status?: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function VerificationBody({
  runId,
  demoMode,
  data,
  modeName
}: {
  runId: string;
  demoMode: boolean;
  data: RunVerification;
  modeName?: string;
}) {
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
            <ReceiptDownload
              runId={runId}
              demoMode={demoMode}
              commitment={data.commitment}
              commitmentHash={data.commitmentHash}
              modeName={modeName}
            />
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
 * W5 U1 — the receipt download. When the runtime advertises `decisionReceipt.getDecisionReceipt`
 * (RFC-MACP-0013 §13), the console fetches the receipt the runtime issued, verifies it in the browser
 * against the runtime's key set, and downloads the runtime's exact bytes. Otherwise — no capability,
 * the runtime answers 501, has no receipt for the run, or the fetch fails — it falls back to the
 * console-built unsigned receipt (W3.10), labelled as such.
 */
function ReceiptDownload(props: {
  runId: string;
  demoMode: boolean;
  commitment: NonNullable<RunVerification['commitment']>;
  commitmentHash: string;
  modeName?: string;
}) {
  const { runId, demoMode } = props;
  const capabilities = useQuery({
    queryKey: ['runtime-capabilities', demoMode],
    queryFn: () => getRuntimeCapabilities(demoMode),
    staleTime: 5 * 60_000,
    retry: false
  });
  const receiptCapability = capabilities.data?.capabilities?.decisionReceipt;
  const runtimeIssues = !demoMode && receiptCapability?.getDecisionReceipt === true;
  const signed = receiptCapability?.signed === true;
  const runtime = useQuery({
    queryKey: ['run-receipt', runId, signed],
    queryFn: () => loadRuntimeReceipt(runId, signed),
    enabled: runtimeIssues,
    retry: false
  });

  if (capabilities.isLoading || (runtimeIssues && runtime.isLoading)) {
    return <div className="muted small">Looking for a runtime-issued receipt…</div>;
  }
  if (runtimeIssues && runtime.data?.kind === 'receipt') {
    return <RuntimeReceipt receipt={runtime.data.receipt} check={runtime.data.check} />;
  }

  let note: ReactNode = null;
  if (runtimeIssues && runtime.data?.kind === 'unavailable') {
    note = (
      <div className="muted small" data-testid="receipt-unavailable">
        The runtime has no receipt for this run.
      </div>
    );
  } else if (runtimeIssues && runtime.data?.kind === 'unsupported') {
    note = (
      <div className="muted small" data-testid="receipt-unsupported">
        The runtime does not issue decision receipts.
      </div>
    );
  } else if (runtimeIssues && runtime.isError) {
    note = (
      <div role="status" className="error-text" data-testid="receipt-fetch-error">
        Could not fetch the runtime&apos;s receipt: {describeApiError(runtime.error)}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      {note}
      <ConsoleReceiptDownload {...props} />
    </div>
  );
}

type RuntimeReceiptResult =
  | { kind: 'receipt'; receipt: RunDecisionReceipt; check: RuntimeReceiptCheck }
  | { kind: 'unavailable' }
  | { kind: 'unsupported' };

/**
 * Receipt first, then keys: reading a receipt signed by a key the control plane's cached key set
 * lacks drops that cache, so the keys read that follows sees the rotation. If a signature still
 * names an unknown key, the keys are fetched once more (`fetchJson` is `no-store`, so this reaches
 * the control plane) before the verdict stands.
 */
async function loadRuntimeReceipt(runId: string, signed: boolean): Promise<RuntimeReceiptResult> {
  let receipt: RunDecisionReceipt;
  try {
    receipt = await getRunReceipt(runId);
  } catch (error) {
    if (error instanceof ApiError) {
      // 409 RECEIPT_UNAVAILABLE (not resolved, no Commitment, not issuable); 404 RUN_NOT_FOUND or
      // NOT_FOUND (no session yet). Neither is a fault: the run simply has no runtime receipt.
      if (error.status === 409 || error.status === 404) return { kind: 'unavailable' };
      if (error.status === 501) return { kind: 'unsupported' };
    }
    throw error;
  }

  let keysError: unknown = null;
  const fetchKeys = async (): Promise<unknown> => {
    try {
      return await getReceiptKeys();
    } catch (error) {
      keysError = error;
      return { keys: [] };
    }
  };
  let check = checkRuntimeReceipt(receipt.receiptJson, await fetchKeys(), signed);
  if (!keysError && check.verification.attestations.includes('unknown_key')) {
    check = checkRuntimeReceipt(receipt.receiptJson, await fetchKeys(), signed);
  }
  if (keysError && check.verdict === 'failed') {
    check = {
      ...check,
      reason: `${check.reason} The runtime's key set could not be fetched: ${describeApiError(keysError)}`
    };
  }
  return { kind: 'receipt', receipt, check };
}

const RUNTIME_RECEIPT_VIEW: Record<
  RuntimeReceiptVerdict,
  { label: string; tone: 'success' | 'danger' | 'neutral'; note: string }
> = {
  attested: {
    label: 'Attested',
    tone: 'success',
    note: "Signed by the runtime: macp-receipt/1, and its signature verifies against the runtime's published keys."
  },
  integrity_only: {
    label: 'Integrity only',
    tone: 'neutral',
    note: 'Issued by the runtime, unsigned (integrity-only): it pins what was decided; nobody has signed it.'
  },
  failed: {
    label: 'Verification failed',
    tone: 'danger',
    note: 'Issued by the runtime, but it did not verify. Download it to inspect; do not rely on it.'
  }
};

function RuntimeReceipt({ receipt, check }: { receipt: RunDecisionReceipt; check: RuntimeReceiptCheck }) {
  const view = RUNTIME_RECEIPT_VIEW[check.verdict];
  const issuer = typeof receipt.receipt.issuer === 'string' ? receipt.receipt.issuer : null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="inline-list" data-testid="receipt-status">
        <Badge label={view.label} tone={view.tone} />
        <span className="muted small">{view.note}</span>
      </div>
      {check.verdict === 'failed' ? (
        <div role="alert" className="error-text" data-testid="receipt-failure">
          {check.reason}
        </div>
      ) : null}
      <div className="inline-list">
        <Button
          variant="secondary"
          onClick={() => exportRawJson(receipt.receiptJson, receiptFilename(receipt.sessionId))}
        >
          <Download size={16} />
          {check.verdict === 'failed' ? 'Download receipt for inspection' : 'Download receipt'}
        </Button>
        {issuer ? (
          <span className="muted small">
            Issuer <code>{issuer}</code>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * W3.10 — exports an RFC-MACP-0013 Appendix A receipt (`macp-receipt/1`) for the run's Commitment.
 * Unsigned and integrity-only: the console holds no issuer keys, so `attestations` is `[]`. The hash
 * is recomputed from the projection and the download is refused if it disagrees with the control
 * plane's, so the file never records a hash its own `commitment` does not produce.
 */
function ConsoleReceiptDownload({
  commitment,
  commitmentHash,
  modeName
}: {
  commitment: NonNullable<RunVerification['commitment']>;
  commitmentHash: string;
  modeName?: string;
}) {
  const [error, setError] = useState('');
  const sessionId = commitment.sessionId;
  const ready = Boolean(modeName && sessionId);

  function download() {
    setError('');
    const projection = toCommitmentProjection(commitment.payload);
    if (!projection) {
      setError('The Commitment carries a field outside the RFC-MACP-0013 field set, so no receipt can be issued.');
      return;
    }
    try {
      const receipt = buildReceipt(commitmentFromProjection(projection), {
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
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="inline-list">
        <Button variant="secondary" onClick={download} disabled={!ready}>
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
