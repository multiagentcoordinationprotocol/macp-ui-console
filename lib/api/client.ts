import {
  compareMockRuns,
  computeDashboardKpis,
  COMPLETED_RUN_ID,
  LIVE_RUN_ID,
  MOCK_AGENT_PROFILES,
  MOCK_AUDIT_LOGS,
  MOCK_CHARTS,
  MOCK_COMPILED_RUN,
  MOCK_CREATE_RUN_RESPONSE,
  MOCK_LAUNCH_SCHEMAS,
  MOCK_PACKS,
  MOCK_PROMETHEUS_METRICS,
  MOCK_REPLAY_DESCRIPTORS,
  MOCK_RUN_ARTIFACTS,
  MOCK_RUN_EVENTS,
  MOCK_RUN_FRAMES,
  MOCK_RUN_METRICS,
  MOCK_RUN_STATES,
  MOCK_RUN_TRACES,
  MOCK_RUNS,
  MOCK_RUNTIME_HEALTH,
  MOCK_RUNTIME_MANIFEST,
  MOCK_RUNTIME_MODES,
  MOCK_RUNTIME_POLICIES,
  MOCK_RUNTIME_ROOTS,
  MOCK_SCENARIOS,
  MOCK_WEBHOOKS
} from '@/lib/data/mock-data';
import type {
  AgentMetricsEntry,
  AgentProfile,
  Artifact,
  AuditListResponse,
  BatchOperationResult,
  CanonicalEvent,
  ChartPoint,
  CircuitBreakerResult,
  CompileLaunchRequest,
  CompileLaunchResult,
  CreateArtifactResult,
  CreateRunResponse,
  DashboardKpis,
  ExportRunQuery,
  LaunchSchemaResponse,
  ListAuditQuery,
  ListRunsQuery,
  MetricsSummary,
  MutationAck,
  PackSummary,
  ReadinessProbeResponse,
  RebuildProjectionResult,
  RegisterPolicyRequest,
  ReplayDescriptor,
  RunComparisonResult,
  RunExampleResult,
  RunExportBundle,
  RunRecord,
  RunStateProjection,
  RuntimeHealth,
  RuntimeManifestResult,
  RuntimeModeDescriptor,
  RuntimePolicyDescriptor,
  RuntimeRootDescriptor,
  ScenarioSummary,
  TraceSummary,
  ValidateRunResponse,
  WebhookSubscription
} from '@/lib/types';
import { ApiError, fetchJson } from '@/lib/api/fetcher';

function maybeDelay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function scenarioSchemaKey(packSlug: string, scenarioSlug: string, version: string, template = 'default') {
  return `${packSlug}/${scenarioSlug}@${version}:${template}`;
}

function listAllScenarios(): ScenarioSummary[] {
  return Object.values(MOCK_SCENARIOS).flatMap((items) => items);
}

function listAllEvents(): CanonicalEvent[] {
  return Object.values(MOCK_RUN_EVENTS).flatMap((items) => items);
}

/** Normalize flat CP event response to the nested CanonicalEvent shape the UI expects. */
function normalizeEvent(raw: Record<string, unknown>): CanonicalEvent {
  const event = raw as unknown as CanonicalEvent & {
    sourceKind?: string;
    sourceName?: string;
    subjectKind?: string;
    subjectId?: string;
    rawType?: string;
  };
  if (!event.source && (event.sourceKind || event.sourceName)) {
    event.source = {
      kind: (event.sourceKind ?? 'macp-control-plane') as CanonicalEvent['source']['kind'],
      name: event.sourceName ?? '',
      rawType: event.rawType
    };
  }
  if (!event.subject && event.subjectKind) {
    event.subject = { kind: event.subjectKind, id: event.subjectId ?? '' };
  }
  return event as CanonicalEvent;
}

/** Map flat CP run response to the RunRecord shape the UI expects. */
function normalizeRun(raw: Record<string, unknown>): RunRecord {
  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error(`normalizeRun: missing or invalid 'id' field`);
  }
  if (!raw.status || typeof raw.status !== 'string') {
    throw new Error(`normalizeRun: missing or invalid 'status' field for run ${raw.id}`);
  }
  if (!raw.runtimeKind || typeof raw.runtimeKind !== 'string') {
    throw new Error(`normalizeRun: missing or invalid 'runtimeKind' field for run ${raw.id}`);
  }

  const { sourceKind, sourceRef, ...rest } = raw as unknown as RunRecord & {
    sourceKind?: string;
    sourceRef?: string;
  };
  return {
    ...rest,
    source: rest.source ?? (sourceKind || sourceRef ? { kind: sourceKind, ref: sourceRef } : undefined),
    archivedAt: rest.archivedAt ?? null
  } as RunRecord;
}

export async function listPacks(demoMode: boolean): Promise<PackSummary[]> {
  if (demoMode) return maybeDelay(MOCK_PACKS);
  return fetchJson<PackSummary[]>('macp-playground', '/packs');
}

export async function listScenarios(packSlug: string, demoMode: boolean): Promise<ScenarioSummary[]> {
  if (demoMode) return maybeDelay(MOCK_SCENARIOS[packSlug] ?? []);
  return fetchJson<ScenarioSummary[]>('macp-playground', `/packs/${packSlug}/scenarios`);
}

export async function getLaunchSchema(
  packSlug: string,
  scenarioSlug: string,
  version: string,
  template: string | undefined,
  demoMode: boolean
): Promise<LaunchSchemaResponse> {
  if (demoMode) {
    const key = scenarioSchemaKey(packSlug, scenarioSlug, version, template ?? 'default');
    const fallbackKey = scenarioSchemaKey(packSlug, scenarioSlug, version, 'default');
    return maybeDelay(MOCK_LAUNCH_SCHEMAS[key] ?? MOCK_LAUNCH_SCHEMAS[fallbackKey]);
  }

  const suffix = template ? `?template=${encodeURIComponent(template)}` : '';
  return fetchJson<LaunchSchemaResponse>(
    'macp-playground',
    `/packs/${packSlug}/scenarios/${scenarioSlug}/versions/${version}/launch-schema${suffix}`
  );
}

