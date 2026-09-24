import { describe, it, expect } from 'vitest';
import {
  listPacks,
  listRuns,
  runExample,
  getRun,
  getDashboardOverview,
  compileLaunch,
  getAgentProfiles,
  getAgentMetrics,
  getLogsData,
  getTraceData,
  getWebhooks,
  createWebhook,
  getObservabilityRawMetrics,
  cancelRun,
  cloneRun,
  batchExportRuns,
  getRunState,
  getRunEvents,
  getRunMetrics,
  getMockFrames,
  getQuickCompareTarget,
  listScenarioRefs,
  listScenarios,
  getLaunchSchema,
  createReplay,
  getRuntimeSessionDrift
} from './client';
import { LIVE_RUN_ID, COMPLETED_RUN_ID } from '@/lib/data/mock-data';

const DEMO = true;

describe('demo mode API client', () => {
  it('listPacks returns mock packs array', async () => {
    const packs = await listPacks(DEMO);
    expect(Array.isArray(packs)).toBe(true);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]).toHaveProperty('slug');
    expect(packs[0]).toHaveProperty('name');
  });

  it('listRuns returns all mock runs', async () => {
    const runs = await listRuns(DEMO);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]).toHaveProperty('id');
    expect(runs[0]).toHaveProperty('status');
  });

  it('listRuns filters by status parameter', async () => {
    const allRuns = await listRuns(DEMO);
    const completedRuns = await listRuns(DEMO, { status: 'completed' });
    expect(completedRuns.length).toBeLessThanOrEqual(allRuns.length);
    completedRuns.forEach((run) => expect(run.status).toBe('completed'));
  });

  it('getRun returns matching mock run', async () => {
    const runs = await listRuns(DEMO);
    const run = await getRun(runs[0].id, DEMO);
    expect(run.id).toBe(runs[0].id);
  });

  it('getRun throws for unknown runId', async () => {
    await expect(getRun('nonexistent-id', DEMO)).rejects.toThrow();
  });

  it('getRunState returns projection for known run', async () => {
    const runs = await listRuns(DEMO);
    const state = await getRunState(runs[0].id, DEMO);
    expect(state).toHaveProperty('graph');
    expect(state).toHaveProperty('participants');
    expect(state).toHaveProperty('decision');
  });

  it('getRunEvents returns events array', async () => {
    const runs = await listRuns(DEMO);
    const events = await getRunEvents(runs[0].id, DEMO);
    expect(Array.isArray(events)).toBe(true);
  });

  it('getDashboardOverview returns kpis, runs, packs, runtimeHealth, charts', async () => {
    const overview = await getDashboardOverview(DEMO);
    expect(overview).toHaveProperty('kpis');
    expect(overview).toHaveProperty('runs');
    expect(overview).toHaveProperty('packs');
    expect(overview).toHaveProperty('runtimeHealth');
    expect(overview).toHaveProperty('charts');
  });

  it('cancelRun returns ok with cancelled status', async () => {
    const runs = await listRuns(DEMO);
    const result = await cancelRun(runs[0].id, DEMO);
    expect(result).toHaveProperty('ok', true);
    expect(result).toHaveProperty('status', 'cancelled');
  });

  it('compileLaunch merges input into compiled result', async () => {
    const result = await compileLaunch(
      { scenarioRef: 'fraud/check@1.0.0', templateId: 'default', inputs: { key: 'value' } },
      DEMO
    );
    expect(result).toHaveProperty('runDescriptor');
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('scenarioMeta');
  });

  it('getAgentProfiles returns agent profile array', async () => {
    const profiles = await getAgentProfiles(DEMO);
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0]).toHaveProperty('agentRef');
  });

  it('listScenarios returns scenarios for a pack', async () => {
    const packs = await listPacks(DEMO);
    const scenarios = await listScenarios(packs[0].slug, DEMO);
    expect(Array.isArray(scenarios)).toBe(true);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]).toHaveProperty('scenario');
  });

  it('listScenarios returns scenarios with policyVersion and policyHints', async () => {
    const scenarios = await listScenarios('fraud', DEMO);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]).toHaveProperty('policyVersion');
    expect(scenarios[0].policyHints).toBeDefined();
    expect(scenarios[0].policyHints!.type).toBeDefined();
  });

  it('getLaunchSchema returns schema with policyHints in launchSummary', async () => {
    const schema = await getLaunchSchema('fraud', 'high-value-new-device', '1.0.0', 'default', DEMO);
    expect(schema).toHaveProperty('launchSummary');
    expect(schema.launchSummary.policyHints).toBeDefined();
    expect(schema.launchSummary.policyHints!.type).toBeDefined();
  });

  it('getRunState returns state with policy projection', async () => {
    const state = await getRunState(COMPLETED_RUN_ID, DEMO);
    expect(state.policy).toBeDefined();
    expect(state.policy!.policyVersion).toBeDefined();
    expect(Array.isArray(state.policy!.commitmentEvaluations)).toBe(true);
  });

  it('getRunMetrics returns token usage fields', async () => {
    const metrics = await getRunMetrics(COMPLETED_RUN_ID, DEMO);
    expect(typeof metrics.promptTokens).toBe('number');
    expect(typeof metrics.completionTokens).toBe('number');
    expect(typeof metrics.totalTokens).toBe('number');
    expect(typeof metrics.estimatedCostUsd).toBe('number');
  });

  it('getLogsData returns events for specific runId', async () => {
    const runs = await listRuns(DEMO);
    const events = await getLogsData(DEMO, runs[0].id);
    expect(Array.isArray(events)).toBe(true);
  });

  it('getWebhooks returns mock webhooks', async () => {
    const webhooks = await getWebhooks(DEMO);
    expect(Array.isArray(webhooks)).toBe(true);
  });

  it('createWebhook returns subscription with generated id', async () => {
    const webhook = await createWebhook(
      { url: 'https://example.com', secret: 'test', events: ['run.completed'] },
      DEMO
    );
    expect(webhook).toHaveProperty('id');
    expect(webhook).toHaveProperty('url', 'https://example.com');
  });

  it('getObservabilityRawMetrics returns prometheus string', async () => {
    const metrics = await getObservabilityRawMetrics(DEMO);
    expect(typeof metrics).toBe('string');
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('getAgentMetrics returns mock agent metrics in demo mode', async () => {
    const metrics = await getAgentMetrics(DEMO);
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('agentRef');
    expect(metrics[0]).toHaveProperty('runs');
    expect(metrics[0]).toHaveProperty('signals');
    expect(metrics[0]).toHaveProperty('messages');
    expect(metrics[0]).toHaveProperty('averageConfidence');
  });

  it('cloneRun returns a new run response in demo mode', async () => {
    const result = await cloneRun('any-run-id', DEMO);
    expect(result).toHaveProperty('runId');
    expect(result).toHaveProperty('status', 'running');
  });

  it('cloneRun accepts overrides parameter', async () => {
    const result = await cloneRun('any-run-id', DEMO, {
      tags: ['cloned', 'test'],
      context: { override: true }
    });
    expect(result).toHaveProperty('runId');
  });

  it('batchExportRuns returns bundles for each run', async () => {
    const runs = await listRuns(DEMO);
    const ids = runs.slice(0, 2).map((r) => r.id);
    const bundles = await batchExportRuns(ids, DEMO);
    expect(Array.isArray(bundles)).toBe(true);
    expect(bundles).toHaveLength(ids.length);
    expect(bundles[0]).toHaveProperty('run');
  });

  it('getLogsData with runId returns events for that run', async () => {
    const runs = await listRuns(DEMO);
    const events = await getLogsData(DEMO, runs[0].id);
    expect(Array.isArray(events)).toBe(true);
  });

  it('getLogsData without runId returns all events', async () => {
    const events = await getLogsData(DEMO);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('getTraceData with runId returns artifacts for that run', async () => {
    const runs = await listRuns(DEMO);
    const artifacts = await getTraceData(DEMO, runs[0].id);
    expect(Array.isArray(artifacts)).toBe(true);
  });

  it('getTraceData without runId returns all artifacts', async () => {
    const artifacts = await getTraceData(DEMO);
    expect(Array.isArray(artifacts)).toBe(true);
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it('getMockFrames returns array of frames', () => {
    const frames = getMockFrames(LIVE_RUN_ID);
    expect(Array.isArray(frames)).toBe(true);
  });

  it('getQuickCompareTarget returns COMPLETED_RUN_ID for LIVE_RUN_ID', () => {
    expect(getQuickCompareTarget(LIVE_RUN_ID)).toBe(COMPLETED_RUN_ID);
  });

  it('getQuickCompareTarget returns LIVE_RUN_ID for COMPLETED_RUN_ID', () => {
    expect(getQuickCompareTarget(COMPLETED_RUN_ID)).toBe(LIVE_RUN_ID);
  });

  it('listScenarioRefs returns array of scenario reference strings', () => {
    const refs = listScenarioRefs();
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBeGreaterThan(0);
    refs.forEach((ref) => expect(ref).toContain('@'));
  });

  it('createReplay returns a ReplayDescriptor', async () => {
    const descriptor = await createReplay(COMPLETED_RUN_ID, DEMO);
    expect(descriptor).toHaveProperty('runId');
    expect(descriptor).toHaveProperty('mode');
    expect(descriptor).toHaveProperty('streamUrl');
    expect(descriptor).toHaveProperty('stateUrl');
  });

  it('getObservabilityRawMetrics returns a non-empty string', async () => {
    const metrics = await getObservabilityRawMetrics(DEMO);
    expect(typeof metrics).toBe('string');
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('getRuntimeSessionDrift returns a complete diff with both directions populated', async () => {
    const drift = await getRuntimeSessionDrift(DEMO);

    expect(drift.complete).toBe(true);
    expect(drift.untrackedSessions.length).toBeGreaterThan(0);
    expect(drift.missingFromRuntime).not.toBeNull();
    expect(drift.missingFromRuntime?.length).toBeGreaterThan(0);
  });

  it('getRuntimeSessionDrift demo counts reflect the live-vs-retained distinction', async () => {
    const drift = await getRuntimeSessionDrift(DEMO);

    // runtimeSessionCount includes terminal sessions still inside the runtime's retention
    // window; only liveRuntimeSessionCount feeds the diff. If the fixture made them equal the
    // UI's explainer for the gap would have nothing to explain.
    expect(drift.runtimeSessionCount).toBeGreaterThan(drift.liveRuntimeSessionCount);
    expect(drift.trackedRunCount).toBeGreaterThan(0);
  });

  it('getRuntimeSessionDrift demo payload describes a state the control plane could emit', async () => {
    // A demo fixture is the artifact the UI renders and the thing reviewers reason from, so an
    // arithmetically impossible one teaches a wrong contract. Re-derived from the controller:
    //   untracked ⊆ live                       (untracked sessions are drawn from live ones)
    //   live - untracked = live-and-tracked    (the rest are bound to tracked runs)
    //   trackedRunCount ≥ live-and-tracked + |missing|
    //       (each tracked run holds at most one session id; the missing ones are runs whose
    //        session is NOT among the live set, so they are disjoint from live-and-tracked)
    const drift = await getRuntimeSessionDrift(DEMO);
    const untracked = drift.untrackedSessions.length;
    const missing = drift.missingFromRuntime?.length ?? 0;

    expect(drift.liveRuntimeSessionCount).toBeLessThanOrEqual(drift.runtimeSessionCount);
    expect(untracked).toBeLessThanOrEqual(drift.liveRuntimeSessionCount);
    expect(drift.liveRuntimeSessionCount - untracked + missing).toBeLessThanOrEqual(drift.trackedRunCount);
  });

  it('runExample demo mode returns a controlPlaneRun pointing at a real demo run', async () => {
    // Without this field the demo bootstrap would permanently take the "not registered with the
    // control plane" branch and never redirect — the highest-probability bug in this phase, and one
    // no page test catches because the page mocks the client.
    const result = await runExample(
      { scenarioRef: 'fraud/high-value-new-device@1.0.0', templateId: 'default', mode: 'live', inputs: {} },
      DEMO
    );

    expect(result.controlPlaneRun).toBeDefined();
    // The redirect navigates by this id, so it has to resolve against the demo dataset.
    const runs = await listRuns(DEMO);
    expect(runs.some((run) => run.id === result.controlPlaneRun!.runId)).toBe(true);
  });

  it('getRuntimeSessionDrift demo sessions carry the fields the UI renders', async () => {
    const [session] = (await getRuntimeSessionDrift(DEMO)).untrackedSessions;

    expect(session.sessionId).toBeTruthy();
    expect(session.mode).toBeTruthy();
    // The CP filters to live states, so a demo fixture in a terminal state would misrepresent
    // the contract.
    expect(['SESSION_STATE_OPEN', 'SESSION_STATE_SUSPENDED']).toContain(session.state);
  });
});
