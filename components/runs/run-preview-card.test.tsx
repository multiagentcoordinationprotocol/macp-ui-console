import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/test-utils';
import { RunPreviewCard } from './run-preview-card';
import { MOCK_COMPILED_RUN } from '@/lib/data/mock-data';
import type { CompileLaunchResult } from '@/lib/types';

function compiled(overrides?: Partial<CompileLaunchResult['initiator']>): CompileLaunchResult {
  return {
    ...MOCK_COMPILED_RUN,
    participantBindings: [{ participantId: 'risk-agent', role: 'risk', agentRef: 'agent://risk' }],
    initiator: overrides === null ? undefined : { ...MOCK_COMPILED_RUN.initiator!, ...overrides }
  } as CompileLaunchResult;
}

describe('RunPreviewCard max_suspend_ms', () => {
  const noop = () => {};

  it('renders the Max suspend badge when the compiled sessionStart carries maxSuspendMs', () => {
    renderWithProviders(<RunPreviewCard compiled={compiled()} onEdit={noop} onSubmit={noop} isSubmitting={false} />);
    // MOCK_COMPILED_RUN.initiator.sessionStart.maxSuspendMs === 900000 → 15m 0s
    expect(screen.getByText(/Max suspend:/i)).toBeInTheDocument();
    expect(screen.getByText(/Max suspend: 15m/i)).toBeInTheDocument();
  });

  it('omits the Max suspend badge when maxSuspendMs is absent', () => {
    const withoutCap = compiled({
      sessionStart: { ...MOCK_COMPILED_RUN.initiator!.sessionStart, maxSuspendMs: undefined }
    });
    renderWithProviders(<RunPreviewCard compiled={withoutCap} onEdit={noop} onSubmit={noop} isSubmitting={false} />);
    expect(screen.queryByText(/Max suspend:/i)).not.toBeInTheDocument();
  });
});
