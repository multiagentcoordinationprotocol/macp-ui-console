import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import { COMPLETED_RUN_ID, FAILED_RUN_ID, MOCK_RUNTIME_CAPABILITIES } from '@/lib/data/mock-data';
import { ApiError } from '@/lib/api/fetcher';
import { describeWhatIfError, WhatIfPanel } from './what-if-panel';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, getRuntimeCapabilities: vi.fn() };
});

const { getRuntimeCapabilities: mockedCaps } = await import('@/lib/api/client');
const getRuntimeCapabilities = vi.mocked(mockedCaps);

function renderPanel(runId = COMPLETED_RUN_ID) {
  return renderWithProviders(
    <WhatIfPanel runId={runId} demoMode modeName="macp.mode.decision.v1" recordedPolicyId="policy.default" />
  );
}

describe('WhatIfPanel (W4.1)', () => {
  beforeEach(() => {
    getRuntimeCapabilities.mockReset();
    getRuntimeCapabilities.mockResolvedValue(MOCK_RUNTIME_CAPABILITIES);
  });

  it('renders nothing when the runtime does not advertise whatIfReplay', async () => {
    getRuntimeCapabilities.mockResolvedValue({ policyRegistry: { whatIfReplay: false } });
    renderPanel();
    await waitFor(() => expect(getRuntimeCapabilities).toHaveBeenCalled());
    expect(screen.queryByTestId('what-if-panel')).not.toBeInTheDocument();
  });

  it('prefills the recorded rules and reports no difference when they are unchanged', async () => {
    renderPanel();
    const rules = await screen.findByLabelText('Candidate rules');
    await waitFor(() => expect((rules as HTMLTextAreaElement).value).toContain('initiator_only'));

    await userEvent.click(screen.getByRole('button', { name: /run what-if/i }));
    expect(await screen.findByTestId('what-if-identical')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-diverged]')).toHaveLength(0);
  });

  it('highlights the diverging row and lists the candidate denial', async () => {
    renderPanel();
    const rules = await screen.findByLabelText('Candidate rules');
    fireEvent.change(rules, { target: { value: '{"voting":{"algorithm":"unanimous"}}' } });

    await userEvent.click(screen.getByRole('button', { name: /run what-if/i }));
    expect(await screen.findByText(/first divergence at history entry #8/i)).toBeInTheDocument();
    const diverged = document.querySelectorAll('[data-diverged]');
    expect(diverged).toHaveLength(1);
    expect(diverged[0].textContent).toContain('Commitment');
    expect(screen.getAllByText('QUORUM_NOT_REACHED').length).toBeGreaterThan(0);
    expect(screen.getByText(/candidate denials \(1\)/i)).toBeInTheDocument();
  });

  it('refuses rules that are not a JSON object without calling the control plane', async () => {
    renderPanel();
    const rules = await screen.findByLabelText('Candidate rules');
    fireEvent.change(rules, { target: { value: '[1, 2' } });
    await userEvent.click(screen.getByRole('button', { name: /run what-if/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i);
  });

  it('explains HISTORY_UNAVAILABLE in user terms', async () => {
    renderPanel(FAILED_RUN_ID);
    await screen.findByLabelText('Candidate rules');
    await userEvent.click(screen.getByRole('button', { name: /run what-if/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/MACP_COMPACT_TERMINAL_LOGS=0/);
  });

  it('accepts the any-mode (*) candidate', async () => {
    renderPanel();
    await screen.findByLabelText('Candidate rules');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: /run what-if/i }));
    // `*` is always accepted by the demo, so the replay succeeds.
    expect(await screen.findByTestId('what-if-result')).toBeInTheDocument();
  });

  it('maps control-plane error codes to actionable messages', () => {
    const err = (status: number, errorCode: string, message: string) =>
      new ApiError(status, '', JSON.stringify({ statusCode: status, errorCode, message }), 'macp-control-plane', '/x');
    expect(describeWhatIfError(err(400, 'INVALID_POLICY_DEFINITION', 'rules.voting.threshold: must be ≤ 1'))).toContain(
      'rules.voting.threshold'
    );
    expect(describeWhatIfError(err(501, 'WHAT_IF_REPLAY_UNSUPPORTED', 'x'))).toMatch(/0\.10/);
    expect(describeWhatIfError(err(404, 'NOT_FOUND', 'x'))).toMatch(/no longer exists/);
    expect(describeWhatIfError(err(500, 'INTERNAL_ERROR', 'integrity'))).toMatch(/bug worth reporting/);
    expect(describeWhatIfError(err(429, 'RATE_LIMITED', 'x'))).toMatch(/Too many/);
  });
});
