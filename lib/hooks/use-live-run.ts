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

export function useLiveRun({ runId, demoMode, initialState, initialEvents, autoStart = true }: UseLiveRunOptions) {
  const [state, setState] = useState<RunStateProjection | undefined>(initialState);
  const [events, setEvents] = useState<CanonicalEvent[]>(initialEvents ?? []);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error'
  >('idle');
  const [lastSeq, setLastSeq] = useState<number>(initialState?.timeline.latestSeq ?? 0);
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
      setLastSeq(payload.timeline.latestSeq);
      resetHeartbeatTimer();
    });

    source.addEventListener('canonical_event', (event) => {
      const payload = normalizeEvent(JSON.parse((event as MessageEvent).data) as Record<string, unknown>);
      appendEvent(payload);
      setLastSeq(payload.seq);
      resetHeartbeatTimer();
    });

    source.addEventListener('heartbeat', () => {
      setConnectionStatus('live');
      resetHeartbeatTimer();
    });

    source.onerror = () => {
      source.close();
      eventSourceRef.current = null;
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      attemptReconnect();
    };
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
      setLastSeq(initialState?.timeline.latestSeq ?? 0);
      setConnectionStatus('idle');
      setReconnectAttempt(0);
      reconnectAttemptRef.current = 0;
    }
  };
}
