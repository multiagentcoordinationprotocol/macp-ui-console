import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@/test/fixtures/receipt/macp-decision-receipt.schema.json';
import { commitmentHash, type DecisionReceipt } from '@/lib/utils/receipt';
import { VerificationPanel } from './verification-panel';
import type { RunVerification } from '@/lib/types';
import { ApiError } from '@/lib/api/fetcher';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, getRunVerification: vi.fn() };
});

vi.mock('@/lib/utils/export', () => ({ exportToJson: vi.fn() }));

const { getRunVerification: mockedGet } = await import('@/lib/api/client');
const { exportToJson: mockedExport } = await import('@/lib/utils/export');
const exportToJson = vi.mocked(mockedExport);
const getRunVerification = vi.mocked(mockedGet);

const HASH = 'sha256:9f58e9d114d11860d48aa2bcb8cda458b9618b1cc8560595a802b68c4af85d41';

function verified(over: Partial<RunVerification> = {}): RunVerification {
  return {
    runId: 'run-1',
    status: 'verified',
    match: true,
    label: 'macp-commitment-hash/1',
    commitmentHash: HASH,
    recomputed: HASH,
    wireVerdict: 'match',
    commitment: {
      messageId: 'msg-commit-1',
      sender: 'coordinator',
      sessionId: 'sess-1',
      acceptedAt: '2026-10-24T00:00:00Z',
      payload: { action: 'approve', outcome_positive: true }
    },
    checks: [
      { id: 'wire_recompute', description: 'Stored hash equals wire recompute', passed: true },
      { id: 'rfc0013_verify', description: 'RFC-MACP-0013 §6.1 verify returns match', passed: true, detail: 'match' }
    ],
    notVerified: ['Authenticity: a commitment hash is a content digest, not a signature.'],
    checkedAt: '2026-10-24T00:00:01Z',
    ...over
  };
}

/** RFC-MACP-0013 vector cmt_hash_001: its pinned hash is `HASH`. */
const VECTOR_001 = {
  commitment_id: 'c1',
  action: 'decision.approved',
  authority_scope: 'seam',
  reason: 'sealed by seam',
  mode_version: 'macp.mode.decision.v1',
  policy_version: '1.0.0',
  configuration_version: '1.0.0',
  outcome_positive: true
};

function withProjection(): RunVerification {
  const base = verified();
  return { ...base, commitment: { ...base.commitment!, payload: VECTOR_001 } };
}