export async function compileLaunch(input: CompileLaunchRequest, demoMode: boolean): Promise<CompileLaunchResult> {
  if (demoMode) {
    const mode = input.mode ?? 'live';
    return maybeDelay({
      ...MOCK_COMPILED_RUN,
      display: {
        ...MOCK_COMPILED_RUN.display,
        scenarioRef: input.scenarioRef,
        templateId: input.templateId
      },
      mode,
      runDescriptor: {
        ...MOCK_COMPILED_RUN.runDescriptor,
        mode
      },
      initiator: MOCK_COMPILED_RUN.initiator
        ? {
            ...MOCK_COMPILED_RUN.initiator,
            sessionStart: {
              ...MOCK_COMPILED_RUN.initiator.sessionStart,
              context: input.inputs
            }
          }
        : undefined,
      scenarioMeta: {
        ...MOCK_COMPILED_RUN.scenarioMeta,
        sessionContext: input.inputs
      }
    });
  }

  return fetchJson<CompileLaunchResult>('macp-playground', '/launch/compile', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function runExample(
  input: CompileLaunchRequest & { bootstrapAgents?: boolean },
  demoMode: boolean
): Promise<RunExampleResult> {
  if (demoMode) {
    const compiled = await compileLaunch(input, true);
    return maybeDelay({
      compiled,
      hostedAgents: MOCK_LAUNCH_SCHEMAS['fraud/high-value-new-device@1.0.0:default'].agents.map((agent) => ({
        ...agent,
        participantId: agent.agentRef,
        status: 'bootstrapped'
      })),
      sessionId: LIVE_RUN_ID
    });
  }

  return fetchJson<RunExampleResult>('macp-playground', '/examples/run', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function validateRun(body: Record<string, unknown>, demoMode: boolean): Promise<ValidateRunResponse> {
  if (demoMode) {
    return maybeDelay({
      ok: true,
      errors: [],
      warnings: [],
      runtime: { reachable: true, supportedModes: ['negotiation'], capabilities: undefined }
    });
  }
  const raw = await fetchJson<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    runtime: { reachable: boolean; supportedModes: string[]; capabilities?: unknown };
  }>('macp-control-plane', '/runs/validate', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return {
    ok: raw.valid && raw.errors.length === 0,
    errors: raw.errors,
    warnings: raw.warnings,
    runtime: raw.runtime
  };
}

export async function createRun(body: Record<string, unknown>, demoMode: boolean): Promise<CreateRunResponse> {
  if (demoMode) return maybeDelay(MOCK_CREATE_RUN_RESPONSE);
  return fetchJson<CreateRunResponse>('macp-control-plane', '/runs', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function listRuns(demoMode: boolean, searchParams?: Partial<ListRunsQuery>): Promise<RunRecord[]> {
  if (demoMode) {
    let runs = [...MOCK_RUNS];
    if (searchParams?.status) runs = runs.filter((run) => run.status === searchParams.status);
    if (searchParams?.environment)
      runs = runs.filter((run) => String(run.metadata?.environment ?? '') === searchParams.environment);
    if (searchParams?.search) {
      const lower = searchParams.search.toLowerCase();
      runs = runs.filter((run) => {
        const haystack = [run.id, run.metadata?.scenarioRef, run.source?.ref, ...(run.tags ?? [])]
          .join(' ')
          .toLowerCase();
        return haystack.includes(lower);
      });
    }
    if (searchParams?.createdAfter) runs = runs.filter((run) => run.createdAt >= searchParams.createdAfter!);
    if (searchParams?.createdBefore) runs = runs.filter((run) => run.createdAt <= searchParams.createdBefore!);
    if (!searchParams?.includeArchived) runs = runs.filter((run) => !run.archivedAt);
    if (searchParams?.sortBy) {
      const key = searchParams.sortBy;
      const order = searchParams.sortOrder === 'asc' ? 1 : -1;
      runs.sort((a, b) => {
        const va = key === 'updatedAt' ? (a.endedAt ?? a.createdAt) : a.createdAt;
        const vb = key === 'updatedAt' ? (b.endedAt ?? b.createdAt) : b.createdAt;
        return va < vb ? -order : va > vb ? order : 0;
      });
    }
    return maybeDelay(runs);
  }

  const query = new URLSearchParams();
  query.set('limit', String(searchParams?.limit ?? 200));
  query.set('offset', String(searchParams?.offset ?? 0));
  if (searchParams?.status) query.set('status', searchParams.status);
  if (searchParams?.environment) query.set('environment', searchParams.environment);
  if (searchParams?.search) query.set('search', searchParams.search);
  if (searchParams?.scenarioRef) query.set('scenarioRef', searchParams.scenarioRef);
  if (searchParams?.sortBy) query.set('sortBy', searchParams.sortBy);
  if (searchParams?.sortOrder) query.set('sortOrder', searchParams.sortOrder);
  if (searchParams?.createdAfter) query.set('createdAfter', searchParams.createdAfter);
  if (searchParams?.createdBefore) query.set('createdBefore', searchParams.createdBefore);
  if (searchParams?.includeArchived) query.set('includeArchived', 'true');
  if (searchParams?.tags?.length) query.set('tags', searchParams.tags.join(','));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const res = await fetchJson<{ data: Record<string, unknown>[]; total: number }>(
    'macp-control-plane',
    `/runs${suffix}`
  );
  return res.data.map(normalizeRun);
}

export async function getRun(runId: string, demoMode: boolean): Promise<RunRecord> {
  if (demoMode) {
    const run = MOCK_RUNS.find((item) => item.id === runId);
    if (!run) throw new Error(`Unknown mock run: ${runId}`);
    return maybeDelay(run);
  }
  const raw = await fetchJson<Record<string, unknown>>('macp-control-plane', `/runs/${runId}`);
  return normalizeRun(raw);
}

export async function getRunState(runId: string, demoMode: boolean): Promise<RunStateProjection> {
  if (demoMode) {
    const state = MOCK_RUN_STATES[runId];
    if (!state) throw new Error(`Unknown mock run state: ${runId}`);
    return maybeDelay(state);
  }
  return fetchJson<RunStateProjection>('macp-control-plane', `/runs/${runId}/state`);
}

/**
 * Query options for per-run event listing. Backend §4.2 added
 * `afterTs`/`beforeTs` (ISO-8601 UTC) and a CSV `type` filter.
 */
export interface RunEventsQuery {
  limit?: number;
  afterSeq?: number;
  /** ISO-8601 UTC lower bound (exclusive), e.g. `2026-04-14T00:00:00Z`. */
  afterTs?: string;
  /** ISO-8601 UTC upper bound (inclusive). */
  beforeTs?: string;
  /** Comma-separated event types, e.g. `signal.emitted,signal.acknowledged`. */
  type?: string;
}

export async function getRunEvents(
  runId: string,
  demoMode: boolean,
  queryOrLimit: RunEventsQuery | number = {},
  afterSeqArg = 0
): Promise<CanonicalEvent[]> {
  // Back-compat: callers that pass `(runId, demoMode, limit, afterSeq)` still work.
  const query: RunEventsQuery =
    typeof queryOrLimit === 'number' ? { limit: queryOrLimit, afterSeq: afterSeqArg } : queryOrLimit;
  const { limit = 500, afterSeq = 0, afterTs, beforeTs, type } = query;

  if (demoMode) {
    let items = MOCK_RUN_EVENTS[runId] ?? [];
    if (afterSeq) items = items.filter((event) => event.seq > afterSeq);
    if (afterTs) items = items.filter((event) => event.ts > afterTs);
    if (beforeTs) items = items.filter((event) => event.ts <= beforeTs);
    if (type) {
      const types = new Set(type.split(',').map((s) => s.trim()));
      items = items.filter((event) => types.has(event.type));
    }
    return maybeDelay(items.slice(0, limit));
  }

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('afterSeq', String(afterSeq));
  if (afterTs) params.set('afterTs', afterTs);
  if (beforeTs) params.set('beforeTs', beforeTs);
  if (type) params.set('type', type);

  const raw = await fetchJson<Record<string, unknown>[] | { data: Record<string, unknown>[] }>(
    'macp-control-plane',
    `/runs/${runId}/events?${params.toString()}`
  );
  // Backend §4.2 returns `{data,total,limit,nextCursor}` when any of the new
  // filters is set; plain array for the fast path.
  const array = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return array.map(normalizeEvent);
}

/**
 * Backend §4.1 — cross-run `/events` endpoint. Enables scenario-wide
 * and type-wide queries across runs without per-run fan-out.
 */
export interface EventsQuery extends RunEventsQuery {
  runId?: string;
  scenarioRef?: string;
}

export async function listEvents(
  demoMode: boolean,
  query: EventsQuery = {}
): Promise<{ data: CanonicalEvent[]; total: number; nextCursor?: number }> {
  if (demoMode) {
    // Fan out across mock runs when no specific runId is pinned.
    let items: CanonicalEvent[] = query.runId
      ? (MOCK_RUN_EVENTS[query.runId] ?? [])
      : Object.values(MOCK_RUN_EVENTS).flat();
    if (query.scenarioRef) {
      const runIds = new Set(
        MOCK_RUNS.filter(
          (run) => run.source?.ref === query.scenarioRef || run.metadata?.scenarioRef === query.scenarioRef
        ).map((r) => r.id)
      );
      items = items.filter((event) => runIds.has(event.runId));
    }
    if (query.afterSeq) items = items.filter((event) => event.seq > (query.afterSeq ?? 0));
    if (query.afterTs) items = items.filter((event) => event.ts > query.afterTs!);
    if (query.beforeTs) items = items.filter((event) => event.ts <= query.beforeTs!);
    if (query.type) {
      const types = new Set(query.type.split(',').map((s) => s.trim()));
      items = items.filter((event) => types.has(event.type));
    }
    const limit = query.limit ?? 500;
    const total = items.length;
    const data = items.slice(0, limit);
    return maybeDelay({
      data,
      total,
      nextCursor: data.length < items.length ? data[data.length - 1]?.seq : undefined
    });
  }

  const params = new URLSearchParams();
  if (query.runId) params.set('runId', query.runId);
  if (query.scenarioRef) params.set('scenarioRef', query.scenarioRef);
  if (query.type) params.set('type', query.type);
  if (query.afterSeq !== undefined) params.set('afterSeq', String(query.afterSeq));
  if (query.afterTs) params.set('afterTs', query.afterTs);
  if (query.beforeTs) params.set('beforeTs', query.beforeTs);
  params.set('limit', String(query.limit ?? 500));

  // Happy path: cross-run /events endpoint (BE §4.1).
  if (!eventsEndpointMissing) {
    try {
      const response = await fetchJson<{
        data: Record<string, unknown>[];
        total: number;
        nextCursor?: number;
      }>('macp-control-plane', `/events?${params.toString()}`);
      return {
        data: response.data.map(normalizeEvent),
        total: response.total,
        nextCursor: response.nextCursor
      };
    } catch (error) {
      // Cache the 404 for the rest of this session so we stop probing it
      // on every page load. Non-404 errors propagate normally.
      if (error instanceof ApiError && error.isNotFound) {
        eventsEndpointMissing = true;
        console.warn(
          '[MACP UI] Control-plane is missing GET /events (BE §4.1). ' +
            'Falling back to per-run /runs/:id/events fan-out for the rest of this session.'
        );
      } else {
        throw error;
      }
    }
  }

  // Fallback path: fan out across per-run /runs/:id/events (which the
  // older macp-control-plane builds DO have). Limits the blast radius by
  // capping the number of runs we fetch.
  return await listEventsFallback(query);
}

/**
 * Session-cached flag — once we've confirmed `/events` is missing,
 * skip probing it again. Reset on full page reload.
 */
let eventsEndpointMissing = false;

async function listEventsFallback(
  query: EventsQuery
): Promise<{ data: CanonicalEvent[]; total: number; nextCursor?: number }> {
  const limit = query.limit ?? 500;

  // Determine which runs to fan out across.
  let runIds: string[];
  if (query.runId) {
    runIds = [query.runId];
  } else {
    const runs = await listRuns(false, {
      ...(query.scenarioRef ? { scenarioRef: query.scenarioRef } : {}),
      limit: 10 // cap fan-out to keep the page snappy
    });
    runIds = runs.map((run) => run.id);
  }

  if (runIds.length === 0) {
    return { data: [], total: 0 };
  }

  // Per-run events fetch — uses the older endpoint that does exist.
  const allEvents: CanonicalEvent[] = [];
  for (const runId of runIds) {
    try {
      const events = await getRunEvents(runId, false, {
        limit,
        afterSeq: query.afterSeq ?? 0,
        afterTs: query.afterTs,
        beforeTs: query.beforeTs,
        type: query.type
      });
      for (const event of events) allEvents.push(event);
    } catch (error) {
      console.warn(
        `[MACP UI] Failed to fetch events for run ${runId.slice(0, 8)}…: `,
        error instanceof Error ? error.message : error
      );
      // Continue — partial results are better than none.
    }
  }

  // Sort newest-first by seq within run, then cap to the requested limit.
  allEvents.sort((a, b) => {
    if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
    return b.seq - a.seq;
  });

  const total = allEvents.length;
  const data = allEvents.slice(0, limit);
  return {
    data,
    total,
    // Cursor pagination doesn't compose cleanly across multiple runs;
    // the caller's "Load more" button hides when nextCursor is undefined.
    nextCursor: undefined
  };
}

export async function getRunMetrics(runId: string, demoMode: boolean): Promise<MetricsSummary> {
  if (demoMode) return maybeDelay(MOCK_RUN_METRICS[runId]);
  return fetchJson<MetricsSummary>('macp-control-plane', `/runs/${runId}/metrics`);
}

export async function getRunTraces(runId: string, demoMode: boolean): Promise<TraceSummary> {
  if (demoMode) return maybeDelay(MOCK_RUN_TRACES[runId]);
  return fetchJson<TraceSummary>('macp-control-plane', `/runs/${runId}/traces`);
}

export interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references: Array<{ refType: string; traceID: string; spanID: string }>;
  startTime: number; // microseconds
  duration: number; // microseconds
  tags: Array<{ key: string; type: string; value: unknown }>;
  logs: Array<{ timestamp: number; fields: Array<{ key: string; value: unknown }> }>;
  processID: string;
}

export interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName: string; tags: Array<{ key: string; value: unknown }> }>;
}

export async function getJaegerTrace(traceId: string): Promise<JaegerTrace | null> {
  if (!traceId || traceId === '00000000000000000000000000000000') return null;
  try {
    const response = await fetch(`/api/jaeger/traces/${traceId}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[0] ?? null;
  } catch {
    return null;
  }
}

export function getJaegerUiUrl(traceId: string): string {
  const envBase = process.env.NEXT_PUBLIC_JAEGER_BASE_URL;
  const base = envBase
    ? envBase
    : typeof window !== 'undefined'
      ? window.location.origin.replace(/:\d+$/, ':16686')
      : 'http://localhost:16686';
  return `${base}/trace/${traceId}`;
}

export async function getRunArtifacts(runId: string, demoMode: boolean): Promise<Artifact[]> {
  if (demoMode) return maybeDelay(MOCK_RUN_ARTIFACTS[runId] ?? []);
  return fetchJson<Artifact[]>('macp-control-plane', `/runs/${runId}/artifacts`);
}

export async function cancelRun(
  runId: string,
  demoMode: boolean
): Promise<{ ok: boolean; runId: string; status: string }> {
  if (demoMode) return maybeDelay({ ok: true, runId, status: 'cancelled' });
  const raw = await fetchJson<Record<string, unknown>>('macp-control-plane', `/runs/${runId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Cancelled from MACP UI' })
  });
  return { ok: true, runId: String(raw.id ?? runId), status: String(raw.status ?? 'cancelled') };
}

/**
 * Suspend (pause) a running run — macp-proto 0.1.3 (RFC-MACP-0001 §7.5).
 * Calls the macp-control-plane `POST /runs/:id/suspend`; the run enters the
 * non-terminal `suspended` state with its TTL banked.
 */
export async function suspendRun(
  runId: string,
  demoMode: boolean,
  reason?: string
): Promise<{ ok: boolean; runId: string; status: string }> {
  if (demoMode) return maybeDelay({ ok: true, runId, status: 'suspended' });
  const raw = await fetchJson<Record<string, unknown>>('macp-control-plane', `/runs/${runId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? 'Suspended from MACP UI' })
  });
  return { ok: true, runId: String(raw.id ?? runId), status: String(raw.status ?? 'suspended') };
}

/**
 * Resume a suspended run — macp-proto 0.1.3. Calls `POST /runs/:id/resume`;
 * the banked TTL is restored and the run returns to `running`.
 */
export async function resumeRun(
  runId: string,
  demoMode: boolean,
  reason?: string
): Promise<{ ok: boolean; runId: string; status: string }> {
  if (demoMode) return maybeDelay({ ok: true, runId, status: 'running' });
  const raw = await fetchJson<Record<string, unknown>>('macp-control-plane', `/runs/${runId}/resume`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? 'Resumed from MACP UI' })
  });
  return { ok: true, runId: String(raw.id ?? runId), status: String(raw.status ?? 'running') };
}

export async function cloneRun(
  runId: string,
  demoMode: boolean,
  overrides?: { tags?: string[]; context?: Record<string, unknown> }
): Promise<CreateRunResponse> {
  if (demoMode) return maybeDelay({ runId: LIVE_RUN_ID, status: 'running', traceId: 'trace-live-fraud-001' });
  return fetchJson<CreateRunResponse>('macp-control-plane', `/runs/${runId}/clone`, {
    method: 'POST',
    body: JSON.stringify(overrides ?? {})
  });
}

export async function archiveRun(
  runId: string,
  demoMode: boolean
): Promise<{ ok: boolean; runId: string; archived: boolean }> {
  if (demoMode) return maybeDelay({ ok: true, runId, archived: true });
  const raw = await fetchJson<Record<string, unknown>>('macp-control-plane', `/runs/${runId}/archive`, {
    method: 'POST'
  });
  return { ok: true, runId: String(raw.id ?? runId), archived: true };
}

export async function createReplay(runId: string, demoMode: boolean): Promise<ReplayDescriptor> {
  if (demoMode) return maybeDelay(MOCK_REPLAY_DESCRIPTORS[runId] ?? MOCK_REPLAY_DESCRIPTORS[COMPLETED_RUN_ID]);
  return fetchJson<ReplayDescriptor>('macp-control-plane', `/runs/${runId}/replay`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'timed', speed: 1 })
  });
}

export async function compareRuns(
  leftRunId: string,
  rightRunId: string,
  demoMode: boolean
): Promise<RunComparisonResult> {
  if (demoMode) return maybeDelay(compareMockRuns(leftRunId, rightRunId));
  return fetchJson<RunComparisonResult>('macp-control-plane', '/runs/compare', {
    method: 'POST',
    body: JSON.stringify({ leftRunId, rightRunId })
  });
}

export async function getAgentProfiles(demoMode: boolean): Promise<AgentProfile[]> {
  if (demoMode) return maybeDelay(MOCK_AGENT_PROFILES);
  return fetchJson<AgentProfile[]>('macp-playground', '/agents');
}

export async function getAgentProfile(agentRef: string, demoMode: boolean): Promise<AgentProfile | undefined> {
  if (demoMode) {
    const agents = await getAgentProfiles(true);
    return agents.find((agent) => agent.agentRef === agentRef);
  }
  try {
    return await fetchJson<AgentProfile>('macp-playground', `/agents/${encodeURIComponent(agentRef)}`);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return undefined;
    throw error;
  }
}

export async function getRuntimeManifest(demoMode: boolean): Promise<RuntimeManifestResult> {
  if (demoMode) return maybeDelay(MOCK_RUNTIME_MANIFEST);
  return fetchJson<RuntimeManifestResult>('macp-control-plane', '/runtime/manifest');
}

export async function getRuntimeModes(demoMode: boolean): Promise<RuntimeModeDescriptor[]> {
  if (demoMode) return maybeDelay(MOCK_RUNTIME_MODES);
  return fetchJson<RuntimeModeDescriptor[]>('macp-control-plane', '/runtime/modes');
}

export async function getRuntimeRoots(demoMode: boolean): Promise<RuntimeRootDescriptor[]> {
  if (demoMode) return maybeDelay(MOCK_RUNTIME_ROOTS);
  return fetchJson<RuntimeRootDescriptor[]>('macp-control-plane', '/runtime/roots');
}

export async function getRuntimeHealth(demoMode: boolean): Promise<RuntimeHealth> {
  if (demoMode) return maybeDelay(MOCK_RUNTIME_HEALTH);
  return fetchJson<RuntimeHealth>('macp-control-plane', '/runtime/health');
}

export async function getAuditLogs(demoMode: boolean, query?: Partial<ListAuditQuery>): Promise<AuditListResponse> {
  if (demoMode) {
    let data = [...MOCK_AUDIT_LOGS];
    if (query?.actor) data = data.filter((e) => e.actor.includes(query.actor!));
    if (query?.action) data = data.filter((e) => e.action === query.action);
    if (query?.resource) data = data.filter((e) => e.resource === query.resource);
    return maybeDelay({ data, total: data.length });
  }
  const params = new URLSearchParams();
  if (query?.limit) params.set('limit', String(query.limit));
  if (query?.offset) params.set('offset', String(query.offset));
  if (query?.actor) params.set('actor', query.actor);
  if (query?.action) params.set('action', query.action);
  if (query?.resource) params.set('resource', query.resource);
  if (query?.resourceId) params.set('resourceId', query.resourceId);
  if (query?.createdAfter) params.set('createdAfter', query.createdAfter);
  if (query?.createdBefore) params.set('createdBefore', query.createdBefore);
  const suffix = params.toString() ? `?${params.toString()}` : '?limit=100&offset=0';
  return fetchJson<AuditListResponse>('macp-control-plane', `/audit${suffix}`);
}

export async function getWebhooks(demoMode: boolean): Promise<WebhookSubscription[]> {
  if (demoMode) return maybeDelay(MOCK_WEBHOOKS);
  return fetchJson<WebhookSubscription[]>('macp-control-plane', '/webhooks');
}

export async function createWebhook(
  body: { url: string; secret: string; events: string[] },
  demoMode: boolean
): Promise<WebhookSubscription> {
  if (demoMode) {
    return maybeDelay({
      id: `webhook-${Date.now()}`,
      url: body.url,
      secret: body.secret,
      events: body.events,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  return fetchJson<WebhookSubscription>('macp-control-plane', '/webhooks', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function deleteWebhook(id: string, demoMode: boolean): Promise<void> {
  if (demoMode) return maybeDelay(undefined as unknown as void);
  await fetchJson('macp-control-plane', `/webhooks/${id}`, { method: 'DELETE' });
}

export async function resetCircuitBreaker(demoMode: boolean): Promise<CircuitBreakerResult> {
  if (demoMode) return maybeDelay({ status: 'ok', state: 'CLOSED' });
  return fetchJson<CircuitBreakerResult>('macp-control-plane', '/admin/circuit-breaker/reset', { method: 'POST' });
}

/** Backend §5.1 — query filters on `/dashboard/overview`. */
export interface DashboardOverviewQuery {
  /** Window alias. Backend accepts `15m / 1h / 6h / 24h / 7d / 30d`. */
  window?: '15m' | '1h' | '6h' | '24h' | '7d' | '30d';
  scenarioRef?: string;
  environment?: string;
  /** Explicit range (mutually exclusive with `window`). ISO-8601 UTC. */
  from?: string;
  to?: string;
}

export async function getDashboardOverview(
  demoMode: boolean,
  query: DashboardOverviewQuery = {}
): Promise<{
  kpis: DashboardKpis;
  runs: RunRecord[];
  packs: PackSummary[];
  runtimeHealth: RuntimeHealth;
  charts: Record<string, ChartPoint[]>;
  degraded?: boolean;
}> {
  if (demoMode) {
    // Demo mode — filter the cached runs client-side so the KPI strip
    // responds to scenario/environment pickers even without backend support.
    let filteredRuns = MOCK_RUNS;
    if (query.scenarioRef) {
      filteredRuns = filteredRuns.filter(
        (run) => run.source?.ref === query.scenarioRef || run.metadata?.scenarioRef === query.scenarioRef
      );
    }
    if (query.environment) {
      filteredRuns = filteredRuns.filter((run) => run.metadata?.environment === query.environment);
    }
    return maybeDelay({
      kpis: computeDashboardKpis(filteredRuns),
      runs: filteredRuns,
      packs: MOCK_PACKS,
      runtimeHealth: MOCK_RUNTIME_HEALTH,
      charts: MOCK_CHARTS
    });
  }

  type CpOverview = {
    kpis?: Record<string, number>;
    charts?: Record<string, { labels: string[]; data: number[] }>;
    recentRuns?: Record<string, unknown>[];
    runtimeHealth?: { ok: boolean; runtimeKind: string; detail?: string };
  };
  const params = new URLSearchParams();
  if (query.window) params.set('window', query.window);
  if (query.scenarioRef) params.set('scenarioRef', query.scenarioRef);
  if (query.environment) params.set('environment', query.environment);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  let overviewDegraded = false;
  const [cpOverview, packs, runtimeHealth] = await Promise.all([
    fetchJson<CpOverview>('macp-control-plane', `/dashboard/overview${suffix}`).catch((error): CpOverview => {
      console.warn(
        '[MACP UI] Dashboard overview endpoint unavailable:',
        error instanceof Error ? error.message : error
      );
      overviewDegraded = true;
      return {};
    }),
    listPacks(false),
    getRuntimeHealth(false)
  ]);

  // CP `/dashboard/overview` includes `recentRuns` pre-filtered by
  // `scenarioRef`/`environment`. Use it directly and skip a second
  // `listRuns` round-trip; fall back only when the overview call
  // failed or the field is missing (older CP builds).
  const runs: RunRecord[] =
    cpOverview.recentRuns && cpOverview.recentRuns.length > 0
      ? cpOverview.recentRuns.map((raw) => normalizeRun(raw))
      : await listRuns(false, {
          limit: 20,
          ...(query.scenarioRef ? { scenarioRef: query.scenarioRef } : {}),
          ...(query.environment ? { environment: query.environment } : {})
        });

  const cpKpis = cpOverview.kpis ?? {};
  const totalRuns = cpKpis.totalRuns ?? runs.length;
  const activeRuns =
    cpKpis.activeRuns ??
    runs.filter((run) => ['queued', 'starting', 'binding_session', 'running'].includes(run.status)).length;
  const completedRuns = cpKpis.completedRuns ?? runs.filter((run) => run.status === 'completed').length;
  const failedRuns = cpKpis.failedRuns ?? runs.filter((run) => run.status === 'failed').length;
  const cancelledRuns = cpKpis.cancelledRuns ?? runs.filter((run) => run.status === 'cancelled').length;
  const suspendedRuns = cpKpis.suspendedRuns ?? runs.filter((run) => run.status === 'suspended').length;
  const averageDurationMs = cpKpis.avgDurationMs ?? 0;

  const cpCharts = cpOverview.charts ?? {};
  const toChartPoints = (chart?: { labels: string[]; data: number[] }): ChartPoint[] =>
    chart ? chart.labels.map((label, i) => ({ label, value: chart.data[i] ?? 0 })) : [];

  return {
    kpis: {
      totalRuns,
      activeRuns,
      completedRuns,
      failedRuns,
      cancelledRuns,
      suspendedRuns,
      averageDurationMs,
      totalSignals: cpKpis.totalSignals ?? 0,
      totalCostUsd: cpKpis.totalCostUsd ?? cpKpis.estimatedCostUsd ?? 0,
      totalTokens: cpKpis.totalTokens ?? 0
    },
    runs,
    packs,
    runtimeHealth: cpOverview.runtimeHealth
      ? {
          ok: cpOverview.runtimeHealth.ok,
          runtimeKind: cpOverview.runtimeHealth.runtimeKind,
          detail: cpOverview.runtimeHealth.detail
        }
      : runtimeHealth,
    charts: {
      runVolume: toChartPoints(cpCharts.runVolume),
      latency: toChartPoints(cpCharts.latency),
      errors: toChartPoints(cpCharts.errorClasses),
      signals: toChartPoints(cpCharts.signalVolume),
      // Backend §5.2 — richer chart series. Each is optional; the UI
      // only renders when the series is non-empty.
      throughput: toChartPoints(cpCharts.throughput),
      queueDepth: toChartPoints(cpCharts.queueDepth),
      latencyP50: toChartPoints(cpCharts.latencyP50),
      latencyP95: toChartPoints(cpCharts.latencyP95),
      latencyP99: toChartPoints(cpCharts.latencyP99),
      cost: toChartPoints(cpCharts.cost),
      successRate: toChartPoints(cpCharts.successRate),
      // CP emits a single `decisionOutcome` series whose values carry the
      // net outcome per bucket (positive contributions as +1, negative as
      // -1), not separate positive/negative arrays.
      decisionOutcome: toChartPoints(cpCharts.decisionOutcome),
      perScenario: toChartPoints(cpCharts.perScenario)
    },
    degraded: overviewDegraded || undefined
  };
}

/** Backend §5.3 — circuit breaker state history. */
export interface CircuitBreakerHistoryEntry {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  enteredAt: string;
  reason?: string;
}

export async function getCircuitBreakerHistory(
  demoMode: boolean,
  window?: DashboardOverviewQuery['window']
): Promise<CircuitBreakerHistoryEntry[]> {
  if (demoMode) {
    const now = Date.now();
    return maybeDelay([
      { state: 'CLOSED', enteredAt: new Date(now - 1000 * 60 * 60 * 23).toISOString() },
      {
        state: 'HALF_OPEN',
        enteredAt: new Date(now - 1000 * 60 * 25).toISOString(),
        reason: 'Runtime heartbeat timeout'
      },
      { state: 'CLOSED', enteredAt: new Date(now - 1000 * 60 * 22).toISOString() }
    ]);
  }
  const suffix = window ? `?window=${window}` : '';
  return fetchJson<CircuitBreakerHistoryEntry[]>('macp-control-plane', `/admin/circuit-breaker/history${suffix}`);
}

export async function getLogsData(demoMode: boolean, runId?: string) {
  if (demoMode) {
    const items = runId ? (MOCK_RUN_EVENTS[runId] ?? []) : listAllEvents();
    return maybeDelay(items);
  }
  if (!runId) return [];
  return getRunEvents(runId, false);
}

export async function getTraceData(demoMode: boolean, runId?: string) {
  if (demoMode) {
    if (!runId) return maybeDelay(Object.values(MOCK_RUN_ARTIFACTS).flat());
    return maybeDelay(MOCK_RUN_ARTIFACTS[runId] ?? []);
  }
  if (!runId) return [];
  return getRunArtifacts(runId, false);
}

export async function getObservabilityRawMetrics(demoMode: boolean): Promise<string> {
  if (demoMode) return maybeDelay(MOCK_PROMETHEUS_METRICS);
  const response = await fetch('/api/proxy/macp-control-plane/metrics', { cache: 'no-store' });
  return response.text();
}

export async function getTimelineFrame(
  runId: string,
  seq: number,
  demoMode: boolean
): Promise<RunStateProjection | undefined> {
  if (demoMode) {
    const frames = MOCK_RUN_FRAMES[runId] ?? [];
    return maybeDelay(frames.find((frame) => frame.seq === seq)?.snapshot);
  }
  return fetchJson<RunStateProjection>('macp-control-plane', `/runs/${runId}/replay/state?seq=${seq}`);
}

export function getMockFrames(runId: string) {
  return MOCK_RUN_FRAMES[runId] ?? [];
}

export function getQuickCompareTarget(runId: string): string {
  if (runId === LIVE_RUN_ID) return COMPLETED_RUN_ID;
  return LIVE_RUN_ID;
}

export function listScenarioRefs(): string[] {
  return listAllScenarios().map((scenario) => `${scenario.scenario}@${scenario.versions[0]}`);
}

/* ─── Batch operations ─── */

export async function batchCancelRuns(runIds: string[], demoMode: boolean): Promise<BatchOperationResult> {
  if (demoMode) return maybeDelay({ results: runIds.map((id) => ({ runId: id, ok: true })) });
  return fetchJson<BatchOperationResult>('macp-control-plane', '/runs/batch/cancel', {
    method: 'POST',
    body: JSON.stringify({ runIds })
  });
}

export async function batchArchiveRuns(runIds: string[], demoMode: boolean): Promise<BatchOperationResult> {
  if (demoMode) return maybeDelay({ results: runIds.map((id) => ({ runId: id, ok: true })) });
  return fetchJson<BatchOperationResult>('macp-control-plane', '/runs/batch/archive', {
    method: 'POST',
    body: JSON.stringify({ runIds })
  });
}

export async function batchDeleteRuns(runIds: string[], demoMode: boolean): Promise<BatchOperationResult> {
  if (demoMode) return maybeDelay({ results: runIds.map((id) => ({ runId: id, ok: true })) });
  return fetchJson<BatchOperationResult>('macp-control-plane', '/runs/batch/delete', {
    method: 'POST',
    body: JSON.stringify({ runIds })
  });
}

/* ─── Run export bundle ─── */

export async function exportRunBundle(
  runId: string,
  demoMode: boolean,
  query?: ExportRunQuery
): Promise<RunExportBundle> {
  if (demoMode) {
    const run = MOCK_RUNS.find((r) => r.id === runId) ?? MOCK_RUNS[0];
    return maybeDelay({
      run,
      session: null,
      projection: MOCK_RUN_STATES[runId] ?? null,
      canonicalEvents: MOCK_RUN_EVENTS[runId] ?? [],
      rawEvents: [],
      artifacts: MOCK_RUN_ARTIFACTS[runId] ?? [],
      metrics: MOCK_RUN_METRICS[runId] ?? null,
      exportedAt: new Date().toISOString()
    });
  }
  const params = new URLSearchParams();
  if (query?.includeCanonical !== undefined) params.set('includeCanonical', String(query.includeCanonical));
  if (query?.includeRaw !== undefined) params.set('includeRaw', String(query.includeRaw));
  if (query?.eventLimit !== undefined) params.set('eventLimit', String(query.eventLimit));
  if (query?.format) params.set('format', query.format);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<RunExportBundle>('macp-control-plane', `/runs/${runId}/export${suffix}`);
}

/* ─── Webhook update ─── */

export async function updateWebhook(
  id: string,
  body: { url?: string; events?: string[]; active?: boolean; secret?: string },
  demoMode: boolean
): Promise<WebhookSubscription> {
  if (demoMode) {
    const existing = MOCK_WEBHOOKS.find((w) => w.id === id);
    return maybeDelay({ ...(existing ?? {}), ...body } as WebhookSubscription);
  }
  return fetchJson<WebhookSubscription>('macp-control-plane', `/webhooks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

/* ─── Create artifact ─── */

export async function createArtifact(
  runId: string,
  body: { kind: string; label: string; uri?: string; inline?: Record<string, unknown> },
  demoMode: boolean
): Promise<CreateArtifactResult> {
  if (demoMode) return maybeDelay({ id: 'demo-artifact', runId, ...body, createdAt: new Date().toISOString() });
  return fetchJson<CreateArtifactResult>('macp-control-plane', `/runs/${runId}/artifacts`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/* ─── Projection rebuild (admin) ─── */

export async function rebuildProjection(runId: string, demoMode: boolean): Promise<RebuildProjectionResult> {
  if (demoMode) return maybeDelay({ rebuilt: true, latestSeq: 42 });
  return fetchJson<RebuildProjectionResult>('macp-control-plane', `/runs/${runId}/projection/rebuild`, {
    method: 'POST'
  });
}

/* ─── Readiness probe ─── */

export async function getReadinessProbe(demoMode: boolean): Promise<ReadinessProbeResponse> {
  if (demoMode)
    return maybeDelay({
      ok: true,
      database: 'ok',
      runtime: { ok: true, runtimeKind: 'rust', detail: 'Healthy' },
      streamConsumer: 'ok',
      circuitBreaker: 'CLOSED'
    });
  return fetchJson<ReadinessProbeResponse>('macp-control-plane', '/readyz');
}

/* ─── Agent metrics from control plane ─── */

/** Shape returned by CP GET /dashboard/agents/metrics */
interface CpAgentMetricsEntry {
  participantId: string;
  runs: number;
  signals: number;
  messages: number;
  averageConfidence: number;
  averageLatencyMs?: number;
}

export async function getAgentMetrics(demoMode: boolean): Promise<AgentMetricsEntry[]> {
  if (demoMode) {
    return maybeDelay(
      MOCK_AGENT_PROFILES.map((agent) => ({
        agentRef: agent.agentRef,
        runs: agent.metrics?.runs ?? 0,
        signals: agent.metrics?.signals ?? 0,
        messages: 0,
        averageLatencyMs: agent.metrics?.averageLatencyMs,
        averageConfidence: agent.metrics?.averageConfidence ?? 0
      }))
    );
  }
  try {
    const raw = await fetchJson<CpAgentMetricsEntry[]>('macp-control-plane', '/dashboard/agents/metrics');
    return raw.map((entry) => ({
      agentRef: entry.participantId,
      runs: entry.runs,
      signals: entry.signals,
      messages: entry.messages,
      averageLatencyMs: entry.averageLatencyMs,
      averageConfidence: entry.averageConfidence
    }));
  } catch (error) {
    console.warn('[MACP UI] Agent metrics endpoint unavailable:', error instanceof Error ? error.message : error);
    return [];
  }
}

/* ─── Batch export ─── */

export async function batchExportRuns(runIds: string[], demoMode: boolean): Promise<RunExportBundle[]> {
  if (demoMode) {
    const bundles: RunExportBundle[] = runIds.map((id) => {
      const run = MOCK_RUNS.find((r) => r.id === id) ?? MOCK_RUNS[0];
      return {
        run,
        session: null,
        projection: MOCK_RUN_STATES[id] ?? null,
        canonicalEvents: MOCK_RUN_EVENTS[id] ?? [],
        rawEvents: [],
        artifacts: MOCK_RUN_ARTIFACTS[id] ?? [],
        metrics: MOCK_RUN_METRICS[id] ?? null,
        exportedAt: new Date().toISOString()
      };
    });
    return maybeDelay(bundles);
  }
  return fetchJson<RunExportBundle[]>('macp-control-plane', '/runs/batch/export', {
    method: 'POST',
    body: JSON.stringify({ runIds })
  });
}

/* ─── Hard delete run ─── */

export async function deleteRun(runId: string, demoMode: boolean): Promise<void> {
  if (demoMode) return maybeDelay(undefined as unknown as void);
  await fetchJson('macp-control-plane', `/runs/${runId}`, { method: 'DELETE' });
}

/* ─── Runtime policy CRUD ─── */

export async function listRuntimePolicies(demoMode: boolean, mode?: string): Promise<RuntimePolicyDescriptor[]> {
  if (demoMode) {
    let policies = [...MOCK_RUNTIME_POLICIES];
    if (mode) policies = policies.filter((p) => p.mode === mode);
    return maybeDelay(policies);
  }
  const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return fetchJson<RuntimePolicyDescriptor[]>('macp-control-plane', `/runtime/policies${suffix}`);
}

export async function getRuntimePolicy(policyId: string, demoMode: boolean): Promise<RuntimePolicyDescriptor> {
  if (demoMode) {
    const policy = MOCK_RUNTIME_POLICIES.find((p) => p.policyId === policyId);
    if (!policy) throw new Error(`Unknown mock policy: ${policyId}`);
    return maybeDelay(policy);
  }
  return fetchJson<RuntimePolicyDescriptor>('macp-control-plane', `/runtime/policies/${encodeURIComponent(policyId)}`);
}

export async function registerRuntimePolicy(
  body: RegisterPolicyRequest,
  demoMode: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (demoMode) return maybeDelay({ ok: true });
  return fetchJson<{ ok: boolean; error?: string }>('macp-control-plane', '/runtime/policies', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export async function unregisterRuntimePolicy(
  policyId: string,
  demoMode: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (demoMode) return maybeDelay({ ok: true });
  return fetchJson<{ ok: boolean; error?: string }>(
    'macp-control-plane',
    `/runtime/policies/${encodeURIComponent(policyId)}`,
    { method: 'DELETE' }
  );
}
