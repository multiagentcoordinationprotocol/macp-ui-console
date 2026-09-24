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
- **Resolved (2026-09-23) — CHANGED.** The polyfill was necessary but not the best available option, and two
  of the entry's own claims were wrong. (a) The root cause is not Vitest's key list alone: that filter
  skips a key only when it already exists on the Node global, and **Node >= 22 defines
  `localStorage`/`sessionStorage` itself** as experimental Web Storage that returns `undefined`
  without `--localstorage-file`. (b) `environmentOptions.jsdom.url` was a **no-op** — Vitest's jsdom
  environment already defaults to that exact string — so the comment calling it the fix was false.
  (c) Worse, `installStorage` never replaced `sessionStorage` at all: Node's version returns a
  working object, so the guard handed it back, silently binding tests to a **process-wide** store
  outside jsdom's per-file isolation. Replaced the hand-rolled `Storage` with a bridge to jsdom's
  native instances (`test/setup.ts`), which closes the spec-fidelity gap this entry named as its only
  risk, fixes the `sessionStorage` leak, and drops the per-run `ExperimentalWarning`. The `jsdom.url`
  pin is kept — under the native bridge a non-opaque origin is a genuine prerequisite — with an
  honest comment. Added `test/setup.test.ts`, which fails 2/5 against the exact previous bug.
- **Status:** RESOLVED (2026-09-23) — superseded by the change above

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
- **Reconciled (2026-09-23) — CONFIRMED, with two amendments.** The core claim verified and is stronger than
  written: `PolicyDefinition` has exactly two consumers in the repo, both demo (`MOCK_POLICY_DEFINITIONS`
  and its test). The entry's own hedge about the registration body is also wrong — that form is a
  free-text JSON textarea typed `Record<string, unknown>`, so `PolicyDefinition` is demo-only, full
  stop. `grep -rn "authority"` hits only `lib/types.ts` and the mock data; no component reads it.
  The singular `designated_role` is confirmed correct against four independent sources plus the
  canonical JSON schema. **Amendment 1:** the exhaustiveness anchor is at `lib/data/mock-data.test.ts:36`,
  not `lib/types.ts`, and it is load-bearing — verified empirically (adding a member gives TS2741,
  removing one TS2353), reached by `npm run typecheck` in CI. It is only the *annotation site* that
  makes it work; hoisting the literal off it silently kills the gate. **Amendment 2:** the blast
  radius understated one thing — nothing anywhere in the stack enum-checks `commitment.authority`
  (the runtime hand-checks only the `designated_role` -> non-empty-roles pairing), so an unknown
  value is registrable and the runtime's `_ =>` arm silently treats it as `initiator_only`. That is
  an upstream validation gap, out of scope here, and it does not change the console's behaviour.
  A display-only "unrecognized authority" badge was considered and **not** taken: it is cheap in code
  but unreachable against current mocks, and making it reachable needs a deliberately-invalid fixture
  on the user-visible `/policies` catalog — a product decision, not a type fix.
- **Status:** CONFIRMED (2026-09-23)

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
- **Resolved (2026-09-23) — CHANGED.** The premise verified TRUE and reaches further than the entry said.
  On manifest-validation failure the playground's host returns `status: 'resolved'` with
  `processAttached: false` and **does not throw**
  (`process-example-agent-host.provider.ts:132-145`); the caller rethrows only a *rejected* promise
  (`example-run.service.ts:76-79`), so 201 + `sessionId` + no `controlPlaneRun` + zero agents
  attached is reachable. A second path was missed entirely: a `mode: 'mock' | 'deferred'` agent
  returns `processAttached: false` **by design**, so the sentence would be false on a perfectly
  healthy run once such an agent is added. Decisively, the deferred "right fix" would not have fixed
  it either — `processAttached: true` is set immediately after spawn, alongside
  `healthStatus: 'starting'`, so it means "a process was spawned", never "an agent is live".
  Took the previously-rejected option instead: reworded to "The Example Service returned a session
  but did not register this run." Both clauses now mirror the render gate exactly, which is the
  standard every other sentence in this banner already held itself to. No type change, no
  demo-parity work, no new failure mode; the rationale is pinned in a comment at the call site so it
  is not "improved" back. The upstream defect (201 for an agent that never attached) is a playground
  issue and is listed for filing — **awaiting explicit go-ahead**, per the cross-repo rule.
