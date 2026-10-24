'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { CanonicalEvent, RunStateProjection } from '@/lib/types';
import { formatDateTime } from '@/lib/utils/format';
import { getStatusTone } from '@/lib/utils/format';
import { Badge } from '@/components/ui/badge';

interface TimelineFrame {
  seq: number;
  event: CanonicalEvent;
  /** Captured projection at this seq. Demo frames carry one; real frames are fetched per seq. */
  snapshot?: RunStateProjection;
}

interface TimelineScrubberProps {
  frames: TimelineFrame[];
  currentSeq: number | undefined;
  onSeqChange: (seq: number | undefined) => void;
}

export function TimelineScrubber({ frames, currentSeq, onSeqChange }: TimelineScrubberProps) {
  const rangeRef = useRef<HTMLInputElement>(null);

  const minSeq = frames[0]?.seq ?? 0;
  const maxSeq = frames[frames.length - 1]?.seq ?? 0;
  const currentFrame = frames.find((f) => f.seq === currentSeq);
  const effectiveSeq = currentSeq ?? maxSeq;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = frames.findIndex((f) => f.seq === effectiveSeq);
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        onSeqChange(frames[currentIndex - 1].seq);
      } else if (e.key === 'ArrowRight' && currentIndex < frames.length - 1) {
        onSeqChange(frames[currentIndex + 1].seq);
      } else if (e.key === 'Home') {
        onSeqChange(frames[0]?.seq);
      } else if (e.key === 'End') {
        onSeqChange(undefined);
      }
    },
    [frames, effectiveSeq, onSeqChange]
  );

  useEffect(() => {
    if (rangeRef.current) {
      rangeRef.current.value = String(effectiveSeq);
    }
  }, [effectiveSeq]);

  if (frames.length === 0) {
    return (
      <div className="timeline-scrubber">
        <p className="muted small">No replay frames available.</p>
      </div>
    );
  }

  return (
    <div className="timeline-scrubber" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="timeline-scrubber-track">
        {frames.map((frame) => {
          const pct = maxSeq === minSeq ? 50 : ((frame.seq - minSeq) / (maxSeq - minSeq)) * 100;
          const isActive = frame.seq === effectiveSeq;
          return (
            <button
              key={frame.seq}
              className={`timeline-scrubber-marker ${isActive ? 'timeline-scrubber-marker-active' : ''}`}
              style={{ left: `${pct}%` }}
              title={`Seq ${frame.seq}: ${frame.event.type}`}
              onClick={() => onSeqChange(frame.seq)}
            />
          );
        })}
        <input
          ref={rangeRef}
          type="range"
          className="timeline-scrubber-range"
          min={minSeq}
          max={maxSeq}
          defaultValue={effectiveSeq}
          onChange={(e) => {
            const val = Number(e.target.value);
            const closest = frames.reduce((prev, curr) =>
              Math.abs(curr.seq - val) < Math.abs(prev.seq - val) ? curr : prev
            );
            onSeqChange(closest.seq);
          }}
        />
      </div>

      <div className="timeline-scrubber-info">
        {currentFrame ? (
          <>
            <Badge label={currentFrame.event.type} tone={getStatusTone(currentFrame.event.type) as 'info'} />
            <span className="muted small">
              seq {currentFrame.seq} · {formatDateTime(currentFrame.event.ts)}
            </span>
          </>
        ) : (
          <span className="muted small">Latest state (seq {maxSeq})</span>
        )}
        <button className="button button-ghost" style={{ marginLeft: 'auto' }} onClick={() => onSeqChange(undefined)}>
          Reset to latest
        </button>
      </div>
    </div>
  );
}
