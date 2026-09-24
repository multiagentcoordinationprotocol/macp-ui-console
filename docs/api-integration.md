# API integration

This document covers how the UI Console talks to its two upstream services. Endpoint
schemas and request/response details live in the upstream API docs and are referenced
rather than duplicated here.

> **Endpoint references** — the UI integrates against two HTTP services. For full
> endpoint schemas, error shapes, and semantics see the upstream docs:
>
> - **Control Plane** — [`macp-control-plane/docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md), [`macp-control-plane/docs/INTEGRATION.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/INTEGRATION.md), [`macp-control-plane/docs/ARCHITECTURE.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/ARCHITECTURE.md)
> - **Examples Service** — [`macp-playground/docs/api-reference.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/api-reference.md), [`macp-playground/docs/architecture.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/architecture.md)
>
> What follows is **UI-specific**: the proxy model, the subset of endpoints the UI calls,
> the normalizers that bridge upstream shapes to UI types, and the SSE / demo-mode
> plumbing.

## Overview

The UI integrates with two upstream services:

1. **Examples Service** — scenario catalog, agent profiles, launch schema, launch compilation, optional one-shot bootstrap.
2. **Control Plane** — observer-only run lifecycle, state projection, canonical events (per-run + cross-run), SSE streaming, metrics/traces/artifacts, runtime metadata + policy registry, webhooks, audit, admin.

Under the observer-only macp-control-plane model, agents emit envelopes (messages, signals,
context updates) **directly to the runtime** via `macp-sdk-python` / `macp-sdk-typescript`.
The UI only reads from the CP; it never originates agent traffic. See
[`macp-control-plane/docs/ARCHITECTURE.md § Request Flow`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/ARCHITECTURE.md#request-flow-observer-mode--direct-agent-auth-2026-04-15)
for the authority model and
[`macp-playground/docs/direct-agent-auth.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/direct-agent-auth.md)
for how macp-playground spawns those agents.

## Proxy routes

The browser never calls upstream services directly. Two Next.js route handlers forward
requests, inject auth, and keep secrets server-side.

| Route | File | Purpose |
|---|---|---|
| `/api/proxy/[service]/[...path]` | `app/api/proxy/[service]/[...path]/route.ts` | Generic forwarder for `macp-playground` and `macp-control-plane` services. Injects auth, strips hop-by-hop headers, streams response body unchanged. |
| `/api/jaeger/[...path]` | `app/api/jaeger/[...path]/route.ts` | Forwards to `JAEGER_BASE_URL/api/*`. Used by the trace detail surface to resolve span waterfalls. Returns `502` if Jaeger is unreachable. |

Supported upstream service identifiers (`[service]` segment): `macp-playground`, `macp-control-plane` — the two members of `ProxyService` in `lib/server/integrations.ts:1`.

### Environment variables

```bash
MACP_PLAYGROUND_BASE_URL=http://localhost:3100
MACP_PLAYGROUND_API_KEY=
MACP_CONTROL_PLANE_BASE_URL=http://localhost:3001
MACP_CONTROL_PLANE_API_KEY=
JAEGER_BASE_URL=http://localhost:16686           # server-side (proxy target)
NEXT_PUBLIC_JAEGER_BASE_URL=http://localhost:16686  # client-side (UI deep links)
```

`lib/server/integrations.ts` throws when `MACP_PLAYGROUND_BASE_URL` / `MACP_CONTROL_PLANE_BASE_URL`
are missing in production; empty API keys log a warning but do not block requests.

### Auth forwarding

- **Examples Service** — the proxy adds `x-api-key: <MACP_PLAYGROUND_API_KEY>` when configured.
- **Control Plane** — the proxy adds `authorization: Bearer <MACP_CONTROL_PLANE_API_KEY>` when configured.

Headers `host`, `connection`, `content-length` are stripped before forwarding;
`content-encoding` is stripped on the response. Every proxied response carries
`x-macp-ui-proxy: <service>` for observability.

---

## Examples Service endpoints used by the UI

