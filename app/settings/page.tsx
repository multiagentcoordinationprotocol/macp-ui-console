'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, Trash2, Webhook } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useConfirmation } from '@/lib/hooks/use-confirmation';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FieldLabel, Input, Select } from '@/components/ui/field';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import {
  createWebhook,
  deleteWebhook,
  getAuditLogs,
  getRuntimeHealth,
  getWebhooks,
  resetCircuitBreaker,
  updateWebhook
} from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { formatDateTime } from '@/lib/utils/format';

export default function SettingsPage() {
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const setDemoMode = usePreferencesStore((state) => state.setDemoMode);
  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const autoFollow = usePreferencesStore((state) => state.autoFollow);
  const setAutoFollow = usePreferencesStore((state) => state.setAutoFollow);
  const showCriticalPath = usePreferencesStore((state) => state.showCriticalPath);
  const setShowCriticalPath = usePreferencesStore((state) => state.setShowCriticalPath);
  const showParallelBranches = usePreferencesStore((state) => state.showParallelBranches);
  const setShowParallelBranches = usePreferencesStore((state) => state.setShowParallelBranches);
  const replaySpeed = usePreferencesStore((state) => state.replaySpeed);
  const setReplaySpeed = usePreferencesStore((state) => state.setReplaySpeed);
  const logsDensity = usePreferencesStore((state) => state.logsDensity);
  const setLogsDensity = usePreferencesStore((state) => state.setLogsDensity);

  const [webhookUrl, setWebhookUrl] = useState('https://example.com/hooks/macp');
  const [webhookSecret, setWebhookSecret] = useState('change-me');
  const [webhookEvents, setWebhookEvents] = useState('run.completed,run.failed,signal.emitted');
  const [auditActor, setAuditActor] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditResource, setAuditResource] = useState('');
  const [auditResourceId, setAuditResourceId] = useState('');
  const [auditAfter, setAuditAfter] = useState('');
  const [auditBefore, setAuditBefore] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const auditLimit = 10;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirmation = useConfirmation();
  const webhooksQuery = useQuery({ queryKey: ['settings-webhooks', demoMode], queryFn: () => getWebhooks(demoMode) });
  const auditQuery = useQuery({
    queryKey: [
      'settings-audit',
      demoMode,
      auditActor,
      auditAction,
      auditResource,
      auditResourceId,
      auditAfter,
      auditBefore,
      auditOffset
    ],
    queryFn: () =>
      getAuditLogs(demoMode, {
        actor: auditActor || undefined,
        action: auditAction || undefined,
        resource: auditResource || undefined,
        resourceId: auditResourceId || undefined,
        createdAfter: auditAfter || undefined,
        createdBefore: auditBefore || undefined,
        limit: auditLimit,
        offset: auditOffset
      })
  });
  const healthQuery = useQuery({ queryKey: ['settings-health', demoMode], queryFn: () => getRuntimeHealth(demoMode) });

  const createWebhookMutation = useMutation({
    mutationFn: () =>
      createWebhook(
        {
          url: webhookUrl,
          secret: webhookSecret,
          events: webhookEvents
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        },
        demoMode
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-webhooks'] });
      toast('success', 'Webhook created successfully.');
    },
    onError: (error) => {
      toast('error', `Failed to create webhook.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => deleteWebhook(id, demoMode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-webhooks'] });
      toast('success', 'Webhook removed.');
    },
    onError: (error) => {
      toast('error', `Failed to remove webhook.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const toggleWebhookMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateWebhook(id, { active }, demoMode),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['settings-webhooks'] });
      toast('success', `Webhook ${variables.active ? 'resumed' : 'paused'}.`);
    },
    onError: (error) => {
      toast('error', `Failed to update webhook.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const resetBreakerMutation = useMutation({
    mutationFn: () => resetCircuitBreaker(demoMode),
    onSuccess: () => {
      toast('success', 'Circuit breaker reset.');
    },
    onError: (error) => {
      toast('error', `Failed to reset circuit breaker.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  const preferencePayload = useMemo(
    () => ({ theme, demoMode, autoFollow, showCriticalPath, showParallelBranches, replaySpeed, logsDensity }),
    [autoFollow, demoMode, logsDensity, replaySpeed, showCriticalPath, showParallelBranches, theme]
  );

  if (webhooksQuery.isLoading || auditQuery.isLoading || healthQuery.isLoading) {
    return (
      <LoadingPanel
        title="Loading settings"
        description="Reading preferences, webhook subscriptions, audit entries, and runtime status."
      />
    );
  }
  if (webhooksQuery.error || auditQuery.error || healthQuery.error || !healthQuery.data) {
    const errors = [
      webhooksQuery.error ? `Webhooks: ${String(webhooksQuery.error)}` : '',
      auditQuery.error ? `Audit: ${String(auditQuery.error)}` : '',
      healthQuery.error ? `Health: ${String(healthQuery.error)}` : '',
      !healthQuery.data && !healthQuery.error ? 'Runtime health data is unavailable.' : ''
    ]
      .filter(Boolean)
      .join(' · ');
    return <ErrorPanel message={errors} actionHref="/" />;
  }

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Settings and integrations</h1>
          <p>
            Adjust console behavior, manage webhook subscriptions, and trigger operational actions against the Control
            Plane.
          </p>
        </div>
      </div>

      <div className="split-layout">
        <Card>
          <CardHeader>
            <CardTitle>Console preferences</CardTitle>
            <CardDescription>Persisted in local storage for the current browser session.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="field-grid">
              <div>
                <FieldLabel>Theme</FieldLabel>
                <Select value={theme} onChange={(event) => setTheme(event.target.value as 'dark' | 'light')}>
                  <option value="dark">dark</option>
                  <option value="light">light</option>
                </Select>
              </div>
              <div>
                <FieldLabel>Replay speed</FieldLabel>
                <Select value={String(replaySpeed)} onChange={(event) => setReplaySpeed(Number(event.target.value))}>
                  <option value="0.5">0.5x</option>
                  <option value="1">1x</option>
                  <option value="2">2x</option>
                  <option value="4">4x</option>
                </Select>
              </div>
              <div>
                <FieldLabel>Log density</FieldLabel>
                <Select
                  value={logsDensity}
                  onChange={(event) => setLogsDensity(event.target.value as 'compact' | 'comfortable')}
                >
                  <option value="comfortable">comfortable</option>
                  <option value="compact">compact</option>
                </Select>
              </div>
              <div className="stack">
                <label className="switch-row">
                  <input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} />
                  <span>Demo mode</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={autoFollow}
                    onChange={(event) => setAutoFollow(event.target.checked)}
                  />
                  <span>Auto-follow active node</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={showCriticalPath}
                    onChange={(event) => setShowCriticalPath(event.target.checked)}
                  />
                  <span>Animate critical path</span>
                </label>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={showParallelBranches}
                    onChange={(event) => setShowParallelBranches(event.target.checked)}
                  />
                  <span>Show parallel branches</span>
                </label>
              </div>
            </div>
            <JsonViewer value={preferencePayload} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runtime + integration status</CardTitle>
            <CardDescription>
              Current runtime health plus environment-aware notes for Example Service and Control Plane integration.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="inline-list">
              <Badge
                label={healthQuery.data.ok ? 'healthy' : 'degraded'}
                tone={healthQuery.data.ok ? 'success' : 'danger'}
              />
              <Badge label={healthQuery.data.runtimeKind} tone="info" />
              <Badge label={process.env.NEXT_PUBLIC_MACP_ENVIRONMENT_LABEL ?? 'local-dev'} />
            </div>
            <div className="list-item">
              <div className="list-item-title">Proxy routing</div>
              <div className="list-item-meta">
                Client traffic is routed through <code>/api/proxy/[service]/...</code> to avoid leaking secrets to the
                browser.
              </div>
            </div>
            <div className="list-item">
              <div className="list-item-title">Expected secrets</div>
              <div className="list-item-meta">
                Set MACP_PLAYGROUND_BASE_URL / MACP_PLAYGROUND_API_KEY and MACP_CONTROL_PLANE_BASE_URL /
                MACP_CONTROL_PLANE_API_KEY in <code>.env.local</code>.
              </div>
            </div>
            <JsonViewer value={healthQuery.data} />
          </CardContent>
        </Card>
      </div>

      <div className="split-layout">
        <Card>
          <CardHeader>
            <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Webhook size={18} /> Webhooks
            </CardTitle>
            <CardDescription>Manage subscriptions to run lifecycle events and emitted signals.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="field-grid">
              <div>
                <FieldLabel>Webhook URL</FieldLabel>
                <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} />
              </div>
              <div>
                <FieldLabel>Secret</FieldLabel>
                <Input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} />
              </div>
            </div>
            <div>
              <FieldLabel>Events</FieldLabel>
              <Input value={webhookEvents} onChange={(event) => setWebhookEvents(event.target.value)} />
            </div>
            <div className="section-actions">
              <Button
                variant="secondary"
                onClick={() => createWebhookMutation.mutate()}
                disabled={createWebhookMutation.isPending}
              >
                Create webhook
              </Button>
              <Button
                variant="ghost"
                onClick={() => resetBreakerMutation.mutate()}
                disabled={resetBreakerMutation.isPending}
              >
                <RotateCcw size={16} />
                Reset circuit breaker
              </Button>
            </div>
            <div className="list">
              {(webhooksQuery.data ?? []).map((webhook) => (
                <div
                  key={webhook.id}
                  className="list-item"
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}
                >
                  <div>
                    <div className="list-item-title">
                      {webhook.url}
                      <Badge
                        label={webhook.active ? 'active' : 'paused'}
                        tone={webhook.active ? 'success' : 'neutral'}
                      />
                    </div>
                    <div className="list-item-meta">
                      {webhook.events.join(', ')} · created {formatDateTime(webhook.createdAt)}
                      {webhook.deliveryStats ? (
                        <span>
                          {' '}
                          · {webhook.deliveryStats.succeeded}/{webhook.deliveryStats.total} delivered
                          {webhook.deliveryStats.failed > 0 ? ` (${webhook.deliveryStats.failed} failed)` : ''}
                          {webhook.deliveryStats.lastDeliveredAt
                            ? ` · last ${formatDateTime(webhook.deliveryStats.lastDeliveredAt)}`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="section-actions">
                    <Button
                      variant="secondary"
                      onClick={() => toggleWebhookMutation.mutate({ id: webhook.id, active: !webhook.active })}
                      disabled={toggleWebhookMutation.isPending}
                      aria-label={webhook.active ? `Pause webhook ${webhook.url}` : `Resume webhook ${webhook.url}`}
                    >
                      {webhook.active ? <Pause size={14} /> : <Play size={14} />}
                      {webhook.active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        const confirmed = await confirmation.confirm({
                          title: 'Remove webhook',
                          description: `Remove the subscription to ${webhook.url}? This cannot be undone.`,
                          confirmLabel: 'Remove'
                        });
                        if (confirmed) deleteWebhookMutation.mutate(webhook.id);
                      }}
                      disabled={deleteWebhookMutation.isPending}
                      aria-label={`Remove webhook ${webhook.url}`}
                    >
                      <Trash2 size={16} />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {resetBreakerMutation.data ? <JsonViewer value={resetBreakerMutation.data} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit trail</CardTitle>
            <CardDescription>Recent administrative actions routed through the control plane.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="grid-3">
              <div>
                <FieldLabel>Actor</FieldLabel>
                <Input
                  value={auditActor}
                  onChange={(e) => {
                    setAuditActor(e.target.value);
                    setAuditOffset(0);
                  }}
                  placeholder="Filter by actor"
                />
              </div>
              <div>
                <FieldLabel>Action</FieldLabel>
                <Select
                  value={auditAction}
                  onChange={(e) => {
                    setAuditAction(e.target.value);
                    setAuditOffset(0);
                  }}
                >
                  <option value="">All actions</option>
                  <option value="run.create">run.create</option>
                  <option value="run.archive">run.archive</option>
                  <option value="run.cancel">run.cancel</option>
                  <option value="run.delete">run.delete</option>
                  <option value="webhook.create">webhook.create</option>
                  <option value="webhook.delete">webhook.delete</option>
                  <option value="circuit_breaker.reset">circuit_breaker.reset</option>
                  <option value="policy.register">policy.register</option>
                  <option value="policy.delete">policy.delete</option>
                </Select>
              </div>
              <div>
                <FieldLabel>Resource</FieldLabel>
                <Select
                  value={auditResource}
                  onChange={(e) => {
                    setAuditResource(e.target.value);
                    setAuditOffset(0);
                  }}
                >
                  <option value="">All resources</option>
                  <option value="run">run</option>
                  <option value="webhook">webhook</option>
                  <option value="circuit-breaker">circuit-breaker</option>
                  <option value="policy">policy</option>
                </Select>
              </div>
            </div>
            <div className="grid-3">
              <div>
                <FieldLabel>Resource ID</FieldLabel>
                <Input
                  value={auditResourceId}
                  onChange={(e) => {
                    setAuditResourceId(e.target.value);
                    setAuditOffset(0);
                  }}
                  placeholder="Filter by resource ID"
                />
              </div>
              <div>
                <FieldLabel>Created after</FieldLabel>
                <Input
                  type="date"
                  value={auditAfter}
                  onChange={(e) => {
                    setAuditAfter(e.target.value);
                    setAuditOffset(0);
                  }}
                />
              </div>
              <div>
                <FieldLabel>Created before</FieldLabel>
                <Input
                  type="date"
                  value={auditBefore}
                  onChange={(e) => {
                    setAuditBefore(e.target.value);
                    setAuditOffset(0);
                  }}
                />
              </div>
            </div>
            <div className="timeline-list">
              {(auditQuery.data?.data ?? []).map((entry, index) => (
                <div key={`${entry.action}-${index}`} className="timeline-item">
                  <div className="list-item-title">{entry.action}</div>
                  <div className="list-item-meta">
                    {entry.actor} · {entry.actorType} · {formatDateTime(entry.createdAt)}
                  </div>
                  <div className="muted small">
                    {entry.resource}
                    {entry.resourceId ? ` / ${entry.resourceId}` : ''}
                  </div>
                </div>
              ))}
            </div>
            <div className="section-actions">
              <Button
                variant="ghost"
                disabled={auditOffset === 0}
                onClick={() => setAuditOffset(Math.max(0, auditOffset - auditLimit))}
              >
                Previous
              </Button>
              <span className="muted small">
                Showing {auditOffset + 1}–{auditOffset + (auditQuery.data?.data.length ?? 0)} of{' '}
                {auditQuery.data?.total ?? '?'}
              </span>
              <Button
                variant="ghost"
                disabled={(auditQuery.data?.data.length ?? 0) < auditLimit}
                onClick={() => setAuditOffset(auditOffset + auditLimit)}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      {/* PolicyManagement moved to /policies per Q4/Q28/Q29 decisions. */}
      <ConfirmationDialog
        open={confirmation.state.open}
        title={confirmation.state.title}
        description={confirmation.state.description}
        confirmLabel={confirmation.state.confirmLabel}
        variant={confirmation.state.variant}
        onConfirm={confirmation.state.onConfirm}
        onCancel={confirmation.cancel}
      />
    </div>
  );
}
