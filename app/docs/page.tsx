import Link from 'next/link';
import { BookOpen, Compass, Layers, Play, Rocket, Sparkles, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArchitectureDiagram } from '@/components/docs/diagrams/architecture-diagram';
import { ScenarioPackDiagram } from '@/components/docs/diagrams/scenario-pack-diagram';
import { RunFlowDiagram } from '@/components/docs/diagrams/run-flow-diagram';
import { listDocs, getCollectionLabel } from '@/lib/docs/loader';

export const metadata = {
  title: 'Docs · MACP Console',
  description:
    'Understand the MACP UI Console, how it integrates with the Examples Service and Control Plane, and how scenario packs run end-to-end.'
};

export default async function DocsLandingPage() {
  const [uiDocs, esDocs] = await Promise.all([listDocs('macp-ui-console'), listDocs('macp-playground')]);

  return (
    <div className="stack docs-landing">
      <section className="hero docs-hero">
        <div>
          <div className="docs-hero-kicker">
            <Sparkles size={14} />
            <span>MACP UI Console</span>
          </div>
          <h1>
            Orchestrate, observe, and debug
            <br />
            <span className="docs-hero-accent">multi-agent runs.</span>
          </h1>
          <p>
            The Console is the operator surface for MACP. Launch scenarios, watch live runs over SSE, inspect the
            canonical event stream, and explore historical analytics — all against the Examples Service and Control
            Plane, or against a rich local demo dataset.
          </p>
          <div className="docs-hero-actions">
            <Link href="/scenarios" className="button button-primary">
              <Play size={16} />
              Try demo mode
            </Link>
            <a href="#documentation" className="button">
              <BookOpen size={16} />
              Read the docs
            </a>
          </div>
        </div>
      </section>

      <section className="docs-feature-grid">
        <Card>
          <CardHeader>
            <Rocket size={20} style={{ color: 'var(--brand)' }} />
            <CardTitle>Orchestration launchpad</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="muted">
              Browse scenario packs, fill a schema-driven launch form, compile with the Examples Service, and submit a
              whitelisted-safe RunDescriptor to the Control Plane.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Zap size={20} style={{ color: 'var(--brand-2)' }} />
            <CardTitle>Live run observability</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="muted">
              SSE-backed execution graph, node inspector, signal rail, live decision panel, and policy governance — all
              updated as canonical events arrive.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Compass size={20} style={{ color: 'var(--success)' }} />
            <CardTitle>Historical analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="muted">
              Run history, pairwise comparison, Prometheus metrics with percentile KPIs, circuit breaker timeline, and
              Jaeger trace deep-links when configured.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Architecture</CardTitle>
          <CardDescription>
            The browser never calls upstream services directly. A Next.js route-handler proxy injects auth and forwards.
            The Control Plane observes the Runtime read-only; agents drive the session.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="docs-diagram-wrap docs-diagram-wrap--arch">
            <ArchitectureDiagram />
          </div>
          <p className="muted">
            Under the <strong>observer-only Control Plane</strong> model (RFC-MACP-0004 §4), agents authenticate
            directly to the Runtime via <code>macp-sdk-python</code> / <code>macp-sdk-typescript</code>. The Control
            Plane reads envelopes off a read-only <code>StreamSession</code> and projects them for the UI. The HTTP
            bypass endpoints (<code>/runs/:id/messages</code>, <code>/signal</code>, <code>/context</code>) are removed
            and return 410 Gone.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scenario packs</CardTitle>
          <CardDescription>
            A pack is a folder of versioned scenarios. Each scenario compiles twin artifacts: a Control-Plane-safe run
            descriptor, and per-agent bootstrap files.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="docs-diagram-wrap docs-diagram-wrap--pack">
            <ScenarioPackDiagram />
          </div>
          <ul className="docs-explainer-list">
            <li>
              <strong>Pack</strong> — a bundle of related scenarios (e.g. <code>fraud</code>, <code>lending</code>) with
              metadata in <code>pack.yaml</code>.
            </li>
            <li>
              <strong>Scenario version</strong> — an immutable <code>scenario.yaml</code> +{' '}
              <code>templates/*.yaml</code>. Inputs are validated against a JSON Schema.
            </li>
            <li>
              <strong>Launch Schema</strong> — the form the Console renders. Carries defaults, <code>policyHints</code>,
              participant bindings, and expected decision kinds.
            </li>
            <li>
              <strong>Compile</strong> — merges schema defaults, template defaults, and user inputs; validates; and
              produces a pre-allocated <code>sessionId</code> (UUID v4).
            </li>
            <li>
              <strong>Twin artifacts</strong> — a scenario-agnostic <code>RunDescriptor</code> goes to the Control
              Plane; a <code>Bootstrap + scenarioSpec</code> is handed to each spawned agent so it can open its gRPC
              channel and (for the initiator) call <code>SessionStart</code>.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run flow</CardTitle>
          <CardDescription>From clicking Launch to watching a live run — five steps, three services.</CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="docs-diagram-wrap docs-diagram-wrap--flow">
            <RunFlowDiagram />
          </div>
          <ol className="docs-explainer-list">
            <li>
              <strong>Compile</strong> — <code>POST /launch/compile</code> against the Examples Service.
            </li>
            <li>
              <strong>Validate</strong> — <code>POST /runs/validate</code> against the Control Plane (optional but
              default-on).
            </li>
            <li>
              <strong>Submit</strong> — <code>POST /runs</code> with the whitelisted-safe descriptor. Response includes{' '}
              <code>runId</code>, <code>sessionId</code>, <code>traceId</code>.
            </li>
            <li>
              <strong>Stream</strong> — the workbench opens <code>GET /runs/:id/stream?includeSnapshot=true</code> (SSE)
              and consumes <code>snapshot</code>, <code>canonical_event</code>, <code>heartbeat</code> frames.
            </li>
            <li>
              <strong>Workbench</strong> — the graph, node inspector, signal rail, and decision panel render from the
              projection and live event feed.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the Console uses each service</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="docs-service-grid">
            <div className="panel">
              <h3>
                <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--brand)' }} />
                Examples Service
              </h3>
              <ul className="docs-explainer-list">
                <li>Scenario catalog (`/packs`, `/scenarios`) — powers the catalog + detail pages.</li>
                <li>Agent profiles (`/agents`) — powers the agent catalog.</li>
                <li>Launch schema + compile — powers the Launch form and the one-shot bootstrap.</li>
              </ul>
            </div>
            <div className="panel">
              <h3>
                <Layers size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--brand)' }} />
                Control Plane
              </h3>
              <ul className="docs-explainer-list">
                <li>Run lifecycle (`/runs`, validate, cancel, clone, archive).</li>
                <li>State projection + canonical events (per-run and cross-run).</li>
                <li>SSE live stream — `/runs/:id/stream`.</li>
                <li>Observability: metrics, traces, audit, readiness, circuit breaker.</li>
                <li>Runtime manifest / modes / roots and the policy registry (pass-through).</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card id="documentation">
        <CardHeader>
          <CardTitle>Documentation</CardTitle>
          <CardDescription>
            Deep-dives for both repos. UI Console docs ship with this app; Examples Service docs are synced from the
            upstream repo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="docs-index-grid">
            <DocCollectionCard
              collection="macp-ui-console"
              entries={uiDocs}
              description="Architecture, API integration, feature matrix, changelog, and backend repo notes for this app."
            />
            <DocCollectionCard
              collection="macp-playground"
              entries={esDocs}
              description="Scenario authoring, launch compilation, agent hosting, and the worker bootstrap contract."
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DocCollectionCard({
  collection,
  entries,
  description
}: {
  collection: 'macp-ui-console' | 'macp-playground';
  entries: Awaited<ReturnType<typeof listDocs>>;
  description: string;
}) {
  const label = getCollectionLabel(collection);
  return (
    <div className="panel docs-index-collection">
      <div className="docs-index-head">
        <h3>{label}</h3>
        <Link href={`/docs/${collection}`} className="docs-link">
          Browse all →
        </Link>
      </div>
      <p className="muted">{description}</p>
      {entries.length === 0 ? (
        <p className="muted">
          No docs synced yet.
          {collection === 'macp-playground' ? ' The next sync PR will populate this list.' : null}
        </p>
      ) : (
        <ul className="docs-index-list">
          {entries.slice(0, 5).map((entry) => (
            <li key={entry.slug}>
              <Link href={`/docs/${collection}/${entry.slug}`} className="docs-index-item">
                <span className="docs-index-item-title">{entry.title}</span>
                {entry.firstParagraph ? (
                  <span className="docs-index-item-blurb">{truncate(entry.firstParagraph, 140)}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
