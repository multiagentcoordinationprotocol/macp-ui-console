'use client';

import { useQuery } from '@tanstack/react-query';
import { GitCompareArrows } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getRuntimeSessionDrift, type RuntimeSessionSnapshot } from '@/lib/api/client';
import { ApiError, describeApiError } from '@/lib/api/fetcher';
import { formatDateTime } from '@/lib/utils/format';

/**
 * Runtime/control-plane session drift, from CP `GET /admin/runtime/sessions`.
 *
 * On-demand by design, not a monitored value: the endpoint drains the runtime's full paginated
 * session list over gRPC behind a circuit breaker. Firing it automatically for everyone who opens
 * the Infrastructure tab would be real, avoidable load on a production runtime.
 *
 * The component owns its query so its behaviour is testable — the page holds a matching
 * `enabled: false` observer on the same key to route errors into its partial-data banner.
 */

/** Rendered-row ceiling. The response is bounded at 200 pages x 200 = 40,000 snapshots upstream. */
const MAX_ROWS = 50;

export const RUNTIME_SESSION_DRIFT_QUERY_KEY = 'runtime-session-drift';

/**
 * proto3 string fields arrive as `''` rather than absent, so `??` would render a blank cell where a
 * placeholder was intended. Only `||` catches both.
 */
function orDash(value: string | number | undefined): string {
  return value || value === 0 ? String(value) : '—';
}

function describeDriftError(error: unknown): string {
  if (error instanceof ApiError) {
    // Two distinct failures share HTTP 503 and mean different things to an operator, so the code —
    // not the status — is what distinguishes them. Everything else is deliberately NOT rendered by
    // code: a 401 carries none at all, and the CP's own throttler stamps a 429 as INTERNAL_ERROR,
    // which would read as "the control plane crashed" when it means "you were rate limited".
    if (error.errorCode === 'CIRCUIT_BREAKER_OPEN') {
      return 'The control plane has tripped its circuit breaker for the runtime. It will retry on its own once the breaker half-opens.';
    }
    if (error.errorCode === 'RUNTIME_UNAVAILABLE') {
      return 'The control plane could not reach the runtime.';
    }
    if (error.errorCode === 'RUNTIME_TIMEOUT') {
      return 'The runtime did not finish listing its sessions before the control plane gave up.';
    }
    if (error.status === 429) {
      // Two different 429s land here: the control plane's own request throttler (waiting helps), and
      // the runtime exhausting its page-size budget while draining the session list (waiting does
      // not). The copy has to be true of both, so it names the retry without promising it works.
      return 'Rate limited — either by the control plane or by the runtime while listing sessions. Try again shortly; if it keeps failing, the session list is too large for the current page-size budget.';
    }
    if (error.status === 401 || error.status === 403) {
      return "Not authorized. Check the console's control-plane credential.";
    }
  }
  return describeApiError(error);
}

/**
 * Both tables cap their rows, so both must disclose the cap. A drift panel that silently shows 50 of
 * 300 under-reports the very thing it exists to report — and `listActiveRuns()` is unbounded upstream,
 * so a runtime restart that drops every session really does produce a `missingFromRuntime` this long.
 */
function RowCapNote({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="muted small">
      Showing {shown} of {total}. A list this long is itself the finding — the control plane has been out of step with
      the runtime for a while.
    </p>
  );
}

