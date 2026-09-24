# DECISIONS

Durable record of assumptions settled by `/reconcile`. `/ship` and any later reconciliation read
this file rather than replaying the conversation that produced it.

Each entry records the original assumption, the independent analysis and its recommendation, who
decided, the verdict, and the resulting status.

---

## 2026-09-23 — Reconciliation of `plans/absorb-control-plane-playground-sep-2026.md`

Six `UNCONFIRMED` entries, all tagged to that plan. **None was a one-way door**, and that was
verified rather than assumed against each criterion: this repo owns no persisted schema and no
public API contract (the console is purely a consumer); no entry touches a data migration; and the
one auth-model candidate was disproved by reading the code — `resolveBaseUrl`
(`lib/server/integrations.ts:12-23`) **throws** when a base URL is unset in production, so the
suspect fallback is dev-only by construction and can never send a credential to an unintended
destination in a deployed build. The two external-dependency entries are version pins reversible by
changing a value.

All six were therefore analyzed at the reversible tier by fresh Opus agents and **settled without
escalation**. Four were changed, two confirmed. Ordering below is by blast radius, highest first.

---

### D-R1 — The runtime v0.8.0 pin was verified by pairing evidence, not a boot

- **Assumption:** Phase 9's acceptance criteria 4 and 5 required booting the console's own stack.
  AC4 was never run; what was verified was image-pair compatibility via a *different* repo's running
  stack. AC5 was not verified at all.
- **Analysis (Opus):** Found both original blockers had lifted, and **actually booted the stack** —
  no file edits, documented env overrides only. Every service healthy; `/readyz` returned
  `ok: true` with `runtime.ok: true, detail: "connected to runtime:50051"` and
  `circuitBreaker: CLOSED`. Confirmed the pin four independent ways (`f97fd15…` is exactly
  `git rev-list -n1 macp-runtime-v0.8.0`; commit is "chore: release v0.8.0 (#172)"; the image's
  `org.opencontainers.image.revision` label matches; the container logs `macp-runtime v0.8.0
  listening`). Measured the `MACP_BIND_ADDR` question rather than reasoning about it: dual-stack
  listener, healthcheck exits 0, peer container connects over IPv4 — no live risk.
  **Recommended CONFIRM, and recommended splitting the entry**, because it had two unrelated things
  in it.
- **Decided by:** Opus (reversible tier). **Verdict: CONFIRM.**
- **Resulting status:** `CONFIRMED (2026-09-23)`. AC4 is now genuinely met. `MACP_BIND_ADDR` changed
  `[::]:50051` → `0.0.0.0:50051` as cleanup, not mitigation — it matches the image's own default
  and both sibling stacks, and the only environment the old value breaks is one with IPv6 disabled,
  where it would take down the two services that `depend_on` the runtime as `service_healthy`.

### D-R2 — `docker-compose.local.yml` image names (split out of D-R1)

- **Assumption:** Recorded inside D-R1 as "a strong candidate for its own change", left unfixed
  because it was out of the phase's file list and thought unverifiable without a boot.
- **Analysis (Opus):** Confirmed **TRUE** three ways — compose resolution, registry denial, and the
  local image cache. Root-caused to commit `690c899` ("refactor: adopt macp-* naming"), which
  renamed the *services* but prefixed the *project* half of the image strings, leaving the control
  plane one `macp-` short and the playground name never updated at all. Independently reconfirmed
  here: `docker compose -f docker-compose.e2e.yml config --images` produces
  `macp-ui-console-macp-control-plane` / `macp-ui-console-macp-playground`, only the former exists
  in the local image cache, and neither of the old names exists at all.
- **Decided by:** Opus (reversible tier). **Verdict: CHANGE.**
- **Resulting status:** Fixed. Three image defaults corrected; header rewritten to name the
  producing command (`docker compose -f docker-compose.e2e.yml build`) and to explain the doubled
  `macp-`, since the file's "avoids needing NPM_TOKEN" claim is only true *after* someone has paid
  that cost once. `npm run local:up` was impossible as shipped — compose could only pull names
  nothing produces, which is the real source of the misleading `pull access denied`.

### D-R3 — macp-proto 0.1.9 → 0.1.10 was not audited

- **Assumption:** The bump might have moved `decodedPayload` shapes the console reads; auditing was
  judged "a phase of its own" needing the old package "to diff against".
- **Analysis (Opus):** That blocker was wrong. The monorepo carries `proto-v0.1.9` / `proto-v0.1.10`
  tags, and `git archive proto-v0.1.10 packages/proto-npm` is **byte-identical** to the published
  0.1.10 installed in the control plane, so the tags are faithful. The entire delta across every
  `.proto` file is a four-line **comment** change on `PolicyDescriptor.schema_version` — no field
  added, removed, renamed, re-nested or retyped. `policy.proto` is loaded only for the gRPC policy
  RPCs and is not among the descriptors decoded into `decodedPayload`, so it cannot reach the event
  stream. Zero overlap with the enumerated console read sites. Took ~10 minutes.
