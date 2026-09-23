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

---

## `CommitmentAuthority` is a compile-time guard only — real-mode policy data is never narrowed

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** 1
- **Assumed:** Correcting the union and adding a `Record<CommitmentAuthority, true>` exhaustiveness
  anchor makes the *type* impossible to get wrong again by an editor. It does **not** make the console
  detect a backend that emits a different value. Real policies never pass through `PolicyDefinition`:
  they arrive as `RuntimePolicyDescriptor.rules: Record<string, unknown>` (`lib/types.ts`) and are
  rendered opaquely through `JsonViewer` at `app/policies/[policyId]/page.tsx`. There is no parse,
  narrow, or validate step anywhere in the real-mode path.
- **Chose:** Leave it that way for this phase. Phase 1's stated scope is the wire *value*, and adding
  runtime validation of policy rules would be a new feature with its own error surface, its own demo
  parity work, and its own failure mode (rejecting a policy the runtime happily accepted). The anchor
  plus the mirrored demo entry is the full extent of what the plan asked for.
- **Alternatives:** (1) Parse `RuntimePolicyDescriptor.rules` with a schema validator and surface a
  "policy rules not recognized" state — rejected as out of scope and a larger change than the bug being
  fixed. (2) Narrow `rules` from `Record<string, unknown>` to `PolicyDefinition['rules']` — rejected:
  it would be a type assertion about a backend, not a proof, and would silently mis-describe any policy
  shape the console has not seen.
- **Blast radius if wrong:** A control plane emitting an unknown `authority` value renders as raw JSON
  in the policy detail panel rather than being flagged. No crash, no data loss, no incorrect
  enforcement (the console never enforces policy — it displays it). Cost to reverse: none; this is an
  absence of behaviour, not a behaviour.
- **Status:** UNCONFIRMED
