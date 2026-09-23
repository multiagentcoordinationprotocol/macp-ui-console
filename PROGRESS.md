# PROGRESS — absorb-control-plane-playground-sep-2026

Plan: `plans/absorb-control-plane-playground-sep-2026.md`
Started: 2026-09-23 (via `/plan`)
Branch: `feat/absorb-control-plane-playground-sep-2026`

**PR strategy: one PR for all 11 phases, opened by `/ship` after finalization.** Why: the phases are
individually small (most are one or two files) but share a single narrative — "absorb three weeks of
already-merged backend changes" — and four of them chain through `ApiError.errorCode` (P4, P5, P6 → P3) or
the SSE cursor (P8b → P8a). Splitting on those seams would produce PRs that cannot be reviewed or reverted
independently anyway. One PR, eleven reviewable commits, one CI run. Each phase is still its own commit, so
a reviewer can walk it phase by phase and a bad phase can be reverted on its own.

## Phase log

_(one checkpoint per phase; `/implement` appends)_

| Phase | Title | Status | Rounds | Verifier | Commit | PR |
|---|---|---|---|---|---|---|
| P1 | Correct the `CommitmentAuthority` wire value | DONE | 2 | Opus | `68d80db` | pending /ship |
| P2 | Surface non-canonical supersedes hashes | DONE | 2 | Opus | `6178633` | pending /ship |
| P3 | Structured error codes on `ApiError` | DONE | 3 | Opus | `4e4f543` | pending /ship |
| P4 | Runtime session drift: types, client, demo data | DONE | 2 | Opus | `032a6f0` | pending /ship |
| P5 | Runtime session drift: Infrastructure-tab UI | DONE | 2 | Opus | `8149d9d` | pending /ship |
| P6 | Constrain policy `schemaVersion` to {1,2,3} | DONE | 1 | Opus | `e7fbb08` | pending /ship |
| P7 | Absorb `controlPlaneRun` from the playground bootstrap | DONE | 3 | Opus | `4dd89cf` | pending /ship |
| P8a | SSE resume-cursor correctness | TODO | — | — | — | — |
| P8b | Gap visibility (`historyGap`, client gaps) + `policy.denied` detail | TODO | — | — | — | — |
| P9 | Repoint the dev/e2e stack at runtime v0.8.0 | TODO | — | — | — | — |
| P10 | Documentation refresh | TODO | — | — | — | — |

Dependency edges: P4→P3, P5→P4, **P5→P3** (Phase 5 reads `errorCode` directly, so the edge is real and not
merely transitive through P4), P6→P3, P8b→P8a, P10→all. P1, P2, P7, P8a, P9 are independent.

---

## Repo map (gathered during planning — do not re-scan)

> **Anchor by symbol, not by line.** Line numbers are correct as of 2026-09-23 but rot as soon as a phase
> inserts code. Grep for the quoted symbol; treat `:N` as a hint.

**Known line drift (accumulating as phases land — read before trusting any `:N` below):**

- **P1 grew `lib/data/mock-data.ts` by +25** (2297 → 2322): `MOCK_POLICY_DEFINITIONS` `:1906-1979` →
  `:1906-1992`, `MOCK_RUNTIME_POLICIES` `:1981-2006` → `:1994-2031`, `MOCK_CHARTS` now `:2033`. Anything
  below `:1956` has moved.
- **P1 shifted `lib/types.ts` by +13 below line 26** (a TSDoc block on `CommitmentAuthority`). Every plan
  and map citation into `lib/types.ts` past line 26 is now off by 13: `CommitmentSupersedes` `:45-48` →
  `:58-61`, `RegisterPolicyRequest.schemaVersion` `:132` → `:145`, `CreateRunResponse` `:330-341`,
  `RunStateProjection.run` `:453-463`, `RunExampleResult` `:743-747` all move down by 13. Re-locate by
  symbol.

### Build, test, CI

- `package.json` — scripts. Note `test:integration` exists (`vitest.integration.config.ts`) and is **not**
  documented in `CLAUDE.md`. Node `>=20.9.0`.
- `.github/workflows/ci.yml` — the gate: `format:check` → `lint` → `typecheck` → `test` → `build` (`:44-60`).
  Integration tests are a **separate job** (`:76-105`) that runs only on `workflow_dispatch` or a
  `run-integration-tests` PR label. `format:check` globs `.ts/.tsx/.json/.css` only — **markdown is not
  formatted by tooling**.
- `vitest.integration.config.ts` — node env, 30s timeout, `sequence.concurrent: false`.
- `test/test-utils.tsx` — `renderWithProviders`. Wraps in `QueryClientProvider` **only**; there is
  **no `ToastProvider`**, so `useToast()` is the no-op default (`components/ui/toast.tsx:18`) and toast text
  is never assertable. Assert on rendered DOM instead.
- `test/integration/helpers/fetch-mocker.ts` — `FetchMocker`: `on(method, proxyPath, handler)` `:17`,
  `onPrefix` `:23`, `requests` `:28`, `install` `:37`, `restore` `:97`. Exact match first, then query-stripped
  (`:59-62`), then prefix.
- `test/integration/helpers/mock-backend.ts` — in-process HTTP backend; integration tests are self-contained
  and need no Docker.
- `test/integration/fixtures/backend-responses.ts` — response factories. `readinessProbe()` `:307-315` is the
  insertion model for a new admin fixture. `:231` hard-codes `metadata: {version:'0.5.0'}` (fixture only).

### Types — `lib/types.ts` (831 lines)

- `RunStatus` `:1-10` — all 8 members incl. `starting`, `suspended` (`:7`), `cancelled`. **Needs no change.**
- `CommitmentAuthority` `:26` — **the Phase 1 bug** (`'designated_roles'` → `'designated_role'`). Zero
  importers; referenced only at `:111`.
- `PolicyHints.designatedRoles` `:36` — **separate advisory camelCase field. Do not touch.**
- `CommitmentSupersedes` `:45-48` (doc comment `:40-44`) — **Phase 2** adds `canonical?: boolean`.
- `PolicyDefinition` `:90-116` — `schema_version` `:93`; `rules.commitment` `:110-114` with `authority` `:111`
  and the correctly-plural array field `designated_roles` `:113`.
- `RuntimePolicyDescriptor` `:118-125` — `schemaVersion: number` `:123` (**response**; keep as `number`).
- `RegisterPolicyRequest` `:127-133` — `schemaVersion?: number` `:132` (**Phase 6** narrows to `1|2|3`).
- `RunDescriptor` `:215-238` — a **request** type, not the response. Do not reuse for `controlPlaneRun`.
- `RunRecord` `:299-316`; `CreateRunResponse` `:330-341` — **the type Phase 7 reuses** for `controlPlaneRun`.
- `CanonicalEvent` `:343-365` — `subject?: {kind, id}` `:350-353` (`subject` optional, `id` a required
  string so `''` type-checks); `schemaVersion?` `:349` (**unrelated** event-envelope version);
  `data: Record<string, unknown>` `:364`. No `messageId`, no `reasons` — both ride inside `data`.
