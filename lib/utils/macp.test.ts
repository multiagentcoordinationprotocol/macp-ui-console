import { describe, it, expect, vi } from 'vitest';
import { parseScenarioRef, getScenarioRefFromRun, getRunDurationMs, unique, isImplicitAccept } from './macp';
import type { RunRecord } from '@/lib/types';

describe('parseScenarioRef', () => {
  it('returns undefined fields for null input', () => {
    const result = parseScenarioRef(null);
    expect(result.packSlug).toBeUndefined();
    expect(result.scenarioSlug).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it('returns undefined fields for undefined input', () => {
    const result = parseScenarioRef(undefined);
    expect(result.packSlug).toBeUndefined();
    expect(result.scenarioSlug).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it('parses pack/scenario@version format', () => {
    const result = parseScenarioRef('fraud/transaction-check@1.0.0');
    expect(result.packSlug).toBe('fraud');
    expect(result.scenarioSlug).toBe('transaction-check');
    expect(result.version).toBe('1.0.0');
  });

  it('handles scenario slugs with slashes', () => {
    const result = parseScenarioRef('trust/deep/nested/scenario@2.0');
    expect(result.packSlug).toBe('trust');
    expect(result.scenarioSlug).toBe('deep/nested/scenario');
    expect(result.version).toBe('2.0');
  });

  it('handles missing version', () => {
    const result = parseScenarioRef('fraud/check');
    expect(result.packSlug).toBe('fraud');
    expect(result.scenarioSlug).toBe('check');
    expect(result.version).toBeUndefined();
  });
});

describe('getScenarioRefFromRun', () => {
  it('returns metadata.scenarioRef when available', () => {
    const run = { metadata: { scenarioRef: 'fraud/check@1.0' } } as unknown as RunRecord;
    expect(getScenarioRefFromRun(run)).toBe('fraud/check@1.0');
  });

  it('falls back to source.ref', () => {
    const run = { source: { ref: 'trust/verify@2.0' } } as unknown as RunRecord;
    expect(getScenarioRefFromRun(run)).toBe('trust/verify@2.0');
  });

  it('returns empty string for undefined run', () => {
    expect(getScenarioRefFromRun(undefined)).toBe('');
    expect(getScenarioRefFromRun(null)).toBe('');
  });
});

describe('getRunDurationMs', () => {
  it('returns 0 for undefined run', () => {
    expect(getRunDurationMs(undefined)).toBe(0);
  });

  it('returns 0 when startedAt is missing', () => {
    expect(getRunDurationMs({} as RunRecord)).toBe(0);
  });

  it('calculates duration from startedAt to endedAt', () => {
    const run = {
      startedAt: '2025-01-01T00:00:00Z',
      endedAt: '2025-01-01T00:01:00Z'
    } as RunRecord;
    expect(getRunDurationMs(run)).toBe(60000);
  });

  it('uses Date.now() when endedAt is missing', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const run = {
      startedAt: new Date(now - 5000).toISOString()
    } as RunRecord;
    expect(getRunDurationMs(run)).toBe(5000);
    vi.restoreAllMocks();
  });

  it('returns 0 for negative duration', () => {
    const run = {
      startedAt: '2025-01-01T01:00:00Z',
      endedAt: '2025-01-01T00:00:00Z'
    } as RunRecord;
    expect(getRunDurationMs(run)).toBe(0);
  });
});

describe('unique', () => {
  it('removes duplicates from array', () => {
    expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  });

  it('returns empty array for empty input', () => {
    expect(unique([])).toEqual([]);
  });

  it('handles string arrays', () => {
    expect(unique(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('isImplicitAccept', () => {
  it('detects the decodedPayload.implicit flag', () => {
    expect(isImplicitAccept({ data: { decodedPayload: { implicit: true } } })).toBe(true);
  });

  it('tolerates snake_case and top-level flag spellings', () => {
    expect(isImplicitAccept({ data: { decoded_payload: { implicit_accept: true } } })).toBe(true);
    expect(isImplicitAccept({ data: { implicit: true } })).toBe(true);
    expect(isImplicitAccept({ data: { implicitAccept: true } })).toBe(true);
  });

  it('detects the implicit-accept: message/event id prefix', () => {
    expect(isImplicitAccept({ data: { messageId: 'implicit-accept:handoff-42' } })).toBe(true);
    expect(isImplicitAccept({ id: 'implicit-accept:handoff-42', data: {} })).toBe(true);
  });

  it('returns false for an explicit accept sent by a participant', () => {
    expect(isImplicitAccept({ data: { sender: 'risk-agent', action: 'allow', implicit: false } })).toBe(false);
    expect(isImplicitAccept({ id: 'evt-7', data: { messageId: 'msg-123' } })).toBe(false);
    expect(isImplicitAccept({ data: {} })).toBe(false);
  });
});
