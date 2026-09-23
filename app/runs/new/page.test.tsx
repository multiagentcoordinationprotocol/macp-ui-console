import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import NewRunPage from './page';
import type { RunExampleResult } from '@/lib/types';

/**
 * The repo's first test under `app/`. It exists because two of Phase 7's acceptance criteria are
 * page-level: that a run the control plane never registered does NOT redirect, and that the operator
 * is told why. Neither is observable from a component test, because the page owns the mutation.
 */

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('pack=fraud&scenario=high-value-new-device&version=1.0.0&template=default')
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, runExample: vi.fn() };
});

const client = await import('@/lib/api/client');
const mockedRunExample = vi.mocked(client.runExample);

/** A bootstrap result shaped like the playground's, with registration succeeding by default. */
async function bootstrap(overrides: Partial<RunExampleResult> = {}): Promise<RunExampleResult> {
  const compiled = await client.compileLaunch(
    {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'default',
      mode: 'live',
      inputs: {}
    },
    true
  );
  return {
    compiled,
    hostedAgents: [{ participantId: 'fraud-agent', status: 'bootstrapped' }],
    sessionId: 'session-abc',
    controlPlaneRun: { runId: 'run-abc', status: 'running' },
    ...overrides
  };
}

/** Clicks the primary Submit run button once the launch catalog has loaded. */
async function submit(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: /^submit run$/i }, { timeout: 5000 });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe('NewRunPage control-plane registration', () => {
  beforeEach(() => {
    push.mockReset();
    mockedRunExample.mockReset();
  });

  it("redirects by the control plane's run id, NOT the session id", async () => {
    // These are different values. When the Example Service registers a run via `POST /runs`, the
    // control plane mints a fresh run id and stores the session id separately; `/runs/live/:id`
    // resolves by run id, so navigating with the session id 404s on the very path that succeeded.
    // The fixture deliberately gives them different values so the two cannot be confused.
    mockedRunExample.mockResolvedValue(await bootstrap());
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/runs/live/run-abc'));
    expect(push).not.toHaveBeenCalledWith('/runs/live/session-abc');
  });

  it('does NOT redirect when the run was never registered, and says so', async () => {
    // The headline case. Redirecting would load the live run view against a control plane that has
    // no such run, presenting a confusing load failure instead of the real situation.
    mockedRunExample.mockResolvedValue(await bootstrap({ controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    await waitFor(() => expect(screen.getByText('Not Registered With The Control Plane')).toBeInTheDocument());
    expect(screen.getByText(/agents are live, but the example service did not register/i)).toBeInTheDocument();
    // The falsifiable half: no navigation at all, not merely a different destination.
    expect(push).not.toHaveBeenCalled();
  });

  it('does not blame a cause it cannot know', async () => {
    // Every failure class upstream — unset URL, network error, timeout, non-2xx, bad body — omits the
    // field identically, so the copy must not attribute the absence to any one of them.
    mockedRunExample.mockResolvedValue(await bootstrap({ controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    const banner = await screen.findByText(/agents are live, but the example service did not register/i);
    const text = banner.parentElement?.textContent ?? '';
    // It may list the possibilities, but it must say it cannot distinguish them, and must never
    // state one as fact.
    expect(text).toMatch(/does not report why/i);
    expect(text).toMatch(/best-effort/i);
    expect(text).not.toMatch(/\bthe control plane (is|was) (down|offline|unreachable|misconfigured)\b/i);
    // It may explain the redirect decision; it must not explain the *failure*.
    expect(text).not.toMatch(/did not (land|register)[^.]*\bbecause\b/i);
  });

  it('does not accuse the control plane of losing a run it may yet discover', async () => {
    // Session discovery is on by default upstream, and registers observed runtime sessions as runs
    // keyed by session id. So "the Example Service did not register it" must not be reported as
    // "this run will never appear" — that claim is false in the default configuration.
    mockedRunExample.mockResolvedValue(await bootstrap({ controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    const banner = await screen.findByText(/agents are live, but the example service did not register/i);
    const text = banner.parentElement?.textContent ?? '';
    expect(text).toMatch(/session discovery/i);
    expect(text).not.toMatch(/will not appear|nothing to load/i);
    // It must not assert discovery state it never checked, in either direction.
    expect(text).toMatch(/not something this page can tell/i);
    // And it must not promise a benign empty view: the live route renders an ErrorPanel until the
    // control plane knows the session. Promising emptiness recreates the confusing load failure the
    // no-redirect branch exists to avoid, just one click later.
    expect(text).not.toMatch(/shows nothing|shows an empty|is empty/i);
    expect(text).toMatch(/reports an error, not an empty page/i);
    // The session route is offered as a link rather than a redirect, since discovery is not instant.
    expect(screen.getByRole('link', { name: /open the live view/i })).toHaveAttribute('href', '/runs/live/session-abc');
  });

  it('shows no warning and a run badge on the success path', async () => {
    // The negative half of the headline case: the warning surfaces must be absent when registration
    // succeeded, or the branch is decorative.
    mockedRunExample.mockResolvedValue(await bootstrap());
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(screen.queryByText('Not Registered With The Control Plane')).not.toBeInTheDocument();
    expect(screen.queryByText(/did not register this run/i)).not.toBeInTheDocument();
    // The run id shown must be the control plane's, not the session's.
    expect(screen.getByText('run-abc')).toBeInTheDocument();
    expect(screen.getByText('Registered With The Control Plane')).toBeInTheDocument();
  });

  it('surfaces a failed bootstrap instead of silently stopping the spinner', async () => {
    mockedRunExample.mockRejectedValue(new Error('playground unreachable'));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    await waitFor(() => expect(screen.getByText(/bootstrap failed/i)).toBeInTheDocument());
    expect(screen.getByText(/playground unreachable/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('treats a run with no bootstrap at all as neither success nor drift', async () => {
    // `bootstrapAgents: false` short-circuits upstream, returning no sessionId and no controlPlaneRun.
    // That is "nothing was bootstrapped", not "bootstrap went unregistered" — it must not accuse the
    // control plane of losing a run that was never submitted.
    mockedRunExample.mockResolvedValue(await bootstrap({ sessionId: undefined, controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);

    await waitFor(() => expect(mockedRunExample).toHaveBeenCalled());
    expect(screen.queryByText('Not Registered With The Control Plane')).not.toBeInTheDocument();
    // The badge and the banner are two separate JSX blocks with two separate gates. Asserting only
    // the badge left the banner's gate unpinned — relaxing it to `bootstrapResult && !controlPlaneRun`
    // kept all nine tests green while the accusation this test exists to forbid rendered anyway.
    expect(screen.queryByText(/did not register this run/i)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('uses one mutation for every trigger, so the quick-run button behaves identically', async () => {
    // The two mutations were byte-identical duplicates; changing only one would have left this
    // button on the old always-redirect behaviour.
    mockedRunExample.mockResolvedValue(await bootstrap({ controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);

    const quick = await screen.findByRole('button', { name: /quick example service run/i }, { timeout: 5000 });
    await waitFor(() => expect(quick).toBeEnabled());
    await user.click(quick);

    await waitFor(() => expect(screen.getByText('Not Registered With The Control Plane')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it('clears the previous attempt, so a failure cannot render beside a stale success', async () => {
    // Two `role="status"` regions making contradictory claims about one button press is worse than
    // either claim alone.
    mockedRunExample.mockResolvedValueOnce(await bootstrap({ controlPlaneRun: undefined }));
    const user = userEvent.setup();
    renderWithProviders(<NewRunPage />);
    await submit(user);
    await waitFor(() => expect(screen.getByText('Not Registered With The Control Plane')).toBeInTheDocument());

    mockedRunExample.mockRejectedValue(new Error('playground unreachable'));
    await submit(user);

    await waitFor(() => expect(screen.getByText(/bootstrap failed/i)).toBeInTheDocument());
    expect(screen.queryByText('Not Registered With The Control Plane')).not.toBeInTheDocument();
  });
});
