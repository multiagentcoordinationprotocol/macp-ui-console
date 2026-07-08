import { describe, it, expect } from 'vitest';
import { looksLikeId } from './breadcrumbs';

describe('looksLikeId', () => {
  it('matches UUID-style run ids', () => {
    expect(looksLikeId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(looksLikeId('deadbeefdeadbeef')).toBe(true);
  });

  it('matches 36-char base64url session ids (mixed case, `_`, `-`)', () => {
    // runId === sessionId for discovered sessions, so a base64url session id can be a
    // route segment. These must be truncated, not title-cased into a nonsense label.
    expect(looksLikeId('aB3-_xY9zQ12aB3-_xY9zQ12aB3-_xY9zQ12')).toBe(true);
    expect(looksLikeId('Gz09_-Gz09_-Gz09_-Gz09_')).toBe(true);
  });

  it('does not treat short human-readable segments as ids', () => {
    expect(looksLikeId('runs')).toBe(false);
    expect(looksLikeId('new')).toBe(false);
    expect(looksLikeId('compare')).toBe(false);
  });
});
