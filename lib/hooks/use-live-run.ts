'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMockFrames } from '@/lib/api/client';
import type { CanonicalEvent, RunStateProjection } from '@/lib/types';

const MAX_RECONNECT_ATTEMPTS = 8;
const MAX_EVENT_BUFFER = 500;
const HEARTBEAT_TIMEOUT_MS = 45_000;

/** Normalize flat CP event fields to the nested shape the UI expects. */
function normalizeEvent(raw: Record<string, unknown>): CanonicalEvent {
  const event = raw as unknown as CanonicalEvent & {
    sourceKind?: string;
    sourceName?: string;
    subjectKind?: string;
    subjectId?: string;
    rawType?: string;
  };
  if (!event.source && (event.sourceKind || event.sourceName)) {
    event.source = {
      kind: (event.sourceKind ?? 'macp-control-plane') as CanonicalEvent['source']['kind'],
      name: event.sourceName ?? '',
      rawType: event.rawType
    };
  }
  if (!event.subject && event.subjectKind) {
    event.subject = { kind: event.subjectKind, id: event.subjectId ?? '' };
  }
  return event as CanonicalEvent;
}

interface UseLiveRunOptions {
  runId: string;
  demoMode: boolean;
  initialState?: RunStateProjection;
  initialEvents?: CanonicalEvent[];
  autoStart?: boolean;
}

/**
 * The resume cursor, derived **only from events actually received**.
 *
 * Never seed this from `timeline.latestSeq`. That is the server's head, and the console does not
 * necessarily hold everything below it: `getRunEvents` fetches at most 500 events, oldest first, so on
 * a longer run the head is far beyond the newest event in hand. Opening the stream at the head then
 * asks for events *after* the ones that were never delivered, and the range between silently never
 * arrives by any path.
 *
 * `getRunEvents` does not guarantee ordering, so take the maximum rather than the last element. The
 * unfiltered page really is oldest-first (`event.repository.ts:75` orders by `asc(seq)`), but the filtered
 * path — `afterTs`, `beforeTs` or `type` — orders by `asc(ts), asc(seq)` (`:121`, `:137`), which can
 * diverge from seq order. `Math.max` is correct for both; `at(-1)` is correct only for the first.
 *
 * An empty or absent list yields 0. Note what that actually requests: the control plane gates its
 * replay on `afterSeq > 0`, so `afterSeq=0` means "snapshot plus the live tail", **not** "send
 * everything". That is the right request on a cold mount — the initial page of history comes from
 * the separate `getRunEvents` query, not from the stream — but it is not a backfill.
 */
function highestSeq(events: CanonicalEvent[] | undefined): number {
  if (!events?.length) return 0;
  return events.reduce((max, event) => (Number.isFinite(event.seq) && event.seq > max ? event.seq : max), 0);
}

