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
| `/api/proxy/[service]/[...path]` | `app/api/proxy/[service]/[...path]/route.ts` | Generic forwarder for `example` and `macp-control-plane` services. Injects auth, strips hop-by-hop headers, streams response body unchanged. |
| `/api/jaeger/[...path]` | `app/api/jaeger/[...path]/route.ts` | Forwards to `JAEGER_BASE_URL/api/*`. Used by the trace detail surface to resolve span waterfalls. Returns `502` if Jaeger is unreachable. |

Supported upstream service identifiers (`[service]` segment): `example`, `macp-control-plane`.

### Environment variables

```bash
MACP_PLAYGROUND_BASE_URL=http://localhost:3000
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
- `POST /examples/run` — compiles, spawns the example agents with per-agent JWTs (minted via auth-service), and optionally submits to the CP. Response: `{ compiled, hostedAgents[], sessionId }`. Under observer-only CP, `sessionId` doubles as the run ID for navigation.

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
- `GET /runs/:id/state` — the projection. The UI consumes: `run` block (+ `contextId`, `extensionKeys`), `participants`, `graph`, `decision.current` (incl. `proposals[]`, `resolvedAt`, `resolvedBy`, `prompt`, `outcomePositive: boolean | null`), `signals`, `progress`, `timeline`, `trace`, `outboundMessages`, optional `policy` (+ `expectedCommitments`, `voteTally`, `quorumStatus`), optional `llm` (`{ calls[], totals }`).
- `GET /runs/:id/events` — dual-shape response: bare `CanonicalEvent[]` on the fast path; `{ data, total, limit, nextCursor }` when any of `afterTs` / `beforeTs` / `type` is supplied. The client handles both and pipes every row through `normalizeEvent()`.
- `GET /events` — cross-run stream for `/logs`. When CP returns 404 (older build), the client falls back to per-run fan-out and caches the decision for the browser session so later navigations skip the probe.
- `GET /runs/:id/stream` — SSE with `includeSnapshot=true&afterSeq=<n>`. Named events: `snapshot`, `canonical_event`, `heartbeat`.
- `GET /runs/:id/replay/state?seq=<n>` — state projection at a specific sequence; powers the timeline scrubber.
- `GET /runs/:id/export` — full run bundle; query: `includeCanonical`, `includeRaw`, `eventLimit`, `format` (`json | jsonl`).

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

### Runtime policy registry (RFC-MACP-0012, pass-through)
- `GET /runtime/policies?mode=<modeId>` — filterable list
- `GET /runtime/policies/:policyId`
- `POST /runtime/policies` — `{ policyId, mode, description, rules, schemaVersion? }`
- `DELETE /runtime/policies/:policyId`

Rule schemas are opaque to the control plane; the UI renders them descriptively. The
authoritative per-mode schema lives in [`macp-runtime/docs/policy.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/policy.md).

### Operational admin
- `GET /webhooks` — subscriptions may include `deliveryStats` (`total`, `succeeded`, `failed`, `lastDeliveredAt`)
- `POST /webhooks`, `PATCH /webhooks/:id`, `DELETE /webhooks/:id`
- `POST /admin/circuit-breaker/reset`
- `GET /admin/circuit-breaker/history?window=<alias>` — state transitions (`CLOSED | OPEN | HALF_OPEN`) with enter timestamps and optional reason
- `GET /readyz` — `{ ok, database, runtime, streamConsumer, circuitBreaker }`

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

All UI-facing data access lives in `lib/api/client.ts` (~1180 lines). Every function
branches on `NEXT_PUBLIC_MACP_UI_DEMO_MODE` — demo returns mock data, real hits the
proxy.

### Examples Service
- `listPacks`, `listScenarios`
- `getLaunchSchema`, `compileLaunch`
- `runExample` — one-shot bootstrap via `/examples/run`
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
- `getReadinessProbe`, `rebuildProjection`
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
and an `isNotFound` getter. Client functions branch on `ApiError.isNotFound` to return
`undefined` (missing entity) or to mark a capability as degraded
(`getDashboardOverview`, `listEvents` fallback, `getAgentMetrics`). Non-404 errors
propagate and are caught by React Query / error boundaries.

## Demo mode

When `NEXT_PUBLIC_MACP_UI_DEMO_MODE=true`, every client function short-circuits to mock
data from `lib/data/mock-data.ts` (~2000 lines). This keeps the entire product surface
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
2. Examples Service compiles, mints per-agent JWTs, spawns worker processes with bootstrap files, and optionally submits the run to the CP (see [`macp-playground/docs/direct-agent-auth.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/direct-agent-auth.md))
3. UI redirects to the returned `sessionId` (= run ID under observer-only CP)
