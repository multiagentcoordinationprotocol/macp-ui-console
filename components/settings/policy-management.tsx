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
import { describeApiError, isRegistryReadOnlyError } from '@/lib/api/fetcher';
import { POLICY_SCHEMA_VERSIONS, type PolicySchemaVersion } from '@/lib/types';
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
  // Defaults to the current authoring version, not to the control plane's own fallback of 1: every
  // sample policy upstream was migrated to schema_version 3 in this window, so 3 is what a new
  // registration should be. The literal union is what keeps `Number(...)` narrowable below.
  const [schemaVersion, setSchemaVersion] = useState<`${PolicySchemaVersion}`>('3');
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
          // Safe by construction: the select's options are exactly the members of the union, so the
          // state can only ever hold '1' | '2' | '3'.
          schemaVersion: Number(schemaVersion) as PolicySchemaVersion
        },
        demoMode
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-policies'] });
      // Belt-and-braces, like the three resets above it: `onSuccess` closes the form and the parent
      // renders it conditionally, so the component unmounts and every field is recreated at its
      // default anyway. Kept so the resets stay complete if the form is ever left open on success.
      setPolicyId('');
      setDescription('');
      setRulesJson('{}');
      setSchemaVersion('3');
      toast('success', 'Policy registered successfully.');
      onSuccess();
    },
    onError: (error) => {
      if (isRegistryReadOnlyError(error)) {
        onReadOnly();
        return;
      }
      // `describeApiError` reads the control plane's `message` field, so a rejection renders as
      // "schemaVersion must be one of 1, 2, 3" rather than the raw `{"statusCode":400,...}` body
      // that `error.message` carries. Nest's validation errors use the framework-default envelope
      // with no `errorCode`, so `message` is the only usable prose in them.
      toast('error', `Registration failed. ${describeApiError(error)}`);
    }
  });

  function validate(): string {
    if (!policyId.trim()) return 'Policy ID is required';
    if (policyId === 'policy.default') return 'Reserved policy ID: policy.default';
    if (!description.trim()) return 'Description is required';
    // No schema-version check: the control is a select over exactly the accepted values, so an
    // invalid one is unrepresentable rather than merely rejected.
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
            {/* Same reason as the schema-version select below: `FieldLabel` emits no htmlFor, so
                without this the control has no accessible name at all. */}
            <Select aria-label="Target mode" value={mode} onChange={(e) => setMode(e.target.value)}>
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
            {/* A select, not a number input: the control plane accepts only 1, 2 or 3, and a free
                number field lets an operator type 4 and learn the constraint from a failed round
                trip. `FieldLabel` emits a bare <label> with no htmlFor, so the accessible name has
                to come from aria-label. */}
            <Select
              aria-label="Schema version"
              value={schemaVersion}
              onChange={(e) => setSchemaVersion(e.target.value as `${PolicySchemaVersion}`)}
            >
              {/* Driven off the constant the type is derived from, so the options and the union
                  cannot drift — adding a 4th option means widening the union, which is where the
                  change belongs. A hand-written list would sail past tsc thanks to the cast below. */}
              {POLICY_SCHEMA_VERSIONS.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <FieldLabel>Rules (JSON)</FieldLabel>
          <Textarea value={rulesJson} onChange={(e) => setRulesJson(e.target.value)} rows={4} />
        </div>
        {validationError && <div className="error-text">{validationError}</div>}
        {registerMutation.isError && (
          <div className="error-text">Registration failed. {describeApiError(registerMutation.error)}</div>
        )}
        <Button type="submit" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? 'Registering...' : 'Register policy'}
        </Button>
      </fieldset>
    </form>
  );
}
