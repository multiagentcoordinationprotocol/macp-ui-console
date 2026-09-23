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

---

## "Agents are live" is asserted, not checked, on the bootstrap result

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** 7
- **Assumed:** The new no-registration banner opens with "Agents are live, but the Example Service did
  not register this run." Phase 7 made every *other* clause of that banner checkable, but this one is
  inferred from `sessionId` being present rather than verified. It is not always true: the playground's
  process host can return `status: 'resolved'` with `processAttached: false` on a manifest-validation
  failure **without throwing**, so `/examples/run` still answers 201 with a `sessionId` for an agent
  that never launched. In that case the console says agents are live when none are.
- **Chose:** Ship the banner as written and record the gap. The page already holds `hostedAgents`, but
  it is typed `Array<Record<string, unknown>>` (`lib/types.ts`), so reading `processAttached` means
  modelling the upstream host result — a type change with its own demo-parity and test surface, and
  outside a phase already at its three-round verification cap. The failure mode it would catch is a
  packaging error in an example agent, which is loud by other means.
- **Alternatives:** (1) Model `hostedAgents` and gate the headline on `processAttached` — the right fix,
  deferred rather than rejected. (2) Soften the copy to "the bootstrap reported agents as started" —
  rejected for now: vaguer for the common case, and it hides the defect instead of fixing it.
- **Blast radius if wrong:** One misleading sentence in a warning banner, on a path that is already the
  unhappy one. No navigation, data, or state depends on it — the redirect is gated on `controlPlaneRun`,
  not on this claim. Cost to reverse: a type change plus one condition.
- **Status:** UNCONFIRMED

---

## The runtime v0.8.0 pin is verified by pairing evidence, not by a console `local:up` boot

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** 9
- **Assumed:** Phase 9's acceptance criteria 4 and 5 are a manual boot — `npm run local:up` comes up
  healthy, the control plane's `/readyz` reports `runtime.ok === true`, and a scenario launched from
  `/runs/new` reaches a terminal state. **AC4 as written — this repo's `local:up` — was not run at all.** What is
  verified is narrower and should be named precisely: **image-pair compatibility**. Not through this
  repo's stack, but through an already-running `macp-playground` stack was found using the **identical** image
  pair this phase pins (`macp-runtime:f97fd15` behind `macp-control-plane:0.8.0`), and its `/readyz`
  returns `{"ok":true,"runtime":{"ok":true,...,"detail":"connected to runtime:50051"},...}`. The image
  itself was confirmed pullable from GHCR by digest, `0.8.0`/`v0.8.0` were confirmed **not** to be
  published tags, and the digest's `org.opencontainers.image.revision` resolves to the runtime commit
  tagged `macp-runtime-v0.8.0`. **AC5 was not verified at all.**

  Three of the plan's flagged risks were closed by independent inspection of the image rather than by
  booting it: this file's `bash`-based runtime healthcheck works (the image is Debian bookworm with
  `/usr/bin/bash`, and two services `depends_on` it as `service_healthy`, so a missing shell would have
  hung `--wait`); all eight `MACP_*` runtime env vars this file sets still exist at `f97fd15`; and the
  `MACP_AUTH_TOKENS_JSON` payload still deserialises field-for-field against
  `crates/macp-auth/src/security.rs`. That matters because a sibling var, `MACP_ALLOW_DEV_SENDER_HEADER`,
  *was* removed upstream in this range. The residual untested delta is one line:
  `MACP_BIND_ADDR: "[::]:50051"` here versus the playground's `0.0.0.0:50051`.
- **Chose:** Ship the pin on that evidence and record the gap. The console's own stack could not be
  brought up here for two reasons, neither caused by this change: (1) `docker-compose.local.yml` sets
  `build: !reset null` and expects images pre-built and tagged `macp-ui-console-control-plane:latest` /
  `macp-ui-console-examples-service:latest`, and building them from source needs `NODE_AUTH_TOKEN` for
  GitHub Packages, which is not available in this environment — the playground build fails at
  `npm ci` on exactly that; (2) ports 3000, 3001, 3200, 50051 and 9464 are held by the running sibling
  stack, which is not mine to stop. Tearing down another repo's running services to satisfy a checklist
  item would be the wrong trade.
- **Alternatives:** (1) Stop the sibling stack and boot this one — rejected; it is someone else's
  running environment. (2) Claim AC4/AC5 as met — rejected; the boot did not happen here and saying so
  would be false. (3) Obtain `NODE_AUTH_TOKEN` and build from source — not available to this session.
- **Blast radius if wrong:** The pin is a one-line default with a documented `MACP_RUNTIME_IMAGE`
  override, and no application code depends on it. If v0.8.0 needed env the old image did not, the
  failure is a local boot failure, reverted instantly by the override. The corroboration is strong:
  both sibling repos pin this exact tag in CI, and a live stack on this machine is running it healthily
  against the same control-plane version.
- **Also found — and it is worse than a missing flag.** `docker-compose.local.yml:11,16,20` defaults to
  `macp-ui-console-control-plane:latest` / `macp-ui-console-examples-service:latest`, but
  `docker compose build` on this project produces `<project>-<service>` — i.e.
  **`macp-ui-console-macp-control-plane:latest`**, one `macp-` different. (That image is in the local
  cache right now under the build-derived name.) Combined with `build: !reset null`, compose can only
  *pull* a name nothing ever produces, which is the real source of the misleading
  `pull access denied for macp-ui-console-control-plane`. **So `local:up` cannot succeed even with a
  valid `NODE_AUTH_TOKEN` and free ports** — the missing `--build` is a symptom, not the cause. Left
  alone here because `docker-compose.local.yml` and `scripts/local-stack.sh` are outside this phase's
  file list **and because the fix is unverifiable in this environment** — the name can be shown to
  match, but not that the stack then boots. Strong candidate for its own change.
- **Status:** UNCONFIRMED