- `RunStateProjection.decision` `:475-512` — `current?` `:476` is an **inline anonymous object**, not a named
  `DecisionProjection`. `supersedes?` at `:510`.
- `RunExampleResult` `:743-747` — **Phase 7** adds `controlPlaneRun?`.
- `ReadinessProbeResponse` `:825-831` — last export; the `…Response` naming precedent.

### API layer

- `lib/api/fetcher.ts` (66 lines) — `ApiError` `:3-21`: constructor takes `body` `:9` and **discards it**
  after `super(body || …)` `:10`. `isNotFound` `:18-20`. `isRegistryReadOnlyError` `:30-39` is the precedent
  for reading a structured CP error (regexes `error.message`). `fetchJson` `:41-61` (`response.text()` →
  `ApiError` at `:52-53`; 204 → undefined `:56-58`). `buildProxyUrl` `:63-65`. **Phase 3 edits this.**
- `lib/api/client.ts` (1228 lines) — every function takes `demoMode: boolean` and branches; `maybeDelay`
  helper `:72-74`. Key symbols: `runExample` `:195-215` (demo payload built inline `:199-208`; real is a raw
  pass-through `:209-211`); `createRun` `:244-250`; `getRun` `:303-311` (**does** call `normalizeRun`);
  `getRunState` `:313-320` (**pass-through cast, no transform** — Phase 2 needs no client work);
  `getRuntimeHealth` `:706-709` (the minimal idiom to copy); `resetCircuitBreaker` `:763-766`;
  `CircuitBreakerHistoryEntry` **declared in this file** `:922-927`; `getCircuitBreakerHistory` `:929-953`;
  `getTimelineFrame` `:979-988`; `getReadinessProbe` `:1101-1111` (**Phase 4 inserts after this**);
  `listRuntimePolicies` `:1188-1196`; `getRuntimePolicy` `:1198-1205`;
  `registerRuntimePolicy` `:1207-1216` (demo branch **always succeeds** `:1211`);
  `unregisterRuntimePolicy` `:1218-1229`. Section banners look like `/* ─── Readiness probe ─── */` `:1099`.
- `lib/server/integrations.ts` — `ProxyService = 'macp-playground' | 'macp-control-plane'` `:1`
  (**CLAUDE.md and `docs/api-integration.md:42` both say `example`/`control-plane` — wrong**). CP config
  `:43-48`: `MACP_CONTROL_PLANE_BASE_URL`, `authHeaderName: 'authorization'`,
  `MACP_CONTROL_PLANE_API_KEY`. Throws in production if the URL is unset `:12-23`.
- `app/api/proxy/[service]/[...path]/route.ts` (55 lines) — **pure catch-all, no allowlist**. `forward()`
  `:6-10` joins `params.path` verbatim; header copy `:12-16`; auth injection `:18-24`; **streams the upstream
  body, status and statusText back untouched** `:37-45`. **No proxy change is needed for a new endpoint.**

### Mock data — `lib/data/mock-data.ts` (2297 lines)

- `LIVE_RUN_ID` `:35`. `supersedes` appears **exactly once**, `:736-740`, inside `completedState` (declared
  `:693`); the declined state at ~`:986` is the suggested host for a second, non-canonical example.
- `MOCK_RUN_STATES` assembled `:1496-1600`. `MOCK_RUNTIME_MODES` `:1768-1841` with the provenance comment
  `:1764-1767` ("Mirrors macp-runtime v0.5.0 …", "a v0.5.0 registration invariant" — Phase 10).
  `protocolVersion: '0.5.0'` `:1851`.
- `MOCK_RUNTIME_HEALTH` `:1863-1868`. `MOCK_POLICY_DEFINITIONS` `:1906-1992` — six entries; entry `[4]` is
  `policy.lending.conservative` `:1960-1980`. **Updated by P1:** `[4]` is now the only entry with
  `authority: 'designated_role'` (all others remain `initiator_only`) and it mirrors
  `macp-playground/policies/policy.lending.conservative.json` field-for-field, including
  `schema_version: 3` and `quorum {count, 3}`.
  `MOCK_RUNTIME_POLICIES` `:1994-2031` — **now FOUR entries.** P1 appended a `[4]`-sourced entry
  (`schemaVersion: 3`), so the reuse set is `[0]`, `[1]`, `[3]`, `[4]`. The old map line said "not `[4]`";
  that is no longer true. This is what makes `designated_role` reachable on the demo `/policies` surface,
  and it means `getRuntimePolicy('policy.lending.conservative')` now resolves instead of throwing.
- Precedent worth knowing: circuit-breaker history and readiness have **no `MOCK_` symbol** — their demo
  payloads are inline in `client.ts`.

### Pages (`app/`) — **zero test files exist under `app/`**

- `app/observability/page.tsx` (534 lines) — **where the drift UI goes.** `Suspense` wrapper `:34-40`
  (uses `useSearchParams` `:45`); queries `:76-101` (`readinessQuery` `:92`, `breakerHistoryQuery` `:93-100`),
  `resetBreakerMutation` `:101`; **hard gate** on overview+health only `:122-140`;
  **`subsidiaryErrors` `:142-146`** and its warning banner `:160-169` (the graceful-degradation path
  Phase 5 joins); `Tabs` `:190-531` with **`infrastructure` `:345-469`**: readiness card `:362-398`,
  health detail `:400-412`, `CircuitBreakerTimeline` `:414-416` (**insert drift after `:416`**), `grid-2`
  with CB-reset `:419-445` and external tools `:447-465`. Stat tiles are hand-rolled `kpi-card` markup
  `:200-273`, **not** the `KpiCard` component.
- `app/settings/page.tsx` (523 lines) — **has no CB-history card and no tables.** Imports only
  `resetCircuitBreaker` `:21` for a ghost button `:311-318`. Sections: preferences `:177-243`, runtime status
  `:245-277`, webhooks `:281-381`, audit `:383-509`. `:511` records that PolicyManagement moved to
  `/policies`.
- `app/policies/page.tsx` — renders `<PolicyManagement demoMode={demoMode} />` `:28`.
  `app/policies/[policyId]/page.tsx:81` badges `schema v{schemaVersion}`; `:88` renders rules opaquely.
