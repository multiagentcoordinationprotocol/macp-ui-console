import { describe, it, expect } from 'vitest';
import { summarizeEvent } from './events';
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
