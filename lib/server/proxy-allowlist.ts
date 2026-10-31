import type { ProxyService } from '@/lib/server/integrations';

/**
 * The hosted console proxy attaches server-held credentials to every upstream call and has no
 * visitor authentication, so anything it forwards is effectively public. It therefore forwards only
 * the (service, method, path) triples the console UI actually calls (see `lib/api/client.ts`,
 * `lib/hooks/use-live-run.ts`), and only the non-mutating ones plus the single launch route.
 *
 * Deliberately NOT listed (all answered 403 without contacting upstream): every `/admin/*` route,
 * `/audit`, `/webhooks` (any method), policy registration/unregistration, run cancel / suspend /
 * resume / clone / archive / delete / projection-rebuild / artifact upload, all `/runs/batch/*`
 * operations, the control plane's direct `POST /runs`, and any PUT / PATCH / DELETE / HEAD /
 * OPTIONS. Those UI features still work in demo mode and against a local stack accessed directly;
 * re-enabling any of them on the hosted proxy needs visitor auth first (W0.1).
 */

export type ProxyMethod = 'GET' | 'POST';

export type RateLimitClass = 'read' | 'launch' | 'whatIf';

export interface ProxyRoute {
  service: ProxyService;
  method: ProxyMethod;
  /** Path template; `:name` matches exactly one safe path segment. */
  path: string;
  /** Which per-IP quota the route draws from. Defaults to `read`. */
  limit?: RateLimitClass;
  /** Why this route is exposed — kept next to the entry so review sees the reasoning. */
  note: string;
}

export const PROXY_ALLOWLIST: readonly ProxyRoute[] = [
  // ── macp-playground: scenario catalog (read-only) ──
  { service: 'macp-playground', method: 'GET', path: '/packs', note: 'listPacks' },
  { service: 'macp-playground', method: 'GET', path: '/packs/:pack/scenarios', note: 'listScenarios' },
  {
    service: 'macp-playground',
    method: 'GET',
    path: '/packs/:pack/scenarios/:scenario/versions/:version/launch-schema',
    note: 'getLaunchSchema'
  },
  { service: 'macp-playground', method: 'GET', path: '/agents', note: 'getAgentProfiles' },
  { service: 'macp-playground', method: 'GET', path: '/agents/:agentRef', note: 'getAgentProfile' },
  // Pure template compilation — returns a run descriptor, persists nothing, starts nothing.
  { service: 'macp-playground', method: 'POST', path: '/launch/compile', note: 'compileLaunch (side-effect free)' },
  // The one launch route the UI uses (`runExample`, "Submit run" on /runs/new). It bootstraps hosted
  // agents (which may call an LLM), so it draws from the much stricter launch quota.
  { service: 'macp-playground', method: 'POST', path: '/examples/run', limit: 'launch', note: 'runExample (launch)' },

  // ── macp-control-plane: runs (read-only) ──
  // The run list stays world-readable: it is what the public demo shows (open owner question, see PR).
  { service: 'macp-control-plane', method: 'GET', path: '/runs', note: 'listRuns' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId', note: 'getRun' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/state', note: 'getRunState' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/events', note: 'getRunEvents' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/stream', note: 'use-live-run SSE' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/metrics', note: 'getRunMetrics' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/traces', note: 'getRunTraces' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/verification', note: 'getRunVerification' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/receipt', note: 'getRunReceipt (W5 U1)' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/artifacts', note: 'getRunArtifacts' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/export', note: 'exportRunBundle' },
  { service: 'macp-control-plane', method: 'GET', path: '/runs/:runId/replay/state', note: 'getTimelineFrame' },
  // Read-only POSTs: CP computes and returns a result without writing anything.
  { service: 'macp-control-plane', method: 'POST', path: '/runs/validate', note: 'validateRun (dry run)' },
  { service: 'macp-control-plane', method: 'POST', path: '/runs/compare', note: 'compareRuns (read-only)' },
  {
    service: 'macp-control-plane',
    method: 'POST',
    path: '/runs/:runId/replay',
    note: 'createReplay (returns a descriptor only)'
  },
  // W4.1 what-if: the runtime replays the session's history under a candidate policy and returns the
  // diff. Read-only (nothing is registered, the session is untouched) but it costs runtime CPU per
  // call, so it draws from its own small quota, separate from launch.
  {
    service: 'macp-control-plane',
    method: 'POST',
    path: '/runs/:runId/what-if',
    limit: 'whatIf',
    note: 'runWhatIf (read-only replay)'
  },
  { service: 'macp-control-plane', method: 'GET', path: '/events', note: 'listEvents' },

  // ── macp-control-plane: dashboards, runtime discovery, health (read-only) ──
  { service: 'macp-control-plane', method: 'GET', path: '/dashboard/overview', note: 'getDashboardOverview' },
  { service: 'macp-control-plane', method: 'GET', path: '/dashboard/agents/metrics', note: 'getAgentMetrics' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/manifest', note: 'getRuntimeManifest' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/modes', note: 'getRuntimeModes' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/roots', note: 'getRuntimeRoots' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/health', note: 'getRuntimeHealth' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/capabilities', note: 'getRuntimeCapabilities' },
  // Public verification keys only: the CP refuses to serve a key set carrying private members.
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/receipt-keys', note: 'getReceiptKeys (W5 U1)' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/policies', note: 'listRuntimePolicies' },
  { service: 'macp-control-plane', method: 'GET', path: '/runtime/policies/:policyId', note: 'getRuntimePolicy' },
  { service: 'macp-control-plane', method: 'GET', path: '/readyz', note: 'getReadinessProbe' },
  { service: 'macp-control-plane', method: 'GET', path: '/metrics', note: 'getObservabilityRawMetrics' }
];

/**
 * A single path segment the proxy is willing to forward. Excludes `/`, `\`, `%` (already-decoded
 * segments must not smuggle a second encoding layer), whitespace, and the dot segments `.`/`..`,
 * which `fetch` would otherwise normalise into a different upstream path than the one matched here.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._~:@+=-]+$/;

export function isSafeSegment(segment: string): boolean {
  return SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..';
}

function matchesTemplate(template: string, segments: readonly string[]): boolean {
  const parts = template.split('/').filter(Boolean);
  if (parts.length !== segments.length) return false;
  return parts.every((part, index) => part.startsWith(':') || part === segments[index]);
}

/**
 * Returns the allow-listed route for this request, or `undefined` when it must be refused.
 * Matching is exact: method is case-normalised, but service and path segments are compared
 * verbatim, so `/Runs` or `/runs/` variants do not match.
 */
export function findAllowedRoute(service: string, method: string, segments: readonly string[]): ProxyRoute | undefined {
  if (segments.length === 0 || !segments.every(isSafeSegment)) return undefined;
  const normalizedMethod = method.toUpperCase();
  return PROXY_ALLOWLIST.find(
    (route) => route.service === service && route.method === normalizedMethod && matchesTemplate(route.path, segments)
  );
}
