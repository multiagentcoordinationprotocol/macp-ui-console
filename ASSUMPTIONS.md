# ASSUMPTIONS

Logged during `/implement`. Each entry is settled later by `/reconcile`.

---

## Test environment: in-memory `localStorage` polyfill rather than jsdom's native `Storage`

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** pre-Phase-1 (test-infrastructure repair; blocking every phase gate)
- **Assumed:** `lib/stores/preferences-store.test.ts` was failing on `main` before any of this plan's
  work — 8 tests, `TypeError: Cannot read properties of undefined (reading 'setItem')` from
  `zustand/middleware`. Verified by stashing and re-running on `main`. Root cause: Vitest 4 populates
  the test global from a fixed key list that does **not** include `localStorage`/`sessionStorage`, and
  it rebinds `window` to `globalThis`, so jsdom's own `Storage` is unreachable from a test. A module
  resolving the bare `localStorage` identifier at import time therefore sees `undefined`.
- **Chose:** (a) `vitest.config.ts` gives jsdom a real document origin
  (`environmentOptions.jsdom.url = 'http://localhost:3000'`) — jsdom refuses storage on an opaque
  origin like the default `about:blank`, so this is the prerequisite for ever using its native
  implementation; (b) `test/setup.ts` installs a spec-shaped in-memory `Storage` on `globalThis` and
  clears it in `afterEach`, so persistence state cannot leak between tests. Result: 396/396 green.
  Fixing this was unavoidable — §1 forbids proceeding on a red build, and every one of the 11 phases
  needs a green gate.
- **Alternatives:** (1) Leave the suite red and treat 8 failures as baseline — rejected: it makes every
  phase gate meaningless and hides real regressions. (2) Change `lib/stores/*.ts` to guard
  `typeof localStorage === 'undefined'` — rejected: it edits production code to work around a test
  harness, and the guard would silently disable persistence if it ever misfired in a browser.
  (3) Pin Vitest back to 3.x — rejected: a dependency downgrade with a far larger blast radius than a
  six-line test shim, to work around a deliberate upstream change.
- **Blast radius if wrong:** Test-only. The polyfill is not spec-perfect (no `storage` events, no quota
  errors, no cross-origin partitioning), so a future test that asserts *browser* storage semantics
  rather than "a store round-trips its state" could pass here and fail in a real browser. No production
  code path is affected. Reversing is deleting two files' worth of additions.
- **Status:** UNCONFIRMED
