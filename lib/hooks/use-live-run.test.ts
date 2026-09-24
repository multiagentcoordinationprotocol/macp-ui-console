import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { getMockFrames } from '@/lib/api/client';
import type { CanonicalEvent, RunStateProjection } from '@/lib/types';

// ── Mock getMockFrames ──────────────────────────────────────────────────
vi.mock('@/lib/api/client', () => ({
  getMockFrames: vi.fn()
}));

const mockedGetMockFrames = getMockFrames as ReturnType<typeof vi.fn>;

// ── Mock EventSource (not available in JSDOM) ───────────────────────────
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  private listeners: Record<string, Array<(ev: Event | MessageEvent) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (ev: Event | MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (ev: Event | MessageEvent) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(type: string, data?: unknown) {
    const event = data !== undefined ? new MessageEvent(type, { data: JSON.stringify(data) }) : new Event(type);
    this.listeners[type]?.forEach((l) => l(event));
    // Also fire the `on*` property handler. The hook registers everything through
    // `addEventListener`, so this is redundant for it today — it is here so the harness drives a
    // source the way a browser does, and a handler assigned as a property (the shape this hook used
    // to use, and the one `dispatchEvent` silently ignored) stays testable.
    const handler = type === 'error' ? this.onerror : type === 'open' ? this.onopen : undefined;
    handler?.(event);
  }

  /**
   * Dispatch a frame from raw JSON *text*, bypassing `JSON.stringify`.
   *
   * Needed because `dispatchEvent` serializes, and `JSON.stringify` cannot express every value
   * `JSON.parse` can produce: `JSON.stringify({ seq: Infinity })` is `{"seq":null}`. Injecting the
   * literal text `{"seq":1e999}` is the only way to drive the hook with a non-finite `seq`, which is
   * exactly the shape an overflowing number on the wire arrives in.
   */
  dispatchRaw(type: string, rawJson: string) {
    const event = new MessageEvent(type, { data: rawJson });
    this.listeners[type]?.forEach((l) => l(event));
  }

  close() {
    this.readyState = 2;
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

// Assign to global so the hook can use `new EventSource(…)`
Object.defineProperty(globalThis, 'EventSource', { value: MockEventSource, writable: true });

// ── Helpers ─────────────────────────────────────────────────────────────

function makeEvent(id: string, seq: number, overrides?: Partial<CanonicalEvent>): CanonicalEvent {
  return {
    id,
    runId: 'run-1',
    seq,
    ts: new Date().toISOString(),
    type: 'test.event',
    source: { kind: 'runtime', name: 'test' },
    data: {},
    ...overrides
  };
}

function makeSnapshot(seq: number): RunStateProjection {
  return {
    run: { runId: 'run-1', status: 'running' },
    participants: [],
    graph: { nodes: [], edges: [] },
    decision: {},
    signals: { signals: [] },
    progress: { entries: [] },
    timeline: { latestSeq: seq, totalEvents: seq, recent: [] },
    policy: { policyVersion: 'policy.default', commitmentEvaluations: [] },
    trace: { spanCount: 0, linkedArtifacts: [] },
    outboundMessages: { total: 0, queued: 0, accepted: 0, rejected: 0 }
  };
}

function makeFrame(seq: number) {
  return { seq, event: makeEvent(`evt-${seq}`, seq), snapshot: makeSnapshot(seq) };
}

/** First reconnect backoff: `min(1000 * 2 ** attempt, 30_000)` with attempt 0. */
const RECONNECT_BACKOFF_MS = 1000;

/** Must match the private constant of the same name in `use-live-run.ts`. */
const HEARTBEAT_TIMEOUT_MS = 45_000;

/** Must match the private constant of the same name in `use-live-run.ts`. */
const MAX_RECONNECT_ATTEMPTS = 8;

/** The `afterSeq` the hook opened its most recent stream with. */
function afterSeqOf(instance: MockEventSource): number {
  return Number(new URL(instance.url, 'http://localhost').searchParams.get('afterSeq'));
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('useLiveRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    mockedGetMockFrames.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Lazy-import the hook so the mock is in place before module resolution
  async function importHook() {
    const mod = await import('./use-live-run');
    return mod.useLiveRun;
  }

  // ── Test 1: Demo mode emits frames at 1600ms intervals ──────────────
  it('demo mode: emits frames at 1600ms intervals', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2), makeFrame(3)];
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // Initial state: no events emitted yet
    expect(result.current.events).toHaveLength(0);

    // After first tick (1600ms): first frame emitted
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.lastSeq).toBe(1);

    // After second tick
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.lastSeq).toBe(2);

    // After third tick
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.events).toHaveLength(3);
    expect(result.current.lastSeq).toBe(3);
    expect(result.current.state).toEqual(frames[2].snapshot);
  });

  // ── Test 2: Demo mode transitions connecting -> live -> ended ────────
  it('demo mode: transitions connecting -> live -> ended', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2)];
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // The effect sets 'connecting' then immediately 'live' (synchronously in the effect)
    expect(result.current.connectionStatus).toBe('live');

    // Consume first frame
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.connectionStatus).toBe('live');

    // Consume second frame
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.connectionStatus).toBe('live');

    // Next tick: no more frames -> ended
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.connectionStatus).toBe('ended');
  });

  // ── Test 3: Demo mode calls appendEvent for each frame ───────────────
  it('demo mode: calls appendEvent for each frame, events array grows', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2), makeFrame(3)];
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // Advance through all 3 frames
    for (let i = 1; i <= 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(result.current.events).toHaveLength(i);
      expect(result.current.events[i - 1].id).toBe(`evt-${i}`);
    }

    // latestEvent should be the last one
    expect(result.current.latestEvent?.id).toBe('evt-3');
  });

  // ── Test 4: Event deduplication ─────────────────────────────────────
  it('deduplicates events with the same id', async () => {
    const useLiveRun = await importHook();
    const dupEvent = makeEvent('dup-1', 1);
    const frames = [
      { seq: 1, event: dupEvent, snapshot: makeSnapshot(1) },
      { seq: 2, event: { ...dupEvent, seq: 2 }, snapshot: makeSnapshot(2) }, // same id "dup-1"
      { seq: 3, event: makeEvent('evt-3', 3), snapshot: makeSnapshot(3) }
    ];
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // Advance through all 3 frames
    await act(async () => {
      vi.advanceTimersByTime(1600 * 3);
    });

    // Only 2 unique events should be present (dup-1 and evt-3)
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe('dup-1');
    expect(result.current.events[1].id).toBe('evt-3');
  });

  // ── Test 5: Buffer limit (MAX_EVENT_BUFFER = 500) ───────────────────
  it('respects MAX_EVENT_BUFFER=500 limit', async () => {
    const useLiveRun = await importHook();
    const frames = Array.from({ length: 502 }, (_, i) => makeFrame(i + 1));
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // Advance through all 502 frames
    await act(async () => {
      vi.advanceTimersByTime(1600 * 502);
    });

    // Should be capped at 500
    expect(result.current.events).toHaveLength(500);
    // The first 2 events should have been dropped; oldest remaining is evt-3
    expect(result.current.events[0].id).toBe('evt-3');
    // Last event is evt-502
    expect(result.current.events[499].id).toBe('evt-502');
  });

  // ── Test 6: Pause/resume ────────────────────────────────────────────
  it('pause stops new events, resume resumes them', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2), makeFrame(3)];
    mockedGetMockFrames.mockReturnValue(frames);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true }));

    // Consume first frame
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(result.current.events).toHaveLength(1);

    // Pause — the effect cleanup runs and clears the interval
    act(() => {
      result.current.setPaused(true);
    });
    expect(result.current.paused).toBe(true);

    // Capture event count right after pausing
    const countAfterPause = result.current.events.length;

    // Advance timers significantly; no new events should arrive
    await act(async () => {
      vi.advanceTimersByTime(1600 * 5);
    });
    expect(result.current.events.length).toBe(countAfterPause);

    // Resume — the effect re-runs and creates a new interval from frame[0]
    act(() => {
      result.current.setPaused(false);
    });

    // Connection should be live again after resume
    expect(result.current.connectionStatus).toBe('live');

    // The interval replays from frame[0], but evt-1 is already present (deduplicated).
    // Advance two ticks: first tick re-sends evt-1 (deduped), second tick sends evt-2 (new).
    await act(async () => {
      vi.advanceTimersByTime(1600 * 2);
    });
    expect(result.current.events.length).toBeGreaterThan(countAfterPause);
  });

  // ── Test 7: Reset returns to initial state ──────────────────────────
  it('reset() returns state to initial values', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2)];
    mockedGetMockFrames.mockReturnValue(frames);

    const initialSnapshot = makeSnapshot(0);
    const initialEvts = [makeEvent('init-1', 0)];

    const { result } = renderHook(() =>
      useLiveRun({
        runId: 'run-1',
        demoMode: true,
        initialState: initialSnapshot,
        initialEvents: initialEvts,
        autoStart: false
      })
    );

    // Verify initial state is set
    expect(result.current.state).toEqual(initialSnapshot);
    expect(result.current.events).toEqual(initialEvts);
    expect(result.current.connectionStatus).toBe('idle');

    // Mutate by manually calling reset (even though autoStart is false,
    // we can test that reset restores the original values)
    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toEqual(initialSnapshot);
    expect(result.current.events).toEqual(initialEvts);
    expect(result.current.lastSeq).toBe(0);
    expect(result.current.connectionStatus).toBe('idle');
    expect(result.current.reconnectAttempt).toBe(0);
  });

  // ── Test 8: Initial state and events are used ───────────────────────
  it('uses initialState and initialEvents when provided', async () => {
    const useLiveRun = await importHook();
    mockedGetMockFrames.mockReturnValue([]);

    const initialSnapshot = makeSnapshot(42);
    const initialEvts = [makeEvent('init-a', 10), makeEvent('init-b', 20)];

    const { result } = renderHook(() =>
      useLiveRun({
        runId: 'run-1',
        demoMode: true,
        initialState: initialSnapshot,
        initialEvents: initialEvts,
        autoStart: false
      })
    );

    expect(result.current.state).toEqual(initialSnapshot);
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe('init-a');
    expect(result.current.events[1].id).toBe('init-b');
    // The cursor seeds from the newest event actually held (20), NOT from the snapshot's
    // `timeline.latestSeq` (42). This assertion previously read 42 and encoded the bug: seeding at
    // the server head makes the stream open at `afterSeq=42` while events 21-42 were never
    // delivered, so that range is skipped permanently.
    expect(result.current.lastSeq).toBe(20);
    expect(result.current.connectionStatus).toBe('idle');
    expect(result.current.latestEvent?.id).toBe('init-b');
  });

  // ── Test: autoStart=false keeps hook idle ───────────────────────────
  it('does not start streaming when autoStart is false', async () => {
    const useLiveRun = await importHook();
    mockedGetMockFrames.mockReturnValue([makeFrame(1)]);

    const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: true, autoStart: false }));

    await act(async () => {
      vi.advanceTimersByTime(1600 * 5);
    });

    expect(result.current.events).toHaveLength(0);
    expect(result.current.connectionStatus).toBe('idle');
    expect(mockedGetMockFrames).not.toHaveBeenCalled();
  });

  // ── Test: reset after streaming restores initial values ─────────────
  it('reset() after streaming restores initial values', async () => {
    const useLiveRun = await importHook();
    const frames = [makeFrame(1), makeFrame(2)];
    mockedGetMockFrames.mockReturnValue(frames);

    const initialSnapshot = makeSnapshot(0);

    const { result } = renderHook(() =>
      useLiveRun({
        runId: 'run-1',
        demoMode: true,
        initialState: initialSnapshot
      })
    );

    // Advance to consume frames
    await act(async () => {
      vi.advanceTimersByTime(1600 * 2);
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.lastSeq).toBe(2);

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.events).toHaveLength(0);
    expect(result.current.state).toEqual(initialSnapshot);
    expect(result.current.lastSeq).toBe(0);
    expect(result.current.connectionStatus).toBe('idle');
  });
  // ── SSE-path resume-cursor tests (demoMode: false) ──────────────────
  //
  // The first tests in this file to drive MockEventSource with a real stream. Every case below is a
  // permanent, silent event-loss path before this phase: the cursor was derived from the server's
  // head rather than from what the client actually holds.
  describe('resume cursor (SSE path)', () => {
    it('opens at the newest event held, not at the server head', async () => {
      // The headline bug. `initialEvents` is capped at 500 by getRunEvents and arrives oldest-first,
      // so on a long run the head is far past anything the client has. Opening at the head skips
      // every event in between, by every path — the stream will not resend them and no refetch asks.
      const useLiveRun = await importHook();
      renderHook(() =>
        useLiveRun({
          runId: 'run-1',
          demoMode: false,
          initialState: makeSnapshot(900),
          initialEvents: [makeEvent('a', 499), makeEvent('b', 500)]
        })
      );

      expect(MockEventSource.instances).toHaveLength(1);
      expect(afterSeqOf(MockEventSource.instances[0])).toBe(500);
    });

    it('does not advance the cursor on a snapshot', async () => {
      // Snapshots are republished on EVERY commit, not once per connection, so this is not a
      // reconnect-window edge: writing latestSeq here drags the cursor to the head continuously
      // during normal streaming.
      const useLiveRun = await importHook();
      renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false, initialEvents: [makeEvent('a', 50)] }));
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        MockEventSource.instances[0].dispatchEvent('snapshot', makeSnapshot(100));
      });
      // Reconnect, and check where it resumes from.
      act(() => {
        MockEventSource.instances[0].dispatchEvent('error');
      });

      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });
      expect(MockEventSource.instances.length).toBeGreaterThan(1);
      expect(afterSeqOf(MockEventSource.instances.at(-1)!)).toBe(50);
    });

    it('still applies the snapshot to state — only the cursor is left alone', async () => {
      // The snapshot is what makes every projection panel self-heal; this phase must not throw that
      // away while fixing the cursor.
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      const snapshot = makeSnapshot(100);
      act(() => {
        MockEventSource.instances[0].dispatchEvent('snapshot', snapshot);
      });

      expect(result.current.state).toEqual(snapshot);
      expect(result.current.state?.timeline.latestSeq).toBe(100);
    });

    it('never walks the cursor backwards on out-of-order delivery', async () => {
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('e5', 5));
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('e3', 3));
      });

      expect(result.current.lastSeq).toBe(5);
      act(() => {
        MockEventSource.instances[0].dispatchEvent('error');
      });
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });
      expect(MockEventSource.instances.length).toBeGreaterThan(1);
      expect(afterSeqOf(MockEventSource.instances.at(-1)!)).toBe(5);
    });

    it('reset() re-seeds from initialEvents, not from the snapshot head', async () => {
      const useLiveRun = await importHook();
      const { result } = renderHook(() =>
        useLiveRun({
          runId: 'run-1',
          demoMode: false,
          initialState: makeSnapshot(900),
          initialEvents: [makeEvent('a', 500)],
          autoStart: false
        })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.lastSeq).toBe(500);
    });

    it('drops a duplicate id arriving with a different seq, on the SSE path', async () => {
      // The demo-mode dedup test covers the frame loop only; the real path had never been tested.
      // Dedup keys on `event.id`, so a redelivery under a new seq must not double up.
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('same-id', 7));
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('same-id', 8));
      });

      expect(result.current.events).toHaveLength(1);
      // The cursor still advances — the event was received even though it was not stored twice.
      expect(result.current.lastSeq).toBe(8);
    });

    it('survives an event with no numeric seq, instead of latching the cursor forever', async () => {
      // Math.max is absorbing over NaN, so without a type guard one malformed frame pins the cursor
      // at NaN for the rest of the session: every reconnect then sends `afterSeq=NaN`, the control
      // plane's validation pipe rejects it, and the stream burns its 8 attempts and dies. The
      // unguarded assignment this replaced self-healed on the next good event, so monotonicity must
      // not be bought at the cost of a permanent latch.
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('good', 4));
        // `seq` absent entirely — the shape a malformed or partially-decoded frame arrives in.
        MockEventSource.instances[0].dispatchEvent('canonical_event', {
          ...makeEvent('bad', 0),
          seq: undefined
        });
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('good-2', 9));
      });

      expect(result.current.lastSeq).toBe(9);
      act(() => {
        MockEventSource.instances[0].dispatchEvent('error');
      });
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });
      const url = MockEventSource.instances.at(-1)!.url;
      expect(url).not.toContain('NaN');
      expect(afterSeqOf(MockEventSource.instances.at(-1)!)).toBe(9);
    });

    it('survives a non-finite seq, which Math.max absorbs exactly like NaN', async () => {
      // `NaN` and `Infinity` literals cannot come out of `JSON.parse`, but an overflowing JSON
      // number does: `JSON.parse('{"seq":1e999}').seq === Infinity`. Math.max absorbs it the same
      // way, producing `afterSeq=Infinity`, which the control plane's `@IsInt()` rejects — the same
      // permanently dead stream as the NaN case. Hence `Number.isFinite`, not `typeof === 'number'`.
      //
      // Dispatched as raw text: `dispatchEvent` would `JSON.stringify` it back down to `null`, which
      // `typeof === 'number'` also rejects, and the test would pass either way.
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));

      act(() => {
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('good', 4));
        MockEventSource.instances[0].dispatchRaw(
          'canonical_event',
          JSON.stringify(makeEvent('overflow', 0)).replace('"seq":0', '"seq":1e999')
        );
        MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent('good-2', 9));
      });

      expect(result.current.lastSeq).toBe(9);
      act(() => {
        MockEventSource.instances[0].dispatchEvent('error');
      });
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });
      expect(MockEventSource.instances.at(-1)!.url).not.toContain('Infinity');
      expect(afterSeqOf(MockEventSource.instances.at(-1)!)).toBe(9);
    });

    it('ignores a non-finite seq when seeding from initialEvents', async () => {
      const useLiveRun = await importHook();
      renderHook(() =>
        useLiveRun({
          runId: 'run-1',
          demoMode: false,
          initialEvents: [makeEvent('a', 7), { ...makeEvent('b', 0), seq: JSON.parse('{"seq":1e999}').seq }]
        })
      );

      expect(afterSeqOf(MockEventSource.instances[0])).toBe(7);
    });

    it('seeds at 0 when nothing is held', async () => {
      const useLiveRun = await importHook();
      renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false, initialState: makeSnapshot(900) }));

      expect(MockEventSource.instances).toHaveLength(1);
      expect(afterSeqOf(MockEventSource.instances[0])).toBe(0);
    });

    it('takes the highest seq, not the last element, since event order is not guaranteed', async () => {
      const useLiveRun = await importHook();
      renderHook(() =>
        useLiveRun({
          runId: 'run-1',
          demoMode: false,
          initialEvents: [makeEvent('a', 300), makeEvent('b', 120)]
        })
      );

      expect(MockEventSource.instances).toHaveLength(1);
      expect(afterSeqOf(MockEventSource.instances[0])).toBe(300);
    });
  });
  describe('seq contiguity (why there is no client-side gap detector)', () => {
    it('receives canonical seqs with permanent holes on a perfectly healthy stream', async () => {
      // Load-bearing regression guard. A seq-delta gap detector was built here and removed, because
      // canonical seqs are NOT contiguous per run and it warned on every healthy run.
      //
      // `RunEventService.persistRawAndCanonical` allocates `1 + canonicalEvents.length` seqs from the
      // single `runs.last_event_seq` counter, gives `startSeq` to the RAW row and `startSeq + i + 1`
      // to the canonical ones (macp-control-plane/src/events/run-event.service.ts:118-123). Raw and
      // canonical live in separate tables, and only canonical events are streamed. So every batch
      // burns one seq that no subscriber will ever see — the CP's own spec pins raw@5 / canonical@6,@7
      // (run-event.service.spec.ts:339-361).
      //
      // This test asserts the hook stays quiet on exactly that pattern. If a gap detector is ever
      // reintroduced on `seq` deltas, this fails — which is the point.
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));

      act(() => {
        // One canonical event per batch: 2, 4, 6, 8 — a hole at every odd seq, all of them normal.
        for (const seq of [2, 4, 6, 8]) {
          MockEventSource.instances[0].dispatchEvent('canonical_event', makeEvent(`e${seq}`, seq));
        }
      });

      expect(result.current.events.map((event) => event.seq)).toEqual([2, 4, 6, 8]);
      expect(result.current.lastSeq).toBe(8);
      // Pin the whole surface, not just the absence of one name: a reporting-only detector
      // reintroduced under any other name must fail this too.
      expect(Object.keys(result.current).sort()).toEqual([
        'connectionStatus',
        'events',
        'lastSeq',
        'latestEvent',
        'paused',
        'reconnectAttempt',
        'reset',
        'setPaused',
        'state'
      ]);
    });
  });

  describe('reconnect targeting across a runId change (no remount)', () => {
    // App Router does not remount `RunWorkbench` just because a dynamic route segment's value
    // changed — navigating from one live run's page to another's, client-side, re-renders the same
    // component with a new `runId` prop. `attemptReconnect`/`resetHeartbeatTimer` are memoized with a
    // permanently empty dependency array so their identity survives reconnects; before the
    // `connectSSERef` fix, that meant they closed over the *first* `connectSSE` this hook instance
    // ever created — a later reconnect would silently re-open a stream for the *original* run and
    // splice its events into whatever run is currently on screen.
    it('a reconnect triggered by a fresh error targets the new run, not the one mounted with', async () => {
      const useLiveRun = await importHook();
      const { rerender } = renderHook(({ runId }: { runId: string }) => useLiveRun({ runId, demoMode: false }), {
        initialProps: { runId: 'run-1' }
      });

      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toContain('/runs/run-1/stream');

      // Simulate the App Router reuse case: same hook instance, new runId.
      rerender({ runId: 'run-2' });

      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.instances[1].url).toContain('/runs/run-2/stream');

      // The run-2 connection drops on its own, independent of the run change.
      act(() => {
        MockEventSource.instances[1].dispatchEvent('error');
      });
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });

      // The reconnect must still target run-2 — not the run-1 closure `attemptReconnect` was
      // originally created against.
      expect(MockEventSource.instances).toHaveLength(3);
      expect(MockEventSource.instances[2].url).toContain('/runs/run-2/stream');
      expect(MockEventSource.instances[2].url).not.toContain('run-1');
    });

    it('a reconnect triggered by a heartbeat timeout also targets the new run', async () => {
      // Same hazard, via the other caller of the stale closure: resetHeartbeatTimer -> attemptReconnect.
      const useLiveRun = await importHook();
      const { rerender } = renderHook(({ runId }: { runId: string }) => useLiveRun({ runId, demoMode: false }), {
        initialProps: { runId: 'run-1' }
      });

      act(() => {
        MockEventSource.instances[0].dispatchEvent('open');
      });

      rerender({ runId: 'run-2' });
      expect(MockEventSource.instances).toHaveLength(2);

      act(() => {
        MockEventSource.instances[1].dispatchEvent('open');
      });

      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
      });
      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });

      expect(MockEventSource.instances).toHaveLength(3);
      expect(MockEventSource.instances[2].url).toContain('/runs/run-2/stream');
      expect(MockEventSource.instances[2].url).not.toContain('run-1');
    });
  });

  describe('heartbeat timeout', () => {
    it('reconnects when no heartbeat or event arrives within HEARTBEAT_TIMEOUT_MS', async () => {
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      act(() => {
        MockEventSource.instances[0].dispatchEvent('open');
      });
      expect(result.current.connectionStatus).toBe('live');

      // Silence for the full heartbeat window — no 'heartbeat', 'snapshot', or 'canonical_event'.
      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
      });
      expect(result.current.connectionStatus).toBe('reconnecting');
      expect(MockEventSource.instances).toHaveLength(1);

      await act(async () => {
        vi.advanceTimersByTime(RECONNECT_BACKOFF_MS);
      });
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it('a heartbeat event resets the timeout window', async () => {
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));

      act(() => {
        MockEventSource.instances[0].dispatchEvent('open');
      });

      // Just under the timeout, then a heartbeat — the window should restart, not merely pause.
      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
      });
      act(() => {
        MockEventSource.instances[0].dispatchEvent('heartbeat');
      });
      await act(async () => {
        vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
      });

      expect(result.current.connectionStatus).toBe('live');
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });

  describe('reconnect attempt exhaustion', () => {
    it(`stops reconnecting after ${MAX_RECONNECT_ATTEMPTS} attempts and reports connectionStatus "error"`, async () => {
      const useLiveRun = await importHook();
      const { result } = renderHook(() => useLiveRun({ runId: 'run-1', demoMode: false }));
      expect(MockEventSource.instances).toHaveLength(1);

      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        act(() => {
          MockEventSource.instances.at(-1)!.dispatchEvent('error');
        });
        await act(async () => {
          vi.advanceTimersByTime(delay);
        });
      }

      // 1 initial connection + one reconnect per attempt.
      expect(MockEventSource.instances).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);
      expect(result.current.connectionStatus).toBe('reconnecting');
      expect(result.current.reconnectAttempt).toBe(MAX_RECONNECT_ATTEMPTS);

      // The next error is the one that exhausts the budget — synchronous, no timer needed.
      act(() => {
        MockEventSource.instances.at(-1)!.dispatchEvent('error');
      });
      expect(result.current.connectionStatus).toBe('error');
      expect(result.current.reconnectAttempt).toBe(MAX_RECONNECT_ATTEMPTS);

      // No further reconnect gets scheduled, however long we wait.
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(MockEventSource.instances).toHaveLength(MAX_RECONNECT_ATTEMPTS + 1);
    });
  });
});
