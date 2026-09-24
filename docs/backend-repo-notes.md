# Backend repo notes

This file is a **pointer index** into the upstream repositories the UI Console integrates
with. Endpoint schemas, request/response shapes, gRPC contracts, and protocol semantics
live in the upstream docs and are not duplicated here. The notes below only capture what
the UI needs to know to consume those services correctly.

## Integration topology

```
macp-ui-console (this repo) ──HTTP──► /api/proxy/{macp-playground,macp-control-plane}
                                        │
                                        ├──► macp-playground  (catalog, compile, bootstrap)
                                        └──► macp-control-plane      (run lifecycle, state, SSE)

                    macp-control-plane ──gRPC──► runtime (Rust)
                    agents        ──gRPC──► runtime (direct-agent-auth, RFC-MACP-0004 §4)
```

Under the observer-only macp-control-plane model, **agents never go through the macp-control-plane**
to emit envelopes. They authenticate to the runtime directly via `macp-sdk-python` /
`macp-sdk-typescript` using per-agent Bearer tokens handed to them via their bootstrap
file. The macp-control-plane observes the resulting envelopes through a read-only
`StreamSession` subscription.

---

## Examples Service

**Role from the UI's perspective:** scenario catalog, launch schema, launch compilation,
agent profile catalog, and optional one-shot bootstrap + spawn of example agents.

- **Canonical docs**
  - Architecture: [`macp-playground/docs/architecture.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/architecture.md)
  - API reference: [`macp-playground/docs/api-reference.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/api-reference.md)
  - Scenario authoring: [`macp-playground/docs/scenario-authoring.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/scenario-authoring.md)
  - Direct-agent-auth (how the service mints per-agent JWTs + spawns workers): [`macp-playground/docs/direct-agent-auth.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/direct-agent-auth.md)
  - Worker bootstrap contract: [`macp-playground/docs/worker-bootstrap-contract.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/worker-bootstrap-contract.md)
  - Policy authoring: [`macp-playground/docs/policy-authoring.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/policy-authoring.md)

