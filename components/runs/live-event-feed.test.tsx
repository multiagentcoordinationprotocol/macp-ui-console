import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { LiveEventFeed } from './live-event-feed';
import type { CanonicalEvent } from '@/lib/types';

function makeEvent(id: string, seq: number): CanonicalEvent {
  return {
    id,
    runId: 'run-1',
    seq,
    ts: '2026-04-14T12:00:00Z',
    type: 'message.sent',
    source: { kind: 'runtime', name: 'test' },
    data: {}
  };
}

const events = [makeEvent('a', 1), makeEvent('b', 2)];

/** The notice is the only `role="status"` region the feed renders. */
function gapNotice() {
  return screen.queryByRole('status');
}

describe('LiveEventFeed — history gap notice', () => {
  it('renders no notice when historyGap is absent', () => {
    renderWithProviders(<LiveEventFeed events={events} runId="run-1" />);
    expect(gapNotice()).toBeNull();
  });

  it('renders no notice when historyGap is explicitly false', () => {
    renderWithProviders(<LiveEventFeed events={events} runId="run-1" historyGap={false} />);
    expect(gapNotice()).toBeNull();
  });

  it('renders exactly one notice when historyGap is true', () => {
    renderWithProviders(<LiveEventFeed events={events} runId="run-1" historyGap />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(within(gapNotice()!).getByText(/compacted that history away/)).toBeTruthy();
  });

  it('says the events are unrecoverable rather than offering a retry', () => {
    // This gap really is permanent: the envelopes were compacted out of the runtime before the
    // control plane could read them, so no refetch produces them. Offering a retry would be a lie.
    renderWithProviders(<LiveEventFeed events={events} runId="run-1" historyGap />);
    const text = gapNotice()!.textContent ?? '';
    expect(text).toMatch(/will\s+not\s+bring them back/);
    expect(text).not.toMatch(/try again|retry/i);
  });

  it('still renders the event rows alongside the notice', () => {
    // The notice is a caveat on the feed, not a replacement for it.
    renderWithProviders(<LiveEventFeed events={events} runId="run-1" historyGap />);
    expect(gapNotice()).not.toBeNull();
    expect(screen.getAllByText(/sent/).length).toBeGreaterThan(0);
  });
});
