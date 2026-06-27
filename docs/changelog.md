# Changelog

## 2026-04-22 — In-console docs surface + Examples Service docs sync

Moves the UI Console and Examples Service docs out of the marketing website and into the Console app itself at `/docs`. Operators now read the docs next to the product.

### New

- `/docs` — single-page landing with hand-authored themed SVG diagrams (architecture, scenario-pack pipeline, run flow) plus a doc index.
- `/docs/macp-ui-console/[slug]` — renders this repo's `docs/*.md` via `react-markdown` + `remark-gfm`. Mermaid code fences render as diagrams via a lazy-loaded client component that re-renders on theme change.
- `/docs/macp-playground/[slug]` — renders markdown from `docs-content/macp-playground/`, which is synced from the upstream repo.
- Sidebar gains a **Docs** entry (BookOpen icon, immediately after Dashboard).
- New sync workflow `.github/workflows/sync-examples-docs.yml` + `scripts/sync-examples-docs.sh`. Listens for `repository_dispatch: docs-updated` from the macp-playground repo (plus a 6-hour fallback schedule), copies the docs, and opens an auto-PR.
- `lib/docs/loader.ts` — small server-side helper (title / first-paragraph extraction).
- `components/docs/markdown-renderer.tsx` with link rewriting (relative `.md` → `/docs/<collection>/<slug>`, cross-repo paths → GitHub URLs), styled code / tables / blockquotes, and `github-slugger` heading anchors.

### Removed

- `.github/workflows/notify-website.yml` — the console is the docs host now, not a source for the website. Website-side cleanup (removing `app/console/` + `app/macp-playground/` + their sync blocks) lands in a separate website commit.

### Dependencies

- Added `react-markdown`, `remark-gfm`, `mermaid`, `github-slugger`.

### Operator note

The macp-playground repo's `notify-website.yml` is retargeted at ui-console in a sibling commit. Once that ships, a push to macp-playground `main` automatically opens a sync PR here. Merging the PR redeploys the Console with fresh Examples Service docs.

---

## 2026-04-22 — Docs refresh: cross-repo references, reduced duplication

Backend docs (`macp-playground`, `macp-control-plane`, `runtime`, `python-sdk`, `typescript-sdk`) were all refreshed upstream. The UI console docs are realigned to **reference** those sources rather than mirror their endpoint tables. No UI code changes.

- `backend-repo-notes.md` rewritten as a pointer index. Per-service endpoint inventories removed; each service now links to its canonical upstream doc plus a short note on the UI-facing role.
- `api-integration.md` trimmed: endpoint schemas now point to `macp-control-plane/docs/API.md` and `macp-playground/docs/api-reference.md`; the UI-specific pieces (proxy, normalizers, SSE hook, demo mode, launch sequences) remain documented inline.
- `architecture.md` gained an **Upstream services** section linking to each repo's architecture doc (CP, ES, runtime, SDKs). Client line counts resynced.
- `README.md` gained an **Upstream repositories** table and updated doc index.
- All occurrences of "Example Service" normalized to the upstream spelling **Examples Service**.

## 2026-04-22 — Observer-only CP alignment, session-interaction rework, Playwright removal

Consolidates a run of UI ↔ backend integration changes (`5adcc20`, `1045a59`, `65433b6`, `fdbe99f`, `6cd9da6`, `4965a63`, `6da8a76`).

### Control Plane contract alignment

- Aligned the client with the **observer-only Control Plane** authority model: agent-originated traffic (messages, signals, context updates) now flows through the runtime SDKs. CP endpoints `POST /runs/:id/messages`, `POST /runs/:id/signal`, and `POST /runs/:id/context` return `410 Gone`. `POST /runs/:id/cancel` proxies to the initiator agent's cancel callback (or calls `CancelSession` directly when policy-delegated).
- `POST /runs` is the **only** run-creation path and accepts a whitelisted-safe compiled `RunDescriptor` only — CP rejects any body containing `kickoff[]`, `participants[].role`, `commitments[]`, `policyHints`, or `initiatorParticipantId`. The UI continues to compile via Examples Service, which is already whitelisted-safe.
- `POST /runs/:id/clone` rejects non-empty `context` overrides.
- `CreateRunResponse` now surfaces `sessionId` alongside `runId` (equal under observer-only; reserved for future auto-discovery).
- Extended `RunStateProjection` with the `llm` projection: `{ calls[], totals: { callCount, promptTokens, completionTokens, totalTokens, estimatedCostUsd } }` plus `contextId` and `extensionKeys` on the `run` block. `NodeInspector` surfaces the LLM tab from this data.

