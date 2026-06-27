'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, Play, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/field';
import { PolicyBadge } from '@/components/ui/policy-badge';
import { JsonViewer } from '@/components/ui/json-viewer';
import { LoadingPanel, ErrorPanel } from '@/components/ui/state-panels';
import {
  compileLaunch,
  createRun,
  getLaunchSchema,
  listPacks,
  listScenarios,
  runExample,
  validateRun
} from '@/lib/api/client';
import { PresetManager } from '@/components/runs/preset-manager';
import { RunPreviewCard } from '@/components/runs/run-preview-card';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import type { CompileLaunchResult } from '@/lib/types';
import type { LaunchPreset } from '@/lib/stores/launch-presets-store';

function parseJsonInput(text: string) {
  try {
    return { value: JSON.parse(text) as Record<string, unknown>, error: '' };
  } catch (error) {
    return { value: undefined, error: String(error) };
  }
}

export default function NewRunPage() {
  return (
    <Suspense>
      <NewRunPageContent />
    </Suspense>
  );
}

function NewRunPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const demoMode = usePreferencesStore((state) => state.demoMode);
  const [packSlug, setPackSlug] = useState(searchParams.get('pack') ?? '');
  const [scenarioSlug, setScenarioSlug] = useState(searchParams.get('scenario') ?? '');
  const [version, setVersion] = useState(searchParams.get('version') ?? '');
  const [templateId, setTemplateId] = useState(searchParams.get('template') ?? '');
  const [mode, setMode] = useState<'live' | 'sandbox'>('live');
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState('{}');
  const [runLabel, setRunLabel] = useState('');
  const [tagsText, setTagsText] = useState('macp-ui,nextjs');
  const [actorId, setActorId] = useState('ajitkoti');
  const [contextIdInput, setContextIdInput] = useState('');
  const [extensionKeysInput, setExtensionKeysInput] = useState('');
  const [compileResult, setCompileResult] = useState<CompileLaunchResult | undefined>();
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | undefined>();
  const [bootstrapResult, setBootstrapResult] = useState<Record<string, unknown> | undefined>();

  const catalogQuery = useQuery({
    queryKey: ['run-launch-catalog', demoMode],
    queryFn: async () => {
      const packs = await listPacks(demoMode);
      return Promise.all(packs.map(async (pack) => ({ pack, scenarios: await listScenarios(pack.slug, demoMode) })));
    }
  });

  useEffect(() => {
    if (!catalogQuery.data?.length) return;

    if (!packSlug) setPackSlug(catalogQuery.data[0].pack.slug);
  }, [catalogQuery.data, packSlug]);

  const scenariosForPack = useMemo(
    () => catalogQuery.data?.find((entry) => entry.pack.slug === packSlug)?.scenarios ?? [],
    [catalogQuery.data, packSlug]
  );

  const selectedScenario = useMemo(
    () => scenariosForPack.find((scenario) => scenario.scenario === scenarioSlug) ?? scenariosForPack[0],
    [scenarioSlug, scenariosForPack]
  );

  useEffect(() => {
    if (!selectedScenario) return;
    if (!scenarioSlug || !scenariosForPack.some((scenario) => scenario.scenario === scenarioSlug)) {
      setScenarioSlug(selectedScenario.scenario);
    }
    if (!version) setVersion(selectedScenario.versions[0] ?? '1.0.0');
    if (!templateId) setTemplateId(selectedScenario.templates[0] ?? 'default');
  }, [scenarioSlug, scenariosForPack, selectedScenario, templateId, version]);

  const schemaQuery = useQuery({
    queryKey: ['launch-schema', packSlug, selectedScenario?.scenario, version, templateId, demoMode],
    queryFn: () => getLaunchSchema(packSlug, selectedScenario!.scenario, version, templateId, demoMode),
    enabled: Boolean(packSlug && selectedScenario?.scenario && version)
  });

  useEffect(() => {
    if (!schemaQuery.data) return;

    setFormValues(schemaQuery.data.defaults ?? {});
    setJsonText(JSON.stringify(schemaQuery.data.defaults ?? {}, null, 2));
  }, [schemaQuery.data]);

  const effectiveInputs = useMemo(() => {
    if (inputMode === 'form') return { value: formValues, error: '' };
    return parseJsonInput(jsonText);
  }, [formValues, inputMode, jsonText]);

  const compileMutation = useMutation({
    mutationFn: async () => {
      const compiled = await compileLaunch(
        {
          scenarioRef: `${packSlug}/${selectedScenario?.scenario}@${version}`,
          templateId,
          mode,
          inputs: effectiveInputs.value ?? {}
        },
        demoMode
      );

      compiled.runDescriptor.execution = {
        ...(compiled.runDescriptor.execution ?? {}),
        tags: tagsText
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        requester: { actorId, actorType: 'user' }
      };
      if (runLabel) {
        compiled.runDescriptor.session.metadata = {
          ...(compiled.runDescriptor.session.metadata ?? {}),
          runLabel
        };
      }
      const trimmedContextId = contextIdInput.trim();
      const trimmedExtensions = extensionKeysInput.trim();
      if (trimmedContextId || trimmedExtensions) {
        compiled.initiator ??= {
          participantId:
            compiled.scenarioMeta.initiatorParticipantId ??
            compiled.runDescriptor.session.participants[0]?.id ??
            'initiator',
          sessionStart: {
            intent: 'launch',
            participants: compiled.runDescriptor.session.participants.map((p) => p.id),
            ttlMs: compiled.runDescriptor.session.ttlMs,
            modeVersion: compiled.runDescriptor.session.modeVersion,
            configurationVersion: compiled.runDescriptor.session.configurationVersion,
            policyVersion: compiled.runDescriptor.session.policyVersion
          }
        };
        if (trimmedContextId) {
          compiled.initiator.sessionStart.contextId = trimmedContextId;
        }
        if (trimmedExtensions) {
          const keys = trimmedExtensions
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
          compiled.initiator.sessionStart.extensions = Object.fromEntries(keys.map((k) => [k, '']));
        }
      }
      setCompileResult(compiled);
      return compiled;
    }
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const compiled = compileResult ?? (await compileMutation.mutateAsync());
      const validation = await validateRun(compiled.runDescriptor as unknown as Record<string, unknown>, demoMode);
      setValidationResult(validation as unknown as Record<string, unknown>);
      return validation;
    }
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const result = await runExample(
        {
          scenarioRef: `${packSlug}/${selectedScenario?.scenario}@${version}`,
          templateId,
          mode,
          inputs: effectiveInputs.value ?? {},
          bootstrapAgents: true
        },
        demoMode
      );
      setBootstrapResult(result as unknown as Record<string, unknown>);
      return result;
    },
    onSuccess: (result) => {
      const sessionId = result.sessionId ?? '';
      if (sessionId) router.push(`/runs/live/${sessionId}`);
    }
  });

  const quickBootstrapMutation = useMutation({
    mutationFn: async () => {
      const result = await runExample(
        {
          scenarioRef: `${packSlug}/${selectedScenario?.scenario}@${version}`,
          templateId,
          mode,
          inputs: effectiveInputs.value ?? {},
          bootstrapAgents: true
        },
        demoMode
      );
      setBootstrapResult(result as unknown as Record<string, unknown>);
      return result;
    },
    onSuccess: (result) => {
      const sessionId = result.sessionId ?? '';
      if (sessionId) router.push(`/runs/live/${sessionId}`);
    }
  });

  if (catalogQuery.isLoading || schemaQuery.isLoading) {
    return (
      <LoadingPanel
        title="Preparing launch experience"
        description="Loading packs, scenarios, launch schema, and default inputs."
      />
    );
  }

  if (catalogQuery.error || !catalogQuery.data?.length || !selectedScenario || schemaQuery.error || !schemaQuery.data) {
    return (
      <ErrorPanel
        message={String(catalogQuery.error ?? schemaQuery.error ?? 'Unable to initialize run creation.')}
        actionHref="/scenarios"
        actionLabel="Open scenarios"
      />
    );
  }

  const schema = schemaQuery.data;
  const schemaProperties = (schema.formSchema.properties ?? {}) as Record<
    string,
    { type?: string; default?: unknown; minimum?: number; maximum?: number }
  >;

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <h1>Launch a new scenario</h1>
          <p>
            Compile launch configuration with Example Service, validate the execution request, and send it to the
            Control Plane.
          </p>
        </div>
        <div className="section-actions">
          <Button
            variant="secondary"
            onClick={() => compileMutation.mutate()}
            disabled={Boolean(effectiveInputs.error) || compileMutation.isPending}
          >
            <CheckCircle2 size={16} />
            {compileMutation.isPending ? 'Compiling...' : 'Compile launch'}
          </Button>
          <Button
            variant="primary"
            onClick={() => submitMutation.mutate()}
            disabled={Boolean(effectiveInputs.error) || submitMutation.isPending}
          >
            <Play size={16} />
            {submitMutation.isPending ? 'Submitting...' : 'Submit run'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Launch configuration</CardTitle>
          <CardDescription>
            Choose the scenario, execution mode, and template before editing the initial payload.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid-3">
          <div>
            <FieldLabel>Pack</FieldLabel>
            <Select
              value={packSlug}
              onChange={(event) => {
                setPackSlug(event.target.value);
                setScenarioSlug('');
                setVersion('');
                setTemplateId('');
              }}
            >
              {catalogQuery.data.map((entry) => (
                <option key={entry.pack.slug} value={entry.pack.slug}>
                  {entry.pack.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Scenario</FieldLabel>
            <Select
              value={selectedScenario.scenario}
              onChange={(event) => {
                setScenarioSlug(event.target.value);
                const scenario = scenariosForPack.find((item) => item.scenario === event.target.value);
                setVersion(scenario?.versions[0] ?? '1.0.0');
                setTemplateId(scenario?.templates[0] ?? 'default');
              }}
            >
              {scenariosForPack.map((scenario) => (
                <option key={scenario.scenario} value={scenario.scenario}>
                  {scenario.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Mode</FieldLabel>
            <Select value={mode} onChange={(event) => setMode(event.target.value as 'live' | 'sandbox')}>
              <option value="live">live</option>
              <option value="sandbox">sandbox</option>
            </Select>
          </div>
          <div>
            <FieldLabel>Version</FieldLabel>
            <Select value={version} onChange={(event) => setVersion(event.target.value)}>
              {selectedScenario.versions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Template</FieldLabel>
            <Select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {selectedScenario.templates.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Input editor</FieldLabel>
            <Select value={inputMode} onChange={(event) => setInputMode(event.target.value as 'form' | 'json')}>
              <option value="form">Schema form</option>
              <option value="json">Raw JSON</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="split-layout">
        <Card>
          <CardHeader>
            <CardTitle>Inputs</CardTitle>
            <CardDescription>
              Switch between a schema-driven form and a raw JSON editor for advanced testing.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            {inputMode === 'form' ? (
              <div className="field-grid">
                {Object.entries(schemaProperties).map(([key, property]) => {
                  const type = property.type ?? 'string';
                  const value = formValues[key];
                  return (
                    <div key={key}>
                      <FieldLabel>{key}</FieldLabel>
                      {type === 'boolean' ? (
                        <label className="switch-row" style={{ width: '100%', justifyContent: 'space-between' }}>
                          <span>{String(value ?? false)}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(value)}
                            onChange={(event) => {
                              const next = { ...formValues, [key]: event.target.checked };
                              setFormValues(next);
                              setJsonText(JSON.stringify(next, null, 2));
                            }}
                          />
                        </label>
                      ) : (
                        <Input
                          type={type === 'number' || type === 'integer' ? 'number' : 'text'}
                          value={String(value ?? '')}
                          min={property.minimum}
                          max={property.maximum}
                          onChange={(event) => {
                            const nextValue =
                              type === 'number' || type === 'integer' ? Number(event.target.value) : event.target.value;
                            const next = { ...formValues, [key]: nextValue };
                            setFormValues(next);
                            setJsonText(JSON.stringify(next, null, 2));
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="stack">
                <Textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} />
                {effectiveInputs.error ? <div className="badge badge-danger">{effectiveInputs.error}</div> : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Advanced options</CardTitle>
            <CardDescription>
              Augment request tags, requester identity, and preset metadata before submission.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div>
              <FieldLabel>Run label</FieldLabel>
              <Input
                value={runLabel}
                onChange={(event) => setRunLabel(event.target.value)}
                placeholder="strict-risk-high-value-checkout"
              />
            </div>
            <div>
              <FieldLabel>Tags</FieldLabel>
              <Input
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="macp-ui,demo,nextjs"
              />
            </div>
            <div>
              <FieldLabel>Requester actor ID</FieldLabel>
              <Input value={actorId} onChange={(event) => setActorId(event.target.value)} placeholder="ajitkoti" />
            </div>
            <div>
              <FieldLabel>Context ID</FieldLabel>
              <Input
                value={contextIdInput}
                onChange={(event) => setContextIdInput(event.target.value)}
                placeholder="ctx:sha256:abc123... (optional)"
              />
            </div>
            <div>
              <FieldLabel>Extension keys</FieldLabel>
              <Input
                value={extensionKeysInput}
                onChange={(event) => setExtensionKeysInput(event.target.value)}
                placeholder="ctxm, billing, audit (comma-separated, optional)"
              />
            </div>
            <div className="inline-list">
              <Badge label={schema.runtime.kind} tone="info" />
              <Badge label={schema.launchSummary.modeName} tone="info" />
              <Badge label={`ttl:${schema.launchSummary.ttlMs}ms`} />
              {schema.launchSummary.policyVersion && <Badge label={schema.launchSummary.policyVersion} tone="info" />}
              {schema.launchSummary.policyHints?.type && <PolicyBadge type={schema.launchSummary.policyHints.type} />}
            </div>
            {schema.launchSummary.policyHints?.description && (
              <p className="muted small">{schema.launchSummary.policyHints.description}</p>
            )}
            <div className="section-actions">
              <Button
                variant="secondary"
                onClick={() => validateMutation.mutate()}
                disabled={Boolean(effectiveInputs.error) || validateMutation.isPending}
              >
                <ShieldCheck size={16} />
                {validateMutation.isPending ? 'Validating...' : 'Validate request'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => quickBootstrapMutation.mutate()}
                disabled={Boolean(effectiveInputs.error) || quickBootstrapMutation.isPending}
              >
                <FlaskConical size={16} />
                {quickBootstrapMutation.isPending ? 'Launching...' : 'Quick Example Service run'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <PresetManager
          onLoad={(preset: LaunchPreset) => {
            setPackSlug(preset.packSlug);
            setScenarioSlug(preset.scenarioSlug);
            setVersion(preset.version);
            setTemplateId(preset.templateId);
            setMode(preset.mode);
            setFormValues(preset.inputs);
            setJsonText(JSON.stringify(preset.inputs, null, 2));
            setTagsText(preset.tags);
            setActorId(preset.actorId);
            setRunLabel(preset.runLabel);
            setContextIdInput(preset.contextId ?? '');
            setExtensionKeysInput(preset.extensionKeys ?? '');
          }}
          currentValues={{
            name: '',
            packSlug,
            scenarioSlug,
            version,
            templateId,
            mode,
            inputs: effectiveInputs.value ?? {},
            tags: tagsText,
            actorId,
            runLabel,
            contextId: contextIdInput,
            extensionKeys: extensionKeysInput
          }}
        />
      </div>

      {compileResult && (
        <RunPreviewCard
          compiled={compileResult}
          onEdit={() => setCompileResult(undefined)}
          onSubmit={() => submitMutation.mutate()}
          isSubmitting={submitMutation.isPending}
        />
      )}

      <div className="grid-2">
        <Card>
          <CardHeader>
            <CardTitle>Compiled execution request</CardTitle>
            <CardDescription>
              Full body to POST into <code>/runs</code> after Example Service compilation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JsonViewer
              value={compileResult ?? { hint: 'Compile to preview the macp-control-plane execution request.' }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation and bootstrap output</CardTitle>
            <CardDescription>
              Review macp-control-plane validation warnings or the example end-to-end bootstrap response.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            {bootstrapResult && typeof bootstrapResult === 'object' && 'sessionId' in bootstrapResult && (
              <div className="inline-list">
                <Badge
                  label={`Session: ${(bootstrapResult as { sessionId?: string }).sessionId ?? ''}`}
                  tone="success"
                />
              </div>
            )}
            <JsonViewer
              value={{ validationResult: validationResult ?? null, bootstrapResult: bootstrapResult ?? null }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
