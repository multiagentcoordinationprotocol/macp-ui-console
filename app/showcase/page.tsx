'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorPanel } from '@/components/ui/state-panels';
import { getRun, runExample } from '@/lib/api/client';
import { ApiError, describeApiError } from '@/lib/api/fetcher';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { SHOWCASE_SCENARIO_REF, SHOWCASE_TEMPLATE_ID } from '@/lib/showcase';

/** How long to wait for the control plane to know the run before giving up. */
const DISCOVERY_ATTEMPTS = 30;
const DISCOVERY_INTERVAL_MS = 1000;

type Phase = { kind: 'launching' } | { kind: 'discovering'; runId: string } | { kind: 'failed'; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `GET /runs/:runId` resolves. A run the playground did not register through `POST /runs`
 * reaches the control plane by session discovery, which lags the launch by a moment — so a 404 here
 * means "not yet", not "never". Any other failure is real and is rethrown.
 */
async function waitForRun(runId: string, demoMode: boolean): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await getRun(runId, demoMode);
      return;
    } catch (error) {
      const notYet = error instanceof ApiError && error.status === 404;
      if (!notYet || attempt >= DISCOVERY_ATTEMPTS) throw error;
    }
    await sleep(DISCOVERY_INTERVAL_MS);
  }
}

export default function ShowcasePage() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'launching' });
  // Launching spends the visitor's per-IP launch quota, so it must happen once per visit. Strict
  // mode runs mount effects twice in development; a ref survives that, state would not.
  const launched = useRef(false);

  const launch = useCallback(async () => {
    setPhase({ kind: 'launching' });
    try {
      const result = await runExample(
        {
          scenarioRef: SHOWCASE_SCENARIO_REF,
          templateId: SHOWCASE_TEMPLATE_ID,
          mode: 'live',
          inputs: {},
          bootstrapAgents: true
        },
        demoMode
      );
      // A run registered through `POST /runs` is keyed by the control plane's own run id; one it
      // auto-discovers from the runtime session is keyed by the session id. See RunExampleResult.
      const runId = result.controlPlaneRun?.runId ?? result.sessionId;
      if (!runId) throw new Error('The playground started the scenario but returned no session id.');
      setPhase({ kind: 'discovering', runId });
      await waitForRun(runId, demoMode);
      router.replace(`/runs/live/${runId}`);
    } catch (error) {
      setPhase({ kind: 'failed', message: describeApiError(error) });
    }
  }, [demoMode, router]);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    void launch();
  }, [launch]);

  if (phase.kind === 'failed') {
    return (
      <div className="stack">
        <ErrorPanel
          title="The showcase run could not start"
          message={phase.message}
          actionHref="/runs"
          actionLabel="Open run history"
        />
        <div>
          <Button onClick={() => void launch()}>
            <Play size={16} />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Starting a Decision-mode session</CardTitle>
        <CardDescription>
          Four agents assess a high-value transaction from a new device and commit to one binding decision. The agents
          run deterministically, with no LLM, so every visit produces the same outcome.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="empty-state compact" role="status" aria-live="polite">
          <h4>{phase.kind === 'launching' ? 'Launching the session' : 'Waiting for the control plane'}</h4>
          <p>
            {phase.kind === 'launching'
              ? 'Compiling the scenario and starting its agents.'
              : `Session ${phase.runId} is running. Opening the run view as soon as the control plane has it.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