- **Status:** RESOLVED (2026-09-23) — superseded by the reword above

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
- **Reconciled (2026-09-23) — CONFIRMED, and the gap is closed: the stack was actually booted.** Both
  original blockers had lifted (the sibling stack was gone; every required port was free), so the
  full stack was brought up with `docker compose -f docker-compose.e2e.yml -f docker-compose.local.yml
  up -d --wait` using only documented env overrides, no file edits. Every service reported healthy.
  **AC4 is now genuinely met**: `/readyz` returned `ok: true` with
  `runtime: { ok: true, runtimeKind: "rust", detail: "connected to runtime:50051" }` and
  `circuitBreaker: CLOSED`. The pin itself is confirmed four ways: `f97fd15…` is exactly
  `git rev-list -n1 macp-runtime-v0.8.0`, the commit is "chore: release v0.8.0 (#172)", the image's
  `org.opencontainers.image.revision` label matches, and the container logs
  `macp-runtime v0.8.0 listening`. The three risks previously closed by inspection are now closed by
  execution — the boot logged `static bearer resolver initialized count=1`, so `MACP_AUTH_TOKENS_JSON`
  really does deserialise, and all eight `MACP_*` vars were consumed.
  The `MACP_BIND_ADDR` delta was measured, not argued: `bindv6only=0`, a `::` dual-stack listener,
  the exact compose healthcheck exiting 0, and a peer container connecting over IPv4 — **no live
  risk**. It was still changed to `0.0.0.0:50051`, as cleanup rather than mitigation: it matches the
  image's own default and the sibling stacks, and the only environment it breaks is one with IPv6
  disabled, where it would take down the two services that `depend_on` the runtime.
  **AC5**: a scenario launched through the same path `/runs/new` uses reached a terminal state, but
  `failed` — and *not* because of the pin. See the separate GetSession-race item below.
- **Status:** CONFIRMED (2026-09-23)

---

