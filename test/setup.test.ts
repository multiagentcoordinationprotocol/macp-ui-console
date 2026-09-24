import { describe, it, expect } from 'vitest';

/**
 * Pins the storage wiring in `test/setup.ts`.
 *
 * The previous setup installed a hand-rolled in-memory `Storage` for `localStorage` but silently
 * left `sessionStorage` pointing at Node's *process-wide* experimental Web Storage — outside
 * jsdom's per-file isolation, and a cross-file leak waiting for the `afterEach` to be removed.
 * Nothing caught that, because nothing asserted where the globals actually pointed. These do.
 */
/** jsdom's window carries the `Storage` constructor; the DOM lib's `Window` type does not declare it. */
type JsdomWindow = Window & { Storage: typeof Storage };

describe('test environment storage', () => {
  const jsdomWindow = (globalThis as unknown as { jsdom?: { window: JsdomWindow } }).jsdom?.window;

  it('exposes jsdom as the environment, not a bare Node global', () => {
    expect(jsdomWindow).toBeDefined();
  });

  it('binds both storages to jsdom, not to Node process-wide storage', () => {
    expect(globalThis.localStorage).toBe(jsdomWindow?.localStorage);
    expect(globalThis.sessionStorage).toBe(jsdomWindow?.sessionStorage);
  });

  it('uses the real Storage implementation rather than a stand-in', () => {
    // A hand-rolled polyfill would not be an instance of jsdom's own Storage constructor.
    expect(globalThis.localStorage).toBeInstanceOf(jsdomWindow!.Storage);
    expect(globalThis.sessionStorage).toBeInstanceOf(jsdomWindow!.Storage);
  });

  it('round-trips and clears', () => {
    localStorage.setItem('k', 'v');
    sessionStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(sessionStorage.getItem('k')).toBe('v');
    expect(localStorage.length).toBe(1);
  });

  it('is empty at the start of each test, proving the afterEach cleanup runs', () => {
    // The previous case wrote 'k' to both stores and did not clean up itself.
    expect(localStorage.getItem('k')).toBeNull();
    expect(sessionStorage.getItem('k')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