describe('VerificationPanel', () => {
  beforeEach(() => {
    getRunVerification.mockReset();
    exportToJson.mockReset();
  });

  it('shows Verified ✓ with the hash, the recompute, the checks and the caveats', async () => {
    getRunVerification.mockResolvedValue(verified());
    renderWithProviders(<VerificationPanel runId="run-1" demoMode={false} runStatus="completed" />);

    expect(await screen.findByText('Verified ✓')).toBeInTheDocument();
    expect(screen.getByTestId('verification-hash')).toHaveTextContent(HASH);
    expect(screen.getByTestId('verification-recomputed')).toHaveTextContent(HASH);
    expect(screen.getByText('Stored hash equals wire recompute')).toBeInTheDocument();
    expect(screen.getByText(/content digest, not a signature/)).toBeInTheDocument();
    expect(screen.getByText('macp-commitment-hash/1')).toBeInTheDocument();
    expect(getRunVerification).toHaveBeenCalledWith('run-1', false);
  });

  it('shows ✗ and the failing check detail on a mismatch', async () => {
    getRunVerification.mockResolvedValue(
      verified({
        status: 'mismatch',
        match: false,
        recomputed: 'sha256:' + '0'.repeat(64),
        wireVerdict: 'mismatch',
        checks: [
          { id: 'wire_recompute', description: 'Stored hash equals wire recompute', passed: false },
          { id: 'rfc0013_verify', description: 'RFC-MACP-0013 §6.1 verify', passed: false, detail: 'mismatch' }
        ]
      })
    );
    renderWithProviders(<VerificationPanel runId="run-1" demoMode={false} runStatus="completed" />);

    expect(await screen.findByText('Not Verified ✗')).toBeInTheDocument();
    expect(screen.getAllByLabelText('failed')).toHaveLength(2);
    expect(screen.getByText('(mismatch)')).toBeInTheDocument();
  });

  it('shows the pending state while the run has no commitment', async () => {
    getRunVerification.mockResolvedValue(
      verified({
        status: 'pending',
        match: false,
        commitmentHash: null,
        recomputed: null,
        wireVerdict: null,
        commitment: null,
        checks: []
      })
    );
    renderWithProviders(<VerificationPanel runId="run-1" demoMode={false} runStatus="running" />);

    expect(await screen.findByText('Awaiting Commitment')).toBeInTheDocument();
    expect(screen.getByText(/No Commitment has been accepted/)).toBeInTheDocument();
    expect(screen.queryByTestId('verification-hash')).not.toBeInTheDocument();
  });

  it('degrades to an unavailable notice when the endpoint fails', async () => {
    getRunVerification.mockRejectedValue(
      new ApiError(404, 'Not Found', '{}', 'macp-control-plane', '/runs/run-1/verification')
    );
    renderWithProviders(<VerificationPanel runId="run-1" demoMode={false} runStatus="completed" />);

    expect(await screen.findByText(/Verification is unavailable/)).toBeInTheDocument();
  });

  describe('Download receipt (W3.10)', () => {
    it('downloads a schema-valid, integrity-only macp-receipt/1 named after the session', async () => {
      getRunVerification.mockResolvedValue(withProjection());
      const user = userEvent.setup();
      renderWithProviders(
        <VerificationPanel runId="run-1" demoMode={false} runStatus="completed" modeName="macp.mode.decision.v1" />
      );

      await user.click(await screen.findByRole('button', { name: /download receipt/i }));
      await waitFor(() => expect(exportToJson).toHaveBeenCalledTimes(1));

      const [receipt, filename] = exportToJson.mock.calls[0] as [DecisionReceipt, string];
      expect(filename).toBe('receipt-sess-1.json');
      const ajv = new Ajv2020({ strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true);
      expect(receipt).toMatchObject({
        receipt_format: 'macp-receipt/1',
        session_id: 'sess-1',
        mode: 'macp.mode.decision.v1',
        commitment: VECTOR_001,
        commitment_hash: HASH,
        attestations: []
      });
      expect(receipt.issuer).toMatch(/^console:/);
      expect(receipt.issued_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      // A.4 integrity: recomputes to commitment_hash, and with no attestations the verdict is integrity_only.
      expect(await commitmentHash(receipt.commitment)).toBe(receipt.commitment_hash);
    });

    it('refuses to issue a receipt when the recomputed hash disagrees with the control plane', async () => {
      // `verified()` carries a partial payload whose projection does not hash to HASH.
      getRunVerification.mockResolvedValue(verified());
      const user = userEvent.setup();
      renderWithProviders(
        <VerificationPanel runId="run-1" demoMode={false} runStatus="completed" modeName="macp.mode.decision.v1" />
      );

      await user.click(await screen.findByRole('button', { name: /download receipt/i }));
      expect(await screen.findByText(/does not match the control plane/)).toBeInTheDocument();
      expect(exportToJson).not.toHaveBeenCalled();
    });

    it('is disabled until the session mode is known', async () => {
      getRunVerification.mockResolvedValue(withProjection());
      renderWithProviders(<VerificationPanel runId="run-1" demoMode={false} runStatus="completed" />);

      expect(await screen.findByRole('button', { name: /download receipt/i })).toBeDisabled();
    });

    it('is absent while the run has no Commitment', async () => {
      getRunVerification.mockResolvedValue(
        verified({ status: 'pending', commitmentHash: null, recomputed: null, commitment: null, checks: [] })
      );
      renderWithProviders(
        <VerificationPanel runId="run-1" demoMode={false} runStatus="running" modeName="macp.mode.decision.v1" />
      );

      expect(await screen.findByText('Awaiting Commitment')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /download receipt/i })).not.toBeInTheDocument();
    });
  });
});