- `app/runs/new/page.tsx` (577 lines) — `Suspense` wrapper `:37-43`, `useSearchParams` `:47-52`;
  `bootstrapResult` state `:64` (typed `Record<string, unknown>`, **Phase 7 retypes**);
  **`submitMutation` `:185-204` and `quickBootstrapMutation` `:206-225` are byte-for-byte identical**;
  triggers at `:273`, `:486`, `:532`; JSON-error badge `:415`; output card `:552-572` with the badge row
  `:560-567` (**Phase 7's warning surface**). No `onError` on either mutation; no toast import.
- `app/modes/page.tsx` (137 lines) — the v0.5.0 invariant comment `:126-127` is **comment-only**; `:128`
  already renders defensively with `?.` and `|| '—'`. No test.
- `app/logs/page.tsx` — `EVENT_TYPE_GROUPS.Policy` `:53`; id-keyed dedup `:128-135`; search haystack `:183`;
  subject meta row `:382` (**Phase 8b guard**).

### Components

- `components/runs/decision-panel.tsx` (265 lines) — imports incl. `Badge` `:3-8`; supersession block
  `:171-181` (`:175` is the `list-item-title` where Phase 2's badge goes); existing `tone="warning"` usage
  `:145`. Test `decision-panel.test.tsx` (178 lines): `baseRun` `:12-21`, **`baseState(currentOver)`
  `:23-51` spreads a `Partial<…current>` at `:37` — no builder change needed**; the `titleCase` behaviour is
  already documented at `:57-58`. **No `supersedes` fixture exists today.**
- `components/settings/policy-management.tsx` (303 lines) — `PolicyManagement` `:23-176` (read-only banner
  `:66-82` is the `role="status"` banner precedent; `JsonViewer` for rules `:132`);
  `RegisterPolicyForm` `:178-303`: `schemaVersion` state `:192`, mutation `:196-230` with
  `Number(schemaVersion)` `:210`, `onSuccess` reset `:217-219` (**does not reset schemaVersion**),
  `onError` `:223-229`, `validate()` `:232-244`, **`Select` for mode `:267-270` (the in-file precedent)**,
  schemaVersion `Input` `:283-285`, inline `.error-text` `:292-296`. Test (50 lines, one test) asserts only
  the 405 read-only path.
- `components/observability/circuit-breaker-timeline.tsx` (125 lines) — **the template to clone** for the
  drift panel: imports its type from `@/lib/api/client` `:6`, `STATE_TONE`/`STATE_BG` maps `:20-30`,
  `return null` when empty `:52`, `Card`/`CardHeader`/`CardContent className="stack"`, `.inline-list` badge
  row, `table-wrap`/`table` `:94-121`. Its test is 30 lines, plain `render()`, prop-driven.
- `components/ui/field.tsx` (17 lines) — `Input` `:3-5`, **`Select` `:7-9`**, `Textarea` `:11-13`,
  `FieldLabel` `:15-17`. **No Radio primitive.**
- `components/ui/badge.tsx` — `tone?: 'neutral'|'info'|'success'|'warning'|'danger'` `:6`; **renders
  `titleCase(label)` `:11`**, and `titleCase` (`lib/utils/format.ts:45-52`) replaces `-`/`_` with spaces.
- `components/ui/toast.tsx` — `toast(type, message)` positional `:15`; `ToastType` `:6`; **default context
  is a no-op `:18`**.
- `components/ui/event-detail-dialog.tsx` (129 lines) — pure framing; renders caller-supplied
  `meta: {label,value}[]` `:113-118`. Immune to empty ids; the dangling colon comes from the **callers**.
- Other primitives: `kpi-card.tsx:29`, `panel.tsx:21,31,50`, `card.tsx:6,14,22,30,38`,
  `empty-state.tsx:31`, `section-header.tsx:3`, `state-panels.tsx:4,27,59`.
  **No shared `<Table>` component** — all 14 tables are hand-rolled `<div class="table-wrap"><table
  class="table">`; CSS at `app/globals.css:512-537`.

### Hooks & utils

- `lib/hooks/use-live-run.ts` — **Phase 8a/8b's file.** The resume cursor is seeded/overwritten from the
  server head in **three** places, all of which P8a fixes: `:47` (`useState(initialState?.timeline.latestSeq
  ?? 0)`), `:120` (snapshot handler — and the CP republishes a snapshot on **every commit**, so this fires
  continuously, not once per connection), and `:197` (`reset()`). `MAX_RECONNECT_ATTEMPTS = 8` `:7`,
  `MAX_EVENT_BUFFER = 500` `:8`, `HEARTBEAT_TIMEOUT_MS = 45_000` `:9`; `normalizeEvent` `:27-29`;
  `appendEvent` `:62-68` (**dedup scans the buffer by `event.id` at `:64`**; eviction `:66`);
  `resetHeartbeatTimer` `:70-79`; backoff `:93`; `connectSSE` `:100-141` — **`afterSeq` from
  `lastSeqRef` `:104-107`**, `snapshot` handler **`setLastSeq(payload.timeline.latestSeq)` `:120` (bug 1)**,
  `canonical_event` `setLastSeq(payload.seq)` `:127` (bug 2, non-monotonic); `onerror` `:136-140`;
  demo frame loop `:152-165`; `reset()` `:194`. **No gap detection anywhere.**
  Test file: `MockEventSource` `:14-55` is **defined but never driven** — `instances` is populated in the
  constructor at `:27`, static `reset` at `:49` (**there is no `push` helper**). All 10 tests use
  `demoMode: true`, so the duplicate-id test at `:196-218` proves **demo-path** dedup only, not SSE.
  **Harness blocker for P8a:** `dispatchEvent` (`:40-43`) fans out only to `this.listeners`, but the hook
  assigns `source.onerror = …` (`use-live-run.ts:136`), so the reconnect path is undrivable until either
  the test calls `instance.onerror?.(new Event('error'))` or the hook switches to
  `addEventListener('error', …)`.
- `lib/utils/events.ts` — `summarizeEvent`; subject string built at `:39` (truthiness on the **object**);
  **`:141-144` is a SHARED case block** covering `policy.resolved | policy.violated | policy.denied |
  policy.commitment.evaluated` — appending to its array at `:151-156` changes all four labels, so P8b must
  split the case or gate on `type === 'policy.denied'`. `default` `:198-205`. Test has 15 label assertions.
  **No `session.stream.gap` case exists** (P8b adds one).
- `components/runs/live-event-feed.tsx:196-200` and `app/logs/page.tsx:379-383` build the Subject meta row
  with **byte-identical** expressions; neither file has a test (zero tests under `app/`). P8b extracts
  `formatEventSubject` into `lib/utils/events.ts` so the empty-id fix is unit-testable.
- **Pre-existing gap debt the console never implemented (P8b):** the CP sets
  `RunSummaryProjection.historyGap?: boolean` (`macp-control-plane/src/contracts/control-plane.ts:245`,
  emitted via `src/runs/stream-consumer.service.ts:296-310`) and its doc comment at `:238-244` states *"the
  console surfaces this as a fidelity warning"*. The UI's `RunStateProjection.run` (`lib/types.ts:453-463`)
  is a field-for-field copy of that projection **missing only `historyGap`**, and `session.stream.gap`
  appears in no event-type group in `app/logs/page.tsx:40-60`. Both predate this absorption window.
- `lib/utils/run-story.ts` — `asString` `:86-87` returns undefined for `''`; `subject?.id` reads `:225,236`
  guarded by `continue`; both inside a loop gated to `llm.call.completed`/`signal.emitted` at `:204`.
- `lib/utils/export.ts` — `flattenRunForCsv` `:37-52`; `exportTraceBundle` `:60-68` serializes `state`
  **wholesale**, and its test asserts a self-consistent round-trip — immune to added optional fields.
- `lib/utils/format.ts` — `titleCase` `:45-52` (the `-`/`_` → space transform), `getStatusTone`.
- `lib/utils/macp.ts` — `parseScenarioRef` `:3-15` has **zero production callers**; `isImplicitAccept`
  reads `decodedPayload.implicit` `:66`.

### Docs (Phase 10 targets)

- `docs/changelog.md` (537 lines) — **newest first**; entry template is `:3-53`; `---` separators.
- `docs/feature-matrix.md` (81 lines) — the 4-col table `:5-65`; **`:50` is the "all six v0.5.0 modes" line**
  (count still correct, label stale).
- `docs/api-integration.md` (355 lines) — proxy identifiers **`:42` (wrong)**; `### Runtime metadata` `:165`;
  **`Notes for runtime v0.5.0:` `:172`** with the mode/terminal claims `:174-178`;
  `POST /runtime/policies` body `:192`; **`### Operational admin` `:206-211`** (drift endpoint goes here);
  **`### Control Plane — admin` `:277-281`** (client fn goes here); `## Error handling` `:306-312`;
  `## SSE integration` `:321-341`; one-shot bootstrap `:87-88`, `:353-355`; `decision.current` field list
  `:115` (**omits `supersedes` entirely**).
- `docs/backend-repo-notes.md` (137 lines) — **"Observer-only authority model" `:66-70`**; brittle
  "22 gRPC RPCs" claim `:92`; mode roster `:93`.
- `docs/architecture.md` — stale line counts `:67`, `:78`.
- `docs-content/macp-playground/**` (11 files) — **AUTO-SYNCED** by
  `.github/workflows/sync-examples-docs.yml` + `scripts/sync-examples-docs.sh`. **Never hand-edit**; a
  `"authority": "designated_roles"` at `policy-authoring.md:208` is already fixed upstream.
- `app/docs/macp-ui-console/[slug]/page.tsx` renders `docs/*.md` directly — **no second copy to update**.
  Hand-authored in-app copy lives only at `app/docs/page.tsx:114,137-138,209`.
- `docker-compose.e2e.yml:61-64` — the runtime image pin (**Phase 9**); `:72` another v0.5.0 claim in the
  same file; `README.md:117-118` the matching prose.
- **`docker-compose.e2e.yml:155-175` — the `macp-playground` service sets NO `MACP_CONTROL_PLANE_URL`, NO
  `MACP_CONTROL_PLANE_API_KEY`, and no `depends_on` on the CP** (contrast
  `macp-playground/docker-compose.fullstack.yml:159-160`, which sets both variables). Without them,
  `controlPlaneRun` is always omitted in the local stack and **Phase 7's happy path is unreachable** — P7
  must add **both**.
  **The API key is NOT optional, despite `AUTH_API_KEYS: ""` at `:126`.** The CP guard throws
  `UnauthorizedException('Missing Authorization header')` at
  `macp-control-plane/src/auth/auth.guard.ts:25-27` *before* the empty-keys bypass at `:36-40`; `AuthGuard`
  is global (`src/app.module.ts:97`) and `POST /runs` (`src/controllers/runs.controller.ts:110`) is not
  `@Public`. The playground sends `authorization` only when `controlPlaneApiKey` is non-empty
  (`macp-playground/src/launch/control-plane-run-client.service.ts:119-124`, fed by
  `MACP_CONTROL_PLANE_API_KEY` at `macp-playground/src/config/app-config.service.ts:169`). URL-without-key
  ⇒ `reason=http_401` ⇒ `submitRun` returns `null` ⇒ the warning branch, every time. Use `e2e-test`, matching
  `.env.e2e:8`.

### Sibling repos (read-only reference — never modify)

- `/Users/Shared/multiagentcoordinationprotocol/macp-control-plane`
  - `src/controllers/admin.controller.ts:43-133` — the drift endpoint. `@Controller('admin')` `:11`; live-state
    filter `:82-84`; `untrackedSessions` `:93`; **`missingFromRuntime` ternary `:115-120`** (null ⟺
    `!complete`), `starting` exclusion `:117`; response `:122-132`.
  - `src/contracts/runtime.ts:85-99` — `RuntimeSessionSnapshot` (the real `untrackedSessions` element type);
    `RuntimeListSessionsResult:106-111`.
  - `src/errors/app-exception.ts:14-19` — `{statusCode, errorCode, message, metadata?}`.
    `src/errors/error-codes.ts:4,5,11,27,29`. `src/auth/auth.guard.ts:26,32,44` — **401 is Nest-default, no
    `errorCode`**.
  - `src/projection/projection.service.ts:726-731` — `CANONICAL_COMMITMENT_HASH_RE = /^sha256:[0-9a-f]{64}$/`;
    `extractSupersedes` `:739-747`; **read-time backfill `deriveMissingCanonical` `:762-774`**, called from
    `get()` `:46`.
  - `src/controllers/runtime.controller.ts:78-79` — the schemaVersion check and its exact message;
    `BadRequestException` ⇒ Nest-default 400 body.
  - `src/events/event-normalizer.service.ts:147-149,161,512-539` — `policy.denied` inline path + reason parsing.
  - `docs/INTEGRATION.md:60-200` — observer authorization contract; `docs/API.md:609-648` — drift endpoint.
- `/Users/Shared/multiagentcoordinationprotocol/macp-playground`
  - `src/contracts/launch.ts:126-136` — `RunExampleResult` incl. `controlPlaneRun?`.
  - `src/contracts/run-descriptor.ts:48-54` — `RunDescriptorResponse` (open `| string` status union).
  - `src/launch/example-run.service.ts` — bootstrap short-circuit near `:26-28`; **conditional spread at
    `:97`** (`...(controlPlaneRun ? { controlPlaneRun } : {})`) ⇒ the key is omitted, never null; the
    settled-promise assignment is at `:81-83`.
  - `src/launch/control-plane-run-client.service.ts:27-69` — returns `null` on every failure, never throws.
  - `src/contracts/policy.ts:22` — the singular `'designated_role'` this repo must match.
  - `policies/policy.lending.conservative.json:21-23` — `designated_role` +
    `["risk-agent","compliance-agent"]`.
  - `docker-compose.fullstack.yml:58` — pins `macp-runtime:f97fd15`.
- `/Users/Shared/multiagentcoordinationprotocol/macp-runtime`
  - `crates/macp-modes/src/mode/mod.rs:15-21,25` — 5 standard + 1 extension mode = **six**, still correct.
  - `crates/macp-modes/src/mode_registry.rs:483-500` — the terminal-type invariant, **now enforced at
    registration**. `#[cfg(test)] mod tests` starts `:727`, so the `Finalize`/empty occurrences at
    `:906,925` are **fixtures**, not real modes.
  - Commit `f97fd15` carries tag `macp-runtime-v0.8.0`; there is **no `v0.8.0` tag** (the repo moved to
    per-crate tags).

---

## Decisions log

_(`/implement` appends; `/plan` seeded the five below — full reasoning in the plan's Open questions section)_

| # | Decision | Rationale |
|---|---|---|
| D1 | Drift UI lands on `app/observability/page.tsx`, not settings | Settings has no comparable admin surface; the brief's premise was wrong |
| D2 | `canonical` typed optional, badge gated on `=== false` | Legacy projections deserialize as `undefined`; prevents mis-badging |
| D3 | Drift types live in `lib/api/client.ts` | Matches `CircuitBreakerHistoryEntry`, the nearest analogue |
| D4 | `controlPlaneRun` reuses `CreateRunResponse` | Already the modelled CP `POST /runs` response; avoids a duplicate type |
| D5 | SSE work is a real phase, not a verify-only note | Permanent event-loss paths exist at `use-live-run.ts:47`, `:120`, `:197` |
| D6 | Phase 8 split into 8a (correctness) / 8b (display) | Review found six deliverables across nine files in one phase |
| D7 | Drift component owns its query rather than taking props | Otherwise Phase 5's ACs 1 and 5 are unverifiable — zero tests exist under `app/` |
| D8 | `CommitmentAuthority` gets a `Record<…>` exhaustiveness anchor | A union with zero consumers cannot fail CI; that is why the bug survived |
| D9 | Phase 7 also fixes `docker-compose.e2e.yml` | Its happy path is otherwise unreachable in the only stack that can exercise it |
| D10 | The compose fix sets `MACP_CONTROL_PLANE_API_KEY` as well as the URL | `AUTH_API_KEYS: ""` does not disable auth — the CP rejects a *missing* header before reaching the empty-keys bypass (round-2 review, B1) |
| D11 | Phase 5's page gets an `enabled: false` **observer** query on the same key | The component owns the fetch, but `subsidiaryErrors` is built from page-local query objects — without the observer, AC5 is unimplementable, not merely untested (round-2 review, B2) |
| D12 | Phase 8a does **not** re-sync the cursor when `initialEvents` arrives late | `useState` is mount-only, so a cold mount seeds `0`, which is safe; an effect that writes `lastSeq` is the bug class being removed (round-2 review, S3) |
| D13 | `RUNTIME_LIST_SESSIONS_TIMEOUT_MS=1` is the recipe for `complete:false` | `MAX_PAGES=1` alone needs >200 concurrent sessions to trip the page cap; the timeout path needs none (round-2 review, S1) |
| D14 | Phase 5's drift query must set `retry: false` | The global default is `retry: 1`, which on a 503 fires a *second* full gRPC session drain exactly when the runtime is unhealthy; retrying an open breaker is pointless as well as expensive (P4 verify, item 8) |
| D15 | `RuntimeSessionSnapshot` models 7 of the CP's 11 fields | `configurationVersion`, `policyVersion`, `contextId`, `extensionKeys` are passed through by the CP but nothing renders them; documented in the type so a future need adds them rather than reaching past it (P4 verify, item 2c) |
| D16 | Demo and fixture counts are held to a derived invariant, not chosen for looks | An arithmetically unreachable payload teaches a wrong contract to everything that reuses it; `untracked ≤ live` and `live − untracked + missing ≤ trackedRunCount` are now asserted (P4 verify, items 1–2) |
| D17 | The row cap is one shared `RowCapNote`, used by **both** drift tables | The missing-runs table originally capped at 50 silently while only the untracked table disclosed it. `listActiveRuns()` is unbounded upstream, so a runtime restart really can produce 300 missing runs — a drift panel that under-reports drift 6× without saying so is worse than no cap at all (P5 verify R1, gap 1) |
| D18 | A test that pins a query option must not run under a client that already supplies it | The `retry: false` test passed under `test-utils`' `retry: false` client even with the component's own option deleted — it could not fail. Tests asserting a React Query option now build a client mirroring `providers.tsx` (`retry: 1`) so the component's option is the only thing under test (P5 verify R1, gap 2) |
| D19 | The drift card stamps results with `dataUpdatedAt` and clears the badge on a later failure | `tabs.tsx:48` unmounts inactive tabs while the page's observer keeps the cache entry alive, so a returning operator re-reads old numbers as live; and React Query retains `data` across an error, which would otherwise show "Full session list" beside "Drift check failed" (P5 verify R1 obs 2, R2 obs 3) |
| D20 | The schema-version `<option>` list is generated from `POLICY_SCHEMA_VERSIONS`, the constant the union derives from | The submit site casts (`as PolicySchemaVersion`), so a hand-written 4th option would typecheck while being rejected by the CP. Generating them makes widening the union the only way to add one (P6 verify, obs 2) |
| D21 | `PolicySchemaVersion` constrains the **request** type only; the descriptor stays `number` | A CP that later accepts 4 must not make already-registered policies unrenderable. Pinned by a test that renders a `schemaVersion: 7` policy — the claim was previously made only by a comment (P6 verify, obs 6) |
| D22 | The bootstrap redirect navigates by `controlPlaneRun.runId`, never by `sessionId` | `POST /runs` mints a fresh run id and stores the session id in a separate column (`run-executor.service.ts:141` passes no `explicitRunId`), and `/runs/live/:id` resolves by run id — so the plan's `sessionId`-first fallback 404'd on the phase's own happy path (P7 verify R1, gap 1) |
| D23 | The "not registered" banner offers the session route as a **link**, and says it reports an error until discovery lands | Session discovery (default on) registers observed sessions keyed *by session id*, so the route may start working — but not instantly, and never if the submission reached the CP and only the reply was lost. A redirect would move the load failure behind a click; silence would hide a reachable run (P7 verify R1 gap 2, R2 gap 1) |
| D24 | Ids render in `<code>`, not through `Badge` | `Badge` title-cases its label, turning `run-abc` into `Run Abc` and mangling a UUID outright. The pre-existing session badge had the same defect (P7 verify R2, obs) |

## Assumptions to reconcile

_(pending confirmation; `/implement` logs these to `ASSUMPTIONS.md` as `UNCONFIRMED`)_

- A1 — policy form defaults to `schemaVersion: 3` (P6)
- A2 — bootstrap without `controlPlaneRun` does **not** redirect (P7)
- A3 — drift loads on demand rather than with the tab (P5)
- A4 — GHCR tag `f97fd15` is pullable (P9; verified by that phase's own boot criterion)

---

## Phase checkpoints

### P1 — Correct the `CommitmentAuthority` wire value — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, both rounds · **Rounds:** 2
- **Why Opus (not Fable):** no one-way door — a demo-data + type-alias change with no public contract,
  no schema, no auth boundary, no migration. Per the Autonomy ladder this is the default tier.
- **Round 1 → GAPS (8).** The load-bearing ones: (1) the new provenance comment claimed the mock entry
  mirrored upstream "exactly" while `schema_version`, `description` and `voting.quorum` all contradicted
  it; (3) the corrected union member was data-only — `MOCK_RUNTIME_POLICIES` reused indices 0/1/3, so
  `designated_role` never reached a screen, contradicting the phase's own Delivers line; (4) the
  exhaustiveness anchor's enforcement silently depended on `tsconfig` including test files; (2) a +13
  line drift in `lib/types.ts` invalidated later phases' citations. Plus two tautological tests, an
  import-path nit, and two out-of-scope observations.
- **Fixes:** brought the mock entry into field-for-field agreement with upstream (fixing the data, not
  weakening the comment) and pinned it with a whole-object `toEqual`; appended a 4th
  `MOCK_RUNTIME_POLICIES` entry so `designated_role` renders on demo `/policies` and
  `getRuntimePolicy('policy.lending.conservative')` resolves instead of throwing; documented both of the
  anchor's fragilities and the fallback; recorded the line drift here; dropped the two tautologies;
  switched to the `@/` alias. Plan text corrected inline where implementation reversed it (the
  "display-inert" edge case, the "two assertions" test note, and a stale `policy-authoring.md` citation
  whose vendored copy says the opposite of upstream).
- **Round 2 → PASS.** All 8 confirmed closed, all five ACs met, negative control re-run independently
  (deleting a union member fails `tsc` with the intended TS2353 from the anchor). One new doc-only item
  (NEW-1: the round-1 fixes falsified two planning statements) — closed in this same commit.
- **Files touched:** `lib/types.ts`, `lib/data/mock-data.ts`, `lib/data/mock-data.test.ts` (new),
  `plans/absorb-control-plane-playground-sep-2026.md`, `PROGRESS.md`, `ASSUMPTIONS.md`. No `docs/` or
  `CLAUDE.md` update — Phase 1's `Docs` field is "None in this phase".
- **Assumptions logged:** the `CommitmentAuthority` guard is compile-time only; real-mode policy rules
  arrive as `Record<string, unknown>` and are never narrowed. UNCONFIRMED.
- **Gates:** typecheck clean · 36 files / 395 tests passing · lint clean · format:check clean.
- **Next:** P2 — surface non-canonical supersedes hashes.

### P2 — Surface non-canonical supersedes hashes — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, both rounds · **Rounds:** 2
- **Why Opus (not Fable):** no one-way door — an optional field on a mirrored type plus a display badge.
  Nothing irreversible, no trust boundary.
- **Round 1 → GAPS (6). The headline finding is that the PLAN'S OWN PREMISE WAS FALSE.** The plan
  asserted that the mid-stream SSE snapshot bypasses `ProjectionService.get()`, so `canonical ===
  undefined` reaches the console from a *current* control plane. It does not: `applyAndPersist` calls
  `this.get(runId)` on its first line (`macp-control-plane/src/projection/projection.service.ts:72`) to
  load the base state before reducing, so the backfill at `:46` runs on the streaming path too, and the
  `upsert` at `:75` persists the healed value. I had faithfully copied that false claim into four
  places, one of them shipped documentation.
- **The conclusion survived; only the justification was wrong.** The real reason to type `canonical`
  optional and gate on `=== false` is **control-plane version skew**: a CP deployed before the backfill
  existed genuinely sends `undefined`, and such a row is never rewritten — only re-derived when a new
  `decision.finalized` arrives. The CP's own `ASSUMPTIONS.md` P6 documents exactly this and names *this
  repo's* `decision-panel.tsx` as the blast radius, warning that `if (!canonical) badge()` would
  mis-label legacy-but-actually-canonical history. That is a stronger justification than the draft's,
  and the current CP contract declares the field required
  (`macp-control-plane/src/contracts/control-plane.ts:296`), which the docs now say.
- **Other gaps closed:** badge `tone="warning"` was unasserted (a regression to any other tone shipped
  green) — now pinned with `toHaveClass('badge-warning')`; the explanatory copy and its second
  `=== false` gate had zero assertions — now asserted present/absent across all three states; demo
  fixtures had no test despite being the only backend-free path to the badge — now four tests,
  including a hash-shape check using the CP's own `CANONICAL_COMMITMENT_HASH_RE` verbatim; and a
  truncated hash could hide the very defect being badged — the full value now rides on a `title`
  attribute, tested with a 71-char hash.
- **Round 2 → PASS.** All six confirmed closed, and the reviewer independently re-derived the corrected
  control-plane claims from source rather than accepting the edit. Negative control re-run: flipping the
  gate to `!canonical` fails exactly the `undefined` test.
- **Files touched:** `lib/types.ts`, `components/runs/decision-panel.tsx`,
  `components/runs/decision-panel.test.tsx`, `lib/data/mock-data.ts`, `lib/data/mock-data.test.ts`,
  `docs/api-integration.md`, plan, `PROGRESS.md`.
- **Assumptions logged:** none new — the version-skew rationale is now sourced to the CP's own
  ASSUMPTIONS P6 rather than assumed here.
- **Gates:** typecheck clean · 36 files / 404 tests passing · lint clean · format:check clean.
- **Next:** P3 — structured error codes on `ApiError` (P4, P5, P6 all depend on it).

### P3 — Structured error codes on `ApiError` — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, all three rounds · **Rounds:** 3
- **Why Opus (not Fable):** additive changes to one error class. No public contract, no migration,
  no trust boundary. `.message` semantics were explicitly preserved, so nothing one-way.
- **Round 1 → GAPS (7).** Again the biggest finding was a **false claim inherited from the plan**:
  that the CP's throttler 429 uses the no-`errorCode` envelope. It does not.
  `GlobalExceptionFilter` has a **third** path the plan never mentioned — a *string*-bodied
  `HttpException`, and any unhandled error, are rewritten to
  `{statusCode, errorCode: 'INTERNAL_ERROR', message}` (`exception.filter.ts:19-37`) — and
  `ThrottlerException` carries a string body, so **a rate limit arrives labelled `INTERNAL_ERROR`**.
  That matters directly for P4/P5/P6, which branch on `errorCode`: a *present* code is not always a
  real classification. Documented in the type, the docs and the plan.
- **Other round-1 gaps closed:** `describeApiError` returned an unbounded upstream body from a
  function explicitly labelled "fit for a user" — a multi-MB nginx page could reach the UI; now
  capped at 500 chars while `detail`/`message` stay uncapped for logging and matching. The
  `#parsed` null-memo branch was untested — proven by a mutant that made every non-JSON body
  re-parse on every access and still passed 37/37; now killed by a spy test.
  `isRegistryReadOnlyError`'s new structured check sat *after* the 405 short-circuit while being
  called the "preferred path" — reordered and honestly commented, with a non-405 test. Plus a weak
  assertion that would have passed for `undefined`, four untested guards, and an undocumented
  contract row.
- **Round 2 → GAPS (2, doc-only).** The corrected docs table over-generalised in the other
  direction: an object-bodied Nest exception is emitted *verbatim*, so a hand-built one keeps its
  own code — the CP does exactly that for `ENDPOINT_REMOVED`. And the "parsed object with no usable
  `message` → raw JSON" fallback was tested but undocumented in all three places it should appear.
- **Round 3 → PASS.** Both closed; wording independently re-derived from CP source, including that
  the three `ENDPOINT_REMOVED` routes really are `POST /runs/:id/{messages,signal,context}`.
- **Files touched:** `lib/api/fetcher.ts`, `lib/api/fetcher.test.ts`, `docs/api-integration.md`,
  plan, `PROGRESS.md`.
- **Assumptions logged:** none new.
- **Note for later phases:** `describeApiError` has no production caller yet — P6 is the first, by
  design. P4/P5 should branch on `errorCode` only for codes they handle (`CIRCUIT_BREAKER_OPEN`,
  `RUNTIME_UNAVAILABLE`) and treat everything else, `INTERNAL_ERROR` included, as unclassified.
- **Gates:** typecheck clean · 36 files / 423 tests passing · lint clean · format:check clean.
- **Next:** P4 — runtime session drift types, client and demo data.

### P4 — Runtime session drift: types, client, demo data — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, both rounds · **Rounds:** 2
- **Why Opus (not Fable):** a data-layer seam — one client function, local types, demo data. No UI,
  no caller yet, nothing irreversible.
- **Every upstream claim the plan made about the CP checked out this time** (unlike P2 and P3): the
  route, the null-iff-incomplete rule, the soundness of `untrackedSessions` under truncation, the
  `starting` exclusion, the live-vs-retained count asymmetry, all five error codes, and that no
  proxy allowlist change is needed. Only line citations had drifted.
- **Round 1 → GAPS (9), three of them real defects in shipped code, not missing tests:**
  - **The demo payload described a state the control plane cannot produce.** With 5 live sessions
    of which 1 was untracked and only 4 tracked runs, the controller's own logic forces
    `missingFromRuntime: []` — yet the payload claimed one missing run. The fixture and one test
    override had the same flaw. Fixed by deriving the real bound
    (`live − untracked + missing ≤ trackedRunCount`), correcting the numbers, and asserting the
    invariant in a test so it cannot drift again.
  - **The demo's "missing" run was a terminal one** (`FAILED_RUN_ID`), which `listActiveRuns()`
    excludes — and it named a `runtimeSessionId` that contradicted that run's own. Now
    `SUSPENDED_RUN_ID` with its real session id.
  - **`modeVersion`/`initiator` arrive as empty strings, not absent** — proto3 string defaults
    survive the CP's `?? undefined`. A `—`-for-absent renderer using `??` would show blank cells.
    Documented and pinned with a bare-snapshot test.
  - Untested error paths that the plan itself had named: 429/`RATE_LIMITED`, 500/`INTERNAL_ERROR`,
    and most importantly the CP throttler's 429 arriving labelled `INTERNAL_ERROR` — the one case
    where `errorCode` actively lies, and the one P5 must not render.
  - The fixture was not tied to the declared type (`fetchJson` blind-casts, so nothing would catch
    drift). Now annotated with the interface as its return type — `satisfies` was tried first and
    was wrong: it kept the literal's narrow inferred shape and broke `Partial<>` overrides.
  - Two findings promoted to decisions rather than silent fixes: **D14** (`retry: false` on P5's
    query — the global `retry: 1` fires a second full gRPC drain on a 503, exactly when the runtime
    is unhealthy) and **D15**/**D16**.
- **Round 2 → GAPS (1, docs-only).** Adding D14 left two passages in the plan still saying to keep
  the global retry — a self-contradiction a P5 implementer could have followed. Both corrected.
- **Files touched:** `lib/api/client.ts`, `lib/api/client.test.ts`, `lib/api/client.real-mode.test.ts`,
  `test/integration/fixtures/backend-responses.ts`, plan, `PROGRESS.md`.
- **Carried into P5:** `retry: false` (D14); render `modeVersion`/`initiator` with `||` not `??`;
  never render `errorCode` verbatim; cap rendered rows — the response is bounded at 40,000 snapshots.
- **Gates:** typecheck clean · 36 files / 437 tests passing · lint clean · format:check clean.
- **Next:** P5 — the Infrastructure-tab drift UI.

### P5 — Runtime session drift: Infrastructure-tab UI — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, both rounds · **Rounds:** 2
- **Why Opus (not Fable):** a read-only diagnostic card on an existing tab. No trust boundary, no
  one-way door, no cross-repo write. The one genuinely load-bearing choice — that the endpoint fires
  only on an explicit click — was already settled by the plan and by D14.
- **Every CP claim the plan made checked out**, verified against control-plane source in both rounds:
  the route (`admin.controller.ts:11,43`), `trackedRunCount` including `starting` runs (`:129`),
  `missingFromRuntime` excluding them (`:117`), null-iff-incomplete (`:115-120`), and all five error
  codes. P5 is the second phase running (after P4) where the plan's upstream claims held.
- **Round 1 → FAIL (2 blocking), both real defects in shipped code:**
  - **The missing-runs table capped at 50 rows silently.** Only the untracked table disclosed its
    cap, and there was no KPI tile for the missing count, so the number appeared nowhere on screen.
    `listActiveRuns()` is unbounded upstream (`run.repository.ts:178-183`), and the headline scenario
    for this whole panel — a runtime restart that drops every session — produces exactly this shape.
    The verifier demonstrated a 300-run response rendering 50 rows with no "showing" text anywhere:
    a drift panel under-reporting drift 6×. Fixed by hoisting a shared `RowCapNote` used by both
    tables (**D17**) plus an explicit count sentence above the missing-runs table.
  - **The `retry: false` test could not fail.** `test/test-utils.tsx:9` already sets `retry: false`
    on the test client, so the assertion held with the component's own option deleted — the one
    decision the plan calls "required, not stylistic" (D14) was unprotected. Now rendered under a
    client mirroring `providers.tsx` (`retry: 1`) (**D18**). Falsifiability proven by deleting
    `retry: false` and observing exactly that one test fail, then restoring.
- **All four round-1 non-blocking observations adopted**, not deferred: the error state moved from
  `muted small` to the repo's bordered notice idiom (`policy-management.tsx:66-72`); a
  `checked <timestamp>` stamp via `dataUpdatedAt`; 429 copy rewritten to be true of *both* the CP
  throttler and the runtime's page-size-budget `RATE_LIMITED`; and a redundant
  `new Date(ms).toISOString()` round-trip dropped — which also removed a latent `RangeError` on an
  absent timestamp.
- **Round 2 → PASS**, with three observations about *untested* new behaviour. Rather than accept
  them, added four more tests: the cap note's own boundary (a `total < shown` slip would print
  "Showing 50 of 50"), the singular/plural count, the `checked` stamp, and that a later failure
  drops the stale badge and timestamp (**D19**). Both new guards mutation-proven to fail.
- **Verified by diff, not by test** — as the plan requires and asks to be called out at PR time:
  the card's placement on the Infrastructure tab, and `'Drift'` reaching `subsidiaryErrors`. There
  are still zero tests under `app/`.
- **Files touched:** `components/observability/runtime-session-drift.tsx` (new),
  `components/observability/runtime-session-drift.test.tsx` (new, 21 tests),
  `app/observability/page.tsx`, plan, `PROGRESS.md`.
- **Carried into P6:** assert on the inline `.error-text` div, never the toast — there is no
  `ToastProvider` in `test-utils`; and give the new select an accessible name rather than indexing
  `getAllByRole('combobox')`.
- **Gates:** typecheck clean · 37 files / 458 tests passing · lint clean · format:check clean ·
  `next build` clean (criterion 6's build half).
- **Next:** P6 — constrain policy `schemaVersion` to {1,2,3}.

### P6 — Constrain policy `schemaVersion` to {1, 2, 3} — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent · **Rounds:** 1 (first phase to pass in one)
- **Why Opus (not Fable):** a form control and a request-type narrowing. The only irreversible-looking
  part — narrowing a published type — is deliberately confined to the *request* side, so nothing that
  reads from the CP can be broken by it.
- **The plan's four line citations into `lib/types.ts` and `lib/api/client.ts` were all stale**
  (off by 38 and 113 respectively, from P1's and P4's insertions) — found by symbol, as the repo map
  instructs. Its *behavioural* claims all held.
- **One plan claim disproved, caught during implementation rather than by the verifier.** The plan
  says to reset `schemaVersion` in `onSuccess` "so a second registration starts from the default
  rather than inheriting the last choice". It cannot inherit anything: `onSuccess` closes the form and
  the parent renders it as `{showForm && <RegisterPolicyForm …/>}`, so the component unmounts and
  every field is recreated at its default. All four resets there are dead code. The line was kept as
  documented belt-and-braces, and the test asserts the operator-visible path — register, reopen, see
  3 — instead of state after submit. The verifier confirmed this three ways, including by deleting
  all four resets and watching every test stay green.
- **A claim that was right by luck.** The plan asserts the 400 carries no `errorCode`, citing only the
  `BadRequestException`. It never mentions the CP's `GlobalExceptionFilter`, whose string-body branch
  *does* inject `INTERNAL_ERROR`. The claim survives only because `BadRequestException(string)` yields
  an **object** body, taking the verbatim branch. Verified at source this time rather than assumed.
- **Verifier observations adopted rather than deferred:** the `<option>` list is now generated from
  `POLICY_SCHEMA_VERSIONS` so options and union cannot drift (**D20**); forward-compatibility of the
  *response* type is now pinned by a test rendering a `schemaVersion: 7` policy (**D21**) — previously
  asserted only by a comment; `undefined as never` mocks replaced with the real return shape; and the
  Target-mode select got the accessible name the phase had given only to its own control.
- **Deliberately not done:** the optional demo-mode rejection branch — the plan itself states it is not
  an acceptance criterion, and once the request type is narrowed an invalid value is unrepresentable
  without a cast. The four dead `onSuccess` resets are left for a cleanup pass rather than widened here.
- **Files touched:** `lib/types.ts`, `components/settings/policy-management.tsx`,
  `components/settings/policy-management.test.tsx`, `docs/api-integration.md`, `PROGRESS.md`.
- **Gates:** typecheck clean · 37 files / 463 tests passing · lint clean · format:check clean ·
  `next build` clean.
- **Next:** P7 — absorb `controlPlaneRun` from the playground bootstrap.

### P7 — Absorb `controlPlaneRun` from the playground bootstrap — **PASS**

- **When:** 2026-09-23 · **Verifier:** fresh Opus subagent, all three rounds · **Rounds:** 3 (the cap)
- **Why Opus (not Fable):** no trust boundary and no cross-repo write — the compose file edited here is
  this repo's own. The redirect change is user-visible but fully reversible.
- **The most consequential finding of the whole run, and the plan pointed straight past it.** The plan
  warned that `controlPlaneRun.runId` and `sessionId` are different ids — then applied that warning
  only to an *unreachable* branch ("`controlPlaneRun` present but `sessionId` absent", which the
  playground never produces) and left the reachable path redirecting to `sessionId` first. Verified at
  source: `run-executor.service.ts:141` calls `createRun(request, sessionId)` with **no**
  `explicitRunId`, so `run-manager.service.ts:39` mints a fresh UUID and keeps the session id in a
  separate column. `/runs/live/:id` resolves by run id, so the phase's own happy path 404'd. Now
  navigates by `controlPlaneRun.runId` only (**D22**).
- **The inverse is true on the other branch, which made the first warning copy false.** Session
  discovery — `SESSION_DISCOVERY_ENABLED`, default **true** — registers runs it observes from the
  runtime with `createRun(descriptor, sessionId, sessionId)`, i.e. keyed *by session id*. So when the
  Example Service fails to register, `/runs/live/<sessionId>` is exactly the route that eventually
  works. The banner had asserted the run "will not appear under Runs" and the live view "has nothing
  to load" — both false in the default configuration.
- **Round 2 caught the rewrite repeating the error in softer words** ("shows nothing until then"): the
  live route renders an `ErrorPanel`, not an empty page. That is the same gap surviving two rounds, so
  round 3 was scoped narrowly to the copy and treated as final. The banner now states only what is
  checkable: what the Example Service returned, that the page cannot tell whether discovery has run,
  that the route reports an error until it does, and that it may never — if the submission reached the
  CP and only the reply was lost, a run exists under another id and discovery short-circuits on
  `findBySessionId` rather than creating a second (**D23**).
- **Three more plan errors**, all confirmed: the omitted-field failure list was missing three classes
  (missing `status`, missing `sessionId`, session-id mismatch); `controlPlaneRun.sessionId` is
  *guaranteed equal* to the top-level one (the playground rejects a mismatch) so the plan's "lossy in
  the safe direction" note was aimed at the wrong field; and `docker-compose.local.yml:22` already set
  `MACP_CONTROL_PLANE_API_KEY`, so only the **URL** was actually missing from `local:up`.
- **Also fixed while here:** `Badge` title-cases its label, so ids rendered as `Run Abc` and a UUID was
  mangled outright — ids now render in `<code>` (**D24**), which also repairs the pre-existing session
  badge; a `next/link` replaced the only raw internal `<a href>` in `app/`; the previous attempt is
  cleared when a new bootstrap starts, so a failure cannot render beside a stale success; and the flow
  gained its first error surface at all — a failed bootstrap previously just stopped the spinner.
- **Two tests added for claims nothing defended:** demo mode returns a `controlPlaneRun` whose `runId`
  actually exists in `MOCK_RUNS` (deleting the field had survived the entire suite — the plan called
  this "the single highest-probability bug in the phase"), and the success path shows no warning.
- **Known limitation, not fixed:** "Agents are live" is itself unchecked. The playground's host provider
  can return `status: 'resolved'` with `processAttached: false` on a manifest-validation failure, so an
  agent may never have launched. Checking needs `hostedAgents` to stop being
  `Array<Record<string, unknown>>` — a type change beyond this phase's scope. Recorded for /reconcile.
- **Files touched:** `lib/types.ts`, `lib/api/client.ts`, `lib/api/client.test.ts`,
  `app/runs/new/page.tsx`, `app/runs/new/page.test.tsx` (new — the repo's first test under `app/`),
  `test/integration/scenarios-catalog.integration.test.ts`, `docker-compose.e2e.yml`,
  `docs/api-integration.md`, `PROGRESS.md`.
- **Gates:** typecheck clean · 38 files / 475 tests passing · 5 files / 95 integration tests passing ·
  lint clean · format:check clean · `next build` clean.
- **Next:** P8a — SSE resume-cursor correctness.

### Pre-phase — test-infrastructure repair (commit `f704c29`)

`lib/stores/preferences-store.test.ts` was failing 8/8 on `main` before any plan work (verified by
stashing and re-running there). Vitest 4 no longer copies `localStorage`/`sessionStorage` onto the test
global and rebinds `window` to `globalThis`, so jsdom's own `Storage` is unreachable and zustand's
`persist` middleware sees `undefined`. Fixed with a real jsdom document origin plus an in-memory
`Storage` shim cleared between tests. Committed separately because §1 forbids proceeding on a red build
and every phase gate depends on a green suite. Logged UNCONFIRMED in `ASSUMPTIONS.md`.
