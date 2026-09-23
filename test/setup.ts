import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

/**
 * `localStorage` / `sessionStorage` polyfill for the jsdom test environment.
 *
 * Vitest 4 populates the test global from a fixed key list which does **not** include `localStorage`
 * or `sessionStorage`, and it rebinds `window` to `globalThis`, so jsdom's own `Storage` instances
 * are unreachable from a test. Any module that resolves the bare `localStorage` identifier at import
 * time therefore sees `undefined` — which is how Zustand's `persist` middleware
 * (`createJSONStorage(() => localStorage)`) fails with `Cannot read properties of undefined
 * (reading 'setItem')` in `lib/stores/*`.
 *
 * This installs a spec-shaped in-memory `Storage` and clears it between tests so persistence state
 * cannot leak across cases. (`vitest.config.ts` additionally gives jsdom a real document origin —
 * jsdom refuses storage on an opaque origin such as the default `about:blank`, so that is the
 * prerequisite for ever using its native implementation instead of this one.)
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.store.has(String(key)) ? (this.store.get(String(key)) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.store.delete(String(key));
  }

  clear(): void {
    this.store.clear();
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): Storage {
  const existing = (globalThis as Record<string, unknown>)[name];
  if (existing && typeof (existing as Storage).setItem === 'function') {
    return existing as Storage;
  }
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: storage,
    writable: true,
    configurable: true
  });
  return storage;
}

const localStorageRef = installStorage('localStorage');
const sessionStorageRef = installStorage('sessionStorage');

afterEach(() => {
  localStorageRef.clear();
  sessionStorageRef.clear();
});
