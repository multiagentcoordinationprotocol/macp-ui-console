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
