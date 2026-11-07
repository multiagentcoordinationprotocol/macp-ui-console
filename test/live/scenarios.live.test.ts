import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Live end-to-end suite: drives playground scenarios through a RUNNING console's proxy — the same
 * calls the "New run" page makes — and follows each run to completion in the control plane:
 *
 *   launch-schema -> POST /examples/run -> poll GET /runs/:id -> GET /runs/:id/events
 *   -> GET /runs/:id/receipt -> GET /runs/:id/verification
 *
 * So one run covers console proxy -> playground -> control plane -> runtime -> agents and back.
 *
 * Skipped unless MACP_UI_BASE_URL is set. Targets:
 *   local:   docker compose -f docker-compose.e2e.yml up -d --build --wait && npm run dev:e2e
 *            MACP_UI_BASE_URL=http://localhost:3000 npm run test:live
 *   hosted:  MACP_UI_BASE_URL=https://<console host> npm run test:live
 *
 * MACP_UI_LIVE_SCENARIOS picks what to launch: a comma list of `pack/scenario@version:template`, or
 * `all` for every scenario/template the playground lists. The default is four launches, which fits the
 * proxy's launch quota (5 per 10 minutes per client IP); beyond that the suite waits out the 429's
 * retry-after instead of failing.
 */
const BASE = process.env.MACP_UI_BASE_URL?.replace(/\/$/, '');
const DEFAULT_SCENARIOS = [
  'fraud/high-value-new-device@1.0.0:suspend-demo',
  'fraud/high-value-new-device@1.0.0:default',
  'claims/auto-claim-review@1.0.0:default',
  'lending/loan-underwriting@1.0.0:default'
];
const RUN_TIMEOUT_MS = Number(process.env.MACP_UI_LIVE_RUN_TIMEOUT_MS ?? 240_000);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function proxy<T = Json>(
  service: 'macp-playground' | 'macp-control-plane',
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; body: T }> {
  for (;;) {
    const res = await fetch(`${BASE}/api/proxy/${service}${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined
    });
    if (res.status === 429) {
      await sleep((Number(res.headers.get('retry-after') ?? '60') + 1) * 1000);
      continue;
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // non-JSON body; keep the text for the assertion message
    }
    return { status: res.status, body: body as T };
  }
}

async function listCombos(): Promise<string[]> {
  const packs = (await proxy<Array<{ slug: string }>>('macp-playground', '/packs')).body;
  const combos: string[] = [];
  for (const pack of packs) {
    const scenarios = (
      await proxy<Array<{ scenario: string; versions: string[]; templates: string[] }>>(
        'macp-playground',
        `/packs/${pack.slug}/scenarios`
      )
    ).body;
    for (const s of scenarios)
      for (const v of s.versions) for (const t of s.templates) combos.push(`${pack.slug}/${s.scenario}@${v}:${t}`);
  }
  return combos;
}

const selection = (process.env.MACP_UI_LIVE_SCENARIOS ?? '').trim();
const wanted = selection && selection !== 'all' ? selection.split(',').map((s) => s.trim()) : DEFAULT_SCENARIOS;

describe.skipIf(!BASE)('Scenarios through the console (live)', () => {
  let available: string[] = [];

  beforeAll(async () => {
    available = await listCombos();
  });

  it('the playground lists every scenario this suite launches', () => {
    if (selection === 'all') return;
    for (const id of wanted) expect(available, id).toContain(id);
  });

  const ids = selection === 'all' ? null : wanted;

  async function runScenario(id: string) {
    const match = /^([^/]+)\/([^@]+)@([^:]+):(.+)$/.exec(id);
    if (!match) throw new Error(`bad scenario id ${id}`);
    const [, pack, scenario, version, template] = match;

    const schema = await proxy<{ defaults?: Json }>(
      'macp-playground',
      `/packs/${pack}/scenarios/${scenario}/versions/${version}/launch-schema?template=${encodeURIComponent(template)}`
    );
    expect(schema.status, 'launch-schema').toBe(200);

    const launch = await proxy<{ controlPlaneRun?: { runId: string } }>('macp-playground', '/examples/run', {
      method: 'POST',
      body: {
        scenarioRef: `${pack}/${scenario}@${version}`,
        templateId: template,
        mode: 'live',
        inputs: schema.body.defaults ?? {},
        bootstrapAgents: true
      }
    });
    expect(launch.status, `examples/run: ${JSON.stringify(launch.body).slice(0, 300)}`).toBeLessThan(300);
    const runId = launch.body.controlPlaneRun?.runId;
    expect(runId, 'run registered with the control plane (controlPlaneRun.runId)').toBeTruthy();

    const seen: string[] = [];
    let status = '';
    const started = Date.now();
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      const run = await proxy<{ status: string }>('macp-control-plane', `/runs/${runId}`);
      status = run.body.status;
      if (seen[seen.length - 1] !== status) seen.push(status);
      if (TERMINAL.has(status)) break;
      await sleep(1500);
    }
    expect(status, `run ${runId} statuses: ${seen.join(' > ')}`).toBe('completed');

    const events = await proxy<Array<{ type: string }> | { data?: Array<{ type: string }> }>(
      'macp-control-plane',
      `/runs/${runId}/events?limit=500`
    );
    const list = Array.isArray(events.body) ? events.body : (events.body.data ?? []);
    const types = list.map((e) => e.type);
    expect(types, 'run events').toContain('run.completed');

    if (template === 'suspend-demo') {
      expect(types, 'suspend-demo suspends').toContain('run.suspended');
      expect(types, 'suspend-demo resumes').toContain('run.resumed');
      expect(types.indexOf('run.suspended')).toBeLessThan(types.indexOf('run.resumed'));
    }

    const receipt = await proxy<{ receipt?: { receipt_format?: string; commitment?: Json; session_id?: string } }>(
      'macp-control-plane',
      `/runs/${runId}/receipt`
    );
    expect(receipt.status, `receipt: ${JSON.stringify(receipt.body).slice(0, 300)}`).toBe(200);
    expect(receipt.body.receipt?.receipt_format).toBe('macp-receipt/1');
    expect(receipt.body.receipt?.commitment).toBeTruthy();

    const verification = await proxy('macp-control-plane', `/runs/${runId}/verification`);
    expect(verification.status, 'verification').toBe(200);
  }

  if (ids) {
    for (const id of ids) it(id, () => runScenario(id));
  } else {
    it('every listed scenario completes with a receipt', async () => {
      for (const id of available) await runScenario(id);
    });
  }
});