### Runtime policy registry integration (RFC-MACP-0012 pass-through)

- New client functions: `listRuntimePolicies`, `getRuntimePolicy`, `registerRuntimePolicy`, `unregisterRuntimePolicy` against CP `/runtime/policies{?mode}` and `/runtime/policies/:policyId`.
- Surface: `/policies` (registry browser) and `/modes` (mode-scoped policy list).
- `PolicyBadge` and `PolicyPanel` tones updated to reflect the revised governance rules and commitment-evaluation contract.
- Mock dataset gains `MOCK_RUNTIME_POLICIES` to keep demo mode exercisable.

### Session interaction simplification

- Removed UI-side message/signal/context POST forms that targeted the now-410 CP endpoints. The runs workbench is now a read-only consumer of CP state, canonical events, and artifacts; agents drive envelopes via `macp-sdk-python` / `macp-sdk-typescript`.
- Artifact creation (`POST /runs/:id/artifacts`) and projection rebuild (`POST /runs/:id/projection/rebuild`) remain CP-local and are kept.

### Dashboard chart series

- CP now emits a **single `decisionOutcome`** series (positive/negative encoded as +1/-1 per bucket) instead of the earlier split `decisionOutcomePositive` / `decisionOutcomeNegative` arrays. Client and mock data updated; any callers relying on the split fields were removed.

### Response normalization cleanup

- `normalizeRun()` no longer synthesizes `archivedAt` from tags — CP exposes the column directly; the client passes it through unchanged.
- `normalizeEvent()` promoted out of the SSE hook and applied uniformly in `getRunEvents` and `listEvents` so every CP event consumer gets the nested `source` / `subject` shape.
- `listEvents` gained a session-cached `eventsEndpointMissing` flag — when CP returns `404` for `/events`, the fallback per-run fan-out is used for the rest of the browser session without re-probing.

### Test infrastructure

- **Playwright removed** (`4965a63`) — the visual-regression and E2E spec suites are retired. All golden-PNG baselines deleted. The Vitest + React Testing Library suite remains canonical.
- Integration tests under `test/integration/` tightened for the observer-only contracts and the new 410 responses (`6da8a76`).

### UI regression fixes

- Color palette and chart/config warning cleanup that regressed during the CP rewrite work (`fdbe99f`).
- Lint-only fixes across `decision-panel`, `policy-panel`, and `run-workbench` (`6cd9da6`, `ddd8a26`).
- `ExecutionGraph` regained the four extra auto-layout passes lost in the CP rewrite (part of `6da8a76`).

### Docs

- `api-integration.md`, `backend-repo-notes.md`, and `architecture.md` regenerated against the current `lib/api/client.ts`. Runtime policy endpoints, `/admin/circuit-breaker/history`, `/readyz`, `/runs/:id/replay/state?seq=`, `/runs/batch/export`, and the Jaeger proxy route are now documented.
- `README.md` route map includes `/modes` and `/policies`; added the `npm run local:{up,down,status}` Docker full-stack section.

---

## 2026-04-14 (continued) — Phase F + Phase D remainder

Second push on 2026-04-14: completes Phase F (filters + observability) and the
remaining Phase D items (D3 Prometheus parser, D4 tree waterfall, D5 /traces
filters). All items below ship against the backend substantially-complete
plan; no `console` / lint warnings; `npm run build` clean.

### Added

#### API client extensions