## macp-proto 0.1.9 → 0.1.10 was not audited for `decodedPayload` shape changes

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** 10
- **Assumed:** That the proto bump the control plane took in this range (`macp-proto` `0.1.9` → `0.1.10`,
  confirmed as the CP's current dependency) introduced no change to the `event.data.decodedPayload`
  shapes the console reads. Nothing in this pass checked that. The console decodes payloads in
  `lib/utils/events.ts` and several run surfaces, all of which read fields positionally by name off an
  untyped object, so a renamed or re-nested field would degrade quietly — a summary line rendering as
  `—` or an empty detail block, not an error.
- **Chose:** Record it as a known-unverified edge and say so explicitly in the changelog, rather than
  relabelling the docs as "absorbed" and implying the audit happened. The plan itself instructed this
  ("**Not audited this session** — record it as a known-unverified edge rather than implying it was
  checked"), and it is the right call: a confidently-wrong doc is worse than a missing one.
- **Alternatives:** (1) Diff the two proto packages field-by-field and audit every console read site —
  the right thorough answer, but it is a phase of its own, not a bullet in a documentation refresh, and
  it would need the 0.1.9 package to diff against. (2) Say nothing — rejected; silence here reads as
  "checked and fine". (3) Assert compatibility from the absence of breakage in the test suite —
  rejected; demo-mode fixtures are this repo's own mock data and would not move if upstream shapes did.
- **Blast radius if wrong:** Degraded event detail rendering on real backends only — demo mode is
  unaffected because it never touches proto. No crash path: every read site is a lookup on a possibly-
  absent field with a fallback. Detection would come from an operator noticing a blank summary, which
  is why the changelog names the risk rather than burying it.
- **Resolved (2026-09-23) — AUDITED; the risk is verified absent for this bump.** The blocker recorded above
  ("it would need the 0.1.9 package to diff against") was simply wrong: the monorepo carries tags
  `proto-v0.1.9` and `proto-v0.1.10`, and `git archive proto-v0.1.10 packages/proto-npm` is
  **byte-identical** to the published 0.1.10 installed in the control plane, so the tags are faithful.
  The entire delta across every `.proto` file is a four-line **comment** change on
  `PolicyDescriptor.schema_version` in `policy.proto` — no field added, removed, renamed, re-nested
  or retyped. That message cannot reach `decodedPayload` at all: `ProtoRegistryService` loads only
  the envelope and mode descriptors for `decodeKnown()`, while `policy.proto` is loaded separately
  for the gRPC policy RPCs. Zero overlap with the fields the console reads. The audit took about ten
  minutes, not "a phase of its own".
  Two things worth keeping: mode-payload `decodedPayload` **is** a genuine pass-through of the proto
  decode, so a future bump touching the mode descriptors needs this same check — now a one-command
  recipe rather than an open-ended audit; and the console already implements the one substantive
  thing 0.1.10 documents (`schema_version` 3). The changelog was rewritten from "not audited" to the
  finding, since leaving it would now understate what is known.
- **Status:** RESOLVED (2026-09-23) — verified absent, not merely unverified

---

## `MACP_PLAYGROUND_BASE_URL`'s code default points at the console, not the playground

_(Narrowed during §4 finalization — the docs were corrected to `3100`, leaving only the code
default — then settled by `/reconcile` on 2026-09-23, which changed it. See the resolution below
and `DECISIONS.md` D-R4.)_

- **Plan:** plans/absorb-control-plane-playground-sep-2026.md
- **Phase:** 10 (found while sweeping docs; **not** introduced by this branch)
- **Assumed:** That leaving `lib/server/integrations.ts:37`'s fallback at `http://localhost:3000`
  is safe because every supported way of running the stack sets the variable explicitly. Four
  sources disagreed about this value. `3100` is the right one — the compose stacks publish the
  playground there (`docker-compose.e2e.yml` maps `3100:3000`, so the container's own port really is
  `3000`) — while host-side `3000` is the Next.js dev server. The **documentation** half is now
  settled: `.env.example`, `docs/api-integration.md` and `README.md` all say `3100`. What remains
  unconfirmed is only the code fallback at `lib/server/integrations.ts:37`, still `3000` —
  so with the variable unset, the proxy forwards Examples Service calls **to the console itself**.
  The likely symptom is not a connection error but a confusing 404 from Next's own router.
- **Chose:** Document the disagreement in `CLAUDE.md` and record it here rather than change the
  fallback. `lib/server/integrations.ts` is outside this phase's file list; the phase is
  documentation; and the correct value cannot be demonstrated here, because the console's local
  stack could not be booted in this environment (see the runtime-pin entry above). Changing a
  default that every working configuration currently overrides is a behaviour change dressed as a
  doc fix — it belongs in its own change, with a test.
- **Alternatives:** (1) Change the fallback to `3100` and align `docs/api-integration.md` — probably
  right, but unverifiable here and out of scope. (2) Delete the fallback and fail fast when the
  variable is unset — arguably the best answer, since a silent self-proxy is worse than a startup
  error, but that is a behaviour change with its own blast radius. (3) Say nothing — rejected; the
  next person to hit it would have no thread to pull.
- **Blast radius if wrong:** Only affects a real-mode run with `MACP_PLAYGROUND_BASE_URL` unset.
  What actually sets it is `.env.e2e` (loaded by `dev:e2e`, which `scripts/local-stack.sh` execs)
  and the `.env.local` recipe in `README.md:75-81` — note that `npm run dev:real` sets only
  `NEXT_PUBLIC_MACP_UI_DEMO_MODE`, and the compose files start no UI service, so neither supplies
  it. A developer who runs `dev:real` without having written an env file gets the self-proxy. If the
  fallback is in fact correct and `.env.example` is the wrong one, the cost of this entry is a
  paragraph of prose. Nothing in the branch depends on either value.
- **Resolved (2026-09-23) — CHANGED; fixed rather than deferred again.** `lib/server/integrations.ts:37`
  now falls back to `http://localhost:3100`. Deferring a second time was the wrong instinct: the
  change is one character-range, reversible, and it makes the code agree with the three docs this
  branch already corrected. Option (b) — delete the fallback and fail hard — was rejected on a fact
  that corrects the original note: `getIntegrationConfig` is called at **request** time from the
  proxy route, so removing the fallback yields a request-time 500, not a startup error, which is
  worse than the 404 it replaces. It would also leave an asymmetric pair, since the control plane's
  `3001` fallback is correct and stays. With `3100`, `local:up` + `dev:real` with no env file simply
  works. A breakage sweep found nothing depending on the old value: `.env.e2e`, `local-stack.sh`,
  every compose file and the one integration test all set the variable explicitly.
  Pinned by a new `lib/server/integrations.test.ts` (4 cases), mutation-proved: reverting the
  fallback to `3000` fails 2 of them.
- **Status:** CONFIRMED (2026-09-23) — changed and pinned
