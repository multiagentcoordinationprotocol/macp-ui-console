import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '@/test/test-utils';
import { PolicyManagement } from './policy-management';
import { ApiError } from '@/lib/api/fetcher';
import * as client from '@/lib/api/client';

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listRuntimePolicies: vi.fn(),
    registerRuntimePolicy: vi.fn(),
    unregisterRuntimePolicy: vi.fn()
  };
});

describe('PolicyManagement read-only registry handling', () => {
  beforeEach(() => {
    vi.mocked(client.listRuntimePolicies).mockResolvedValue([]);
  });

  it('shows the file-managed banner and disables controls when registration hits a read-only (405) registry', async () => {
    // CP surfaces a file-managed (MACP_POLICIES_DIR) registry as HTTP 405 REGISTRY_READ_ONLY.
    vi.mocked(client.registerRuntimePolicy).mockRejectedValue(
      new ApiError(
        405,
        'Method Not Allowed',
        JSON.stringify({ errorCode: 'REGISTRY_READ_ONLY', message: 'registry is read-only' }),
        'macp-control-plane',
        '/runtime/policies'
      )
    );

    const user = userEvent.setup();
    renderWithProviders(<PolicyManagement demoMode={false} />);

    // Open the register form and fill the required fields.
    await user.click(screen.getByRole('button', { name: /register policy/i }));
    await user.type(screen.getByPlaceholderText('policy.my-custom'), 'policy.custom');
    await user.type(screen.getByPlaceholderText('Describe the policy...'), 'A test policy');

    // Submit — the submit button is the last "Register policy"-named button.
    const submitButtons = screen.getAllByRole('button', { name: /^register policy$/i });
    await user.click(submitButtons[submitButtons.length - 1]);

    // The banner appears and the top toggle is disabled.
    await waitFor(() => expect(screen.getByText(/file-managed \(read-only\)/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /register policy/i })).toBeDisabled();
  });
});

describe('PolicyManagement schema version', () => {
  it('still displays a policy registered under a version this console cannot submit', async () => {
    // The request type is narrowed to 1|2|3; the *response* type must stay `number`, or a control
    // plane that later accepts 4 would make existing policies unrenderable. Nothing else pins this.
    vi.mocked(client.listRuntimePolicies).mockResolvedValue([
      {
        policyId: 'policy.from-the-future',
        mode: 'macp.mode.decision.v1',
        description: 'Registered by a newer control plane',
        rules: {},
        schemaVersion: 7
      }
    ]);
    renderWithProviders(<PolicyManagement demoMode={false} />);

    expect(await screen.findByText('policy.from-the-future')).toBeInTheDocument();
    // Rendered inside the meta line, so matched as a substring rather than a whole text node.
    expect(screen.getByText(/·\s*v7\b/)).toBeInTheDocument();
  });

  beforeEach(() => {
    vi.mocked(client.listRuntimePolicies).mockResolvedValue([]);
    vi.mocked(client.registerRuntimePolicy).mockReset();
  });

  /** Opens the register form and fills the two required text fields. */
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<PolicyManagement demoMode={false} />);
    await user.click(screen.getByRole('button', { name: /register policy/i }));
    await user.type(screen.getByPlaceholderText('policy.my-custom'), 'policy.custom');
    await user.type(screen.getByPlaceholderText('Describe the policy...'), 'A test policy');
  }

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    const buttons = screen.getAllByRole('button', { name: /^register policy$/i });
    await user.click(buttons[buttons.length - 1]);
  }

  it('offers exactly the three versions the control plane accepts, and defaults to 3', async () => {
    const user = userEvent.setup();
    await openForm(user);

    // Queried by accessible name, not by index: the form holds two <select> elements (target mode
    // and this one), and FieldLabel emits no htmlFor, so aria-label is the only stable handle.
    const select = screen.getByRole('combobox', { name: /schema version/i });
    expect(select).toHaveValue('3');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual(['1', '2', '3']);
  });

  it('submits schemaVersion as a number, not the select’s string value', async () => {
    // The CP reads this with `POLICY_SCHEMA_VERSIONS.includes(...)`, which is identity-based — '3'
    // would fail the check even though it looks right in the payload.
    vi.mocked(client.registerRuntimePolicy).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    await openForm(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /schema version/i }), '2');
    await submit(user);

    await waitFor(() => expect(client.registerRuntimePolicy).toHaveBeenCalled());
    const [request] = vi.mocked(client.registerRuntimePolicy).mock.calls[0];
    expect(request.schemaVersion).toBe(2);
    expect(typeof request.schemaVersion).toBe('number');
  });

  it('renders a rejection as the control plane’s sentence, with no JSON left in it', async () => {
    // The real 400 envelope: a Nest BadRequestException, so `errorCode` is absent and `message` is
    // the only usable prose. Asserted on the inline .error-text div — `renderWithProviders` has no
    // ToastProvider, so toast text never reaches the DOM.
    vi.mocked(client.registerRuntimePolicy).mockRejectedValue(
      new ApiError(
        400,
        'Bad Request',
        JSON.stringify({ statusCode: 400, message: 'schemaVersion must be one of 1, 2, 3', error: 'Bad Request' }),
        'macp-control-plane',
        '/runtime/policies'
      )
    );
    const user = userEvent.setup();
    await openForm(user);
    await submit(user);

    const error = await screen.findByText(/schemaVersion must be one of 1, 2, 3/);
    expect(error).toHaveTextContent('Registration failed. schemaVersion must be one of 1, 2, 3');
    // The falsifiable form of "readable, not a blob": no JSON punctuation, and no echoed status name.
    expect(error.textContent).not.toMatch(/[{}"]/);
    expect(error.textContent).not.toMatch(/Bad Request/);
  });

  it('starts a second registration at the default rather than inheriting the last choice', async () => {
    // Asserted through the real operator path — register, then reopen the form — rather than by
    // reading state after submit. A successful registration closes the form, and the parent renders
    // it conditionally, so the component unmounts; reopening is the only way the next registration
    // is ever reached, and it is the reset that actually has to hold.
    vi.mocked(client.registerRuntimePolicy).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    await openForm(user);
    await user.selectOptions(screen.getByRole('combobox', { name: /schema version/i }), '1');
    await submit(user);

    // The form closes on success.
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /schema version/i })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /register policy/i }));
    expect(screen.getByRole('combobox', { name: /schema version/i })).toHaveValue('3');
  });
});
