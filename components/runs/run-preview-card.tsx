'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { CompileLaunchResult } from '@/lib/types';
import { formatRelativeDuration } from '@/lib/utils/format';

export function RunPreviewCard({
  compiled,
  onEdit,
  onSubmit,
  isSubmitting
}: {
  compiled: CompileLaunchResult;
  onEdit: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const { runDescriptor, initiator, mode, participantBindings, display } = compiled;
  const session = runDescriptor.session;
  const execution = runDescriptor.execution;
  const sessionStart = initiator?.sessionStart;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review before launch</CardTitle>
        <CardDescription>Confirm the participants, mode, policy, and configuration before submitting.</CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {/* Participants */}
        <div>
          <div className="muted small" style={{ marginBottom: 'var(--space-xs)' }}>
            Participants ({participantBindings.length})
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {participantBindings.map((p) => (
                  <tr key={p.participantId}>
                    <td>
                      <code>{p.participantId}</code>
                    </td>
                    <td>{p.role ?? '—'}</td>
                    <td>
                      <code>{p.agentRef}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Session configuration */}
        <div>
          <div className="muted small" style={{ marginBottom: 'var(--space-xs)' }}>
            Session configuration
          </div>
          <div className="inline-list">
            <Badge label={`Mode: ${session.modeName}`} tone="info" />
            <Badge label={`v${session.modeVersion}`} tone="neutral" />
            {session.policyVersion && <Badge label={`Policy: ${session.policyVersion}`} tone="warning" />}
            {session.ttlMs != null && <Badge label={`TTL: ${formatRelativeDuration(session.ttlMs)}`} tone="neutral" />}
            {sessionStart?.maxSuspendMs != null && (
              <Badge label={`Max suspend: ${formatRelativeDuration(sessionStart.maxSuspendMs)}`} tone="neutral" />
            )}
            <Badge label={mode === 'live' ? 'Live' : 'Sandbox'} tone="neutral" />
          </div>
        </div>

        {/* Context and extensions */}
        {(sessionStart?.contextId || (sessionStart?.extensions && Object.keys(sessionStart.extensions).length > 0)) && (
          <div>
            <div className="muted small" style={{ marginBottom: 'var(--space-xs)' }}>
              Context and extensions
            </div>
            <div className="inline-list">
              {sessionStart?.contextId && <Badge label={`Context: ${sessionStart.contextId}`} tone="neutral" />}
              {sessionStart?.extensions &&
                Object.keys(sessionStart.extensions).map((key) => (
                  <Badge key={key} label={`ext: ${key}`} tone="neutral" />
                ))}
            </div>
          </div>
        )}

        {/* Tags and requester */}
        {(execution?.tags?.length || execution?.requester) && (
          <div>
            <div className="muted small" style={{ marginBottom: 'var(--space-xs)' }}>
              Execution metadata
            </div>
            <div className="inline-list">
              {execution?.requester?.actorId && (
                <Badge label={`Requester: ${execution.requester.actorId}`} tone="neutral" />
              )}
              {(execution?.tags ?? []).map((tag) => (
                <Badge key={tag} label={tag} tone="neutral" />
              ))}
            </div>
          </div>
        )}

        {/* Expected decisions */}
        {display?.expectedDecisionKinds?.length ? (
          <div>
            <div className="muted small" style={{ marginBottom: 'var(--space-xs)' }}>
              Expected decisions
            </div>
            <div className="inline-list">
              {display.expectedDecisionKinds.map((kind) => (
                <Badge key={kind} label={kind} tone="info" />
              ))}
            </div>
          </div>
        ) : null}

        {/* Actions */}
        <div className="section-actions">
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Launching...' : 'Launch run'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
