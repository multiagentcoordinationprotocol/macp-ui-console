import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

/**
 * Re-expose jsdom's native `localStorage` / `sessionStorage` on the test global.
 *
 * Vitest copies jsdom's window properties onto `globalThis`, but its `getWindowKeys` filter skips
 * any key that already exists on the Node global unless that key is on Vitest's own allow-list —
 * and `localStorage`/`sessionStorage` are not on it. Node >= 22 defines both as globals, so the
 * copy is skipped, and `globalThis.localStorage` is Node's experimental Web Storage, which is
 * `undefined` unless the process was started with `--localstorage-file`. Vitest also rebinds
 * `window` to `globalThis`, so `window.localStorage` resolves to that same `undefined`. That is how
 * Zustand's `persist` middleware (`createJSONStorage(() => localStorage)`) fails with
 * `Cannot read properties of undefined (reading 'setItem')` in `lib/stores/*`.
 *
 * Pointing the globals at jsdom's own `Storage` instances gives tests the real browser
 * implementation — storage events, quota errors, origin partitioning — instead of a stand-in, and
 * keeps storage inside jsdom's per-file isolation rather than Node's process-wide store. Requires a
 * non-opaque document origin; see `environmentOptions.jsdom.url` in `vitest.config.ts`.
 *
 * `sessionStorage` belongs in the loop even though nothing uses it yet: left alone, the global
 * resolves to Node's *process-wide* store, which sits outside jsdom's per-file isolation.
 */
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom?.window;

if (jsdomWindow) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      value: jsdomWindow[name],
      writable: true,
      configurable: true
    });
  }
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