- **`listEvents(demoMode, query)`** (`lib/api/client.ts`) — wrapper around BE §4.1 cross-run `/events` endpoint. Query shape: `{ runId, scenarioRef, type, afterTs, beforeTs, afterSeq, limit }`. Returns `{ data, total, nextCursor }`. Demo mode fans out across `MOCK_RUN_EVENTS` with the same filters so `/logs` is exercisable without a backend.
- **`getRunEvents` accepts `RunEventsQuery`** — new fields `afterTs`, `beforeTs`, `type` (csv) map to BE §4.2. Legacy `(runId, demoMode, limit, afterSeq)` call signature preserved for back-compat.
- **`getDashboardOverview(demoMode, query)`** — accepts `{ window, scenarioRef, environment, from, to }` per BE §5.1. Forwards as query params; demo mode filters `MOCK_RUNS` client-side so KPIs respond to the pickers.
- **Chart series extended:** `charts.throughput`, `queueDepth`, `latencyP50/P95/P99`, `cost`, `successRate`, `decisionOutcomePositive`, `decisionOutcomeNegative`, `perScenario` — matches BE §5.2 output.
- **`getCircuitBreakerHistory(demoMode, window?)`** — BE §5.3 endpoint. Returns `CircuitBreakerHistoryEntry[]` (`{ state, enteredAt, reason? }`).
- **`computeDashboardKpis(runs?)`** accepts an optional filtered run list so demo mode can respond to scenario/environment filters.

#### Pure helpers

- **`lib/utils/prometheus.ts`** — `parsePrometheusText()` with full support for counters, gauges, histograms (grouped under base name via `_bucket`/`_sum`/`_count` suffixes), summaries, and escaped quotes in labels. `metricSummaryValue()` returns the one-value-per-row summary (sum of labeled counters, `_count` for histograms). `histogramQuantile(metric, p)` interpolates percentiles from `le` buckets — same algorithm as Grafana's `histogram_quantile`. **13 unit tests.**
- **`lib/utils/traces.ts`** — `buildSpanTree()` builds depth-annotated tree from `span.references[CHILD_OF]`, sorts siblings by `startTime`, treats orphans as additional roots, and counts descendants. `findCriticalPath()` post-order DP finds the longest root-to-leaf chain by cumulative duration. **7 unit tests.**

#### New components

- **`PrometheusMetricsTable`** (`components/observability/prometheus-metrics-table.tsx`) — sortable, filterable table over parsed exposition. Type chips (counter/gauge/histogram/summary), name/help search, click-row → `EventDetailDialog` with per-series breakdown. **4 integration tests.**
- **`CircuitBreakerTimeline`** (`components/observability/circuit-breaker-timeline.tsx`) — horizontal proportional-width state timeline + current-state badge + per-transition table. Freezes `now` at mount for render-purity. **3 tests.**

#### Page rewrites

