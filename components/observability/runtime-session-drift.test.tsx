import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import { RuntimeSessionDrift } from './runtime-session-drift';
import type { RuntimeSessionDriftResponse } from '@/lib/api/client';
import { ApiError } from '@/lib/api/fetcher';

vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, getRuntimeSessionDrift: vi.fn() };
});

const { getRuntimeSessionDrift } = await import('@/lib/api/client');
const mockedDrift = vi.mocked(getRuntimeSessionDrift);

/**
 * Counts are held to the invariant the control plane's own logic implies:
 * `liveRuntimeSessionCount - untracked + missing <= trackedRunCount`. A fixture that violates it
 * depicts a response no CP could produce.
 */
function drift(overrides: Partial<RuntimeSessionDriftResponse> = {}): RuntimeSessionDriftResponse {
  return {
    complete: true,
    runtimeSessionCount: 7,
    liveRuntimeSessionCount: 5,
    trackedRunCount: 5,
    untrackedSessions: [
      {
        sessionId: 'session-orphan-7c1f',
        mode: 'macp.mode.decision.v1',
        state: 'SESSION_STATE_OPEN',
        startedAtUnixMs: 1_774_000_000_000,
        modeVersion: '1.0.0',
        initiator: 'fraud-agent'
      }
    ],
    missingFromRuntime: [{ runId: 'run-stale-1', runtimeSessionId: 'session-stale-42b9' }],
    ...overrides
  };
}

const CHECK = /check for drift/i;
const MISSING_HEADING = /runs whose session the runtime no longer holds/i;
const NOT_COMPUTED = /not computed/i;

