import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/test-utils';
import ShowcasePage from './page';
import { ApiError } from '@/lib/api/fetcher';
import { SHOWCASE_SCENARIO_REF, SHOWCASE_TEMPLATE_ID } from '@/lib/showcase';
import type { RunExampleResult, RunRecord } from '@/lib/types';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn(), refresh: vi.fn() })
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, runExample: vi.fn(), getRun: vi.fn() };
});

const client = await import('@/lib/api/client');
const mockedRunExample = vi.mocked(client.runExample);
const mockedGetRun = vi.mocked(client.getRun);

function result(overrides: Partial<RunExampleResult> = {}): RunExampleResult {
  return {
    compiled: {} as RunExampleResult['compiled'],
    hostedAgents: [],
    sessionId: 'session-abc',
    ...overrides
  };
}

const notFound = () => new ApiError(404, 'Not Found', '', 'macp-control-plane', '/runs/session-abc');

describe('ShowcasePage', () => {
  beforeEach(() => {
    replace.mockReset();
    mockedRunExample.mockReset();
    mockedGetRun.mockReset();
  });

  it('launches the deterministic showcase template exactly once', async () => {
    mockedRunExample.mockResolvedValue(result());
    mockedGetRun.mockResolvedValue({} as RunRecord);
    renderWithProviders(<ShowcasePage />);

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(mockedRunExample).toHaveBeenCalledTimes(1);
    expect(mockedRunExample.mock.calls[0][0]).toEqual({
      scenarioRef: SHOWCASE_SCENARIO_REF,
      templateId: SHOWCASE_TEMPLATE_ID,
      mode: 'live',
      inputs: {},
      bootstrapAgents: true
    });
  });

  it('lands on the live run by session id when the control plane discovers the session', async () => {
    // Hosted playgrounds without a control-plane URL never register the run; the control plane
    // auto-discovers it from the runtime and keys it by session id, a moment after launch.
    mockedRunExample.mockResolvedValue(result());
    mockedGetRun.mockRejectedValueOnce(notFound()).mockResolvedValue({} as RunRecord);
    renderWithProviders(<ShowcasePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/runs/live/session-abc'), { timeout: 4000 });
    expect(mockedGetRun).toHaveBeenCalledTimes(2);
  });

  it("prefers the control plane's own run id when the playground registered the run", async () => {
    mockedRunExample.mockResolvedValue(result({ controlPlaneRun: { runId: 'run-xyz', status: 'running' } }));
    mockedGetRun.mockResolvedValue({} as RunRecord);
    renderWithProviders(<ShowcasePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/runs/live/run-xyz'));
    expect(replace).not.toHaveBeenCalledWith('/runs/live/session-abc');
  });

  it('shows the failure and offers a retry instead of navigating when the launch is refused', async () => {
    mockedRunExample.mockRejectedValue(
      new ApiError(429, 'Too Many Requests', '{"message":"Launch quota exceeded"}', 'macp-playground', '/examples/run')
    );
    renderWithProviders(<ShowcasePage />);

    expect(await screen.findByText(/could not start/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not keep polling past a real control-plane error', async () => {
    mockedRunExample.mockResolvedValue(result());
    mockedGetRun.mockRejectedValue(new ApiError(500, 'Internal Server Error', '', 'macp-control-plane', '/runs/x'));
    renderWithProviders(<ShowcasePage />);

    expect(await screen.findByText(/could not start/i)).toBeInTheDocument();
    expect(mockedGetRun).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
