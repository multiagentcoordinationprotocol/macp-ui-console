import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { VerificationPanel } from './verification-panel';
import type { RunVerification } from '@/lib/types';
import { ApiError } from '@/lib/api/fetcher';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, getRunVerification: vi.fn() };
});

const { getRunVerification: mockedGet } = await import('@/lib/api/client');
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

describe('VerificationPanel', () => {
  beforeEach(() => {
    getRunVerification.mockReset();
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
});
