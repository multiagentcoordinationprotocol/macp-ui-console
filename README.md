# MACP UI Console

[![CI](https://github.com/multiagentcoordinationprotocol/macp-ui-console/actions/workflows/ci.yml/badge.svg)](https://github.com/multiagentcoordinationprotocol/macp-ui-console/actions/workflows/ci.yml)

Feature-rich Next.js orchestration and observability console for MACP.

This project turns the MACP product blueprint into a working UI scaffold that can:

- launch scenarios from Examples Service launch schemas
- compile launch inputs into Control Plane execution requests
- validate and submit runs to the Control Plane
- stream live execution updates over SSE
- visualize multi-agent execution flow graphically
- inspect node-level payloads, logs, signals, artifacts, and metrics
- browse historical runs and compare outcomes
- inspect runtime health, raw metrics, audit logs, and webhook configuration
- run completely in **demo mode** with mock data or against the real services

## What is included

### Core product surfaces

- Dashboard
- Scenario catalog
- Scenario detail pages
- New run launch page
- Live runs page
- Live run workbench
- Historical run detail page
- Run comparison page
- Agent catalog and detail pages
- Logs explorer
- Traces explorer
- Observability dashboard
- Settings / webhooks / preferences page

### Technical foundations

- Next.js 16 App Router (React 19, TypeScript strict)
- Generic route-handler proxy under `app/api/proxy/[service]/[...path]`
- Optional Jaeger proxy under `app/api/jaeger/[...path]` for trace deep-dives
- Demo mode with rich mock data (full product surface works with no backends)
- React Query data layer
- Zustand preferences and launch-presets stores (persisted to `localStorage`)
- React Flow execution graph
- Recharts metrics cards
- Vitest + React Testing Library test suite
- Husky + lint-staged pre-commit hooks
- Markdown docs for architecture, integration, feature matrix, and change log

## Quick start

### 1. Copy environment variables

```bash
cp .env.example .env.local
```

### 2. Decide how you want to run the UI

#### Demo mode

Keep this enabled in `.env.local`:

```bash
NEXT_PUBLIC_MACP_UI_DEMO_MODE=true
```

This gives you a complete end-to-end UI experience without starting any backend services.

#### Real integration mode

Set:

```bash
NEXT_PUBLIC_MACP_UI_DEMO_MODE=false
MACP_PLAYGROUND_BASE_URL=http://localhost:3000
MACP_CONTROL_PLANE_BASE_URL=http://localhost:3001
MACP_PLAYGROUND_API_KEY=
MACP_CONTROL_PLANE_API_KEY=
```

Then run the Examples Service and Control Plane locally. For a single-command full stack (PostgreSQL + Runtime + Control Plane + Examples Service + UI) see [Local full-stack development](#local-full-stack-development) below.

### 3. Install dependencies and start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Local full-stack development

Run the UI against real backend services in Docker:

```bash
npm run local:up       # Start all backends + UI in real mode
npm run local:down     # Stop and clean up
npm run local:status   # Check health of running services
```

| Service | Port | Health |
|---|---|---|
| PostgreSQL | 5434 | — |
| Runtime (gRPC) | 50051 | — |
| Control Plane | 3001 | `/healthz` |
| Examples Service | 3100 | `/healthz` |
| UI Console | 3000 | — |

## Environment variables

See `.env.example`.

Important values:

- `NEXT_PUBLIC_MACP_UI_DEMO_MODE`
- `MACP_PLAYGROUND_BASE_URL`
- `MACP_PLAYGROUND_API_KEY`
- `MACP_CONTROL_PLANE_BASE_URL`
- `MACP_CONTROL_PLANE_API_KEY`
- `NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL`

## Route map

- `/` — dashboard
- `/docs` — docs home (explainer + UI Console and Examples Service doc viewers)
- `/scenarios` — scenario catalog
- `/scenarios/[packSlug]/[scenarioSlug]` — scenario detail
- `/runs/new` — launch run
- `/runs/live` — active runs
- `/runs/live/[runId]` — live execution workbench
- `/runs/[runId]` — historical run detail
- `/runs/[runId]/compare/[otherRunId]` — comparison
- `/agents` — agent catalog
- `/agents/[agentId]` — agent detail
- `/logs` — logs / canonical events
- `/traces` — traces / artifacts
- `/observability` — metrics and health
- `/modes` — runtime mode registry browser
- `/policies` — runtime policy registry browser (RFC-MACP-0012)
- `/settings` — preferences, webhooks, audit

## Demo mode behavior

The UI includes a built-in mock dataset that simulates:

- packs and scenarios
- launch schemas
- compile results
- live run state frames
- canonical events
- trace artifacts
- metrics
- audit logs
- webhooks
- runtime health

This lets the product surface feel complete before wiring every backend behavior.

## Integration model

The UI assumes:

- Examples Service provides scenario discovery, launch compilation, agent profiles, and optional one-shot bootstrap.
- Control Plane provides run lifecycle, state projection, canonical events, SSE streaming, metrics, traces, artifacts, audit, webhooks, runtime metadata, and runtime policy registry.
- Live execution is streamed with SSE (`snapshot`, `canonical_event`, `heartbeat` named events).
- Under the observer-only Control Plane model, agents emit messages / signals / context updates directly to the runtime via `macp-sdk-python` / `macp-sdk-typescript` — the CP `/runs/:id/{messages,signal,context}` POST endpoints are **removed** (410 Gone).

The browser never talks directly to those services. Instead it calls the Next.js proxy route handlers.

### Upstream repositories

The UI references — but does not duplicate — the docs from the backend repos:

| Repo | Role | Docs |
|---|---|---|
| [macp-playground](https://github.com/multiagentcoordinationprotocol/macp-playground) | Scenario catalog + launch compiler + example-agent bootstrap | [`docs/architecture.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/architecture.md), [`docs/api-reference.md`](https://github.com/multiagentcoordinationprotocol/macp-playground/blob/main/docs/api-reference.md) |
| [macp-control-plane](https://github.com/multiagentcoordinationprotocol/macp-control-plane) | Observer-only run lifecycle + projections + SSE | [`docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/API.md), [`docs/ARCHITECTURE.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/ARCHITECTURE.md), [`docs/INTEGRATION.md`](https://github.com/multiagentcoordinationprotocol/macp-control-plane/blob/main/docs/INTEGRATION.md) |
| [macp-runtime](https://github.com/multiagentcoordinationprotocol/macp-runtime) | Rust coordination kernel; gRPC source of truth | [`docs/README.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/README.md), [`docs/API.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/API.md), [`docs/modes.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/modes.md), [`docs/policy.md`](https://github.com/multiagentcoordinationprotocol/macp-runtime/blob/main/docs/policy.md) |
| [macp-sdk-python](https://github.com/multiagentcoordinationprotocol/macp-sdk-python) | Agent SDK (direct-agent-auth clients) | [`docs/index.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-python/blob/main/docs/index.md) |
| [macp-sdk-typescript](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript) | Agent SDK (direct-agent-auth clients) | [`docs/index.md`](https://github.com/multiagentcoordinationprotocol/macp-sdk-typescript/blob/main/docs/index.md) |

## Docs

- [`docs/architecture.md`](docs/architecture.md) — UI architecture + upstream pointers
- [`docs/api-integration.md`](docs/api-integration.md) — Proxy model, endpoint usage, normalizers, SSE, launch sequence
- [`docs/backend-repo-notes.md`](docs/backend-repo-notes.md) — Pointer index into upstream docs
- [`docs/feature-matrix.md`](docs/feature-matrix.md) — Product surface inventory
- [`docs/changelog.md`](docs/changelog.md) — Release history

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

Tests use Vitest + React Testing Library. Test files are co-located with source (`.test.ts` / `.test.tsx`). Integration tests covering the UI ↔ Docker-backed Control Plane + Examples Service flow live under `test/integration/`.

## Development workflow

Pre-commit hooks automatically format and lint staged files via Husky + lint-staged.

```bash
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting
npm run lint          # ESLint
npm run typecheck     # TypeScript check
```

## CI/CD

GitHub Actions CI runs on every PR and push to `main`: format check, lint, typecheck, tests, and production build.

A Vercel deploy workflow is available, gated by GitHub Environment approval for secret protection.

## Notes

This project is intentionally **UI-first** and **integration-ready**.

It does **not** modify the uploaded backend repositories. Instead, it aligns the new front end to the endpoints and contracts exposed by those services.