Full schemas: [`macp-playground/docs/api-reference.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/api-reference.md).
The UI calls the following subset:

### Scenario discovery
- `GET /packs` — pack listing for the catalog
- `GET /packs/:packSlug/scenarios` — scenarios within a pack
- `GET /scenarios` — cross-pack listing; each row includes `packSlug`, `policyVersion`, `policyHints`

### Agent profiles
- `GET /agents` — all agent profiles with pre-computed scenario coverage; `metrics` are best-effort (zero when CP is unavailable). The UI enriches latency / confidence client-side from CP `/dashboard/agents/metrics`.
- `GET /agents/:agentRef` — single profile; the client returns `undefined` on 404 and rethrows other errors

### Launch setup
- `GET /packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema?template=` — drives the schema-driven launch form; `launchSummary.policyHints` feeds the policy badge and launch preview
- `POST /launch/compile` — validates inputs against the scenario JSON Schema and returns a whitelisted-safe `runDescriptor` (for CP `POST /runs`), a `scenarioSpec` (for agent bootstrap), and a pre-allocated UUID v4 `sessionId`

### Optional one-shot bootstrap
- `POST /examples/run` — compiles, spawns the example agents with per-agent JWTs (minted via auth-service), and submits the run to the CP. Response (201): `{ compiled, hostedAgents[], sessionId, controlPlaneRun? }`.

  **`controlPlaneRun` is the CP's `POST /runs` response, and its absence is the only registration signal the console gets.** Submission is best-effort and non-fatal by design: it runs concurrently with agent bootstrap, and an unset `MACP_CONTROL_PLANE_URL`, a network error, a timeout, a non-2xx (including a 401 from a missing API key), a malformed body, or a response missing `runId`/`status`/`sessionId` or whose `sessionId` disagrees with the descriptor's, all cause the field to be **omitted** while the request still succeeds with live agents. A playground old enough never to send it is indistinguishable. The field is also absent, along with `sessionId`, when `bootstrapAgents: false` short-circuits the flow; that is "nothing was bootstrapped", not a registration failure.

  **Navigate by `controlPlaneRun.runId`, never by `sessionId` — the two are different ids on this path.** `POST /runs` makes the CP mint a fresh run id and store the session id separately, so `/runs/live/<sessionId>` does not resolve. (`controlPlaneRun.sessionId`, by contrast, is guaranteed equal to the top-level `sessionId`: the playground rejects any response where they disagree.)

  **When the field is absent, the run is not necessarily unreachable.** With `SESSION_DISCOVERY_ENABLED` (default **true**), the CP registers runs it observes directly from the runtime, and those it keys **by session id** — so `/runs/live/<sessionId>` starts resolving once discovery has seen the session. Discovery is neither instant nor guaranteed: if the submission reached the CP and only the reply was lost, a run already exists under a different id and discovery finds it by session id, so no session-keyed run is ever created and that route stays dead. The console therefore does not redirect; it reports that the Example Service did not register the run, declines to attribute a cause, and offers the session route as a link that may or may not resolve.

  For local real-mode work both `MACP_CONTROL_PLANE_URL` and `MACP_CONTROL_PLANE_API_KEY` must be set on the playground service — the CP's auth guard rejects a *missing* Authorization header before it reaches the empty-`AUTH_API_KEYS` bypass, so an unset key silently yields the omitted field. `docker-compose.e2e.yml` sets both.

---

## Control Plane endpoints used by the UI

Full schemas: [`macp-control-plane/docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md).
The UI calls the following subset. Each bullet below documents what the **UI** sends
and expects — for the authoritative endpoint contract, follow the links.