describe('RuntimeSessionDrift', () => {
  beforeEach(() => {
    mockedDrift.mockReset();
  });

  it('renders idle and issues NO request on mount — the endpoint drains the live runtime', async () => {
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);

    expect(mockedDrift).not.toHaveBeenCalled();
    expect(screen.getByText(/no drift check run yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CHECK })).toBeEnabled();
  });

  it('issues exactly one request when the operator clicks', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);

    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(mockedDrift).toHaveBeenCalledTimes(1));
    expect(mockedDrift).toHaveBeenCalledWith(false);
  });

  it('renders the three counts and both tables on a complete diff', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText('session-orphan-7c1f')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/5 live/)).toBeInTheDocument();
    expect(screen.getByText('run-stale-1')).toBeInTheDocument();
    expect(screen.getByText('session-stale-42b9')).toBeInTheDocument();
    expect(screen.getByText('Full Session List')).toBeInTheDocument();
  });

  it('on a truncated drain: warns, keeps untracked sessions, and renders NO missing-runs table', async () => {
    // The single most important behaviour here. `null` means "not computed"; a truncated session
    // list cannot prove a run's session is gone. Rendering "0 missing" would assert an absence
    // the data does not support.
    mockedDrift.mockResolvedValue(drift({ complete: false, missingFromRuntime: null }));
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText('Partial Session List')).toBeInTheDocument());
    expect(screen.getByText(NOT_COMPUTED)).toBeInTheDocument();
    // untrackedSessions stays sound under truncation, so it must still render.
    expect(screen.getByText('session-orphan-7c1f')).toBeInTheDocument();
    // The falsifiable form of "don't render it as zero".
    expect(screen.queryByText(/every active run is bound/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /bound session/i })).not.toBeInTheDocument();
  });

  it('distinguishes an empty missingFromRuntime from null — [] is a real answer', async () => {
    mockedDrift.mockResolvedValue(
      drift({ liveRuntimeSessionCount: 4, trackedRunCount: 4, untrackedSessions: [], missingFromRuntime: [] })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/every active run is bound/i)).toBeInTheDocument());
    expect(screen.getByText(/every live runtime session maps to a run/i)).toBeInTheDocument();
    expect(screen.queryByText(NOT_COMPUTED)).not.toBeInTheDocument();
    expect(screen.getByText('Full Session List')).toBeInTheDocument();
  });

  it('renders a placeholder for empty-string session fields rather than a blank cell', async () => {
    // proto3 string defaults arrive as '' rather than absent, so `??` would leave cells blank.
    mockedDrift.mockResolvedValue(
      drift({
        untrackedSessions: [
          { sessionId: 'session-bare-01', mode: 'macp.mode.decision.v1', state: 'SESSION_STATE_OPEN' },
          {
            sessionId: 'session-empty-02',
            mode: 'macp.mode.decision.v1',
            state: 'SESSION_STATE_SUSPENDED',
            modeVersion: '',
            initiator: ''
          }
        ]
      })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText('session-bare-01')).toBeInTheDocument());
    // Two rows x (absent startedAt + absent/empty initiator) = 4 placeholders.
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('caps rendered rows and says so', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      sessionId: `session-${i}`,
      mode: 'macp.mode.decision.v1',
      state: 'SESSION_STATE_OPEN'
    }));
    mockedDrift.mockResolvedValue(
      drift({ runtimeSessionCount: 400, liveRuntimeSessionCount: 300, trackedRunCount: 300, untrackedSessions: many })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/showing 50 of 120/i)).toBeInTheDocument());
    expect(screen.getByText('session-49')).toBeInTheDocument();
    expect(screen.queryByText('session-50')).not.toBeInTheDocument();
  });

  it('caps the MISSING-RUNS table too, and discloses both the cap and the true total', async () => {
    // A runtime restart drops every session at once, and `listActiveRuns()` is unbounded upstream, so
    // this list really can run to hundreds. Capping it silently would make the drift panel
    // under-report drift by 6x — the exact failure it exists to catch.
    const many = Array.from({ length: 300 }, (_, i) => ({
      runId: `run-${i}`,
      runtimeSessionId: `session-${i}`
    }));
    mockedDrift.mockResolvedValue(
      drift({
        runtimeSessionCount: 300,
        liveRuntimeSessionCount: 300,
        trackedRunCount: 320,
        untrackedSessions: [],
        missingFromRuntime: many
      })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText('run-0')).toBeInTheDocument());
    expect(screen.getByText('run-49')).toBeInTheDocument();
    expect(screen.queryByText('run-50')).not.toBeInTheDocument();
    // The count must appear on screen somewhere, and the cap must be disclosed.
    expect(screen.getByText(/300 runs are bound to a session the runtime is no longer holding/i)).toBeInTheDocument();
    expect(screen.getByText(/showing 50 of 300/i)).toBeInTheDocument();
  });

  it('shows a breaker-specific message on CIRCUIT_BREAKER_OPEN, and NOT the idle state', async () => {
    // The isError-before-idle ordering guard: a failed check must never revert to "click to
    // check", or the operator never learns it failed.
    mockedDrift.mockRejectedValue(
      new ApiError(
        503,
        'Service Unavailable',
        JSON.stringify({ statusCode: 503, errorCode: 'CIRCUIT_BREAKER_OPEN', message: 'breaker open' }),
        'macp-control-plane',
        '/admin/runtime/sessions'
      )
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/tripped its circuit breaker/i)).toBeInTheDocument());
    expect(screen.queryByText(/no drift check run yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/drift check failed/i)).toBeInTheDocument();
  });

  it('distinguishes RUNTIME_UNAVAILABLE from CIRCUIT_BREAKER_OPEN — same status, different cause', async () => {
    mockedDrift.mockRejectedValue(
      new ApiError(
        503,
        'Service Unavailable',
        JSON.stringify({ statusCode: 503, errorCode: 'RUNTIME_UNAVAILABLE', message: 'unreachable' }),
        'macp-control-plane',
        '/admin/runtime/sessions'
      )
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/could not reach the runtime/i)).toBeInTheDocument());
    expect(screen.queryByText(/tripped its circuit breaker/i)).not.toBeInTheDocument();
  });

  it('never shows a raw errorCode — a throttled 429 is stamped INTERNAL_ERROR by the control plane', async () => {
    // Rendering the code would tell an operator the control plane crashed when it rate-limited
    // them. Status is the trustworthy signal for this one.
    mockedDrift.mockRejectedValue(
      new ApiError(
        429,
        'Too Many Requests',
        JSON.stringify({
          statusCode: 429,
          errorCode: 'INTERNAL_ERROR',
          message: 'ThrottlerException: Too Many Requests'
        }),
        'macp-control-plane',
        '/admin/runtime/sessions'
      )
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/rate limited/i)).toBeInTheDocument());
    expect(screen.queryByText(/INTERNAL_ERROR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ThrottlerException/)).not.toBeInTheDocument();
  });

  it('points at the credential on a 401, which carries no errorCode at all', async () => {
    mockedDrift.mockRejectedValue(
      new ApiError(
        401,
        'Unauthorized',
        JSON.stringify({ statusCode: 401, message: 'Missing Authorization header', error: 'Unauthorized' }),
        'macp-control-plane',
        '/admin/runtime/sessions'
      )
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/control-plane credential/i)).toBeInTheDocument());
  });

  it('does not retry a failed check — a retry re-drains an already-unhealthy runtime', async () => {
    // D14. This MUST NOT use `renderWithProviders`: that client sets `retry: false` globally
    // (test/test-utils.tsx:9), so the assertion would hold even if the component dropped its own
    // `retry: false` — the test would pass against the bug it exists to catch. Render instead under a
    // client mirroring the real app defaults (components/providers.tsx:27-29, `retry: 1`), so the
    // component's own option is the only thing keeping the call count at 1.
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: Infinity } } });
    mockedDrift.mockRejectedValue(
      new ApiError(
        503,
        'Service Unavailable',
        JSON.stringify({ errorCode: 'RUNTIME_UNAVAILABLE' }),
        'macp-control-plane',
        '/x'
      )
    );
    render(
      <QueryClientProvider client={client}>
        <RuntimeSessionDrift demoMode={false} />
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/drift check failed/i)).toBeInTheDocument());
    expect(mockedDrift).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a check is in flight, so drains cannot stack', async () => {
    let resolve: ((value: RuntimeSessionDriftResponse) => void) | undefined;
    mockedDrift.mockImplementation(
      () =>
        new Promise<RuntimeSessionDriftResponse>((r) => {
          resolve = r;
        })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled());
    expect(screen.getByText(/draining the runtime/i)).toBeInTheDocument();

    resolve?.(drift());
    await waitFor(() => expect(screen.getByRole('button', { name: CHECK })).toBeEnabled());
    expect(mockedDrift).toHaveBeenCalledTimes(1);
  });

  it('explains why the counts do not reconcile by subtraction', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(/not meant to reconcile/i)).toBeInTheDocument());
    expect(screen.getByText(/retention window/i)).toBeInTheDocument();
    expect(screen.getByText(/still starting/i)).toBeInTheDocument();
  });

  it('passes demoMode through, so the demo surface works with no backend', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(mockedDrift).toHaveBeenCalledWith(true));
  });

  it('renders the missing-runs heading in every non-truncated state', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText(MISSING_HEADING)).toBeInTheDocument());
  });

  it('does NOT claim a cap when nothing was capped — a list at the limit is shown whole', async () => {
    // Guards the cap note's own boundary. A `total < shown` slip would render "Showing 50 of 50",
    // which reads as truncation where none happened — the mirror image of the under-reporting bug
    // this note exists to prevent.
    const exactly = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => ({
        sessionId: `${prefix}-${i}`,
        mode: 'macp.mode.decision.v1',
        state: 'SESSION_STATE_OPEN'
      }));
    mockedDrift.mockResolvedValue(
      drift({
        runtimeSessionCount: 50,
        liveRuntimeSessionCount: 50,
        trackedRunCount: 50,
        untrackedSessions: exactly(50, 's'),
        missingFromRuntime: Array.from({ length: 50 }, (_, i) => ({
          runId: `r-${i}`,
          runtimeSessionId: `rs-${i}`
        }))
      })
    );
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() => expect(screen.getByText('s-49')).toBeInTheDocument());
    expect(screen.getByText('r-49')).toBeInTheDocument();
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it('uses the singular when exactly one run is missing', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    await waitFor(() =>
      expect(screen.getByText(/1 run is bound to a session the runtime is no longer holding/i)).toBeInTheDocument()
    );
  });

  it('stamps a successful check with the time it was taken, in an assertive region on failure', async () => {
    mockedDrift.mockResolvedValue(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    // The card is unmounted on tab switch while the page observer keeps the cache entry alive, so a
    // returning operator sees these numbers again; without the stamp they read as live.
    await waitFor(() => expect(screen.getByText(/^checked /i)).toBeInTheDocument());
  });

  it('drops the stale badge and timestamp when a later check fails', async () => {
    // React Query keeps `data` across an error, so a success followed by a failure would otherwise
    // show "Full session list · checked 12:01" beside "Drift check failed" — the card asserting both
    // that it has good data and that it does not.
    mockedDrift.mockResolvedValueOnce(drift());
    renderWithProviders(<RuntimeSessionDrift demoMode={false} />);
    await userEvent.click(screen.getByRole('button', { name: CHECK }));
    await waitFor(() => expect(screen.getByText('Full Session List')).toBeInTheDocument());

    mockedDrift.mockRejectedValue(
      new ApiError(
        503,
        'Service Unavailable',
        JSON.stringify({ errorCode: 'RUNTIME_UNAVAILABLE', message: 'runtime unreachable' }),
        'macp-control-plane',
        '/admin/runtime/sessions'
      )
    );
    await userEvent.click(screen.getByRole('button', { name: CHECK }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/drift check failed/i);
    expect(screen.queryByText('Full Session List')).not.toBeInTheDocument();
    expect(screen.queryByText(/^checked /i)).not.toBeInTheDocument();
  });
});
