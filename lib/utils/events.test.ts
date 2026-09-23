import { describe, it, expect } from 'vitest';
import { formatEventSubject, mergeEventStreams, summarizeEvent } from './events';
import type { CanonicalEvent } from '@/lib/types';

function evt(overrides: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'type' | 'data'>): CanonicalEvent {
  return {
    id: 'ev-1',
    runId: 'run-1',
    seq: 1,
    ts: '2026-04-14T12:00:00Z',
    source: { kind: 'runtime', name: 'test' },
    ...overrides
  } as CanonicalEvent;
}

describe('summarizeEvent', () => {
  it('summarizes run lifecycle events', () => {
    expect(summarizeEvent(evt({ type: 'run.created', data: {}, subject: { kind: 'run', id: 'abc' } }))).toBe(
      'Run created · run:abc'
    );
    expect(summarizeEvent(evt({ type: 'run.failed', data: {} }))).toBe('Run failed');
  });

  it('summarizes run suspend/resume lifecycle events', () => {
    expect(summarizeEvent(evt({ type: 'run.suspended', data: {} }))).toBe('Run suspended');
    expect(summarizeEvent(evt({ type: 'run.resumed', data: {} }))).toBe('Run resumed');
  });

  it('summarizes the real control-plane session vocabulary', () => {
    expect(summarizeEvent(evt({ type: 'session.bound', data: { sessionId: 'sess-abcdef123456' } }))).toBe(
      'Session bound · sess-abc…'
    );
    expect(summarizeEvent(evt({ type: 'session.stream.opened', data: {} }))).toBe('Session stream opened');
    expect(summarizeEvent(evt({ type: 'session.state.changed', data: { state: 'SESSION_STATE_SUSPENDED' } }))).toBe(
      'Session → SUSPENDED'
    );
    expect(
      summarizeEvent(
        evt({ type: 'session.state.changed', data: { state: 'SESSION_STATE_CANCELLED', sessionId: 'sess-abcdef12' } })
      )
    ).toBe('Session → CANCELLED · sess-abc…');
  });

  it('still summarizes legacy session events', () => {
    expect(summarizeEvent(evt({ type: 'session.resolved', data: {} }))).toBe('Session resolved');
  });

  it('summarizes participant progress with percentage and message', () => {
    const out = summarizeEvent(
      evt({
        type: 'participant.progress',
        data: { participantId: 'risk-agent', percentage: 75, message: 'Evaluating signals' }
      })
    );
    expect(out).toBe('risk-agent (75%) · Evaluating signals');
  });

  it('summarizes signal.emitted with name, severity, and confidence', () => {
    const out = summarizeEvent(
      evt({
        type: 'signal.emitted',
        data: { name: 'anomaly', severity: 'high', confidence: 0.87 }
      })
    );
    expect(out).toBe('anomaly emitted (high) · conf 87%');
  });

  it('summarizes proposal.submitted with participant and action', () => {
    const out = summarizeEvent(
      evt({
        type: 'proposal.submitted',
        data: {
          participantId: 'fraud-agent',
          action: 'decline',
          confidence: 0.72,
          proposalId: 'abcdef123456'
        }
      })
    );
    expect(out).toContain('proposal submitted');
    expect(out).toContain('fraud-agent');
    expect(out).toContain('→ DECLINE');
    expect(out).toContain('conf 72%');
    expect(out).toContain('#abcdef12');
  });

  it('summarizes decision.finalized with action and confidence', () => {
    expect(summarizeEvent(evt({ type: 'decision.finalized', data: { action: 'approve', confidence: 0.9 } }))).toBe(
      'Decision finalized → APPROVE · conf 90%'
    );
  });

  it('summarizes policy lifecycle with outcome', () => {
    expect(summarizeEvent(evt({ type: 'policy.resolved', data: { outcomePositive: true } }))).toContain('positive');
    expect(summarizeEvent(evt({ type: 'policy.resolved', data: { outcomePositive: false } }))).toContain('negative');
    expect(summarizeEvent(evt({ type: 'policy.resolved', data: { outcomePositive: null } }))).toContain('no outcome');
  });

  it('summarizes message.sent with from/to and messageType', () => {
    const out = summarizeEvent(
      evt({
        type: 'message.sent',
        data: { from: 'fraud-agent', to: ['risk-agent'], messageType: 'recommendation' }
      })
    );
    expect(out).toBe('sent · fraud-agent → risk-agent · recommendation');
  });

  it('summarizes tool.call.completed with name, participant, duration', () => {
    expect(
      summarizeEvent(
        evt({
          type: 'tool.call.completed',
          data: { name: 'lookupCustomer', participantId: 'fraud-agent', durationMs: 340 }
        })
      )
    ).toBe('lookupCustomer completed · fraud-agent · 340ms');
  });

  it('summarizes llm.call.completed with model and token counts', () => {
    const out = summarizeEvent(
      evt({
        type: 'llm.call.completed',
        data: {
          participantId: 'risk-agent',
          model: 'claude-sonnet-4-6',
          promptTokens: 2048,
          completionTokens: 312,
          latencyMs: 870
        }
      })
    );
    expect(out).toContain('LLM call');
    expect(out).toContain('risk-agent');
    expect(out).toContain('claude-sonnet-4-6');
    expect(out).toContain('2048→312');
    expect(out).toContain('870ms');
  });

  it('falls back to type + subject + first short string for unknown types', () => {
    expect(
      summarizeEvent(
        evt({
          type: 'custom.unknown.event',
          subject: { kind: 'agent', id: 'risk' },
          data: { hint: 'short-string' }
        })
      )
    ).toBe('custom.unknown.event · agent:risk · short-string');
  });

  it('skips long strings in the fallback path', () => {
    const long = 'x'.repeat(200);
    expect(summarizeEvent(evt({ type: 'custom.unknown', data: { noise: long } }))).toBe('custom.unknown');
  });
});