### Dashboard
- `GET /dashboard/overview` — aggregated KPIs, `recentRuns`, `runtimeHealth`, chart series. The UI sends `window` / `from` + `to` / `scenarioRef` / `environment`. KPIs read: `totalRuns`, `activeRuns`, `completedRuns`, `failedRuns`, `cancelledRuns`, `totalSignals`, `totalTokens`, `totalCostUsd`, `avgDurationMs`. The UI consumes `recentRuns` directly and only falls back to `GET /runs` when an older CP build omits the field. Chart series the UI renders are listed under [Chart series](#chart-series) below.
- `GET /dashboard/agents/metrics` — per-agent `runs`/`signals`/`messages`/`averageConfidence`/`averageLatencyMs` (optional). CP returns `participantId`; the client normalizes to `agentRef` before merging into the Examples Service agent profiles.

### Run lifecycle
- `POST /runs/validate` — the UI composes `ValidateRunResponse { ok, errors, warnings, runtime }` from CP's `{ valid, errors, warnings, runtime }` by mapping `valid && errors.length === 0` → `ok`.
- `POST /runs` — **only** run-creation path. The UI posts whitelisted-safe compiled descriptors from the Examples Service. Scenario-specific fields are rejected with 400 by CP.
- `GET /runs` — paginated `{ data, total, limit, offset }`. The UI always sends `limit` / `offset` defaults (required by CP validation) plus the active filters (`status`, `environment`, `search`, `tags`, `scenarioRef`, `sortBy`, `sortOrder`, `createdAfter`, `createdBefore`, `includeArchived`).
- `GET /runs/:id` — run record; flat `sourceKind` / `sourceRef` are nested into `source: { kind, ref }` by `normalizeRun()`.
- `POST /runs/:id/cancel` — opaque to the UI; CP chooses between the initiator's cancel-callback (default) and direct `CancelSession` (policy-delegated).
- `POST /runs/:id/clone` — accepts optional `{ tags, context }`. Non-empty `context` overrides are rejected by CP under observer-only rules; the clone form surfaces the error directly.
- `POST /runs/:id/archive` — full run record; the client extracts `{ ok, runId, archived }`. CP's dedicated `archivedAt` column is passed through unchanged (no tag-synthesis bridge).
- `POST /runs/:id/replay` — returns a replay descriptor (`{ runId, mode, speed, streamUrl, stateUrl }`).
- `POST /runs/compare` — pairwise comparison.
- `DELETE /runs/:id` — permanent delete; only available for terminal runs.

### Run state and streaming
- `GET /runs/:id/state` — the projection. The UI consumes: `run` block (+ `contextId`, `extensionKeys`), `participants`, `graph`, `decision.current` (incl. `proposals[]`, `resolvedAt`, `resolvedBy`, `prompt`, `outcomePositive: boolean | null`, `supersedes`), `signals`, `progress`, `timeline`, `trace`, `outboundMessages`, optional `policy` (+ `expectedCommitments`, `voteTally`, `quorumStatus`), optional `llm` (`{ calls[], totals }`).
  - `decision.current.supersedes` — cross-session commitment lineage (RFC-MACP-0001 §7.3): `{ sessionId, commitmentHash, canonical }`. `canonical` reports whether `commitmentHash` is in the RFC-MACP-0013 §9 form — literally `sha256:` followed by exactly 64 **lowercase** hex characters. `false` marks a legacy pre-0013 hash, which the control plane deliberately surfaces rather than drops; the console badges the format and keeps the hash (with the full value on the `title` attribute, since the rendered hash is truncated).
  - **The control plane declares `canonical` required; this repo mirrors it as optional and gates the badge on `=== false`, never on falsiness.** That is deliberate version-skew tolerance, not a hole in the current CP: a current control plane sets the field on every UI-visible path — via the read-time backfill in `ProjectionService.get()` (which the streaming path also runs, since `applyAndPersist` loads its base state through `get()`), and via the reducer itself on a rebuild — so `undefined` should not arrive from one. It *does* arrive from a control plane deployed before the backfill existed — and such a row is never rewritten, only re-derived when a new `decision.finalized` arrives. The CP's own `ASSUMPTIONS.md` P6 records this and names this console's decision panel as the blast radius, warning that `if (!canonical) badge()` would mis-label legacy-but-actually-canonical history. Treat `undefined` as "unknown", not as "non-canonical".
- `GET /runs/:id/events` — dual-shape response: bare `CanonicalEvent[]` on the fast path; `{ data, total, limit, nextCursor }` when any of `afterTs` / `beforeTs` / `type` is supplied. The client handles both and pipes every row through `normalizeEvent()`.
- `GET /events` — cross-run stream for `/logs`. When CP returns 404 (older build), the client falls back to per-run fan-out and caches the decision for the browser session so later navigations skip the probe.
- `GET /runs/:id/stream` — SSE with `includeSnapshot=true&afterSeq=<n>`. Named events: `snapshot`, `canonical_event`, `heartbeat`.
- `GET /runs/:id/replay/state?seq=<n>` — state projection at a specific sequence; powers the timeline scrubber.
- `GET /runs/:id/export` — full run bundle; query: `includeCanonical`, `includeRaw`, `eventLimit`, `format` (`json | jsonl`).

**Session canonical-event vocabulary.** The control plane emits `session.bound`,
`session.stream.opened`, and `session.state.changed`. Suspend / resume / resolve / expire
/ cancel transitions all arrive as `session.state.changed` carrying `data.state` (e.g.
`SESSION_STATE_SUSPENDED`) — there are **no** discrete `session.opened` / `.resolved` /
`.expired` events. The `/logs` Session filter group, `summarizeEvent`, and the run/session
lifecycle summarizers key on this vocabulary (legacy names are retained only so old
exports still group). Run pause/resume also surface as `run.suspended` / `run.resumed`.

**Implicit handoff accepts (RFC-MACP-0010 §5.1).** When a handoff target stays silent
past the accept window, the runtime emits a synthetic `HandoffAccept` (sender = the
target, `messageId = implicit-accept:<handoff_id>`, `decodedPayload.implicit = true`) that
the CP surfaces as a normal `proposal.updated`. The console flags these with an
`implicit` badge (feed, `/logs`, event dialog) via `isImplicitAccept()` so a
runtime-synthesized accept is visually distinct from one a participant actually sent.

**Multi-round Contribute** payloads decode to `decodedPayload.value` on the CP side
(proto `ContributePayload`, JSON legacy tolerated); the console reads the decoded
payload and needs no decoding of its own.

### Session interaction (observer-only)
Under direct-agent-auth, agents emit envelopes directly to the runtime via the SDKs. The
HTTP bypass endpoints return `410 Gone` and the UI does not render forms for them:

- ~~`POST /runs/:id/messages`~~ — agents use `DecisionSession(client).evaluate(...)` or `session.send(...)` ([macp-sdk-python](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/guides/agent-framework.md), [macp-sdk-typescript](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs/guides/agent-framework.md))
- ~~`POST /runs/:id/signal`~~ — agents use `session.signal(...)` via the SDK
- ~~`POST /runs/:id/context`~~ — agents construct a `ContextUpdate` envelope via SDK helpers

Still supported (scenario-agnostic, CP-local):

- `POST /runs/:id/artifacts` — create an artifact (`{ kind, label, uri?, inline? }`)
- `POST /runs/:id/projection/rebuild` — admin: rebuild projection from events

### Batch operations
- `POST /runs/batch/cancel`, `POST /runs/batch/archive`, `POST /runs/batch/delete` — `{ runIds: string[] }` → `{ results: [{ runId, ok }] }`
- `POST /runs/batch/export` — returns `RunExportBundle[]`

### Observability and artifacts
- `GET /runs/:id/metrics` — includes `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`. Cost is derived from `MODEL_COSTS` on the CP side (see [CP API.md § Token usage convention](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md#get-runsidmetrics)).
- `GET /runs/:id/traces` — summary (`traceId`, `spanCount`, `linkedArtifacts`, `runStatus`, `scenarioRef`).
- `GET /runs/:id/artifacts`
- `GET /metrics` — raw Prometheus exposition. The `/observability` page parses it client-side via `lib/utils/prometheus.ts` (counters, gauges, histograms, summaries; percentile interpolation matches Grafana's `histogram_quantile`).
- `GET /audit` — supports `actor`, `action`, `resource`, `resourceId`, `createdAfter`, `createdBefore`, `limit`, `offset`. Default paging is `limit=100&offset=0`.

### Runtime metadata (pass-through from the runtime)
- `GET /runtime/manifest`, `GET /runtime/modes`, `GET /runtime/roots`, `GET /runtime/health`

Runtime-level semantics (what a "mode" is, what's in a manifest) are documented in the
runtime repo: [`macp-runtime/docs/modes.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/modes.md)
and [`macp-runtime/docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/API.md).

Notes for runtime v0.8.0 (the image pinned in `docker-compose.e2e.yml`):

- `GET /runtime/modes` returns **five** mode descriptors — the standards-track set
  (`decision`, `proposal`, `task`, `handoff`, `quorum`). It does **not** include
  `ext.multi_round.v1`: the control plane calls the runtime's `ListModes`, which returns
  `standard_mode_descriptors()` only, and the extension is reachable solely via `ListExtModes`,
  for which the control plane exposes no endpoint. (An earlier revision of this file said "all
  six"; that was true of `all_mode_descriptors()`, which is not what this endpoint calls.)
  **Demo mode still lists six**, because the mock mirrors the full descriptor set — a known
  divergence, flagged at `MOCK_RUNTIME_MODES` in `lib/data/mock-data.ts`.
  Every returned descriptor's `terminalMessageTypes` is exactly `["Commitment"]`; the `/modes`
  page renders both `messageTypes` and `terminalMessageTypes` per mode.
- **The `Commitment` terminal is now enforced, not merely conventional.** The registry rejects,
  at registration time, any extension descriptor with an empty terminal set or with a terminal
  other than `Commitment` — "dynamically registered modes resolve only on 'Commitment'"
  (`macp-runtime/crates/macp-modes/src/mode_registry.rs:481-499`).
- `GET /runtime/roots` is fetched once per page view and returns an empty list — the runtime
  ships no roots provider. Roots are **static**: the runtime advertises `list_changed: false`,
  so per RFC-MACP-0006 §3.3 a client need not watch, and the console does not. (A `WatchRoots`
  RPC does exist on the runtime and yields one initial frame before parking idle, but the
  control plane exposes no route to it — so "there is no change-notification stream", as this
  file previously claimed, was wrong about the runtime even though the console's behaviour was
  right.)
- **Runtime Prometheus metrics** are exposed by the runtime process itself on
  `MACP_METRICS_ADDR` (per-mode `macp_messages_*` / `macp_sessions_*` /
  `macp_commitments_*` counters + `macp_replay_mismatches_total`). These are an
  ops-only surface: the control plane does **not** re-serve them, so the console does
  not render runtime-process counters. The `/observability` "Metrics" tab parses the
  **control plane's own** `GET /metrics`, not the runtime's.

### Runtime policy registry (RFC-MACP-0012, pass-through)
- `GET /runtime/policies?mode=<modeId>` — filterable list
- `GET /runtime/policies/:policyId`
- `POST /runtime/policies` — `{ policyId, mode, description, rules, schemaVersion? }`.
  `schemaVersion` must be **1, 2 or 3**; any other value is rejected with HTTP 400 and the message
  `schemaVersion must be one of 1, 2, 3` (a `null` counts as omitted, not as a bad value). The
  rejection uses the same no-`errorCode` envelope as every other policy-registration 400 — see
  "The three control-plane error envelopes" below — so read `message` via `describeApiError` rather
  than branching on a code. Omitting the field defaults to **1** at the control plane, but the console's
  registration form defaults to **3**, the current
  authoring version, and offers only those three values so the constraint cannot be violated from the
  UI. The response type stays forward-compatible: an already-registered policy reporting a version
  outside the set still renders.
- `DELETE /runtime/policies/:policyId`

Rule schemas are opaque to the control plane; the UI renders them descriptively. The
authoritative per-mode schema lives in [`macp-runtime/docs/policy.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/policy.md).

**Read-only (file-managed) registry.** When the runtime runs with `MACP_POLICIES_DIR`,
policies are managed on disk and register/unregister RPCs fail. The control plane
surfaces this as **HTTP 405 with `errorCode: REGISTRY_READ_ONLY`**. The `/policies`
policy-management UI detects this (`isRegistryReadOnlyError`, which also matches the
underlying `FAILED_PRECONDITION` defensively), shows a persistent "registry is
file-managed (read-only)" banner, and disables the mutation controls rather than looping
a dead-end error toast.

### Operational admin
- `GET /webhooks` — subscriptions may include `deliveryStats` (`total`, `succeeded`, `failed`, `lastDeliveredAt`)
- `POST /webhooks`, `PATCH /webhooks/:id`, `DELETE /webhooks/:id`
- `POST /admin/circuit-breaker/reset`
- `GET /admin/circuit-breaker/history?window=<alias>` — state transitions (`CLOSED | OPEN | HALF_OPEN`) with enter timestamps and optional reason
- `GET /readyz` — `{ ok, database, runtime, streamConsumer, circuitBreaker }`
- `GET /admin/runtime/sessions` — runtime session drift: sessions the runtime holds that the control
  plane has no run for, and vice versa. Carries `complete: false` when the sweep was cut short by its
  page or time budget rather than finishing, so a partial answer is never mistaken for "no drift".
  **When `complete` is `false`, `missingFromRuntime` is `null`, not `[]`** — the reverse direction
  cannot be computed from a partial session list, and an empty array would assert "no runs are
  missing", which is exactly the false reassurance the flag exists to prevent. Render the `null` as
  "not computed", never as zero.

### Chart series

`GET /dashboard/overview` returns `{ labels, data }` pairs; the client converts them to
UI `ChartPoint[]`. The series the UI renders:

`runVolume`, `latency`, `errorClasses`, `signalVolume`, `throughput`, `queueDepth`,
`latencyP50` / `P95` / `P99`, `cost`, `successRate`, `decisionOutcome` (single net series —
positive vs. negative encoded as +1/-1 per bucket, **not** split into two arrays),
`perScenario`.

Series semantics are documented in
[`macp-control-plane/docs/API.md § GET /dashboard/overview`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md#get-dashboardoverview).

---

## Jaeger integration

The `/traces` surface resolves span waterfalls through a Jaeger instance when
configured:

- Server-side fetch: `GET /api/jaeger/traces/:traceId` → `${JAEGER_BASE_URL}/api/traces/:traceId`. Used by `getJaegerTrace(traceId)`.
- Client-side deep link: `getJaegerUiUrl(traceId)` builds a URL from `NEXT_PUBLIC_JAEGER_BASE_URL`, falling back to `window.location.origin` with port swapped to `16686`.

---

## Client-side integration functions

All UI-facing data access lives in `lib/api/client.ts`. Every function
branches on `NEXT_PUBLIC_MACP_UI_DEMO_MODE` — demo returns mock data, real hits the
proxy.

### Examples Service
- `listPacks`, `listScenarios`
- `getLaunchSchema`, `compileLaunch`
- `runExample` — one-shot bootstrap via `/examples/run`; returns `controlPlaneRun` only when the run reached the control plane (demo mode always includes it)
- `getAgentProfiles`, `getAgentProfile` (returns `undefined` on 404)

### Control Plane — run lifecycle
- `validateRun`, `createRun`
- `listRuns` — accepts `Partial<ListRunsQuery>`, always sends `limit`/`offset`
- `getRun`, `cancelRun`, `cloneRun` (accepts `{ tags, context }`), `archiveRun`
- `createReplay`, `compareRuns`, `deleteRun`, `exportRunBundle`

### Control Plane — state, events, streaming
- `getRunState`
- `getRunEvents` — accepts `RunEventsQuery` (`limit`, `afterSeq`, `afterTs`, `beforeTs`, `type`); legacy positional signature preserved
- `listEvents` — cross-run wrapper with 404-fallback to per-run fan-out
- `getTimelineFrame` — `/runs/:id/replay/state?seq=<n>`

### Control Plane — observability
- `getRunMetrics`, `getRunTraces`, `getRunArtifacts`, `createArtifact`
- `getObservabilityRawMetrics` — streams raw `/metrics` exposition (no JSON parsing)
- `getJaegerTrace`, `getJaegerUiUrl`
- `getLogsData`, `getTraceData` — convenience wrappers for the `/logs` and `/traces` pages

### Control Plane — dashboard, audit, agents
- `getDashboardOverview` — accepts `DashboardOverviewQuery`; returns `degraded: true` when CP's `/dashboard/overview` is unavailable
- `getAuditLogs` — `Partial<ListAuditQuery>`
- `getAgentMetrics` — logs a warning and returns `[]` when CP is missing the endpoint

### Control Plane — runtime and policies
- `getRuntimeManifest`, `getRuntimeModes`, `getRuntimeRoots`, `getRuntimeHealth`
- `listRuntimePolicies`, `getRuntimePolicy`, `registerRuntimePolicy`, `unregisterRuntimePolicy`

### Control Plane — admin
- `getWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`
- `resetCircuitBreaker`, `getCircuitBreakerHistory`
- `getReadinessProbe`, `rebuildProjection`, `getRuntimeSessionDrift`
- `batchCancelRuns`, `batchArchiveRuns`, `batchDeleteRuns`, `batchExportRuns`

### Utility helpers (no network I/O)
- `getMockFrames` — demo-mode replay frame source
- `getQuickCompareTarget` — suggests a comparison target run
- `listScenarioRefs` — all scenario refs from mock data

---

## Response normalization

`lib/api/client.ts` bridges CP response shapes to UI types so the render layer sees a
consistent type vocabulary regardless of whether rows came from CP or from mock data.

- **`normalizeRun()`** — maps flat `sourceKind` / `sourceRef` into nested `source: { kind, ref }`; validates `id`, `status`, `runtimeKind`; passes `archivedAt` through unchanged from CP.
- **`normalizeEvent()`** — maps flat `sourceKind` / `sourceName` / `subjectKind` / `subjectId` / `rawType` into nested `source` and `subject` objects. Applied by `getRunEvents`, `listEvents`, and the SSE `canonical_event` handler.
- **Pagination unwrapping** — `GET /runs` returns `{ data, total, limit, offset }`; `listRuns` unwraps `.data`.
- **Validate response mapping** — `validateRun` composes `ValidateRunResponse` from CP's `{ valid, errors, warnings, runtime }`.
- **Cancel / archive envelope mapping** — CP returns the full updated `RunRecord`; the client extracts `{ ok, runId, status }` / `{ ok, runId, archived }`.
- **Dashboard chart conversion** — CP's `{ labels, data }` is converted to UI `ChartPoint[]`.
- **Agent metrics field mapping** — CP's `participantId` becomes the UI's `agentRef` before merging with Examples Service profiles.
- **`/events` endpoint absence** — `listEvents` caches an `eventsEndpointMissing` flag after a single 404 so older CP builds only get probed once per browser session.

---

## Error handling

`lib/api/fetcher.ts` exports `ApiError` with `status`, `statusText`, `service`, `path`,
the verbatim `body`, an `isNotFound` getter, and the two structured accessors below.
Client functions branch on `ApiError.isNotFound` to return `undefined` for a missing entity, and
`listEvents`' fallback is the one degradation path that really is 404-gated. `getDashboardOverview`
and `getAgentMetrics` are **not**: both swallow *every* error and degrade (`client.ts:833`,
`:1277`), so a 500 or a network failure there is indistinguishable from an absent endpoint — the
capability simply reports itself unavailable. Everything else propagates and is caught by React
Query / error boundaries.

### The three control-plane error envelopes

The control plane's `GlobalExceptionFilter` emits **three** different bodies, and code that
understands only the first renders nothing for the second.

| Raised as | Body | `errorCode` |
|---|---|---|
| `AppException` | `{ statusCode, errorCode, message, metadata? }` | present, and meaningful |
| a Nest exception with an **object** body | emitted **verbatim** — the framework default is `{ statusCode, message, error }` | absent when Nest built the body; present when the thrower hand-built one |
| a Nest exception with a **string** body, or any unhandled error | `{ statusCode, errorCode: 'INTERNAL_ERROR', message }` | present, but **synthesized** |

The second row is a pass-through, not a shape. When Nest builds the body — 401 from the auth
guard, and **every `POST /runtime/policies` validation rejection**, including `schemaVersion
must be one of 1, 2, 3` — there is no `errorCode`. But a caller that throws
`new HttpException({ statusCode, errorCode, message }, status)` keeps its own code: the CP does
exactly this for its removed agent endpoints (`ENDPOINT_REMOVED` on `POST /runs/:id/messages`,
`/signal`, `/context`). Note the key is `errorCode`, not `code`.

> **A present `errorCode` is not always a real classification.** The third path rewrites a
> string-bodied `HttpException` into the `AppException` shape with a hardcoded
> `INTERNAL_ERROR`. A throttled **429 goes down that path**, so a rate limit arrives labelled
> `INTERNAL_ERROR`. When branching on `errorCode`, switch on the codes you actually handle and
> treat everything else — `INTERNAL_ERROR` included — as unclassified.

- **`ApiError.errorCode: string | undefined`** — the machine-readable code, present only on
  the `AppException` envelope. `undefined` means "the backend did not classify this", never
  "unknown code". Use it to tell apart failures that share a status: `CIRCUIT_BREAKER_OPEN`
  and `RUNTIME_UNAVAILABLE` are both 503 but mean different things to an operator.
- **`ApiError.detail: string | undefined`** — the human sentence, read from `message` in
  any envelope (an array `message`, the `ValidationPipe` shape, is joined). It deliberately does
  **not** fall back to the Nest `error` field (`"Bad Request"`, `"Unauthorized"`) — that restates
  the status rather than describing the failure. Fallbacks, in order: the raw body when it is not
  JSON; **the raw body when it parses to an object carrying no usable `message`** (so a
  pathological envelope still shows *something* rather than nothing — the trade-off is that the
  user may see raw JSON); `undefined` when there is no body at all.
- **`describeApiError(error: unknown): string`** — renders any thrown value to a sentence fit
  for a user: an `ApiError`'s `detail`, else its `Request failed with status N`; a plain
  `Error`'s `message`; a non-empty `string` verbatim; else a generic fallback. Never returns
  `''` or `[object Object]`. The plain-`Error` row is the commonest input, not an edge case —
  a network failure rejects before `fetchJson` reaches its status check, so it arrives as a
  bare `TypeError`. The result is **capped at 500 characters**, because an upstream body is
  arbitrary bytes (a multi-megabyte nginx page, a full stack trace) and this is the
  show-it-to-a-user boundary; `detail` and `message` stay uncapped for logging and matching.

Parsing is lazy and memoised: constructing an `ApiError` costs no `JSON.parse`, and an empty
body is never parsed at all. `.message` is unchanged — it is still the raw body, or
`Request failed with status N` when the body is empty.

## Demo mode

When `NEXT_PUBLIC_MACP_UI_DEMO_MODE=true`, every client function short-circuits to mock
data from `lib/data/mock-data.ts`. This keeps the entire product surface
exercisable with no backend. Live-run streaming is simulated with 1600ms frame ticks
over `MOCK_RUN_FRAMES`.

## SSE integration

Live execution uses:

```text
GET /api/proxy/macp-control-plane/runs/:id/stream?includeSnapshot=true&afterSeq=<n>
```

`lib/hooks/use-live-run.ts` manages the subscription:

- Named events handled: `snapshot`, `canonical_event`, `heartbeat`.
- Auto-reconnect with exponential backoff (max 8 attempts).
- Heartbeat timeout detection (45s) — silent connections are treated as failed.
- Bounded event buffer (500 events); event IDs deduped.
- Incoming `canonical_event` payloads run through `normalizeEvent` before being appended.
- Connection state surfaced to the UI: `idle | connecting | live | reconnecting | ended | error`.

**The resume cursor derives only from events actually received — never from a snapshot.** `afterSeq`
is seeded from the highest `seq` among the events already in hand, advanced only by
`canonical_event`, and never allowed to decrease.

`afterSeq` is exclusive, and the control plane gates its replay on `afterSeq > 0`: passing `0` yields
the snapshot plus the live tail and replays **nothing**. So a cold mount, where the console holds no
events yet, gets its history from the separate `getRunEvents` query rather than from the stream — and
a resume with a real cursor is what makes the stream replay the range in between.

Two things make that rule load-bearing rather than stylistic:

- **`timeline.latestSeq` is the server's head, not a description of what the client holds.**
  `getRunEvents` fetches at most 500 events, oldest first, so on a longer run the head is far beyond
  the newest event the console has. Opening the stream at the head asks for events *after* a range
  that was never delivered, and nothing else ever requests it — the gap is permanent and silent.
- **Snapshots arrive on every commit, not once per connection.** The control plane republishes the
  projection once per commit batch, so writing `latestSeq` from the `snapshot` handler would drag the
  cursor up to the head continuously during normal streaming, not merely in a reconnect window. The
  handler still applies the payload to state — that is what lets every projection panel self-heal —
  it just does not touch the cursor.

Correcting the cursor is what makes recovery possible at all: on reconnect the control plane pages
through every persisted event after `afterSeq` and re-emits it as `canonical_event`, so a resume at
the newest event actually held replays the range that was missed. Resuming at the server head asked
for events after ones that were never delivered, and nothing else ever requested them.

`timeline.latestSeq` remains available on the returned `state` as the server's high-water mark, which
is the right thing to compare a received `seq` against when detecting a gap.

Two limits worth knowing: the client buffer holds 500 events (`MAX_EVENT_BUFFER`), so a long backfill
evicts the oldest rather than growing without bound; and the hook's own buffer appends in arrival
order without sorting. The workbench no longer shows that raw buffer directly — `mergeEventStreams`
unions it with the fetched history and orders the result by `seq` — but anything reading
`useLiveRun().events` gets arrival order.

### Gap visibility

**`run.historyGap`** (`RunStateProjection.run.historyGap`) is the control plane's signal that a run's
event history is known-incomplete, mirroring `RunSummaryProjection.historyGap`. It is set when the CP
could not resume the runtime's per-session `StreamSession` from its last envelope ordinal because that
history had been compacted away (the runtime answers `FAILED_PRECONDITION`). The CP's own doc comment
states that the console surfaces this as a fidelity warning; the console renders it as a single notice
in the event feed. Absent or `false` means no known gap; only `true` warns. The matching
`session.stream.gap` canonical event is emitted at the same time, carries
`{ requestedAfter, detail }`, and is filterable under **Session** in `/logs`.

This gap is genuinely unrecoverable, and the notice says so instead of offering a retry: the envelopes
were compacted out of the runtime before the control plane could read them, so no refetch produces
them.

**There is deliberately no client-side seq-delta gap detector**, and one should not be added.
Canonical `seq` values are **not contiguous per run**. `RunEventService.persistRawAndCanonical`
allocates `1 + canonicalEvents.length` values from the single `runs.last_event_seq` counter, gives
the first to the **raw** row and `startSeq + index + 1` to the canonical events. Raw and canonical are
separate tables, and only canonical events are streamed — so every persisted batch burns one seq that
no subscriber will ever see. The CP's own unit spec pins the behaviour (raw@5, canonical@6 and @7),
and the projection's separate `timeline.latestSeq` and `timeline.totalEvents` counters are the
corroborating tell.

A detector built on "`seq` jumped, therefore an event was lost" therefore fires on **every healthy
run** — one false warning per batch. An earlier revision of this phase shipped exactly that and it was
removed; `lib/hooks/use-live-run.test.ts` carries a regression test asserting the hook stays quiet on
the real `2, 4, 6, 8` pattern.

Detecting the one hole the server cannot see — an event persisted but never published, which the
non-blocking post-commit publish makes possible — needs a signal that does not assume contiguity
(comparing `timeline.totalEvents` against the number of distinct canonical events held is the obvious
candidate). That is deferred rather than guessed at.

The CP-side stream contract (passive-subscribe frame, replay-from-`afterSeq`, heartbeat
cadence) is documented in
[`macp-control-plane/docs/API.md § SSE Streaming`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md#sse-streaming)
and [`macp-control-plane/docs/INTEGRATION.md § Consuming SSE Streams`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/INTEGRATION.md#consuming-sse-streams).

## Run launch sequence in the UI

### Standard flow
1. Load launch schema (Examples Service)
2. Compile with Examples Service (`POST /launch/compile`) — returns whitelisted-safe `runDescriptor` + pre-allocated `sessionId`
3. Validate with Control Plane (`POST /runs/validate`)
4. Submit to Control Plane (`POST /runs`)
5. Redirect to the live workbench at `/runs/live/[runId]`

### One-shot bootstrap flow
1. Call Examples Service `POST /examples/run`
2. Examples Service compiles, mints per-agent JWTs, spawns worker processes with bootstrap files, and submits the run to the CP best-effort (see [`macp-playground/docs/direct-agent-auth.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/direct-agent-auth.md))
3. **If `controlPlaneRun` came back**, the UI redirects to `/runs/live/<controlPlaneRun.runId>` — the CP's own run id, which is **not** the session id on this path
4. **If it did not**, the UI stays on the page and warns that the Example Service did not register the run, without attributing a cause. The run may still be picked up by session discovery, which keys it by session id, so the session route is offered as a link rather than an automatic redirect. See `POST /examples/run` above.
