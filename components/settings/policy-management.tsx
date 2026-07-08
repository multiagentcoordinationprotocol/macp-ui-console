'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useConfirmation } from '@/lib/hooks/use-confirmation';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/field';
import { JsonViewer } from '@/components/ui/json-viewer';
import { PolicyBadge } from '@/components/ui/policy-badge';
import { listRuntimePolicies, registerRuntimePolicy, unregisterRuntimePolicy } from '@/lib/api/client';
import { isRegistryReadOnlyError } from '@/lib/api/fetcher';
import { formatDateTime } from '@/lib/utils/format';

interface PolicyManagementProps {
  demoMode: boolean;
}

export function PolicyManagement({ demoMode }: PolicyManagementProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirmation = useConfirmation();
  const [modeFilter, setModeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Latches once any mutation reveals a file-managed (read-only) runtime registry
  // (MACP_POLICIES_DIR). Register/unregister RPCs then fail with FAILED_PRECONDITION →
  // CP HTTP 405 REGISTRY_READ_ONLY; rather than a dead-end toast loop, we surface a
  // persistent banner and disable the mutation controls for the session.
  const [registryReadOnly, setRegistryReadOnly] = useState(false);

  const policiesQuery = useQuery({
    queryKey: ['runtime-policies', demoMode, modeFilter],
    queryFn: () => listRuntimePolicies(demoMode, modeFilter || undefined)
  });

  const deleteMutation = useMutation({
    mutationFn: (policyId: string) => unregisterRuntimePolicy(policyId, demoMode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-policies'] });
      toast('success', 'Policy unregistered.');
    },
    onError: (error) => {
      if (isRegistryReadOnlyError(error)) {
        setRegistryReadOnly(true);
        setShowForm(false);
        return;
      }
      toast('error', `Failed to unregister policy.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={18} /> Runtime policies
        </CardTitle>
        <CardDescription>Manage governance policies registered with the control plane runtime.</CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {registryReadOnly && (
          <div
            role="status"
            style={{
              border: '1px solid var(--info)',
              borderRadius: 8,
              padding: '10px 12px',
              background: 'var(--panel-2)'
            }}
          >
            <strong>Policy registry is file-managed (read-only) on this runtime.</strong>
            <div className="muted small" style={{ marginTop: 4 }}>
              This runtime was started with <code>MACP_POLICIES_DIR</code>, so policies are managed on disk. Register
              and unregister are disabled here — edit the policy files and restart the runtime to change them.
            </div>
          </div>
        )}
        <div className="form-row">
          <div>
            <FieldLabel>Filter by mode</FieldLabel>
            <Input
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              placeholder="e.g. macp.mode.decision.v1"
            />
          </div>
          <Button variant="secondary" onClick={() => setShowForm(!showForm)} disabled={registryReadOnly}>
            <Plus size={14} />
            {showForm ? 'Cancel' : 'Register policy'}
          </Button>
        </div>

        {showForm && !registryReadOnly && (
          <RegisterPolicyForm
            demoMode={demoMode}
            onSuccess={() => setShowForm(false)}
            onReadOnly={() => {
              setRegistryReadOnly(true);
              setShowForm(false);
            }}
          />
        )}

        <div className="list">
          {(policiesQuery.data ?? []).map((policy) => (
            <div
              key={policy.policyId}
              className="list-item"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div
                style={{ flex: 1, cursor: 'pointer' }}
                onClick={() => setExpandedId(expandedId === policy.policyId ? null : policy.policyId)}
              >
                <div className="list-item-title">
                  {policy.policyId}
                  <PolicyBadge type={policy.mode.includes('decision') ? 'majority' : 'none'} />
                </div>
                <div className="list-item-meta">
                  {policy.description} · v{policy.schemaVersion}
                  {policy.registeredAtUnixMs
                    ? ` · registered ${formatDateTime(new Date(policy.registeredAtUnixMs).toISOString())}`
                    : ''}
                </div>
                {expandedId === policy.policyId && (
                  <div style={{ marginTop: 8 }}>
                    <JsonViewer value={policy.rules} />
                  </div>
                )}
              </div>
              <div className="section-actions">
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (policy.policyId === 'policy.default') return;
                    const confirmed = await confirmation.confirm({
                      title: 'Unregister policy',
                      description: `Unregister policy "${policy.policyId}"? This cannot be undone.`,
                      confirmLabel: 'Unregister'
                    });
                    if (confirmed) deleteMutation.mutate(policy.policyId);
                  }}
                  disabled={deleteMutation.isPending || policy.policyId === 'policy.default' || registryReadOnly}
                  aria-label={`Unregister policy ${policy.policyId}`}
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {policiesQuery.data?.length === 0 && (
            <div className="empty-state compact">
              <h4>No runtime policies registered</h4>
              <p>Register a policy to enforce governance constraints on runs.</p>
            </div>
          )}
        </div>
      </CardContent>
      <ConfirmationDialog
        open={confirmation.state.open}
        title={confirmation.state.title}
        description={confirmation.state.description}
        confirmLabel={confirmation.state.confirmLabel}
        variant={confirmation.state.variant}
        onConfirm={confirmation.state.onConfirm}
        onCancel={confirmation.cancel}
      />
    </Card>
  );
}

function RegisterPolicyForm({
  demoMode,
  onSuccess,
  onReadOnly
}: {
  demoMode: boolean;
  onSuccess: () => void;
  onReadOnly: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [policyId, setPolicyId] = useState('');
  const [mode, setMode] = useState('macp.mode.decision.v1');
  const [description, setDescription] = useState('');
  const [schemaVersion, setSchemaVersion] = useState('1');
  const [rulesJson, setRulesJson] = useState('{}');
  const [validationError, setValidationError] = useState('');

  const registerMutation = useMutation({
    mutationFn: () => {
      let rules: Record<string, unknown>;
      try {
        rules = JSON.parse(rulesJson);
      } catch {
        throw new Error('Invalid JSON in rules field');
      }
      return registerRuntimePolicy(
        {
          policyId,
          mode,
          description,
          rules,
          schemaVersion: Number(schemaVersion)
        },
        demoMode
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-policies'] });
      setPolicyId('');
      setDescription('');
      setRulesJson('{}');
      toast('success', 'Policy registered successfully.');
      onSuccess();
    },
    onError: (error) => {
      if (isRegistryReadOnlyError(error)) {
        onReadOnly();
        return;
      }
      toast('error', `Registration failed.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
  });

  function validate(): string {
    if (!policyId.trim()) return 'Policy ID is required';
    if (policyId === 'policy.default') return 'Reserved policy ID: policy.default';
    if (!description.trim()) return 'Description is required';
    const sv = Number(schemaVersion);
    if (!Number.isInteger(sv) || sv <= 0) return 'Schema version must be a positive integer';
    try {
      JSON.parse(rulesJson);
    } catch {
      return 'Rules must be valid JSON';
    }
    return '';
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError('');
    registerMutation.mutate();
  }

  return (
    <form className="stack" onSubmit={handleSubmit} style={{ padding: '12px 0', borderTop: `1px solid var(--border)` }}>
      <fieldset disabled={registerMutation.isPending} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="grid-2">
          <div>
            <FieldLabel>Policy ID</FieldLabel>
            <Input value={policyId} onChange={(e) => setPolicyId(e.target.value)} placeholder="policy.my-custom" />
          </div>
          <div>
            <FieldLabel>Target mode</FieldLabel>
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="macp.mode.decision.v1">macp.mode.decision.v1</option>
              <option value="macp.mode.quorum.v1">macp.mode.quorum.v1</option>
            </Select>
          </div>
        </div>
        <div className="grid-2">
          <div>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the policy..."
            />
          </div>
          <div>
            <FieldLabel>Schema version</FieldLabel>
            <Input type="number" value={schemaVersion} onChange={(e) => setSchemaVersion(e.target.value)} min="1" />
          </div>
        </div>
        <div>
          <FieldLabel>Rules (JSON)</FieldLabel>
          <Textarea value={rulesJson} onChange={(e) => setRulesJson(e.target.value)} rows={4} />
        </div>
        {validationError && <div className="error-text">{validationError}</div>}
        {registerMutation.isError && (
          <div className="error-text">
            Registration failed.{registerMutation.error instanceof Error ? ` ${registerMutation.error.message}` : ''}
          </div>
        )}
        <Button type="submit" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? 'Registering...' : 'Register policy'}
        </Button>
      </fieldset>
    </form>
  );
}