- **Decided by:** Opus (reversible tier). **Verdict: CHANGE** (the record, not the code).
- **Resulting status:** `RESOLVED` — risk **verified absent**, not merely unverified. The changelog
  was rewritten from "not audited" to the finding; leaving it would have understated what is known.
  Two facts kept for next time: mode-payload `decodedPayload` *is* a genuine proto pass-through, so
  a future bump touching the mode descriptors does need this check — now a one-command recipe
  (`git diff proto-v<old> proto-v<new> -- packages/proto-npm`); and the console already implements
  the one substantive thing 0.1.10 documents, `schema_version` 3.

### D-R4 — `MACP_PLAYGROUND_BASE_URL`'s code default pointed at the console

- **Assumption:** Leaving the dev fallback at `http://localhost:3000` was safe because every
  supported way of running the stack sets the variable. But `3000` is the Next.js dev server, so an
  unset variable made the proxy forward Examples Service calls back into the console.
- **Analysis (Opus):** Recommended fixing now rather than deferring again. Corrected one fact in the
  original note: `getIntegrationConfig` is called at **request** time from the proxy route, so
  option (b) — delete the fallback — would produce a request-time 500, not an actionable startup
  error, and would leave an asymmetric pair since the control plane's `3001` fallback is correct.
  Breakage sweep found nothing depending on the old value. Verified the proposed test is falsifiable
  by running it against both patched and unpatched copies.
- **Decided by:** Opus (reversible tier). **Verdict: CHANGE.**
- **Resulting status:** `CONFIRMED` — fallback is now `http://localhost:3100`, pinned by a new
  `lib/server/integrations.test.ts`. Mutation-proved here: reverting the fallback to `3000` fails 2
  of its 4 cases. Deferring a second time was the wrong instinct — the change is one character
  range, reversible, and it makes the code agree with the three docs this branch already fixed.

### D-R5 — "Agents are live" was asserted, not checked

- **Assumption:** The no-registration banner claimed agents were live based only on a `sessionId`
  being present. Recorded as probably-false-sometimes; the "right fix" (model `hostedAgents`, gate
  on `processAttached`) was deferred.
- **Analysis (Opus):** Premise verified **TRUE** and broader than recorded. On manifest-validation
  failure the playground's host returns `status: 'resolved'` with `processAttached: false` and does
  **not** throw (`process-example-agent-host.provider.ts:132-145`); the caller rethrows only a
  *rejected* promise (`example-run.service.ts:76-79`). A second path was missed entirely: a
  `mode: 'mock' | 'deferred'` agent returns `processAttached: false` **by design**, so the sentence
  would be false on a perfectly healthy run once such an agent exists. Decisively, the deferred
  "right fix" would not have fixed it either — `processAttached: true` is set immediately after
  spawn alongside `healthStatus: 'starting'`, so it means "a process was spawned", never "an agent
  is live".
- **Decided by:** Opus (reversible tier). **Verdict: CHANGE** — take the previously-rejected
  option, whose "it hides the defect" objection does not survive: the defect is upstream, console
  copy cannot fix it either way, and the real choice was between asserting something never checked
  and reporting what the page knows.
- **Resulting status:** `RESOLVED` — reworded to "The Example Service returned a session but did not
  register this run." Both clauses now mirror the render gate exactly, which is the standard every
  other sentence in that banner already held itself to. No type change, no demo-parity work, no new
  failure mode. Rationale pinned in a comment at the call site. Option (1) is **dropped**, not
  deferred: it buys a weaker guarantee than its cost implies.

### D-R6 — `CommitmentAuthority` is a compile-time guard only

- **Assumption:** The corrected union plus an exhaustiveness anchor prevents the *type* being wrong,
  but nothing narrows or validates real-mode policy data.
- **Analysis (Opus):** Core claim verified and **stronger** than written — `PolicyDefinition` has
  exactly two consumers in the repo, both demo. The entry's own hedge about the registration body is
  also wrong: that form is a free-text JSON textarea typed `Record<string, unknown>`, so
  `PolicyDefinition` is demo-only, full stop. Singular `designated_role` confirmed against four
  independent sources plus the canonical JSON schema. Two amendments: the anchor lives at
  `lib/data/mock-data.test.ts:36` (not `lib/types.ts`) and is load-bearing — verified empirically,
  and dependent on staying at its annotation site; and the blast radius understated that **nothing
  in the stack enum-checks `commitment.authority`**, so an unknown value is registrable and the
  runtime silently treats it as `initiator_only`.
- **Decided by:** Opus (reversible tier). **Verdict: CONFIRM.**
- **Resulting status:** `CONFIRMED (2026-09-23)`, entry amended with both corrections. A display-only
  "unrecognized authority" badge was considered and **not** taken: cheap in code, but unreachable
  against current mocks, and making it reachable needs a deliberately-invalid fixture on the
  user-visible `/policies` catalog — a product decision, not a type fix.

### D-R7 — Test-environment storage (was: in-memory polyfill)

- **Assumption:** A hand-rolled in-memory `Storage` was required because Vitest 4 does not copy
  `localStorage` onto the test global; `environmentOptions.jsdom.url` was described as the
  prerequisite that made native storage possible.