export function useLiveRun({ runId, demoMode, initialState, initialEvents, autoStart = true }: UseLiveRunOptions) {
  const [state, setState] = useState<RunStateProjection | undefined>(initialState);
  const [events, setEvents] = useState<CanonicalEvent[]>(initialEvents ?? []);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error'
  >('idle');
  const [lastSeq, setLastSeq] = useState<number>(() => highestSeq(initialEvents));
  const [paused, setPaused] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastSeqRef = useRef(lastSeq);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    lastSeqRef.current = lastSeq;
  }, [lastSeq]);

  const appendEvent = useCallback((event: CanonicalEvent) => {
    setEvents((current) => {
      if (current.some((item) => item.id === event.id)) return current;
      const next = [...current, event];
      return next.length > MAX_EVENT_BUFFER ? next.slice(-MAX_EVENT_BUFFER) : next;
    });
  }, []);

  const resetHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
    heartbeatTimerRef.current = setTimeout(() => {
      // No heartbeat received — treat as connection failure
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      attemptReconnect();
    }, HEARTBEAT_TIMEOUT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attemptReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionStatus('error');
      setReconnectAttempt(attempt);
      return;
    }

    reconnectAttemptRef.current = attempt + 1;
    setReconnectAttempt(attempt + 1);
    setConnectionStatus('reconnecting');

    const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
    reconnectTimerRef.current = setTimeout(() => {
      connectSSE();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectSSE = useCallback(() => {
    // Clean up any existing connection
    eventSourceRef.current?.close();

    const seq = lastSeqRef.current;
    const source = new EventSource(
      `/api/proxy/macp-control-plane/runs/${runId}/stream?includeSnapshot=true&afterSeq=${seq}`
    );
    eventSourceRef.current = source;

    source.addEventListener('open', () => {
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      setConnectionStatus('live');
      resetHeartbeatTimer();
    });

    source.addEventListener('snapshot', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as RunStateProjection;
      setState(payload);
      // Deliberately does NOT touch the cursor. The control plane republishes a snapshot on every
      // commit, not once per connection, so writing `timeline.latestSeq` here would drag the resume
      // point up to the server head continuously during normal streaming — skipping anything that had
      // not yet been delivered. `timeline.latestSeq` remains available on `state` as the server's
      // high-water mark, which is what gap detection compares against.
      resetHeartbeatTimer();
    });

    source.addEventListener('canonical_event', (event) => {
      const payload = normalizeEvent(JSON.parse((event as MessageEvent).data) as Record<string, unknown>);
      appendEvent(payload);
      // Monotonic: out-of-order delivery must not walk the cursor backwards, or the next reconnect
      // re-requests a range already held and the server replays it for nothing.
      //
      // The guard is not defensive noise. `Math.max` is absorbing over both NaN and Infinity, so a
      // single event whose `seq` is not a finite number would pin the cursor there for the rest of
      // the session, send `afterSeq=NaN` (or `Infinity`), and get every reconnect rejected by the
      // control plane's `@IsInt()` validation until the attempt limit is reached — turning a one-off
      // malformed frame into a permanently dead stream. The unguarded assignment this replaced
      // self-healed on the next good event; monotonicity must not trade that away.
      //
      // `Number.isFinite` rather than `typeof === 'number'`: it rejects NaN and Infinity as well as
      // non-numbers in one predicate, and makes this identical to `highestSeq`. A missing `seq` is
      // the reachable case (`Math.max(9, undefined)` is NaN); `NaN`/`Infinity` literals cannot come
      // from `JSON.parse` at all, but an overflowing JSON number (`1e999`) parses to `Infinity`.
      setLastSeq((previous) => (Number.isFinite(payload.seq) ? Math.max(previous, payload.seq) : previous));
      resetHeartbeatTimer();
    });

    source.addEventListener('heartbeat', () => {
      setConnectionStatus('live');
      resetHeartbeatTimer();
    });

    // `addEventListener`, not `source.onerror =`, so all five event paths on this source (open,
    // snapshot, canonical_event, heartbeat, error) are registered the same way. A fresh EventSource
    // is constructed on every connect, so listeners cannot accumulate across reconnects.
    source.addEventListener('error', () => {
      source.close();
      eventSourceRef.current = null;
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      attemptReconnect();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!autoStart || paused) return;

    setConnectionStatus('connecting');

    if (demoMode) {
      const frames = getMockFrames(runId);
      let index = 0;
      setConnectionStatus('live');
      const interval = window.setInterval(() => {
        const frame = frames[index];
        if (!frame) {
          setConnectionStatus('ended');
          window.clearInterval(interval);
          return;
        }
        appendEvent(frame.event);
        setState(frame.snapshot);
        setLastSeq(frame.seq);
        index += 1;
      }, 1600);

      return () => {
        window.clearInterval(interval);
      };
    }

    connectSSE();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      reconnectAttemptRef.current = 0;
    };
  }, [autoStart, demoMode, paused, runId, connectSSE, appendEvent]);

  const latestEvent = useMemo(() => events.at(-1), [events]);

  return {
    state,
    events,
    latestEvent,
    lastSeq,
    connectionStatus,
    reconnectAttempt,
    paused,
    setPaused,
    reset: () => {
      setEvents(initialEvents ?? []);
      setState(initialState);
      // Same rule as the initial seed: the cursor tracks what we hold, not what the server has.
      setLastSeq(highestSeq(initialEvents));
      setConnectionStatus('idle');
      setReconnectAttempt(0);
      reconnectAttemptRef.current = 0;
    }
  };
}