describe('formatEventSubject', () => {
  it('renders kind:id for a populated subject', () => {
    expect(formatEventSubject(evt({ type: 'x', data: {}, subject: { kind: 'agent', id: 'risk' } }))).toBe('agent:risk');
  });

  it('returns an em dash for an absent subject', () => {
    expect(formatEventSubject(evt({ type: 'x', data: {} }))).toBe('—');
  });

  it('returns an em dash for an empty id rather than a dangling colon', () => {
    // The control plane's inline stream-error path emits exactly this shape. Both call sites used to
    // render it as `message:`.
    expect(formatEventSubject(evt({ type: 'x', data: {}, subject: { kind: 'message', id: '' } }))).toBe('—');
  });
});

describe('summarizeEvent — policy.denied reasons', () => {
  it('surfaces reasons carried only in data.decodedPayload.reasons', () => {
    const out = summarizeEvent(
      evt({
        type: 'policy.denied',
        data: { decodedPayload: { decision: 'deny', reasons: ['quorum not met', 'confidence below floor'] } }
      })
    );
    expect(out).toContain('quorum not met');
    expect(out).toContain('confidence below floor');
  });

  it('still produces a non-empty label with no reasons, commitmentId or decision', () => {
    expect(summarizeEvent(evt({ type: 'policy.denied', data: {} }))).toBe('Policy denied');
  });

  it('ignores a malformed decodedPayload instead of throwing', () => {
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decodedPayload: 'nope' } }))).toBe('Policy denied');
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decodedPayload: { reasons: 'nope' } } }))).toBe(
      'Policy denied'
    );
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decodedPayload: { reasons: [1, '', '  '] } } }))).toBe(
      'Policy denied'
    );
  });

  it('never echoes the redundant "deny" decision, in either payload shape', () => {
    // The previous version of this test put `decision` under `decodedPayload` while the code read the
    // top level, so it passed against the very mutant it was written to catch. Both shapes asserted
    // now, and neither may add anything to the label.
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decodedPayload: { decision: 'deny' } } }))).toBe(
      'Policy denied'
    );
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decision: 'deny' } }))).toBe('Policy denied');
  });

  it('renders the commitment id from the nested envelope shape, not just the demo shape', () => {
    // The envelope deny path nests it (event-normalizer.service.ts:369). Reading only the top level
    // meant `#id` never appeared on a real denial.
    expect(
      summarizeEvent(
        evt({ type: 'policy.denied', data: { decodedPayload: { commitmentId: 'c-42', reasons: ['quorum'] } } })
      )
    ).toBe('Policy denied · #c-42 · quorum');
    // policyId is the documented fallback when commitmentId is absent.
    expect(summarizeEvent(evt({ type: 'policy.denied', data: { decodedPayload: { policyId: 'p-7' } } }))).toBe(
      'Policy denied · #p-7'
    );
  });

  it('prefers nested reasons over the singular top-level reason', () => {
    // Precedence is unobservable against real traffic (the CP sets only the nested form, demo only the
    // singular), but pin it so a future edit cannot silently reorder them.
    expect(
      summarizeEvent(
        evt({ type: 'policy.denied', data: { reason: 'ignored', decodedPayload: { reasons: ['authoritative'] } } })
      )
    ).toBe('Policy denied · authoritative');
  });

  it('surfaces the singular top-level reason that demo data uses', () => {
    // `mock-data.ts` `evt-ops-policy-denied` carries `data.reason`, not `decodedPayload.reasons`.
    expect(
      summarizeEvent(
        evt({
          type: 'policy.denied',
          data: { reason: 'Supermajority threshold not met', commitmentId: 'commitment-ops-002' }
        })
      )
    ).toBe('Policy denied · #commitment-ops-002 · Supermajority threshold not met');
  });

  // Regression guard for the shared-case split: policy.denied was pulled out of a block covering
  // four types, so the other three must keep the same fields, order and separators.
  //
  // One deliberate difference: the outcome suffix used to render a doubled separator
  // (`Policy commitment evaluated · · positive`) because it carried its own ` · ` and was then
  // `.trim()`ed, leaving a bare bullet for the join to separate again. Fixed here, asserted below.
  it('keeps the other three policy labels intact across the split', () => {
    expect(summarizeEvent(evt({ type: 'policy.resolved', data: { commitmentId: 'c1', decision: 'accept' } }))).toBe(
      'Policy resolved · #c1 · → accept'
    );
    expect(summarizeEvent(evt({ type: 'policy.violated', data: { commitmentId: 'c2' } }))).toBe(
      'Policy violated · #c2'
    );
    expect(summarizeEvent(evt({ type: 'policy.commitment.evaluated', data: { outcomePositive: true } }))).toBe(
      'Policy commitment evaluated · positive'
    );
    expect(summarizeEvent(evt({ type: 'policy.commitment.evaluated', data: { outcomePositive: false } }))).toBe(
      'Policy commitment evaluated · negative'
    );
    expect(summarizeEvent(evt({ type: 'policy.commitment.evaluated', data: { outcomePositive: null } }))).toBe(
      'Policy commitment evaluated · no outcome'
    );
  });

  it('never renders a doubled separator before the outcome', () => {
    for (const outcomePositive of [true, false, null]) {
      expect(summarizeEvent(evt({ type: 'policy.resolved', data: { outcomePositive } }))).not.toContain('· ·');
    }
  });
});

