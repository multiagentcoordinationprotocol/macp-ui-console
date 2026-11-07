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

### 1. Configuration

With Doppler access (project `macp-ui-console`, see [Secrets and configuration](#secrets-and-configuration-doppler)):

```bash
doppler setup --project macp-ui-console --config dev   # once per checkout
doppler run -- npm run dev
```

Without it, copy the example and fill it in:

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
MACP_PLAYGROUND_BASE_URL=http://localhost:3100
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
| Runtime (Prometheus metrics) | 9464 | — |
| Control Plane | 3001 | `/healthz` |
| Examples Service | 3100 | `/healthz` |
| UI Console | 3000 | — |

The stack pins the runtime to `ghcr.io/multiagentcoordinationprotocol/macp-runtime:0.14.0`
(override with `MACP_RUNTIME_IMAGE` for local builds). It builds `macp-control-plane` and `macp-playground`
from source, so their checkouts must include their Wave 5 sync (the control plane needs #134 for the
decision-receipt routes). No receipt signing key is configured, so the runtime issues unsigned receipts.
The published image does not bake `MACP_ALLOW_INSECURE` — the compose file sets it explicitly, along with
`MACP_METRICS_ADDR=0.0.0.0:9464` so the runtime exposes per-mode Prometheus counters
(`macp_messages_*`, `macp_sessions_*`, `macp_commitments_*`, `macp_replay_mismatches_total`)
on port 9464 for local debugging (`curl localhost:9464/metrics`). Runtime 0.12 deprecates those
per-mode families in favour of `macp_envelope_processed_total` and `macp_session_transitions_total`
(both are served side by side until 0.13 at the earliest). These runtime-process
counters are an ops surface only; the console's `/observability` page reads the Control
Plane's own `/metrics`, not the runtime's.

## Environment variables

See `.env.example`.

### Secrets and configuration (Doppler)

Doppler is the source of truth. The project is `macp-ui-console`:

| Config | Holds |
|---|---|
| `dev` | Local development values (`.env` + `.env.local`, LLM keys included) |
| `dev_e2e` | `dev` with the `.env.e2e` values on top, for the full-stack E2E environment |
| `dev_personal` | Your own overrides of `dev` |
| `stg` | `prd`'s non-secret config only; there is no staging deployment |
| `prd` | The Vercel production environment (team `zer07labs`, project `ui-console`) |

The real-LLM E2E stack reads `OPENAI_API_KEY` from the shell, so `doppler run -c dev_e2e -- env PLAYGROUND_ALLOW_LLM=1 docker compose -f docker-compose.e2e.yml up -d --build --wait` works; a gitignored `.env` next to the compose file is the fallback.

To change production, edit Doppler `macp-ui-console/prd`, then:

```bash
deploy/doppler-sync.sh           # dry run: key names, changed/unchanged
deploy/doppler-sync.sh --apply   # push the changed keys to Vercel production, then rebuild it
```

The script manages only the keys in [deploy/doppler-keys.txt](deploy/doppler-keys.txt), only in the Production environment. It never removes a Vercel variable, leaves Preview and Development alone, never prints a value, and refuses a dirty tree. `NEXT_PUBLIC_*` values are inlined at build time, so a change rebuilds the latest production deployment. Vercel holds no Doppler token.

Important values:

- `NEXT_PUBLIC_MACP_UI_DEMO_MODE`
- `MACP_PLAYGROUND_BASE_URL`
- `MACP_PLAYGROUND_API_KEY`
- `MACP_CONTROL_PLANE_BASE_URL`
- `MACP_CONTROL_PLANE_API_KEY`
- `NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL`
- `NEXT_PUBLIC_MACP_HOSTED` — `true` on the hosted deployment; shows the deterministic-agents note on `/runs/new`

## Route map

- `/` — dashboard
- `/docs` — docs home (explainer + UI Console and Examples Service doc viewers)
- `/scenarios` — scenario catalog
- `/scenarios/[packSlug]/[scenarioSlug]` — scenario detail
- `/showcase` — stable public deep link: launches the deterministic Decision-mode showcase (no LLM key) and opens its live run
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
npm test                  # Unit tests (jsdom)
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
npm run test:integration  # Integration tests (node): real proxy route + API client vs in-process mock backends
npm run test:live         # Live end-to-end suite against a running console (skipped unless MACP_UI_BASE_URL is set)
```

Tests use Vitest + React Testing Library. Unit test files are co-located with source (`.test.ts` / `.test.tsx`).

- `test/integration/` drives the real `/api/proxy` route handler (allow-list, rate limit, credential
  injection) and `lib/api/client.ts` against mock control-plane and playground servers on real sockets.
  No Docker stack and no secrets; CI runs it as its own job on every PR.
- `test/live/` launches playground scenarios through a running console's proxy, exactly as the New run
  page does, follows each run to `completed` in the control plane, checks the `run.suspended` /
  `run.resumed` pair for `suspend-demo`, and fetches the decision receipt and verification. Point it at
  the local stack or a deployed console:

  ```bash
  # local: backends from docker-compose.e2e.yml, console from `npm run dev:e2e`
  MACP_UI_BASE_URL=http://localhost:3000 npm run test:live
  # deployed console
  MACP_UI_BASE_URL=https://console.multiagentcoordinationprotocol.io npm run test:live
  ```

  By default it launches four scenarios, which fits the proxy's launch quota (5 per 10 minutes per client
  IP). `MACP_UI_LIVE_SCENARIOS` takes a comma list of `pack/scenario@version:template`, or `all`; past the
  quota the suite waits out the 429's `retry-after`. It never runs in CI.

## Development workflow

Pre-commit hooks automatically format and lint staged files via Husky + lint-staged.

```bash
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting
npm run lint          # ESLint
npm run typecheck     # TypeScript check
```

### For MACP org members

Agents working in this repo can query the MACP knowledge base through the `macp-kb` MCP server. Setup instructions are in the private `macp-docs` repo (README, "MCP server"). Answers cite the source repo and commit, so check freshness with `kb_status` before relying on one. Outside contributors can ignore this section; the server is limited to org members.

## Container image (self-host)

`ghcr.io/multiagentcoordinationprotocol/macp-ui-console` is a public Next.js standalone image, built
by `.github/workflows/image.yml`. Tags: `vX.Y.Z`, `vX.Y`, bare `X.Y.Z` / `X.Y` (matching the other MACP images) and `latest` from release tags, and `sha-<short>`
from every push to `main`. The one-command self-host stack (runtime, control plane, Postgres, console)
lives in macp-runtime's `deploy/docker-compose.yml`.

```bash
docker run -p 3000:3000 \
  -e MACP_CONTROL_PLANE_BASE_URL=http://macp-control-plane:3001 \
  -e MACP_CONTROL_PLANE_API_KEY=... \
  -e MACP_PLAYGROUND_BASE_URL=http://macp-playground:3000 \
  ghcr.io/multiagentcoordinationprotocol/macp-ui-console:v0.2.0
```

- **Port** `3000` (`PORT` / `HOSTNAME` override it). The container has a healthcheck on `GET /`.
- **Runtime env** (read by the server-side proxy per request, so one image fits any stack):
  `MACP_CONTROL_PLANE_BASE_URL` and `MACP_PLAYGROUND_BASE_URL` are required (production refuses to
  fall back); `MACP_CONTROL_PLANE_API_KEY` (Bearer) and `MACP_PLAYGROUND_API_KEY` (`x-api-key`) are optional.
- **Build-time only**: `NEXT_PUBLIC_*` values are inlined into the browser bundle. The image is built
  with demo mode **off** and the environment label `self-hosted`; rebuild with
  `--build-arg NEXT_PUBLIC_MACP_UI_DEMO_MODE=true` (or `NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL`,
  `NEXT_PUBLIC_JAEGER_BASE_URL`) to change them.
- The proxy allow-list and per-IP rate limit work unchanged. The limiter keys on `x-real-ip`, then the
  first hop of `x-vercel-forwarded-for`, then the rightmost `x-forwarded-for`, and the proxy sends that IP
  upstream as `X-MACP-Client-IP` (a client-supplied one is stripped); if you expose the console publicly, put it behind a reverse proxy that
  sets `x-real-ip`, otherwise a client can choose its own bucket.

## CI/CD

GitHub Actions CI runs on every PR and push to `main`: format check, lint, typecheck, unit tests and production build, then the integration tests as a second job.

Production deploys are handled by Vercel's native Git integration (auto-deploy on push to `main`).

## Notes

This project is intentionally **UI-first** and **integration-ready**.

It does **not** modify the uploaded backend repositories. Instead, it aligns the new front end to the endpoints and contracts exposed by those services.
