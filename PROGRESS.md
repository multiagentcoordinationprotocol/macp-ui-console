# PROGRESS — macp-runtime-0.9.0-alignment

Plan: `plans/macp-runtime-0.9.0-alignment.md` (local, gitignored)
Started: 2026-10-19
Branch: `chore/runtime-0.9.0-alignment`

## Phase log

| Phase | Title | Status |
|---|---|---|
| P1 | Demo policy catalogue inside the 0.9.0 admission domain | DONE |
| P2 | Demo manifest `protocolVersion` → `0.1.11` | DONE |
| P3 | Re-pin the e2e runtime image to 0.9.0 | DONE |

P1 negative check: with `veto_threshold: 0` restored, two of the new tests fail (value domains, and the
`policy.default` mirror); with the fix, all pass.

P3 also had to fix `docker-compose.e2e.yml` for the control plane's current Dockerfile, which reads the
GitHub Packages token from a BuildKit secret (`npm_token`) rather than a build arg. Without that fix
`migrate` and `macp-control-plane` fail to build (npm E401).

## P3 verification (2026-10-19)

Stack: `docker-compose.e2e.yml` with the runtime at `:0.9.0`. The control plane, playground and
auth-service were built from clean origin/main worktrees: CP `cab0e5a` (#114), playground `821cc31`
(#124), auth-service `5270353` (#41).

- `docker compose -f docker-compose.e2e.yml config` resolves to `macp-runtime:0.9.0`.
- `up -d --build --wait`: every service healthy.
- `npm run test:integration`: 5 files, 95 tests passed.
- Policy registration through the console proxy (`POST /api/proxy/macp-control-plane/runtime/policies`,
  which the `/policies` form calls):
  - `{"objection_handling":{"veto_threshold":0}}` → 400 `INVALID_POLICY_DEFINITION: … /objection_handling/veto_threshold: must be >= 1`
  - `{"audit":{"level":"info"}}` → 400 `INVALID_POLICY_DEFINITION: … (root): unrecognized key "audit"`
  - `{}` → 201 `{"ok":true}`
- Live Decision run `fraud/high-value-new-device@1.0.0` (template `default`) → `completed`, action
  `decline`. Votes on the wire are rev-4 upper-case (`APPROVE` ×2, `REJECT` ×6; recommendations `BLOCK` and
  `REVIEW`).

Open questions 1–2 from the plan (structured `POLICY_DENIED` detail; inline rules guidance) are not
acted on. The CP message names the offending path, so it is not lossy.