describe('summarizeEvent — session.stream.gap', () => {
  it('returns a gap-specific label, not the generic fallback', () => {
    const out = summarizeEvent(evt({ type: 'session.stream.gap', data: {} }));
    expect(out).toContain('gap');
    expect(out).not.toBe('session.stream.gap');
  });

  it('uses the real control-plane payload fields, not invented ones', () => {
    // Verified against the emit site: `{ requestedAfter, detail }`
    // (macp-control-plane/src/runs/stream-consumer.service.ts:312-315). An earlier version read
    // `reason`/`message`, which the control plane never sends — the suffix could never have fired.
    const out = summarizeEvent(
      evt({
        type: 'session.stream.gap',
        data: {
          requestedAfter: 42,
          detail: 'session history before the resume point was compacted; some envelope-level events may be missing'
        }
      })
    );
    expect(out).toContain('compacted');
    expect(out).toContain('42');
  });

  it('degrades to the bare label when the payload is empty', () => {
    expect(summarizeEvent(evt({ type: 'session.stream.gap', data: {} }))).toBe('Stream history gap');
  });
});

describe('mergeEventStreams', () => {
  const fetched = [evt({ type: 'a', data: {} }), evt({ type: 'b', data: {} })].map((e, i) => ({
    ...e,
    id: `f${i}`,
    seq: i + 1
  }));

  it('keeps the fetched history once live events start arriving', () => {
    // The regression this exists for: the rail used to collapse to just the live event.
    const live = [{ ...fetched[0], id: 'live-1', seq: 3 }];
    expect(mergeEventStreams(fetched, live).map((e) => e.id)).toEqual(['f0', 'f1', 'live-1']);
  });

  it('returns the fetched list untouched when nothing is live yet', () => {
    expect(mergeEventStreams(fetched, [])).toBe(fetched);
  });

  it('returns the live list when there is no fetched history', () => {
    const live = [{ ...fetched[0], id: 'live-1', seq: 3 }];
    expect(mergeEventStreams([], live)).toBe(live);
  });

  it('dedups the replay overlap on id, preferring the live copy', () => {
    const live = [{ ...fetched[1], data: { fresher: true } }];
    const merged = mergeEventStreams(fetched, live);
    expect(merged).toHaveLength(2);
    expect(merged[1].data).toEqual({ fresher: true });
  });

  it('orders by seq, not by arrival', () => {
    const live = [
      { ...fetched[0], id: 'late', seq: 9 },
      { ...fetched[0], id: 'early', seq: 4 }
    ];
    expect(mergeEventStreams(fetched, live).map((e) => e.seq)).toEqual([1, 2, 4, 9]);
  });
});
