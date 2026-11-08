import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import SettingsPage from './page';

// The hosted proxy refuses /webhooks and /audit (403), so on the hosted deployment the page must not
// request them, and must still render instead of an error panel.
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getWebhooks: vi.fn(() => actual.getWebhooks(true)),
    getAuditLogs: vi.fn(() => actual.getAuditLogs(true, { limit: 10, offset: 0 })),
    getRuntimeHealth: vi.fn(() => actual.getRuntimeHealth(true))
  };
});

const client = await import('@/lib/api/client');

describe('SettingsPage on the hosted console', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(client.getWebhooks).mockClear();
    vi.mocked(client.getAuditLogs).mockClear();
    usePreferencesStore.setState({ demoMode: true });
  });

  it('skips the operator-only routes and says why', async () => {
    vi.stubEnv('NEXT_PUBLIC_MACP_HOSTED', 'true');
    usePreferencesStore.setState({ demoMode: false });
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByTestId('hosted-operator-note', {}, { timeout: 5000 })).toHaveTextContent(
      'Not available on the hosted console'
    );
    expect(screen.getByRole('heading', { name: /settings and integrations/i })).toBeInTheDocument();
    expect(client.getWebhooks).not.toHaveBeenCalled();
    expect(client.getAuditLogs).not.toHaveBeenCalled();
  });

  it('keeps webhooks and the audit log off the hosted deployment', async () => {
    usePreferencesStore.setState({ demoMode: false });
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole('button', { name: /create webhook/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId('hosted-operator-note')).not.toBeInTheDocument();
    expect(client.getWebhooks).toHaveBeenCalled();
    expect(client.getAuditLogs).toHaveBeenCalled();
  });
});