function SessionRows({ sessions }: { sessions: RuntimeSessionSnapshot[] }) {
  const shown = sessions.slice(0, MAX_ROWS);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Mode</th>
              <th>State</th>
              <th>Started</th>
              <th>Initiator</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((session) => (
              <tr key={session.sessionId}>
                <td className="mono small">{orDash(session.sessionId)}</td>
                <td className="mono muted small">{orDash(session.mode)}</td>
                <td className="mono muted small">{orDash(session.state)}</td>
                {/* `formatDateTime` takes an epoch-ms number directly and already returns '—' for a
                    falsy or unparseable value, so no guard or Date round-trip is needed. */}
                <td className="mono muted small">{formatDateTime(session.startedAtUnixMs)}</td>
                <td className="mono muted small">{orDash(session.initiator)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RowCapNote shown={shown.length} total={sessions.length} />
    </>
  );
}

export function RuntimeSessionDrift({ demoMode }: { demoMode: boolean }) {
  const query = useQuery({
    queryKey: [RUNTIME_SESSION_DRIFT_QUERY_KEY, demoMode],
    queryFn: () => getRuntimeSessionDrift(demoMode),
    // Explicit operator action only — see the component docblock.
    enabled: false,
    // Overrides the global `retry: 1`. On a CIRCUIT_BREAKER_OPEN or RUNTIME_UNAVAILABLE 503 a retry
    // fires a second full gRPC drain at exactly the moment the runtime is unhealthy, and retrying a
    // tripped breaker cannot succeed.
    retry: false
  });

  const { data, isFetching, isError, error, refetch, dataUpdatedAt } = query;

  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <GitCompareArrows size={18} /> Runtime session drift
        </CardTitle>
        <CardDescription>
          Compares the sessions the runtime is holding against the runs this control plane still considers active. Runs
          on demand — it queries the live runtime.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        <div className="inline-list">
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? 'Checking…' : 'Check for drift'}
          </Button>
          {data && !isFetching && !isError ? (
            <>
              {data.complete ? (
                <Badge label="Full session list" tone="success" />
              ) : (
                <Badge label="Partial session list" tone="warning" />
              )}
              {/* This is a point-in-time diagnostic that the page's observer keeps cached across tab
                  switches, so the numbers must say when they were taken or they read as live. */}
              <span className="muted small">checked {formatDateTime(dataUpdatedAt)}</span>
            </>
          ) : null}
        </div>

        {/* Order matters: isError must be checked BEFORE the idle fallback, or a failed check
            silently reverts to "click to check" and the operator never learns it failed. */}
        {isFetching ? (
          <p className="muted small">Draining the runtime&rsquo;s session list…</p>
        ) : isError ? (
          // Matches the repo's notice idiom (policy-management.tsx:66-72) rather than `muted small`,
          // so a failed check reads as a failure instead of as helper copy.
          <div
            role="status"
            style={{
              border: '1px solid var(--warning)',
              borderRadius: 8,
              padding: '10px 12px',
              background: 'var(--panel-2)'
            }}
          >
            <strong>Drift check failed.</strong> {describeDriftError(error)}
          </div>
        ) : data ? (
          <>
            <div className="grid-3">
              <Card>
                <CardContent className="kpi-card">
                  <div className="kpi-label">Runtime sessions</div>
                  <div className="kpi-value">{data.runtimeSessionCount}</div>
                  <div className="kpi-meta">{data.liveRuntimeSessionCount} live</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="kpi-card">
                  <div className="kpi-label">Tracked runs</div>
                  <div className="kpi-value">{data.trackedRunCount}</div>
                  <div className="kpi-meta">active in the control plane</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="kpi-card">
                  <div className="kpi-label">Untracked sessions</div>
                  <div className="kpi-value">{data.untrackedSessions.length}</div>
                  <div className="kpi-meta">runtime has, control plane does not</div>
                </CardContent>
              </Card>
            </div>

            <p className="muted small">
              The two totals are not meant to reconcile by subtraction. <strong>Runtime sessions</strong> counts
              everything the runtime returned, including terminal sessions still inside its retention window, while the
              comparison runs only over the live ones. And a run that is still starting has a session id reserved before
              the session exists, so it is deliberately left out of the reverse check rather than reported as drift.
            </p>

            <div className="stack">
              <h4 className="section-title">Sessions the control plane is not tracking</h4>
              {data.untrackedSessions.length > 0 ? (
                <SessionRows sessions={data.untrackedSessions} />
              ) : (
                <p className="muted small">
                  None. Every live runtime session maps to a run this control plane knows about.
                </p>
              )}
            </div>

            <div className="stack">
              <h4 className="section-title">Runs whose session the runtime no longer holds</h4>
              {/* `null` means "not computed", never "zero". Rendering a 0 here would assert an
                  absence a truncated drain cannot prove. */}
              {data.missingFromRuntime === null ? (
                <p className="muted small">
                  <Badge label="Not computed" tone="warning" /> The session list was truncated before it finished, so
                  this direction was skipped. A partial list cannot prove a run&rsquo;s session is gone — it may simply
                  not have been reached. The untracked sessions above are still accurate. Re-run the check, or raise the
                  control plane&rsquo;s session-drain limits if this keeps happening.
                </p>
              ) : data.missingFromRuntime.length > 0 ? (
                <>
                  <p className="muted small">
                    {data.missingFromRuntime.length} {data.missingFromRuntime.length === 1 ? 'run is' : 'runs are'}{' '}
                    bound to a session the runtime is no longer holding.
                  </p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Bound session</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.missingFromRuntime.slice(0, MAX_ROWS).map((entry) => (
                          <tr key={entry.runId}>
                            <td className="mono small">{entry.runId}</td>
                            <td className="mono muted small">{orDash(entry.runtimeSessionId)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <RowCapNote
                    shown={Math.min(data.missingFromRuntime.length, MAX_ROWS)}
                    total={data.missingFromRuntime.length}
                  />
                </>
              ) : (
                <p className="muted small">None. Every active run is bound to a session the runtime still holds.</p>
              )}
            </div>
          </>
        ) : (
          <EmptyState
            compact
            title="No drift check run yet"
            description="Checking asks the control plane to list every session the runtime is holding and compare it against the runs it is tracking. It queries the live runtime, so it runs only when you ask."
          />
        )}
      </CardContent>
    </Card>
  );
}
