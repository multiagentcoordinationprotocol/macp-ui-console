'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import { getRuntimeHealth, getRuntimeManifest, getRuntimeModes, getRuntimeRoots } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

/**
 * /modes — Runtime modes registry + compact runtime identity header.
 *
 * Moved from /observability per Q4/Q28/Q29 decisions. Runtime modes,
 * manifest, and roots are platform catalog data (not observability
 * signals) and now live on a dedicated page.
 */
export default function ModesPage() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const [rootsExpanded, setRootsExpanded] = useState(false);

  const manifestQuery = useQuery({
    queryKey: ['runtime-manifest', demoMode],
    queryFn: () => getRuntimeManifest(demoMode)
  });
  const modesQuery = useQuery({
    queryKey: ['runtime-modes', demoMode],
    queryFn: () => getRuntimeModes(demoMode)
  });
  const rootsQuery = useQuery({
    queryKey: ['runtime-roots', demoMode],
    queryFn: () => getRuntimeRoots(demoMode)
  });
  const healthQuery = useQuery({
    queryKey: ['runtime-health', demoMode],
    queryFn: () => getRuntimeHealth(demoMode)
  });

  if (modesQuery.isLoading) {
    return <LoadingPanel title="Loading modes" description="Fetching runtime mode registry." />;
  }

  if (modesQuery.error) {
    return <ErrorPanel message={String(modesQuery.error)} actionHref="/" />;
  }

  const modes = modesQuery.data ?? [];
  const manifest = manifestQuery.data;
  const roots = rootsQuery.data ?? [];
  const health = healthQuery.data;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <Layers size={24} />
            Runtime modes
          </h1>
          <p>
            Execution modes registered with the runtime adapter. Each mode describes a participant model, supported
            message types, and version lineage.
          </p>
        </div>
      </div>

      {/* Compact runtime identity header — supersedes the /observability block. */}
      <Card>
        <CardHeader>
          <CardTitle>Runtime identity</CardTitle>
          <CardDescription>Manifest and filesystem roots exposed by the control plane.</CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <div className="inline-list">
            {health ? <StatusBadge status={health.ok ? 'ok' : 'failed'} /> : null}
            {health?.runtimeKind ? <Badge label={health.runtimeKind} tone="info" /> : null}
            {manifest?.supportedModes?.map((mode) => (
              <Badge key={mode} label={mode} />
            ))}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setRootsExpanded((prev) => !prev)}
              className="button button-ghost"
              aria-expanded={rootsExpanded}
            >
              {rootsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Roots & manifest raw payload ({roots.length} root{roots.length === 1 ? '' : 's'})
            </button>
            {rootsExpanded ? (
              <div className="stack" style={{ marginTop: 12 }}>
                <JsonViewer value={manifest ?? {}} />
                <JsonViewer value={{ roots }} />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered modes ({modes.length})</CardTitle>
          <CardDescription>
            Each mode is a versioned participant-interaction contract understood by the runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {modes.length === 0 ? (
            <div className="empty-state compact">
              <h4>No modes registered</h4>
              <p>Register a runtime mode via the macp-control-plane admin API to see it here.</p>
            </div>
          ) : (
            <div className="list">
              {modes.map((mode) => (
                <div key={`${mode.mode}-${mode.modeVersion}`} className="list-item">
                  <div className="list-item-title">
                    <code>{mode.mode}</code>
                    <Badge label={mode.modeVersion} tone="info" />
                  </div>
                  <div className="list-item-meta">Participant model: {mode.participantModel ?? 'unspecified'}</div>
                  <div className="list-item-meta">Message types: {mode.messageTypes.join(', ') || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