- **`/logs` (PR-F1)** — rewritten against the cross-run `/events` endpoint:
  - Shared `<RunSelectorFilters>` (scenario + runId + time window)
  - Event type filter with `EVENT_TYPE_GROUPS` incl. new `LLM` group
  - Cursor-based "Load more" pagination (cursors kept as an append-only `useState` array; each new cursor concatenates a dedup'd page)
  - Client-side free-text search over the current page
  - `summarizeEvent()` one-line summary in the Payload column
  - `EventDetailDialog` opens on row click with full payload + Run / Trace / Event id meta rows
  - URL state for every filter → shareable links (runId / scenario / window / type)
  - Empty states + proper loading/error panels

- **`/traces` (PR-D4 + PR-D5)** — tree-indented span waterfall:
  - Calls `buildSpanTree()` + `findCriticalPath()`
  - Per-row depth indentation with `└` connector
  - Critical path segments tinted accent-blue; non-critical use accent-2; errors tinted red
  - Click-a-span → `EventDetailDialog` with Span ID / Trace ID / Start / Status meta
  - Shared `<RunSelectorFilters>` (scenario + status + runId) replaces the single-select dropdown; URL deep-linkable
  - Graceful fallback to flat render when `references[]` is missing (runtime-side fix still pending — BE §10)

- **`/observability` (PR-F3 / PR-F4 / PR-F5 / PR-F6 / PR-D3)**:
  - Shared `<RunSelectorFilters>` (scenario + environment + time window)
  - New chart grid for BE §5.2 series (throughput / queue depth / latency percentiles / cost over time) — each renders only when data is present
  - Three new KPI cards for **p50 / p95 / p99 latency** computed client-side from the Prometheus histogram (PR-F6)
  - `CircuitBreakerTimeline` card (BE §5.3)
  - Raw `<pre>` dump replaced with `PrometheusMetricsTable` (raw link preserved as "Open raw exposition ↗")

- **Signal Rail** (`components/runs/signal-rail.tsx`) — "Open in full view ↗" link to `/logs?runId=...&type=signal.emitted` (PR-B3, the last remaining surface).

### Changed

- Many pages now wrap their content in `<Suspense>` boundaries to satisfy Next.js 16 `useSearchParams` requirements.
- `RunWorkbench` passes `runId` into `SignalRail` (for the deep-link) and `LiveEventFeed`.

### Tests

- **New unit tests:** `prometheus.test.ts` (13), `traces.test.ts` (7), `prometheus-metrics-table.test.tsx` (4), `circuit-breaker-timeline.test.tsx` (3).
- **Full suite now at 371 unit tests** passing (up from 344), across 30 test files.
- 36 visual baselines regenerated and passing deterministically.
- `npm run build` succeeds — all pages render without runtime errors.

### Notes

- Spurious `posttooluse-validate` hook recommendations suggesting Vercel Workflow migration were ignored — `lib/api/client.ts` is a browser-side fetch wrapper, not a serverless handler.

---

## 2026-04-14 — Phase A–E implementation against the enriched backend projection

This release consumes the substantially-complete backend plan (see
`plans/backend-changes-plan.md` status table as of 2026-04-14): state
projection completeness, decision/policy enrichment, canonical event
contracts, cross-run query endpoints, observability enrichment, and the
re-scoped `llm.call.completed` event are all live on the Control Plane.

### Added

#### Shared primitives

- **`<Tooltip>`** (`components/ui/tooltip.tsx`) — CSS-positioned, keyboard-focusable hint primitive. Used by policy panel commitment ids and ready for further adoption.
- **`<EventDetailDialog>`** (`components/ui/event-detail-dialog.tsx`) — shared native-`<dialog>` modal for click-through event / span / metric details. Consumed by LiveEventFeed; ready for `/traces` span details and `/observability` metric details.
- **`<RunSelectorFilters>`** (`components/runs/run-selector-filters.tsx`) — shared filter bar (scenario / runId / status / environment / time-window). Prop-driven rendering so each consumer shows only the controls it needs. Q24 decision: build once, use three times.
- **`<EmptyState>`** (`components/ui/empty-state.tsx`) — standardized icon + title + description + action.
- **`<KpiCard>`** (`components/ui/kpi-card.tsx`) — Syne-displayed KPI tile with optional colored top-stripe accent.
- **`<Panel>`** (`components/ui/panel.tsx`) — replaces ad-hoc `Card + CardHeader + section-actions` composition.
- **`<Breadcrumbs>`** (`components/layout/breadcrumbs.tsx`) — derives a navigation trail from the current route, truncating UUID-like segments.

#### `summarizeEvent()` helper (`lib/utils/events.ts`)

Pure, type-aware helper that produces a one-line semantic summary for a `CanonicalEvent`. Covers the high-volume types (run.*, signal.*, proposal.*, decision.*, policy.*, message.*, tool.*, llm.call.completed) with a generic fallback for everything else. Unit-tested with 11 assertions.

#### LLM interaction visibility (finding #12)

- New `LlmCallCompletedData` type mirrors the CP-synthesized event payload.
- `NodeInspector` gains a conditional "LLM (N)" tab that lists `llm.call.completed` events for the selected participant — each row shows model, token counts, latency, and expandable prompt + response. Honors `redactedPrompt` when the `RedactionService` applied.
- Mock data includes `llm.call.completed` events for the completed fraud run so demo mode exercises the tab.

#### Enriched projection consumption (BE-3 / BE-5 / BE-6 / BE-7 / BE-8 / BE-9)

- **`DecisionProjection.current`** type extended with `proposals[]`, `resolvedAt`, `resolvedBy`, `prompt`. `outcomePositive` widened to `boolean | null` per BE-3.
- **`PolicyProjection`** type extended with `expectedCommitments[]`, `voteTally[]`, `quorumStatus`.
- **Decision panel** (`components/runs/decision-panel.tsx`) rewritten to render the action header with action→tone mapping (approve/step_up/decline → success/warning/danger, neutral fallback), bulleted reasons, contributors table (from `proposals[]`), resolvedBy/at sub-line with deep-link to originating event seq, and the scenario `prompt` labeled distinctly from reasons. Outcome badge branches on `run.status` first, then `outcomePositive: boolean | null`. Removes the literal `'mode'` / `'unknown'` badges (finding #6a).
- **Policy panel** (`components/runs/policy-panel.tsx`) rewritten to show expected commitments with Tooltip-on-hover revealing title + description + required roles, inline tally (allow/deny/quorum), per-commitment evaluation decisions, and `quorumStatus` badge. Falls back to the legacy `commitmentEvaluations[]` table when new fields aren't yet populated. Policy version badge links to `/policies/[policyVersion]`.
- **Run overview card** (`components/runs/run-overview-card.tsx`) — Q1/Q2/Q3 KPI unification. Events + Messages counters now source from the SSE projection during live statuses and from the metrics aggregate once terminal. Tokens/Cost removed from the top strip (moved to the observability summary card).

#### Event feed redesign (PR-B1)

`LiveEventFeed` rewritten:

- Drops the truncated `JSON.stringify()` snippet per row.
- Each row: type badge + seq + semantic summary (`summarizeEvent`) + meta line (timestamp, source).
- Whole row is a button — click opens `<EventDetailDialog>` with the full payload, copy-JSON action, and metadata rows (subject, source, trace id, event id).
- Size selector chips (100 / 500, default 100 per Q13).
- Type filter chips auto-populated from observed event types.
- "Open in full view ↗" link to `/logs?runId=...`.

### Changed

- `RunWorkbench` now passes `state` + `events` + `runId` into `RunOverviewCard`, `DecisionPanel`, and `LiveEventFeed` to support the new projection-consuming behaviour.
- `ExecutionGraph` `outcomePositive` handling widened to accept `boolean | null | undefined` from the enriched decision projection; `null` maps to undefined accent.
- `policy-panel.tsx` removes the `policyHints.type !== 'none'` gate — full rules now render whenever a descriptor is reachable.

### Tests

- New unit tests: `events.test.ts` (11 cases), `run-selector-filters.test.tsx` (5), `event-detail-dialog.test.tsx` (3), `tooltip.test.tsx` (6), `empty-state.test.tsx` (3), `panel.test.tsx` (2), `kpi-card.test.tsx` (4).
- New integration-style tests: `decision-panel.test.tsx` (9 cases covering outcome branching, prompt/reasons/contributors), `policy-panel.test.tsx` (5 cases covering enriched + legacy fallback paths).
- Full suite: **344 unit tests passing** (up from 311), **36 visual baselines passing** deterministically.

---

## Policy governance and RFC-MACP-0012 alignment

### Added

#### Policy hints throughout the UI
- New `PolicyHints` type with governance fields: type, threshold, vetoEnabled, vetoRoles, vetoThreshold, minimumConfidence, designatedRoles
- `PolicyProjection` and `CommitmentEvaluation` types for runtime policy resolution
- `PolicyBadge` component displays policy type with color coding (none/majority/supermajority/unanimous)
- `PolicyPanel` component shows policy version, resolution status, and commitment evaluation table
- Scenario catalog cards now show policy type badge
- Scenario detail page shows full policy governance section (thresholds, veto config, designated roles)
- Launch form displays policy version and description when template is selected
- Run workbench shows PolicyPanel with commitment evaluations when policy data is available

#### Token and cost tracking
- `MetricsSummary` now includes `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCostUsd`
- Run workbench observability summary shows token count and estimated cost when available

#### Mock data updates
- Fraud scenario templates expanded to include `majority-veto` and `unanimous` variants
- All mock scenarios enriched with `policyVersion` and `policyHints`
- Mock run state projections include `policy` section with commitment evaluations
- Mock metrics include token usage and cost
- Policy canonical events (`policy.resolved`, `policy.commitment.evaluated`) added to mock events

### Changed

#### API client
- `normalizeRun()` simplified: `archivedAt` now passed through directly from CP instead of synthesized from tags
- `listRuns()` always sends `limit` and `offset` defaults (required by CP validation)

---

## Deep analysis fixes: gaps, stubs, bugs, and test coverage

### Critical bug fixes

- **Delete run redirect**: `deleteMutation` in RunWorkbench now redirects to `/runs` after successful deletion instead of leaving user on an error page
- **Form reset after send**: SendMessageForm and SendSignalForm in SessionInteractionPanel now reset fields on successful mutation

### Type safety and error handling

- **14 API functions** now have explicit return type annotations with shared interfaces (`MutationAck`, `BatchOperationResult`, `RebuildProjectionResult`, `CircuitBreakerResult`, `RunExampleResult`, `CreateArtifactResult`, `AgentMetricsEntry`) defined in `lib/types.ts`
- **`ApiError` class** added to `lib/api/fetcher.ts` — preserves HTTP status, service, and path for error discrimination
- **`getAgentProfile()`** now only returns `undefined` for 404; re-throws other errors
- **`getDashboardOverview()`** returns `degraded: true` flag when overview endpoint fails; logs warning
- **`getAgentMetrics()`** logs warning on failure instead of silently returning `[]`
- **`normalizeRun()`** validates required fields (`id`, `status`, `runtimeKind`) before processing

### Agent metrics improvements

- `averageLatencyMs` is now optional — displays "N/A" instead of misleading "0ms" when unavailable
- `messages` field from CP response is now mapped through to `AgentMetricsEntry`
- Demo mode returns representative mock metrics instead of empty array

### Pagination and configuration

- `getRunEvents()` accepts optional `limit` parameter (default 500)
- `getAuditLogs()` accepts optional `limit` and `offset` parameters
- `integrations.ts` throws in production if base URLs are not configured; warns on empty auth tokens
- Preset IDs now use `crypto.randomUUID()` instead of `Date.now()`

### UI and component improvements

- Mutation error messages now include backend error details
- ExecutionGraph uses data-driven auto-layout by node kind instead of hardcoded positions
- `formatDateTime()` and `formatChartLabel()` accept optional `timeZone` parameter
- Tabs component: `defaultTab` prop deprecated in favor of `defaultValue`
- Removed unused imports (`Plus`, `createArtifact`, `updateRunContext`) from RunWorkbench

### Documentation

- Added 10 missing API endpoints to `docs/api-integration.md`: session interaction, batch operations, context updates, artifact creation, projection rebuild, run deletion

### Test coverage

- **47 new unit tests** (226 total): real-mode API client tests, SSE hook tests, agent metrics tests
- **6 new integration tests** (85 total): error scenarios for getRun/cancelRun/sendRunMessage (500/422), dashboard degradation, empty results
- **New test files**: `lib/api/client.real-mode.test.ts`, `lib/hooks/use-live-run.test.ts`

---

## Agent metrics normalization and dynamic environment filter

### Fixed

#### Agent metrics field mapping
- `getAgentMetrics()` now normalizes CP response: `participantId` mapped to `agentRef`, `averageLatencyMs` passed through when available (optional)
- Previously the agent catalog page silently failed to enrich profiles because the CP returns `participantId` while the UI looked up by `agentRef`
- Updated integration test fixtures to match actual CP response shape (`participantId`, `messages` fields)

#### Dynamic environment filter
- Runs page environment dropdown now dynamically populated from actual run metadata
- Removed hardcoded `local-dev | stage | prod` options that didn't match real environments
- Supports any environment value including `development` (the default set by Example Service)

---

## Control plane full integration

### Changed

#### Chart timestamp handling

- `LineChartCard` and `BarChartCard` now use `formatChartLabel()` to auto-detect ISO timestamp labels and format them as short date strings (e.g. "Apr 1, 3 PM")
- added `formatChartLabel` utility in `lib/utils/format.ts`

#### Token and cost KPIs from control plane

- `getDashboardOverview()` now extracts `totalTokens` and `totalCostUsd` from CP KPIs when available, instead of hardcoded zeros

#### Server-side run filtering

- runs page now passes `status`, `environment`, and `search` params to `GET /runs` for server-side filtering
- client-side filtering retained as fallback in demo mode

#### Agent metrics enrichment

- added `getAgentMetrics()` API function calling `GET /dashboard/agents/metrics` on the control plane
- agents page fetches real per-agent metrics (runs, signals, latency, confidence) and merges into profiles

#### Clone with overrides

- `cloneRun()` now accepts optional `{ tags, context }` overrides parameter
- added clone UI form in run workbench with tag and context JSON inputs

#### Batch export

- added `batchExportRuns()` API function calling `POST /runs/batch/export`
- added "Export" button to batch toolbar in runs table

#### Webhook delivery stats

- `WebhookSubscription` type now includes optional `deliveryStats` with `total`, `succeeded`, `failed`, `lastDeliveredAt`
- settings page displays delivery counts and last delivery timestamp per webhook

### Testing

- added unit tests for `formatChartLabel`, `getAgentMetrics`, `cloneRun` with overrides, `batchExportRuns`
- added integration tests for batch export, clone with overrides, server-side filters, agent metrics
- updated dashboard integration tests: token/cost KPI extraction from CP, fallback to zero when omitted
- updated backend-response fixtures: `dashboardOverview` includes token/cost KPIs, added `agentMetrics()` and `batchExportResponse()` fixtures

---

## Real-mode integration fixes

### Changed

#### Response normalization layer

- added `normalizeRun()` helper in `lib/api/client.ts` that maps Control Plane response shapes to UI types
- `listRuns()` now unwraps the paginated `{ data, total }` response from the Control Plane
- `getRun()` now normalizes the raw response through `normalizeRun()`
- flat `sourceKind`/`sourceRef` fields are mapped to nested `source: { kind, ref }` on all run records
- `archivedAt` is synthesized from `tags.includes('archived')` as a bridge until the Control Plane adds a dedicated column

#### Validate, cancel, and archive response mapping

- `validateRun()` now maps the Control Plane's `{ valid, errors, warnings, runtime }` response to a typed `ValidateRunResponse` with `ok` field
- `cancelRun()` now extracts `{ ok, runId, status }` from the full run record returned by the Control Plane
- `archiveRun()` now extracts `{ ok, runId, archived }` from the full run record returned by the Control Plane

#### Agent profiles via Example Service

- `getAgentProfiles()` now calls Example Service `GET /agents` directly instead of computing profiles client-side via N+1 cascading calls to packs/scenarios/launch-schemas
- `getAgentProfile()` now calls Example Service `GET /agents/:agentRef` directly with fallback to `undefined`

#### Dashboard overview with Control Plane aggregation

- `getDashboardOverview()` now fetches from Control Plane `GET /dashboard/overview` for KPIs and chart data
- falls back gracefully to client-side computation if the endpoint is unavailable
- Control Plane chart data (`{ labels, data }` arrays) is converted to UI `ChartPoint[]` format

#### Types

- added `ValidateRunResponse` interface to `lib/types.ts`

---

## Initial MACP UI Console delivery

### Added

#### Project foundation

- created a new Next.js App Router project scaffold
- added TypeScript, Tailwind-free custom CSS shell, React Query, Zustand, React Flow, and Recharts integration points
- added route-handler proxy for Example Service and Control Plane

#### Layout and navigation

- app shell with sidebar navigation
- sticky topbar with demo-mode and theme toggles
- command palette with route shortcuts

#### Scenario surfaces

- scenario catalog page
- scenario detail page with version/template switching
- launch schema and defaults inspection

#### Run launch flow

- new-run page with pack/scenario/template selection
- schema-driven input editor
- raw JSON editor
- compile launch flow against Example Service
- validate execution request against Control Plane
- submit run flow
- optional Example Service one-shot bootstrap flow

#### Live and historical run analysis

- live-runs page
- shared run workbench for live and historical views
- execution graph built with React Flow
- node inspector with overview, payloads, signals, logs, traces, and metrics tabs
- live event rail
- signal rail
- final decision panel
- observability summary panel
- artifacts and messages panel
- replay descriptor request panel

#### History and comparison

- run history page with filtering
- run comparison page

#### Agent and observability surfaces

- agent catalog and detail pages
- logs explorer
- traces explorer
- observability dashboard
- settings page with webhook and audit surfaces

#### Demo mode

- rich mock data for packs, scenarios, runs, states, metrics, traces, and audit/webhooks
- simulated live run streaming frames

### Integration alignment

The UI was aligned to the uploaded repositories by using their exposed contracts and endpoints:

- Example Service for scenario/launch compilation
- Control Plane for run lifecycle, state, streaming, metrics, traces, audit, and webhooks
- runtime metadata as surfaced by Control Plane runtime endpoints

### Intentionally not changed

- no modifications were made to the uploaded backend repositories
- no assumptions were added that require backend code changes to render the demo mode