- **Endpoints the UI calls** — see [`api-integration.md`](./api-integration.md#example-service-endpoints-used-by-the-ui)
- **Observed characteristics**
  - NestJS service; listens on `3000` inside its container, published on `3100` by the compose
    stacks (`docker-compose.e2e.yml`). The code's dev-only fallback is `http://localhost:3100` to
    match, pinned by `lib/server/integrations.test.ts`; production requires the variable explicitly
    (`resolveBaseUrl` throws rather than guessing).
  - Optional `x-api-key` auth (forwarded by the UI proxy)
  - Built-in example agent catalog: `fraud-agent`, `growth-agent`, `compliance-agent`, `risk-agent` across LangGraph / LangChain / CrewAI / custom Node frameworks
  - Agent metrics are fetched from the control plane and merged client-side into agent profiles
  - Compiles twin artifacts: a **scenario-agnostic `RunDescriptor`** (for CP `POST /runs`) plus a **scenario-specific payload** (`scenarioSpec` + per-agent `AgentBootstrap`) that travels with the spawned agents

---

## Control Plane

**Role from the UI's perspective:** observer-only run lifecycle, projected run state,
canonical event stream (per-run and cross-run), SSE live streaming, metrics, traces,
artifacts, audit log, runtime metadata pass-through, runtime policy registry, webhooks,
and admin operations.

- **Canonical docs**
  - API reference: [`macp-control-plane/docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md)
  - Architecture: [`macp-control-plane/docs/ARCHITECTURE.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/ARCHITECTURE.md)
  - Integration guide (add a runtime provider, consume SSE, policy registry): [`macp-control-plane/docs/INTEGRATION.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/INTEGRATION.md)
  - Troubleshooting: [`macp-control-plane/docs/TROUBLESHOOTING.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/TROUBLESHOOTING.md)

- **Endpoints the UI calls** — see [`api-integration.md`](./api-integration.md#macp-control-plane-endpoints-used-by-the-ui)

- **Observer-only authority model (what the UI must respect)**
  - `POST /runs` accepts a **scenario-agnostic `RunDescriptor` only**. A request containing `kickoff[]`, `participants[].role`, `commitments[]`, `policyHints`, or `initiatorParticipantId` is rejected with 400 (`forbidNonWhitelisted: true`). The UI only posts compiled descriptors from the macp-playground, which are whitelisted-safe by construction.
  - `POST /runs/:id/messages`, `POST /runs/:id/signal`, and `POST /runs/:id/context` are **removed** and return `410 Gone` with `errorCode: ENDPOINT_REMOVED`. The UI does not render forms that target these endpoints.
  - `POST /runs/:id/cancel` has two flows, chosen by `metadata.cancelCallback` / `metadata.cancellationDelegated`. The UI treats the endpoint as opaque — it posts and re-renders from the returned record.
  - `POST /runs/:id/clone` rejects non-empty `context` overrides. The clone form surfaces this error directly.
  - **A mis-scoped control-plane credential fails a run immediately, not after a timeout.** The runtime denies session access with gRPC `PERMISSION_DENIED` and a message beginning `FORBIDDEN:` — `FORBIDDEN: session access denied` from `GetSession`, or `FORBIDDEN: caller is not a declared participant or observer for this session` when subscribing to `StreamSession`. The control plane maps `PERMISSION_DENIED` to HTTP 403, and its session poll **rethrows** that rather than retrying, so the run fails on the **first** `GetSession` attempt rather than after the poll budget expires. (`NOT_FOUND` is **not** the contrasting case: `mapGrpcError` maps it to an `AppException` too — `grpc-helpers.ts:146` sits beside `:147` — and the poll loop rethrows *every* `AppException`, so it short-circuits as well. The `debug`-log comment at `run-executor.service.ts:415` saying "`NotFound` … is normal" is stale and is flagged as such in the control plane's own `docs/INTEGRATION.md:133-138`. Polling continues in only two cases: a snapshot whose `state` is neither `OPEN` nor `EXPIRED`, and a **non-gRPC** error — notably circuit-breaker-open, which is a plain `Error` with no numeric `.code` (`circuit-breaker.ts:77`), so `mapGrpcError` declines it and the provider rethrows it unchanged. That second case is what the `debug` log is still genuinely for.)
  - **Where the reason actually is, and where it is not.** The failure is persisted as two columns, `errorCode` and `errorMessage`. On this path `errorCode` is always the literal `RUN_FAILED` — **never** `FORBIDDEN` — and `errorMessage` carries the runtime's sentence, so the `FORBIDDEN:` prefix is the thing to match on. Both are returned by `GET /runs/:id`, which selects the whole row. **Neither appears in `GET /runs/:id/state`**: `RunSummaryProjection` has no error field of any kind, and nor does any sibling block in `RunStateProjection`. A console surface that reads a failure reason from the projection alone will therefore show nothing for this case — that is the difference between "the UI has a bug" and "the UI is reading the wrong endpoint". Note also that `errorCode`/`errorMessage` ship on the wire but are **not** declared in the control plane's published `Run` contract, so they are undocumented rather than guaranteed.
  - **Triage line:** a run that fails almost instantly, with an `errorMessage` starting `FORBIDDEN:`, means a mis-scoped control-plane credential — not a missing initiator agent, and not a runtime outage.

- **Response-shape differences the UI normalizes** — see the [Response normalization](./api-integration.md#response-normalization) section of `api-integration.md`.

- **Observed characteristics**
  - NestJS service with Drizzle ORM and PostgreSQL; local default port `3001`
  - Optional Bearer auth (forwarded by the UI proxy)
  - gRPC integration with the Rust runtime; circuit breaker pattern
  - Prometheus metrics at `/metrics`; readiness probe at `/readyz`
  - OpenTelemetry traces with a `run.lifecycle` parent span

---

## Runtime

**Role from the UI's perspective:** the runtime is not called directly by the UI. Its
manifest, modes, roots, health, and policy registry are all surfaced **through the
macp-control-plane** at `/runtime/*` endpoints. The UI never opens a gRPC channel.

- **Canonical docs** (useful for understanding what the CP passes through)
  - Overview: [`macp-runtime/docs/README.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/README.md)
  - Architecture: [`macp-runtime/docs/architecture.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/architecture.md)
  - API (24 gRPC RPCs): [`macp-runtime/docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/API.md)
  - Modes (Decision / Proposal / Task / Handoff / Quorum + extensions): [`macp-runtime/docs/modes.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/modes.md)
  - Policy (RFC-MACP-0012 rule schemas + evaluator internals): [`macp-runtime/docs/policy.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/policy.md)
  - Deployment: [`macp-runtime/docs/deployment.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/deployment.md)

- **Observed characteristics**
  - Rust implementation, single binary; local default port `50051`
  - JWT bearer + static bearer + dev header resolver chain (see [`macp-runtime/docs/getting-started.md#authentication`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/getting-started.md#authentication))
  - Append-only session history; passive subscribe for observer streams (RFC-MACP-0006 §3.2)

---

## Agent SDKs (Python + TypeScript)

**Role from the UI's perspective:** the UI does **not** depend on the SDKs at runtime. They
are relevant because every envelope the UI displays was emitted by an agent process built
on one of these SDKs. The `agentRef` ↔ `framework` mapping in the agent catalog and the
direct-agent-auth flow referenced in the run workbench trace back to the SDKs.

- **Python SDK** — [`macp-sdk-python/docs/index.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/index.md)
  - Agent framework (`Participant`, `from_bootstrap`, handler dispatch): [`guides/agent-framework.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/guides/agent-framework.md)
  - Direct-agent-auth bootstrap shape: [`guides/direct-agent-auth.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/guides/direct-agent-auth.md)
  - Protocol primer (envelopes, sessions, two-plane): [`protocol.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/protocol.md)

- **TypeScript SDK** — [`macp-sdk-typescript/docs/index.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs/index.md)
  - Agent framework (`fromBootstrap()`, strategies): [`guides/agent-framework.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs/guides/agent-framework.md)
  - Authentication: [`guides/authentication.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs/guides/authentication.md)

---

## Jaeger (optional)

**Role from the UI's perspective:** trace detail deep-dives. The `/traces` surface
resolves span waterfalls through a Jaeger instance when `JAEGER_BASE_URL` is configured.
When unreachable, the `/api/jaeger/[...path]` proxy returns `502` and the UI falls back
to the CP `TraceSummary`. Jaeger has no bearing on the rest of the UI.

---

## How the UI uses this information

- The **macp-playground** drives every catalog, launch, and agent-profile surface.
- The **control plane** drives every live execution, history, observability, runtime metadata / policy, and admin surface.
- Runtime metadata and policy are exposed **through** macp-control-plane `/runtime/*` endpoints — the UI never talks to the runtime directly.
- SDK docs are background reading for understanding envelope contents and the direct-agent-auth bootstrap lifecycle, not a runtime dependency of the UI.
- Jaeger is consulted only when configured and only for trace detail.
