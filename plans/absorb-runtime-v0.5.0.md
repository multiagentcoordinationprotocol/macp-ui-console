# Plan — Absorb macp-runtime v0.5.0 / macp-proto 0.1.4–0.1.6 into macp-ui-console

**Status:** implemented (F, A, C, D, E, G, I landed; B skipped; H pending live stack) ·
**Scope:** macp-ui-console (Next.js) · **Upstream:** macp-runtime v0.5.0, macp-proto
0.1.4 → 0.1.6, spec updates — consumed **via the macp-control-plane** (and the
macp-playground Examples Service for launch compilation).

## Implementation note (2026-07-07)

Both upstreams shipped their v0.5.0 absorptions before this work (see
`../macp-control-plane/plans/absorb-runtime-v0.5.0.md` and
`../macp-playground/plans/absorb-runtime-v0.5.0.md`), which pinned two contracts this plan
had left open:

- **CP did NOT add a `GET /runtime/metrics` passthrough** (its item 15 = "NO IMPACT —
  ops opportunity"). Runtime Prometheus metrics stay an ops-only surface. **Task B was
  therefore skipped** — there is no backend endpoint to consume, and the fallback
  third-proxy service was declined as out of proportion.
- **Read-only policy registry** returns **HTTP 405 `REGISTRY_READ_ONLY`** (CP T9), and
  **handoff `implicit`** is carried on the CP contribution/normalizer (CP T5). ES added
  `sessionStart.maxSuspendMs` and deleted `sessionStart.context` (ES T8/T4).

Landed on branch `feat/absorb-runtime-v0.5.0`, one commit per task, full CI gate green
(format + lint + typecheck + 390 vitest tests + build):

- **F** — compose pinned to `ghcr.io/…/macp-runtime:0.5.0` + `MACP_METRICS_ADDR`/9464;
  mock manifest `protocolVersion` → 0.5.0.
- **A** — real session vocabulary in `summarizeEvent` + `/logs` group; `run.suspended`/
  `.resumed`; base64url breadcrumb ids; suspended + cancelled demo runs; fixture fix.
- **C** — `isImplicitAccept()` + implicit badge in feed / `/logs` / event dialog + mock.
- **D** — `/modes` terminal types; all-six-modes mock rewrite; read-only policy banner.
- **E** — `sessionStart.maxSuspendMs` + "Max suspend" badge; removed dead `context`.
- **G** — external-orchestrator (initiator ∉ participants) resilience test.
- **I** — docs: api-integration, in-app `/docs`, README, feature-matrix, changelog.
- **B** — *skipped* (no CP endpoint; see above).
- **H** — *pending*: live e2e matrix needs `npm run local:up` against the pinned stack;
  not runnable in this pass. Unit/mock coverage stands in until then.

---

## 1. Context — what this app is and how it consumes the runtime

The console is a Next.js 16 (App Router) observability + orchestration UI. **It never
talks to the runtime's gRPC surface directly.** All data flows:

```
Browser → app pages → lib/api/client.ts → lib/api/fetcher.ts
        → /api/proxy/[service]/[...path]  (app/api/proxy/[service]/[...path]/route.ts)
        → macp-playground (scenario catalog / launch compile)
        → macp-control-plane (runs, events, SSE, metrics, runtime metadata, policies)
```

Evidence:

- `lib/server/integrations.ts:1` — `export type ProxyService = 'macp-playground' | 'macp-control-plane';`
  These are the **only** two upstreams the proxy will forward to. There is no runtime
  gRPC client, no proto dependency, and no `macp-proto` entry in `package.json`.
- Runtime-derived data reaches the console only through control-plane HTTP endpoints:
  `getRuntimeManifest/Modes/Roots/Health` → CP `/runtime/*` (`lib/api/client.ts:696-714`),
  `listRuntimePolicies/register/unregister` → CP `/runtime/policies*` (`lib/api/client.ts:1193-1233`),
  runs/events/state/metrics → CP `/runs*` (`lib/api/client.ts:257-380`).
- Live streaming is **SSE from the control-plane**, not gRPC watch streams:
  `lib/hooks/use-live-run.ts:105-107` opens
  `EventSource('/api/proxy/macp-control-plane/runs/:id/stream?includeSnapshot=true&afterSeq=…')`
  with its own exponential-backoff reconnect (`use-live-run.ts:81-98`, max 8 attempts)
  and heartbeat timeout (45 s). This is the only `EventSource` in the codebase.
- "Runtime health" UI: `/observability` (`app/observability/page.tsx:86,200-207,346-467`)
  renders `getRuntimeHealth()` (CP `/runtime/health` → `{ok, runtimeKind, detail}`), the CP
  readiness probe (`/readyz`, including a `runtime` sub-check, `lib/types.ts:820-826`),
  and a raw-Prometheus tab that fetches **the control-plane's own** `/metrics`
  (`lib/api/client.ts:978-982` → `/api/proxy/macp-control-plane/metrics`) and parses it
  client-side (`lib/utils/prometheus.ts`, used at `app/observability/page.tsx:105-120`).
  **Nothing in the console reads runtime-process metrics today.**
- Demo mode (`NEXT_PUBLIC_MACP_UI_DEMO_MODE`, default true) branches every client
  function to `lib/data/mock-data.ts`; the mock dataset is part of the absorption
  surface (stale descriptors/versions show up in demos).

Current dependency/image versions:

- `package.json:3` — console itself `0.1.0`; deps are UI-only (React 19, Next 16,
  React Query 5, Recharts 3, xyflow 12). No MACP packages.
- `docker-compose.e2e.yml:61` — runtime image `${MACP_RUNTIME_IMAGE:-macp-runtime:latest}`
  (locally built tag, not ghcr, not version-pinned).
- `docker-compose.e2e.images.yml:9-23` — pinned sibling images `macp-auth-service:0.1.3`,
  `macp-control-plane:0.1.3`, `macp-playground:0.4.0`.
- `lib/data/mock-data.ts:1584` — mock runtime manifest advertises `protocolVersion: '0.4.0'`.

Cross-repo dependency (critical): **the control-plane has not yet written its own
v0.5.0 absorption plan** — `../macp-control-plane/plans/current/` is empty as of this
writing. Most console items below are display-completeness work that can land now,
plus a contingent tier that needs CP endpoints/vocabulary to exist first. This mirrors
the structure of `plans/macp-proto-0.1.3-suspend-cancel-supersede.md`, whose items
have since landed (SessionState, suspend/resume actions, tones) — this plan builds on
that baseline.

---

## 2. Impact matrix

Every inventory item mapped. "CP" = macp-control-plane, "ES" = macp-playground
(Examples Service). Effort: S < ½ day, M ≈ 1–2 days, L > 2 days.

| # | Change | Verdict | Effort |
|---|--------|---------|--------|
| 1 | Runtime Prometheus metrics (`MACP_METRICS_ADDR`) | **Impacted** — new Runtime metrics surface on `/observability`; contingent on CP passthrough | M |
| 2 | Six session lifecycle states | **Impacted (gaps only)** — 0.1.3 work already landed; log filter groups, `summarizeEvent`, mock/fixture coverage missing | S–M |
| 3 | ListSessions pagination (proto 0.1.6) | **No console impact** — console never calls ListSessions; CP-internal | — |
| 4 | Handoff synthetic implicit accepts | **Impacted** — transcript/feed rendering should distinguish implicit accepts | S |
| 5 | Multi-round `ContributePayload` protobuf (0.1.4) | **No console code impact** — decoding is CP's job; verify + demo data only | S |
| 6 | Watch-stream lag termination / WatchSignals auth / passive-subscribe ordinals | **No direct impact** — console consumes CP SSE only; verify CP reconnect in e2e | S (verify) |
| 7 | `SessionStartPayload.max_suspend_ms` (0.1.5) | **Impacted (contingent)** — launch summary/preview types + display | S |
| 8 | Dev mode requires `MACP_ALLOW_INSECURE=1` | **Already satisfied** in compose; re-verify on image bump | — |
| 9 | HS256 off default JWT allowlist | **No impact** — auth-service mints RS256/ES256 | — |
| 10 | Commitment empty `policy_version` echo | **No impact** — console never constructs commitments | — |
| 11 | Task-mode external orchestrator (initiator ∉ participants) | **Low impact** — defensive rendering verified; add test + demo fixture | S |
| 12 | Ext-mode descriptor rules + wire-read-only policy registry | **Impacted** — stale mock descriptors; `/policies` mutation UI must surface read-only registry gracefully | S–M |
| 13 | Roots `list_changed: false` | **No impact** — console polls roots once, never watches | — |
| 14 | 36-char base64url session IDs | **Minor** — breadcrumb ID heuristic; docs claim "UUID v4" | S |
| 15 | Runtime image ghcr v0.5.0 | **Impacted** — pin compose image; bump mock protocol version | S |
| 16 | Conformance fixtures canonical in spec repo | **No impact** — console uses its own CP HTTP fixtures | — |
| 17 | `SessionStartPayload.context` bytes removed | **Impacted** — deprecated `context` field in launch types + demo compile mock | S |

### Item-by-item detail

#### 1. Runtime metrics endpoint — IMPACTED (the "runtime health" placeholder finally gets data)

What exists today:

- `/observability` "Runtime health" KPI card (`app/observability/page.tsx:200-207`) shows
  only `Healthy/Degraded` + `runtimeKind` from CP `/runtime/health`, whose whole payload
  is `{ok, runtimeKind, detail, manifest?}` (`lib/types.ts:600-605`). CP derives it by
  calling `GetManifest` and reporting `ok: true` on success
  (`macp-control-plane/src/runtime/rust-runtime.provider.ts:421-427`) — a liveness
  probe that carries **no counters**.
- The "Metrics" tab and latency-percentile cards parse the **CP's** `/metrics` exposition
  (`app/observability/page.tsx:87-120`, `lib/api/client.ts:978-982`). Runtime counters
  never appear there.

What v0.5.0 provides (verified in the runtime repo):

- Per-mode counters, all labeled `{mode="…"}`: `macp_messages_accepted_total`,
  `macp_messages_rejected_total`, `macp_sessions_{started,resolved,expired,cancelled,suspended,resumed}_total`,
  `macp_commitments_{accepted,rejected}_total`
  (`macp-runtime/src/metrics.rs:199-216`) plus the global
  `macp_replay_mismatches_total` (`macp-runtime/src/main.rs:473`), served on
  `MACP_METRICS_ADDR` as Prometheus text.

Data-path decision needed (blocked on CP plan): the browser cannot reach
`MACP_METRICS_ADDR` (it's a runtime-side HTTP listener on the Docker network), and the
console proxy only knows the two `ProxyService` upstreams. Two options:

- **(preferred) CP passthrough** — CP adds `GET /runtime/metrics` (fetches
  `MACP_METRICS_ADDR`, re-serves text). Console adds `getRuntimeMetricsText()` next to
  `getObservabilityRawMetrics()` and reuses `parsePrometheusText()` unchanged (it already
  handles labels — see `PrometheusMetricsTable` label breakdown).
- (fallback) add a third proxy service (`runtime-metrics`) to
  `lib/server/integrations.ts` + a `MACP_RUNTIME_METRICS_BASE_URL` env var. Works
  without CP changes but bypasses the "CP is the only runtime reader" architecture and
  needs its own deploy plumbing. Only take this if CP declines the passthrough.

Console work (§3 task B): new "Runtime" section under the `/observability` Metrics tab —
per-mode accepted/rejected + commitment counters (bar or table via existing
`PrometheusMetricsTable`), suspended/resumed counts, and a visible
`macp_replay_mismatches_total` health indicator (a non-zero value is a durability red
flag and belongs next to the Runtime-health KPI, not buried in a table). Extend
`MOCK_PROMETHEUS_METRICS` (`lib/data/mock-data.ts:1637`) — it currently contains only
three CP-flavored series — with realistic runtime series so demo mode exercises the UI.
Also add the compose wiring: `MACP_METRICS_ADDR: "0.0.0.0:9464"` on the `runtime`
service in `docker-compose.e2e.yml` (the endpoint is opt-in; today nothing sets it, so
even a v0.5.0 image would expose nothing).

#### 2. Six lifecycle states — PARTIALLY ABSORBED; close the gaps

Already landed via the 0.1.3 plan (verified, no action):

- `SessionState` union includes `SUSPENDED`/`CANCELLED` (`lib/types.ts:12-20`);
  `RunStatus` includes `suspended` (`lib/types.ts:1-10`).
- Session-state badge tones handle OPEN/RESOLVED/SUSPENDED/danger-fallback
  (`components/runs/run-overview-card.tsx:100-114`) — EXPIRED and CANCELLED both fall
  to `danger`, acceptable.
- `getStatusTone` covers `suspended` (warning) and `cancelled`/`expired` (danger)
  (`lib/utils/format.ts:73-80`).
- Dashboard has a Suspended KPI (`app/page.tsx:151-153`), runs filter has
  `suspended`/`cancelled` options (`app/runs/page.tsx:195-198`), live page merges
  suspended runs (`app/runs/live/page.tsx:18-24`), suspend/resume/cancel actions exist
  (`components/runs/run-overview-card.tsx:165-182`, `lib/api/client.ts:605-633`).

Remaining gaps (action):

- **Session canonical-event vocabulary is stale, not just incomplete.** The `/logs`
  Session filter group (`app/logs/page.tsx:35`) is
  `['session.opened', 'session.resolved', 'session.expired']` — but the CP's canonical
  vocabulary contains **none of those**. Its actual session events are
  `session.bound`, `session.stream.opened`, `session.state.changed`
  (`macp-control-plane/src/contracts/control-plane.ts:133-135`; suspend/resume/cancel/
  resolve/expire transitions all arrive as `session.state.changed` with `data.state`).
  So against a real CP the Session filter matches nothing and every session event
  lands in the untyped "other" bucket. **Replace** the group with the real vocabulary
  (optionally keep the legacy three so old exports/demo data still group).
- **`summarizeEvent`** (`lib/utils/events.ts:40-55`) has the same stale cases
  (`session.opened/resolved/expired`) and no `run.suspended`, `run.resumed`, or
  `session.state.changed` — all real session events fall to the generic fallback. Add
  summarizers (`session.state.changed` should print `data.state`, e.g.
  "Session → SUSPENDED"), keep the legacy cases.
- **The integration fixture uses the phantom type too**:
  `test/integration/fixtures/backend-responses.ts:120` emits `'session.opened'`,
  which the CP never produces — fix to `session.bound`/`session.state.changed` so the
  integration tests exercise reality.
- **Demo/mock coverage**: `lib/data/mock-data.ts` contains **no** run with status
  `suspended` or `cancelled` (only the KPI computation at `mock-data.ts:1783` mentions
  them) and no `SESSION_STATE_SUSPENDED`/`CANCELLED` metrics sample
  (`mock-data.ts:1337-1391` are all OPEN/RESOLVED). Demo mode therefore never renders
  the suspended badge path, the Resume button, or the suspended KPI ≠ 0. Add one
  suspended and one cancelled mock run + metrics entries.
- **Integration fixtures**: `test/integration/fixtures/backend-responses.ts:140` only
  uses `SESSION_STATE_OPEN`; statuses are running/completed/queued. Extend alongside
  the tests in task A.

#### 3. ListSessions pagination — NO CONSOLE IMPACT

The console has no code path that calls the runtime's `ListSessions`. Session lists in
the UI are CP **runs**: `listRuns()` hits CP `GET /runs?limit&offset…`
(`lib/api/client.ts:287-306`) which is already paginated (`ListRunsQuery.limit/offset`,
`lib/types.ts:787-800`), and the runs page caps at `limit=200`. The proto 0.1.6
`page_size/page_token` fields concern the CP's session-discovery loop. No console
change; the CP absorption plan owns it. (If CP later exposes `nextPageToken` on `/runs`,
that's an ordinary CP API change, not part of this absorption.)

#### 4. Handoff implicit accepts — IMPACTED (transcript rendering)

How these will reach the console (verified in CP source):

- CP maps `HandoffAccept` → canonical `proposal.updated`
  (`macp-control-plane/src/events/event-normalizer.service.ts:404-426`) and decodes the
  payload via `HandoffAccept: 'macp.modes.handoff.v1.HandoffAcceptPayload'`
  (`src/runtime/proto-registry.service.ts:36`), placing it on `data.decodedPayload`.
  The projection already treats `HandoffAccept` as an `allow` vote
  (`src/projection/projection.service.ts:723-735`).
- The runtime-synthesized envelope has `sender = target_participant`,
  `messageId = implicit-accept:<handoff_id>`, and `decodedPayload.implicit = true`.

Console impact: nothing crashes today — the event renders as a normal
`proposal.updated` row and looks **exactly like an explicit accept by the target
participant**, which is misleading in a transcript (the participant never sent it).

Action (§3 task C):

- `summarizeEvent` `proposal.*` case (`lib/utils/events.ts:91-109`): when
  `data.decodedPayload?.implicit === true` **or** the event/message id starts with
  `implicit-accept:`, append an `· implicit (runtime)` marker.
- `LiveEventFeed` row + `EventDetailDialog` meta: show an `implicit` badge (tone
  `neutral`/`info`) so runtime-emitted accepts are visually distinct from agent-sent
  ones. Detection helper goes in `lib/utils/macp.ts` so both the feed and `/logs` share
  it.
- Add a handoff-mode mock event with `decodedPayload: {implicit: true}` to
  `MOCK_RUN_EVENTS` so demo mode and unit tests exercise the path.

Field-name caveat: the exact JSON casing CP emits for the decoded proto
(`implicit` vs `implicitAccept`, and where the message id surfaces on canonical events)
must be confirmed against the CP build once its absorption lands — detect both
spellings defensively.

#### 5. Multi-round Contribute protobuf — NO CONSOLE CODE IMPACT (verify only)

The console never decodes payload bytes for messages; it consumes CP's
`data.decodedPayload` (see `lib/utils/run-story.ts:231` for the one place decoded
payloads are read; the base64/JSON parsing at `run-story.ts:160-227` is for **Signal**
payloads, which remain JSON). CP currently maps `Contribute: '__json__'`
(`macp-control-plane/src/runtime/proto-registry.service.ts:46`) — remapping it to
`macp.modes.multi_round.v1.ContributePayload` (and handling legacy JSON histories) is
CP work. If CP fails to decode, the console's `JsonViewer` shows a base64 string —
degraded but non-breaking.

Console action: none in code. Add an e2e assertion (task H) that a multi-round run's
Contribute events display `decodedPayload.value`, and optionally a multi-round mock run
(the mock mode registry already lists `ext.multi_round.v1`, `mock-data.ts:1567-1575`,
but no mock run uses it).

#### 6. Watch-stream lag / WatchSignals auth / passive-subscribe — NO DIRECT IMPACT

- The console consumes only the CP's **SSE** stream; gRPC `WatchSessions`/`WatchSignals`/
  `StreamSession` reconnection on `RESOURCE_EXHAUSTED` is entirely the CP's absorption
  item. The console's own SSE reconnect logic (`lib/hooks/use-live-run.ts:81-143`)
  already resumes from `afterSeq` (CP canonical sequence — unrelated to the runtime's
  1-based accepted-envelope ordinals, which only the CP sees).
- WatchSignals authentication: the e2e compose already provisions the CP's observer
  bearer (`docker-compose.e2e.yml:69`, `tok-cp-observer` with `is_observer: true`), so
  the CP's signal watching keeps authenticating.
- Indirect console consequence: if the CP's runtime streams drop and re-sync, the UI
  should show it. That is already surfaced via the readiness probe's `streamConsumer`
  badge (`app/observability/page.tsx:381-388`) and the run-level
  `streamReconnectCount` in `MetricsSummary` (`lib/types.ts:436`). Verify in e2e (task
  H) that a lag-terminated CP stream recovers without the console losing events
  (CP replays from its cursor). No console code change.

#### 7. `max_suspend_ms` — IMPACTED, CONTINGENT ON ES/CP

The console has a launch flow that displays session TTL today:
`app/runs/new/page.tsx:468` (`ttl:…ms` badge from `launchSummary.ttlMs`) and
`components/runs/run-preview-card.tsx:72` (TTL badge from `runDescriptor.session.ttlMs`).
None of `LaunchSchemaResponse.launchSummary` (`lib/types.ts:183-191`),
`RunDescriptor.session` (`lib/types.ts:221-230`), or `InitiatorPayload.sessionStart`
(`lib/types.ts:249-260`) carry a suspension cap.

Action (task E), gated on ES compiling the field into launch schemas / run descriptors:

- Add optional `maxSuspendMs` to the three types above (wire name per ES contract).
- Display next to the TTL badge in the launch review + preview card
  (`Max suspend: …` via `formatRelativeDuration`).
- On suspended runs, if CP surfaces the bound cap (session insight), show it near the
  Resume button so operators know the auto-expiry horizon. Purely additive.

#### 8. Dev-mode auth — ALREADY SATISFIED; re-verify on image bump

`docker-compose.e2e.yml:66` already sets `MACP_ALLOW_INSECURE: "1"` on the runtime
service **and** provides real auth (`MACP_AUTH_TOKENS_JSON` + JWKS envs at lines
69-73). `docker-compose.local.yml` does not override the runtime service, so it
inherits the same env. Since the v0.5.0 image no longer bakes the flag, this compose
config is now **load-bearing** — the runtime bump in task F must keep it, and task H's
stack-boot smoke test is the regression guard. No change needed, but do not delete.

#### 9. HS256 — NO IMPACT

The only JWT minting in the console's stack is the sibling auth-service, which signs
RS256 or ES256 exclusively (`auth-service/src/keys.ts:12,25` — `RS256 → RSA, ES256 →
EC P-256`; contract tests cover exactly those two,
`auth-service/src/contract.spec.ts:56`). Both are on the runtime's default allowlist.
No console compose file mints or configures HS256, so no `MACP_AUTH_JWT_ALGS` override
is needed.

#### 10. Commitment `policy_version` echo — NO IMPACT

The console never constructs a `CommitmentPayload`. Under the observer-only model the
CP's message POST endpoints are removed (410 Gone — `README.md:173`,
`app/docs/page.tsx:100-106`), and the console's writes to CP are run-lifecycle only
(create/cancel/suspend/resume/archive — `lib/api/client.ts:249-656`). Commitments are
emitted by SDK agents.

#### 11. Task-mode external orchestrator — LOW IMPACT (defensive checks hold)

If the initiator is absent from `participants`, the console sees CP projections where
`decision.current.resolvedBy` / commitment sender is an ID not present in
`state.participants`. Verified defensive:

- `resolvedBy` is rendered as a raw string, never resolved against the participant
  list (`components/runs/decision-panel.tsx:148-158`,
  `components/runs/run-story-panel.tsx:195-205`).
- Participant lookups use `.find(...)` with undefined-tolerant fallbacks
  (`components/runs/execution-graph.tsx:144`, `components/runs/node-inspector.tsx:49`).

Residual risk: the execution graph renders `state.graph.nodes/edges` as built by the
CP — if the CP emits an edge from an initiator it never added as a node, React Flow
silently drops the edge (a commitment edge vanishing from the graph). That is a CP
projection-builder concern; the console adds (task G) a unit test with a
graph/projection fixture where the committing sender is not in `participants`, plus a
demo fixture, so regressions surface here. Cosmetic: `roleToTask` special-cases the
`initiator` role (`lib/utils/run-story.ts:317-319`) — fine as-is.

#### 12. Ext-mode descriptor rules + wire-read-only registries — IMPACTED (two parts)

(a) **Mode registry UI** (`/modes`) is browse-only — no register/unregister/promote
controls exist (`app/modes/page.tsx`; the empty state even directs users to the CP
admin API). So descriptor-validation and promote-rejection rules generate no console
error-handling work. But the **mock descriptors are now wrong against v0.5.0**:

- Mock quorum: `messageTypes: ['ApprovalRequest','Approve','Reject','Abstain']`,
  `terminalMessageTypes: ['Approve','Reject']` (`lib/data/mock-data.ts:1557-1565`).
  Real runtime: message types include `Commitment`, and the terminal type is
  exactly `['Commitment']`
  (`macp-runtime/crates/macp-modes/src/mode/mod.rs:159-176`).
- Mock `ext.multi_round.v1` has `modeVersion: '0.1.0'` (`mock-data.ts:1568`); the
  runtime ships `1.0.0` (`mode/mod.rs:180-185`). Under the new "empty mode_version
  binds descriptor version" rule, demoing the wrong version is actively confusing.
- The mock registry has only **3 of the 6** modes the runtime advertises
  (`mock-data.ts:1545-1576`: decision, quorum, ext.multi_round). v0.5.0 `ListModes`
  returns all five standards-track modes (decision, proposal, task, handoff, quorum —
  `macp-runtime/crates/macp-modes/src/mode/mod.rs:16-22`) plus the extension. Add
  proposal/task/handoff descriptors so the demo `/modes` page matches reality —
  especially handoff, whose transcript work (item 4) deserves demo coverage.
- The `/modes` page shows `messageTypes` but **not** `terminalMessageTypes`
  (`app/modes/page.tsx:125`) — now that "Commitment must be terminal" is a
  registration invariant, display the terminal set on each mode row (task D).

(b) **Policy registry UI** (`/policies`) DOES mutate: register/unregister buttons call
CP `POST/DELETE /runtime/policies*`
(`components/settings/policy-management.tsx:36,159`, `lib/api/client.ts:1212-1233`).
When the runtime runs with `MACP_POLICIES_DIR`, those RPCs fail with
`FAILED_PRECONDITION` and today the console shows only a generic toast
("Registration failed. <message>", `policy-management.tsx:41-42,178-180`). Action
(task D): detect the read-only condition from the CP error (exact HTTP status/shape to
be pinned by the CP plan — likely 4xx with a code string; `ApiError` in
`lib/api/fetcher.ts` already exposes `status`) and render a persistent informational
banner "Policy registry is file-managed (read-only) on this runtime" plus disabled
register/unregister controls, rather than letting every attempt fail with a toast.

#### 13. Roots `list_changed: false` — NO IMPACT

The console fetches roots once per page view via React Query
(`app/modes/page.tsx:32-35` → CP `/runtime/roots`) and renders them in a collapsible
JSON block. `grep` for `WatchRoots|list_changed|listChanged` finds no consumer — the
console never waited on root-change notifications. Nothing to do.

#### 14. Base64url session IDs — MINOR

No client-side validation rejects any session-ID shape (searched `app/ components/
lib/` for session-ID validators — none). Two cosmetic touchpoints:

- `components/layout/breadcrumbs.tsx:52-55` — `looksLikeId()` is
  `/^[0-9a-f-]{16,}$/i`, tuned for UUIDs. A 36-char base64url ID containing `g-z`,
  `A-Z` (as case-distinct), or `_` fails the test and gets title-cased into a
  nonsense breadcrumb label instead of being truncated. Route params today are CP
  **run IDs** (UUIDs), but `runId === sessionId` for discovered sessions
  (`lib/types.ts:325-336`), so base64url session IDs can become URL segments the
  moment the CP discovers a session started with one. Widen to also match
  `/^[A-Za-z0-9_-]{22,}$/` (task A).
- `app/docs/page.tsx:137` states compile "produces a pre-allocated sessionId
  (UUID v4)" — still true for ES-compiled sessions, but worth a parenthetical that the
  runtime accepts UUID v4/v7 or 22+-char base64url (docs task I).

#### 15. Runtime Docker image v0.5.0 — IMPACTED

- `docker-compose.e2e.yml:61`: change the default from `macp-runtime:latest` to
  `ghcr.io/multiagentcoordinationprotocol/macp-runtime:0.5.0` (keeping the
  `MACP_RUNTIME_IMAGE` override for local builds). This is the single switch that
  actually brings v0.5.0 behavior into every console dev/e2e stack (`local-stack.sh`
  composes the same file).
- `lib/data/mock-data.ts:1584`: bump mock manifest `protocolVersion` `'0.4.0'` →
  `'0.5.0'` so demo mode matches reality.
- `docker-compose.e2e.images.yml` pins CP `0.1.3` / ES `0.4.0` — these must move to the
  CP/ES releases that absorb v0.5.0 **when they exist**; pinning the runtime to 0.5.0
  against CP 0.1.3 is exactly the compatibility mix task H must smoke-test first.

#### 16. Conformance fixtures — NO IMPACT

The console's fixtures are hand-written **CP HTTP** response shapes
(`test/integration/fixtures/backend-responses.ts`), not runtime conformance vectors,
and no demo data is generated from the spec repo's fixtures. Fully-qualified
`payload_type` names matter to the CP's proto registry, which already stores
fully-qualified names (`proto-registry.service.ts:36`). Nothing to do.

#### 17. `SessionStartPayload.context` removed — IMPACTED (types + demo mock)

The console already models the successor fields — `contextId` + `extensions` are typed
(`lib/types.ts:257-258`), collected in the launch form (`app/runs/new/page.tsx:60,143-168`),
and displayed (`components/runs/run-preview-card.tsx:78-88`,
`components/runs/run-overview-card.tsx:115-123`). But the deprecated inline `context`
object survives in two places:

- `InitiatorPayload.sessionStart.context?: Record<string, unknown>` (`lib/types.ts:256`).
- Demo `compileLaunch` stuffs form inputs into `initiator.sessionStart.context`
  (`lib/api/client.ts:180-190`) — demo mode still simulates the pre-0.5.0 wire shape.

Run-detail input display is safe: `buildInputsTable` reads inputs from run metadata
`session_context` or from the **`session.context` Signal** (`lib/utils/run-story.ts:149-183`)
— a Signal payload, not the removed `SessionStart.context` bytes field — which is how
agents now share launch context.

Action (task E): once ES's compile output drops `context` (ES contract change), remove
the field from `InitiatorPayload`, update the demo mock to put inputs under
`scenarioMeta.sessionContext` only (already done at `client.ts:187-190`), and confirm
no component reads `initiator.sessionStart.context` (today none renders it — only the
demo mock writes it).

---

## 3. Work plan

Ordered, mergeable slices. Each has definition-of-done (DoD) and tests. "Live-stack
test" = `npm run local:up` against the v0.5.0 runtime image (task F first) or the e2e
compose.

Recommended PR breakdown (each row merges independently; CI gate = format + lint +
typecheck + vitest + build, per `.github/workflows/ci.yml`):

| PR | Tasks | Effort | Extra gate beyond CI |
|----|-------|--------|----------------------|
| 1 | F (image pin + metrics env) | S | manual stack-boot smoke (`npm run local:up`) |
| 2 | A (lifecycle/vocabulary) | S–M | demo-mode visual check of suspended run |
| 3 | C (implicit-accept rendering) | S | unit only (live assertion deferred to H) |
| 4 | D (modes/mocks + policies read-only) | S–M | live-stack `MACP_POLICIES_DIR` check |
| 5 | I (docs) | S | none |
| 6 | B (runtime metrics UI) | M | blocked: CP `/runtime/metrics`; integration test |
| 7 | E (launch metadata) | S | blocked: ES contract |
| 8 | G (orchestrator fixture) | S | blocked: CP task-mode projection decision |
| 9 | H (e2e matrix) | M | full live stack |

Rollback note common to PRs 2–5: all are additive display/mock changes with no data
migration or API contract change — rollback is `git revert` of the PR. PR 1 rolls back
by reverting the compose default (or exporting `MACP_RUNTIME_IMAGE`). PR 6's UI is
self-hiding when its endpoint is absent (see task B), so a CP-side rollback does not
require a console rollback.

### Slice 1 — land now (no upstream dependency)

**Task F — pin runtime v0.5.0 into the dev/e2e stack** *(S; do first — everything else
verifies against it)*
- `docker-compose.e2e.yml:61` default → `ghcr.io/multiagentcoordinationprotocol/macp-runtime:0.5.0`;
  add `MACP_METRICS_ADDR: "0.0.0.0:9464"` + a `9464:9464` port mapping to the runtime
  service (harmless until the UI consumes it; lets task B's e2e hit it).
- Keep `MACP_ALLOW_INSECURE: "1"` and the auth env (items 8/9) — now load-bearing.
- DoD: `npm run local:up` boots; CP `/readyz` reports runtime ok; a scenario run
  completes end-to-end from the launch page; `curl localhost:9464/metrics` returns
  runtime series.
- Risk: CP 0.1.3 image against runtime 0.5.0 — if the CP's stream consumer trips on new
  lifecycle events or lag termination, capture as a CP bug; the console has no
  workaround. Rollback: revert the image default (env override makes this a
  no-code-change toggle).

**Task A — lifecycle display completeness** *(S–M)*
- `app/logs/page.tsx:35`: **replace** the Session group with the CP's real vocabulary
  `session.bound` / `session.stream.opened` / `session.state.changed` (keep the legacy
  `session.opened/resolved/expired` entries for old exports).
- `lib/utils/events.ts`: add `run.suspended`/`run.resumed`/`session.state.changed`
  summarizers; fix `test/integration/fixtures/backend-responses.ts:120` off the
  phantom `session.opened` type.
- `components/layout/breadcrumbs.tsx:54`: widen `looksLikeId` for base64url (item 14).
- `lib/data/mock-data.ts`: add one `suspended` and one `cancelled` mock run (+ metrics
  entries with `SESSION_STATE_SUSPENDED`/`SESSION_STATE_CANCELLED`); extend
  `test/integration/fixtures/backend-responses.ts` similarly.
- Tests: unit — `summarizeEvent` new cases, `looksLikeId` base64url, logs filter
  grouping; snapshot — suspended run renders warning badge + Resume button in demo
  mode. DoD: demo dashboard shows non-zero Suspended KPI; `/logs` Session filter
  captures a `session.state.changed` fixture event.

**Task C — implicit handoff-accept rendering** *(S)*
- `lib/utils/macp.ts`: `isImplicitAccept(event)` helper (checks
  `data.decodedPayload?.implicit === true` OR message id prefixed `implicit-accept:`,
  tolerant of camel/snake casing).
- Wire into `summarizeEvent` (`proposal.*` case), `LiveEventFeed` row badge, and
  `EventDetailDialog` meta row.
- Mock: handoff-mode `proposal.updated` event with `implicit: true` in
  `MOCK_RUN_EVENTS`.
- Tests: unit for the helper + summarizer; demo-mode visual check. Live-stack test:
  run a handoff scenario with a silent target past the accept window; assert the
  transcript row shows the implicit badge (blocked on the runtime timer actually
  emitting — see Sequencing; the unit-level work is not blocked).
- DoD: implicit and explicit accepts are visually distinct in feed, logs, and dialog.

**Task D — registry UIs** *(S–M)*
- `/modes`: render `terminalMessageTypes` per mode row (`app/modes/page.tsx:125`
  vicinity).
- Mock descriptor fixes: quorum terminal → `['Commitment']` + add `Commitment` to
  messageTypes; `ext.multi_round.v1` modeVersion → `1.0.0`; add the missing
  proposal/task/handoff descriptors (`lib/data/mock-data.ts:1545-1576`).
- `/policies` read-only handling: catch the registry-read-only error in
  `policy-management.tsx` mutations; render an info banner + disable mutation controls
  for the session. Detection is by CP error contract — until the CP plan pins it, match
  on `FAILED_PRECONDITION` in the error body/message defensively.
- Tests: unit — policy-management renders banner on mocked read-only error; mock-data
  descriptor assertions. Live-stack test: start runtime with `MACP_POLICIES_DIR`, click
  Register, expect banner not a raw failure toast.
- DoD: no dead-end toast loop against a file-managed registry; demo descriptors match
  runtime v0.5.0 output.

### Slice 2 — contingent on control-plane absorption (track its plan)

**Task B — runtime metrics surface on `/observability`** *(M; the headline feature)*
- Precondition: CP exposes `GET /runtime/metrics` passthrough (preferred; register the
  requirement in the CP absorption plan). Fallback: third proxy service +
  `MACP_RUNTIME_METRICS_BASE_URL` (see §2 item 1).
- `lib/api/client.ts`: `getRuntimeMetricsText(demoMode)` mirroring
  `getObservabilityRawMetrics`; extend `MOCK_PROMETHEUS_METRICS` (or a sibling
  `MOCK_RUNTIME_PROMETHEUS_METRICS`) with per-mode `macp_*_total{mode="…"}` series +
  `macp_replay_mismatches_total`.
- `/observability` Overview tab: "Runtime" KPI row — messages accepted/rejected
  (summed + per-mode breakdown drill-in), commitments accepted/rejected,
  sessions suspended/resumed; a red badge on the Runtime-health card when
  `macp_replay_mismatches_total > 0` (detail text: "replay divergence detected —
  check runtime logs").
- Metrics tab: second `PrometheusMetricsTable` fed by the runtime exposition. The
  parser already handles labeled series (`lib/utils/prometheus.ts:18,101-107` carries a
  `labels: Record<string,string>` per sample), so per-mode `{mode="…"}` breakdown works
  without parser changes.
- Tests: unit — parsing fixture with per-mode labels, mismatch-badge logic;
  integration (`test/integration/observability.integration.test.ts`) — proxy the new
  endpoint; live-stack — run two scenarios in different modes, assert per-mode counters
  render and increment.
- Risk (highest of the plan) and how it is contained:
  - **Triple dependency**: runtime must set `MACP_METRICS_ADDR` (opt-in env — a
    v0.5.0 deployment without it exposes nothing), CP must ship the passthrough, and
    the deployment must wire the CP to the runtime's metrics address. Any missing link
    → the console endpoint 404s/502s. Mitigate: probe once per session and hide the
    entire Runtime section on 404/502 (same pattern as `eventsEndpointMissing`,
    `lib/api/client.ts:434-472`); never fail the page (`/observability` already
    degrades per-source, see `subsidiaryErrors`, `app/observability/page.tsx:142-146`).
  - **Counter semantics**: these are process-lifetime counters — a runtime restart
    resets them to zero. Label the section "since runtime start" and do not derive
    rates client-side in v1 (no timestamps to diff against); per-mode raw totals only.
  - **Cardinality**: dynamically registered ext modes add `{mode=…}` label values;
    the table must render an unbounded mode set (it does — rows are data-driven).
  - DoD: with the full chain wired, `/observability` shows per-mode
    accepted/rejected/commitment/suspend counters and a replay-mismatch indicator;
    with any link missing, the section is absent and the rest of the page is
    unaffected; demo mode always shows the section from mock data.
  - Rollback: section is additive and self-hiding; revert the PR restores today's UI.

**Task E — launch-flow metadata (`max_suspend_ms`, `context` removal)** *(S, needs ES)*
- Add `maxSuspendMs?: number` to `LaunchSchemaResponse.launchSummary`,
  `RunDescriptor.session`, `InitiatorPayload.sessionStart` (`lib/types.ts`), display in
  `app/runs/new/page.tsx` (next to the `ttl:` badge) and
  `components/runs/run-preview-card.tsx:72`.
- Remove `InitiatorPayload.sessionStart.context` (`lib/types.ts:256`) and the demo-mode
  write (`lib/api/client.ts:180-190`) once ES's compile contract drops it.
- Tests: type-level (tsc), launch-page unit render with/without `maxSuspendMs`; demo
  compile round-trip still shows inputs via `scenarioMeta.sessionContext`.
- DoD: launch review shows the suspension cap for scenarios that bind one; no reference
  to `sessionStart.context` remains.

**Task G — external-orchestrator resilience test** *(S, needs CP task-mode projection)*
- Unit fixture: projection where `decision.current.resolvedBy` and a graph edge source
  are an ID absent from `participants`; assert decision panel, run story, node
  inspector, and execution graph render without crashes and the graph does not lose the
  commitment edge (if it does, file against CP's graph builder).
- Optional: demo task-mode run with an external orchestrator.
- DoD: the fixture test is in the suite and green; any CP-side graph-builder gap is
  filed upstream with the fixture attached.

### Slice 3 — verification + docs

**Task H — e2e verification matrix against the live v0.5.0 stack** *(M)*
Run via `npm run local:up` + `test/integration` (vitest, Docker-backed):
1. Boot: stack healthy with v0.5.0 image (task F DoD).
2. Lifecycle: launch → suspend → resume → cancel a run from the UI; assert status
   badges, KPI strip, `/logs` Session group capture, SSE continuity across suspend.
3. Handoff: implicit-accept transcript badge (once runtime timers emit).
4. Multi-round: Contribute payload renders decoded `value` (item 5).
5. Metrics: per-mode counters visible and incrementing; `macp_replay_mismatches_total`
   present and zero (item 1).
6. Streams: restart the runtime container mid-run; assert CP reconnects and the console
   SSE recovers (readiness `streamConsumer` transitions dirty → ok) (item 6).
7. Policies: `MACP_POLICIES_DIR` read-only banner (item 12b).

DoD: all seven scenarios pass against the pinned v0.5.0 stack; failures are triaged
into console-bug vs upstream-bug and filed accordingly. Scenarios 3–5 stay marked
"pending upstream" until their runtime/CP prerequisites ship (see Sequencing) — the
matrix merges with those rows skipped, not deleted.

**Task I — docs refresh** *(S)*
- `docs/api-integration.md` §Runtime: add the runtime-metrics endpoint + note
  roots are static (`list_changed: false`).
- `app/docs/page.tsx:137`: session-ID formats parenthetical.
- `docs/changelog.md`: absorption entry (follow the existing dated-entry convention).
- `README.md` local-stack section: mention the pinned runtime image + metrics port.

Effort total: ~5–8 focused days spread across the slices, dominated by task B + H.

---

## 4. Sequencing

```
now ──────────────► after CP absorption ─────► after runtime timers/impl land
F (image pin)       B (runtime metrics UI)     C-e2e (implicit accept live test)
A (lifecycle gaps)  D-policies error contract  H-3 (handoff e2e)
C (implicit render) E (max_suspend_ms via ES)
D (modes/mocks)     G (task-mode fixture)
I (docs)            H (full matrix)
```

- **Lands now** (Slice 1 + I): pure console work verified against the v0.5.0 image
  and/or mocks. No CP/ES release needed. Worst case without upstream absorption: the
  implicit-accept badge and lifecycle summarizers simply have nothing new to render.
- **Waits on the control-plane absorption plan** (not yet written —
  `../macp-control-plane/plans/current/` is empty): the `GET /runtime/metrics`
  passthrough (task B's preferred path), the read-only-registry error contract (task
  D-policies final wiring), `session.state.changed` payload details for suspend/resume
  variants, Contribute proto decode (item 5), stream lag-reconnect (item 6), and any
  task-mode projection changes (task G). **Ask the CP plan to explicitly commit to:
  (1) `/runtime/metrics` passthrough, (2) a structured error code for read-only
  registries, (3) preserving `decodedPayload.implicit` on handoff accepts.**
- **Waits on ES (macp-playground) absorption**: `maxSuspendMs` in launch schema/run
  descriptor and dropping `sessionStart.context` from compile output (task E).
- **Waits on runtime follow-ups noted in the inventory**: ListSessions pagination
  *implementation* (no console work regardless) and the handoff implicit-accept
  *timer emission* (task C's rendering is forward-compatible; the live e2e assertion
  activates when the runtime ships it).

---

## Revision log

*(Iteration protocol: three passes after the initial draft.)*

### Pass 1 — completeness

Re-walked the inventory and re-grepped for state enums, payload decoders, stream
consumers, compose files, health UI, and session-list fetching. Gaps found and folded
into the plan:

1. **Session canonical-event vocabulary mismatch (major, added to item 2 / task A).**
   The CP's canonical vocabulary is `session.bound` / `session.stream.opened` /
   `session.state.changed` (`macp-control-plane/src/contracts/control-plane.ts:133-135`);
   the console's `/logs` Session group, `summarizeEvent`, and even the integration
   fixture (`backend-responses.ts:120`) are keyed to `session.opened/resolved/expired`,
   which the CP never emits. Upgraded task A from "append event types" to "replace the
   vocabulary".
2. **Mock mode registry is missing half the modes (added to item 12 / task D).** Only
   decision, quorum, ext.multi_round are mocked; proposal/task/handoff absent.
3. **Verified** (no plan change needed): `lib/utils/prometheus.ts` parses labeled
   series, so task B's per-mode `{mode="…"}` counters need no parser work — cited in
   task B. `.env.e2e` has no runtime-facing config (nothing to absorb). Suspend/resume
   mutations are fully wired in `components/runs/run-workbench.tsx:160-171,355`.
   Replay descriptors (`streamUrl`) have no SSE consumer — `use-live-run.ts` remains
   the only `EventSource`, confirming the single-stream-consumer claim in §1.
4. Swept `app/agents`, `app/scenarios`, `app/settings`, `components/docs/diagrams` for
   additional runtime-data consumers: all render ES/CP data already covered by the
   matrix; no new touchpoints.

### Pass 2 — adversarial verification

Re-read the code behind every file:line claim (console, CP, runtime, auth-service).
Outcome:

1. **Corrected**: runtime standards-mode list citation `mode/mod.rs:15-22` → `16-22`
   (`STANDARD_MODE_NAMES` starts at 16).
2. **Strengthened**: "CP derives `/runtime/health` from a manifest call" was inferred;
   now verified and cited — `rust-runtime.provider.ts:421-427` returns `ok: true` iff
   `GetManifest` succeeds, confirming it is a counter-free liveness probe (item 1's
   premise that the console has no runtime counters today).
3. **Verified as written** (spot-list): `ProxyService` union (`integrations.ts:1`);
   `MACP_ALLOW_INSECURE`/token env (`docker-compose.e2e.yml:66,69-73`);
   `docker-compose.local.yml` genuinely does not override the runtime service; mock
   quorum descriptor vs `mode/mod.rs:159-176`; `prometheus_lines` names
   (`metrics.rs:199-216`); `macp_replay_mismatches_total` (`main.rs:473`);
   `Contribute: '__json__'` (`proto-registry.service.ts:46`); HandoffAccept →
   `proposal.updated` (`event-normalizer.service.ts:404-426`); auth-service
   RS256/ES256-only (`keys.ts:25`); breadcrumb regex (`breadcrumbs.tsx:54`);
   `sessionStart.context` written only by the demo mock, rendered nowhere.
4. **Flagged as inventory-derived (not code-verified)**: the exact synthetic-envelope
   shape for implicit accepts (`implicit-accept:` prefix, `implicit=true`) comes from
   the change inventory — the runtime feature is upcoming; task C detects both the
   payload flag and the id prefix defensively, and the field-name caveat in item 4
   stands.
5. **Version check**: no lockfile in this repo pins any MACP package (confirmed —
   `package.json` deps are UI libraries only); the only version couplings are the
   compose image tags cited in §1, re-verified: runtime `macp-runtime:latest` default,
   CP `0.1.3`, ES `0.4.0`, auth-service `0.1.3`.

### Pass 3 — executability

Reordered into mergeable slices and hardened the riskiest item:

1. **Added a PR breakdown table** (9 PRs) mapping tasks → effort → merge gates, with a
   shared rollback note. Every unblocked PR (1–5) can merge this week in order
   F → A → C → D → I; blocked PRs (6–8) carry their blocking upstream artifact in the
   table.
2. **Expanded task B risk** (the riskiest change): named the *triple* dependency
   (runtime env opt-in + CP passthrough + deploy wiring) instead of "double";
   added counter-reset semantics ("since runtime start", no client-side rates in v1)
   and label-cardinality notes; gave it an explicit DoD covering the degraded path
   (section self-hides; page unaffected) and demo-mode behavior.
3. **Added missing DoD** to tasks G and H; H's matrix now states that upstream-blocked
   scenarios (implicit-accept e2e, Contribute decode, metrics chain) merge as skipped
   rows rather than blocking the suite.
4. **Rollback notes**: PRs 2–5 are additive display/mock work (revert-only); PR 1
   reverts via compose default or `MACP_RUNTIME_IMAGE` env; PR 6 tolerates CP-side
   rollback without a console change.
5. Sanity-checked the dependency arrows in §4 against the PR table — consistent; no
   task in Slice 1 reads anything that only exists after CP absorption (task C renders
   from fields that are simply absent today, task D's error match is defensive until
   the CP contract is pinned).