- **Analysis (Opus):** The polyfill was genuinely necessary (removing it reproduces all 8 failures),
  but **three claims in the entry were wrong**. (a) The root cause is not Vitest's key list alone —
  that filter skips a key only when it already exists on the Node global, and **Node ≥ 22 defines
  `localStorage`/`sessionStorage` itself** as experimental Web Storage returning `undefined` without
  `--localstorage-file`. (b) `environmentOptions.jsdom.url` was a **no-op**: Vitest's jsdom
  environment already defaults to that exact string, so the comment calling it the fix was false.
  (c) Worst, `installStorage` never replaced `sessionStorage` at all — Node's version returns a
  working object, so the guard handed it back, silently binding tests to a **process-wide** store
  outside jsdom's per-file isolation.
- **Decided by:** Opus (reversible tier). **Verdict: CHANGE.**
- **Resulting status:** `RESOLVED` — `test/setup.ts` now bridges to jsdom's native `Storage`. This
  closes the spec-fidelity gap the entry itself named as its only risk, fixes the `sessionStorage`
  leak, and drops the per-run `ExperimentalWarning`. The `jsdom.url` pin is kept — under the native
  bridge a non-opaque origin is a real prerequisite — with an honest comment. Added
  `test/setup.test.ts`, mutation-proved: it fails 2 of 5 against the exact previous bug.

---

## Open items arising from this reconciliation — not decided here

These came out of the analyses and are **not** settled. The first two are cross-repo and need
explicit go-ahead before anything is even drafted; the last is local.

- **CP-1 (macp-control-plane / macp-playground) — a launch race fails every real-mode run.**
  Found while booting for D-R1. The playground registers the run with the control plane *before* the
  session exists in the runtime, and the control plane's `startRun` treats `NOT_FOUND` as fatal.
  Timestamps from the boot: CP logged `GetSession failed: code=5 "Session '99eaf3e6…' not found"` →
  `run.failed` after 17ms, while the runtime logged `session started` **385ms later** and the
  session then ran correctly to completion — 4 agents, 106 events, a fully populated projection.
  Version-independent; would reproduce against any runtime. This is what makes real mode look
  broken, and it was invisible for as long as AC5 went unverified.
- **PG-1 (macp-playground) — `/examples/run` returns 201 for an agent that never attached.**
  The upstream half of D-R5. Console copy now reports this honestly, but the service still answers
  success for a failed manifest validation.
- **UI-1 (local) — a display-only "unrecognized authority" indicator**, from D-R6. Deliberately not
  taken; recorded so the option is not rediscovered from scratch. Note `mock-data.test.ts:30-34`
  already names the move that would retire the test-file dependency: a
  `Record<CommitmentAuthority, string>` label map on the policy detail page would give the union a
  shipped-code consumer and surface the unrecognized value in the same change.

---

## D-S1 — the ship-gate pass fixed all four non-blocking gaps, and widened one of them

The pre-push verification round returned **PASS** with four non-blocking findings and one
observation. All five were fixed in the ship commit rather than deferred, because three were live
contradictions of the branch's own work and the fourth was the exact defect class the branch set out
to remove.

- **G1** — `CLAUDE.md` still asserted the playground fallback "is still `http://localhost:3000`",
  which commit `c2656af` had already falsified. A doc that contradicts the code is worse than one
  that omits it.
- **G2** — `PROGRESS.md` still listed A1–A5 as pending and A5 as "not audited". Pointed at
  `DECISIONS.md` rather than rewritten, and D37 marked superseded by D-R3, so the record of what was
  open at plan time survives.
- **G3** — the plan header read `planned (all phases TODO)` above eleven phases marked DONE.
- **G4** — the demo timeline counters lagged the fixtures they describe. **Widened deliberately.**
  The verifier scoped this to the suspended run, which is the one this branch broke. Auditing all
  six found three drifted (11 against 14, 8 against 12, 5 against 6) and the cancelled run claiming
  three events with no event fixture at all — which also left `/logs`'s `run.cancelled` filter entry
  matching nothing in demo mode, the default. Fixing only the branch-caused one would have left the
  two larger instances of the same defect behind on a branch whose thesis is that this class of
  drift is worth removing. The counters are now derived from the fixtures at the same site that
  already derived `recent`, so the literals that drifted no longer exist; the cancelled run gained
  the three events its projection was already asserting. A uniform invariant with no carve-out,
  pinned by `mock-data.test.ts` and mutation-proved twice.
- **N1** — `mergeEventStreams` sorted on `a.seq - b.seq`, which returns `NaN` for a missing or
  non-numeric `seq`. That is not merely a misplaced row: a `NaN`-returning comparator is not a valid
  ordering, so the engine may leave the array in any order. The hook already guards the resume
  cursor with `Number.isFinite` for exactly this reason — the guard was simply absent one layer
  down. Unusable values now sort to the end in arrival order; mutation-proved.

Scope note: G4's widening and N1 touch shipped code, and both were adopted after the verification
round rather than reviewed by it. Both are covered by tests that were proved to fail against the
pre-fix source, and the full suite, typecheck, lint, `format:check` and `next build` are green.
