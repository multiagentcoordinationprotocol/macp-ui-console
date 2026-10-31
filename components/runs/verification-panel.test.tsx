import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@/test/fixtures/receipt/macp-decision-receipt.schema.json';
import { verifyReceipt, type DecisionReceipt } from '@/lib/utils/receipt';
import { VerificationPanel } from './verification-panel';
import type { RunVerification } from '@/lib/types';
import { ApiError } from '@/lib/api/fetcher';
import signedReceipt from '@/test/fixtures/receipt/decision_receipt.json';
import receiptKeys from '@/test/fixtures/receipt/receipt_keys.json';
import vector002 from '@/test/fixtures/receipt/receipt_002_integrity_only.json';
import vector004 from '@/test/fixtures/receipt/receipt_004_body_tampered.json';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return {
    ...actual,
    getRunVerification: vi.fn(),
    getRuntimeCapabilities: vi.fn(),
    getRunReceipt: vi.fn(),
    getReceiptKeys: vi.fn()
  };
});

vi.mock('@/lib/utils/export', () => ({ exportToJson: vi.fn(), exportRawJson: vi.fn() }));

const client = await import('@/lib/api/client');
const exports = await import('@/lib/utils/export');
const exportToJson = vi.mocked(exports.exportToJson);
const exportRawJson = vi.mocked(exports.exportRawJson);
const getRunVerification = vi.mocked(client.getRunVerification);
const getRuntimeCapabilities = vi.mocked(client.getRuntimeCapabilities);
const getRunReceipt = vi.mocked(client.getRunReceipt);
const getReceiptKeys = vi.mocked(client.getReceiptKeys);

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
    exportRawJson.mockReset();
    getRunReceipt.mockReset();
    getReceiptKeys.mockReset();
    // A runtime without decision receipts (before 0.11): the W3.10 console-built path.
    getRuntimeCapabilities.mockReset().mockResolvedValue({ capabilities: {} });
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
      expect(verifyReceipt(receipt, {})).toEqual({ integrity: 'match', attestations: [], verdict: 'integrity_only' });
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

    it('refuses to issue a receipt when the payload has a field outside the RFC-MACP-0013 §5 set', async () => {
      const base = withProjection();
      getRunVerification.mockResolvedValue({
        ...base,
        commitment: { ...base.commitment!, payload: { ...VECTOR_001, extra_field: 'x' } }
      });
      const user = userEvent.setup();
      renderWithProviders(
        <VerificationPanel runId="run-1" demoMode={false} runStatus="completed" modeName="macp.mode.decision.v1" />
      );

      await user.click(await screen.findByRole('button', { name: /download receipt/i }));
      expect(await screen.findByText(/outside the RFC-MACP-0013 field set/)).toBeInTheDocument();
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

  describe('Runtime-signed receipt (W5 U1)', () => {
    const SIGNED_TEXT = JSON.stringify(signedReceipt, null, 2);

    function receiptView(receiptJson: string) {
      return { runId: 'run-1', sessionId: 'sess-1', receiptJson, receipt: JSON.parse(receiptJson) };
    }

    function cpError(status: number, errorCode: string) {
      return new ApiError(
        status,
        '',
        JSON.stringify({ statusCode: status, errorCode, message: `${errorCode} from the CP` }),
        'macp-control-plane',
        '/runs/run-1/receipt'
      );
    }

    function withRuntimeReceipts(signed: boolean) {
      getRuntimeCapabilities.mockResolvedValue({
        capabilities: { decisionReceipt: { getDecisionReceipt: true, signed } }
      });
    }

    function renderPanel() {
      getRunVerification.mockResolvedValue(withProjection());
      return renderWithProviders(
        <VerificationPanel runId="run-1" demoMode={false} runStatus="completed" modeName="macp.mode.decision.v1" />
      );
    }

    it('signed and verified: labels it attested and downloads the runtime bytes unchanged', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockResolvedValue(receiptView(SIGNED_TEXT));
      getReceiptKeys.mockResolvedValue(receiptKeys);
      const user = userEvent.setup();
      renderPanel();

      const status = await screen.findByTestId('receipt-status');
      expect(status).toHaveTextContent('Attested');
      expect(status).toHaveTextContent(/Signed by the runtime/);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('runtime:example')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Download receipt' }));
      expect(exportRawJson).toHaveBeenCalledWith(SIGNED_TEXT, 'receipt-sess-1.json');
      expect(exportToJson).not.toHaveBeenCalled();
      expect(getRunReceipt).toHaveBeenCalledWith('run-1');
      expect(getReceiptKeys).toHaveBeenCalledTimes(1);
    });

    it('refetches the key set once when the signature names an unknown kid', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockResolvedValue(receiptView(SIGNED_TEXT));
      getReceiptKeys.mockResolvedValueOnce({ keys: [] }).mockResolvedValueOnce(receiptKeys);
      renderPanel();

      expect(await screen.findByTestId('receipt-status')).toHaveTextContent('Attested');
      expect(getReceiptKeys).toHaveBeenCalledTimes(2);
    });

    it('fails, prominently, when the kid stays unknown after the one refetch', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockResolvedValue(receiptView(SIGNED_TEXT));
      getReceiptKeys.mockResolvedValue({ keys: [] });
      renderPanel();

      expect(await screen.findByRole('alert')).toHaveTextContent(/does not hold/);
      expect(screen.getByTestId('receipt-status')).toHaveTextContent('Verification Failed');
      expect(getReceiptKeys).toHaveBeenCalledTimes(2);
    });

    it('signed but verification failed: shows the failure and still offers the file for inspection', async () => {
      withRuntimeReceipts(true);
      const tamperedText = JSON.stringify(vector004.receipt);
      getRunReceipt.mockResolvedValue(receiptView(tamperedText));
      getReceiptKeys.mockResolvedValue(receiptKeys);
      const user = userEvent.setup();
      renderPanel();

      expect(await screen.findByRole('alert')).toHaveTextContent(/signature did not verify/);
      expect(screen.getByTestId('receipt-status')).toHaveTextContent('Verification Failed');
      expect(screen.getByTestId('receipt-status')).not.toHaveTextContent('Attested');
      await user.click(screen.getByRole('button', { name: /download receipt for inspection/i }));
      expect(exportRawJson).toHaveBeenCalledWith(tamperedText, 'receipt-sess-1.json');
    });

    it('says why when the key set itself cannot be fetched', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockResolvedValue(receiptView(SIGNED_TEXT));
      getReceiptKeys.mockRejectedValue(cpError(502, 'INTERNAL_ERROR'));
      renderPanel();

      expect(await screen.findByRole('alert')).toHaveTextContent(/key set could not be fetched: INTERNAL_ERROR/);
      expect(getReceiptKeys).toHaveBeenCalledTimes(1);
    });

    it('unsigned runtime (signed=false): labels the runtime receipt integrity-only', async () => {
      withRuntimeReceipts(false);
      const unsignedText = JSON.stringify(vector002.receipt);
      getRunReceipt.mockResolvedValue(receiptView(unsignedText));
      getReceiptKeys.mockResolvedValue({ keys: [] });
      const user = userEvent.setup();
      renderPanel();

      const status = await screen.findByTestId('receipt-status');
      expect(status).toHaveTextContent('Integrity Only');
      expect(status).toHaveTextContent(/unsigned/);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Download receipt' }));
      expect(exportRawJson).toHaveBeenCalledWith(unsignedText, 'receipt-sess-1.json');
    });

    it.each([
      ['409 RECEIPT_UNAVAILABLE', 409, 'RECEIPT_UNAVAILABLE'],
      ['404 NOT_FOUND (no session yet)', 404, 'NOT_FOUND'],
      ['404 RUN_NOT_FOUND', 404, 'RUN_NOT_FOUND']
    ])('unavailable (%s): a calm note, no error, and the console-built fallback', async (_name, status, code) => {
      withRuntimeReceipts(true);
      getRunReceipt.mockRejectedValue(cpError(status, code));
      const user = userEvent.setup();
      renderPanel();

      expect(await screen.findByTestId('receipt-unavailable')).toHaveTextContent('no receipt for this run');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByTestId('receipt-fetch-error')).not.toBeInTheDocument();
      expect(getReceiptKeys).not.toHaveBeenCalled();
      expect(screen.getByText(/unsigned \(integrity-only\)/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /download receipt/i }));
      await waitFor(() => expect(exportToJson).toHaveBeenCalledTimes(1));
    });

    it('unsupported (501): says so and falls back to the console-built receipt', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockRejectedValue(cpError(501, 'DECISION_RECEIPT_UNSUPPORTED'));
      renderPanel();

      expect(await screen.findByTestId('receipt-unsupported')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download receipt/i })).toBeEnabled();
      expect(screen.queryByTestId('receipt-status')).not.toBeInTheDocument();
    });

    it('a 502 from the receipt route is reported and the console-built receipt stays available', async () => {
      withRuntimeReceipts(true);
      getRunReceipt.mockRejectedValue(cpError(502, 'INTERNAL_ERROR'));
      renderPanel();

      expect(await screen.findByTestId('receipt-fetch-error')).toHaveTextContent(/INTERNAL_ERROR from the CP/);
      expect(screen.getByRole('button', { name: /download receipt/i })).toBeEnabled();
    });

    it("without the capability it never calls the receipt routes (today's client-side behaviour)", async () => {
      renderPanel();

      expect(await screen.findByRole('button', { name: /download receipt/i })).toBeEnabled();
      expect(getRunReceipt).not.toHaveBeenCalled();
      expect(getReceiptKeys).not.toHaveBeenCalled();
      expect(screen.queryByTestId('receipt-status')).not.toBeInTheDocument();
    });

    it('never calls the receipt routes in demo mode, even if the capability were advertised', async () => {
      withRuntimeReceipts(true);
      getRunVerification.mockResolvedValue(withProjection());
      renderWithProviders(
        <VerificationPanel runId="run-1" demoMode runStatus="completed" modeName="macp.mode.decision.v1" />
      );

      expect(await screen.findByRole('button', { name: /download receipt/i })).toBeEnabled();
      expect(getRunReceipt).not.toHaveBeenCalled();
    });
  });
});
