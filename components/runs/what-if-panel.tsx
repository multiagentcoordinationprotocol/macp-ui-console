'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/field';
import { getRuntimeCapabilities, getRuntimePolicy, runWhatIf } from '@/lib/api/client';
import { ApiError, describeApiError } from '@/lib/api/fetcher';
import {
  POLICY_SCHEMA_VERSIONS,
  type PolicySchemaVersion,
  type WhatIfCandidate,
  type WhatIfDetails,
  type WhatIfEntry,
  type WhatIfEntryOutcome,
  type WhatIfOutcome,
  type WhatIfResult
} from '@/lib/types';
import { cn } from '@/lib/utils/cn';

/**
 * W4.1 — what-if replay (RFC-MACP-0012 §8.1).
 *
 * Replays the run's accepted session history under a candidate policy and shows both outcomes side
 * by side: one row per accepted history entry, rows the two policies handled differently
 * highlighted, scrolled to the first divergence. Read-only — the candidate is never registered and
 * the session is untouched. Offered only when the runtime advertises
 * `policyRegistry.whatIfReplay`; the control plane enforces the same gate (501), so a stale
 * capability answer fails cleanly rather than silently.
 */

const DEFAULT_POLICY_ID = 'policy.default';

type Tone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const STATE_TONE: Record<string, Tone> = {
  RESOLVED: 'success',
  OPEN: 'info',
  SUSPENDED: 'warning',
  EXPIRED: 'warning',
  CANCELLED: 'danger'
};

const KIND_TONE: Record<WhatIfEntryOutcome['kind'], Tone> = {
  APPLIED: 'success',
  NOT_OPEN: 'neutral',
  REFUSED: 'danger',
  NO_SESSION: 'neutral'
};

/** Sentences for the error codes a user can act on; everything else falls back to the CP message. */
export function describeWhatIfError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.errorCode) {
      case 'HISTORY_UNAVAILABLE':
        return "This session's history was compacted when it ended. What-if needs a runtime with MACP_COMPACT_TERMINAL_LOGS=0, and only covers sessions that end after that.";
      case 'INVALID_POLICY_DEFINITION':
        return `The candidate policy was rejected: ${(error.detail ?? 'invalid policy definition').replace(/^INVALID_POLICY_DEFINITION:\s*/, '')}`;
      case 'VALIDATION_ERROR':
        return `The request was malformed: ${error.detail ?? 'validation failed'}`;
      case 'WHAT_IF_REPLAY_UNSUPPORTED':
        return 'The connected runtime does not support what-if replay (needs macp-runtime 0.10 or later).';
      case 'RUNTIME_UNAVAILABLE':
        return 'The runtime is unreachable right now. Try again shortly.';
      case 'FORBIDDEN':
        return 'The control plane does not allow this caller to replay this session.';
      case 'RATE_LIMITED':
        return 'Too many what-if requests. Wait a few minutes and try again.';
    }
    if (error.status === 404) return 'This run or its runtime session no longer exists.';
    if (error.status === 429) return 'Too many what-if requests from this browser. Wait a few minutes and try again.';
    if (error.status === 500 && error.errorCode === 'INTERNAL_ERROR') {
      return `The runtime could not replay the recorded history faithfully. This is a bug worth reporting, not a problem with the candidate: ${error.detail ?? ''}`.trim();
    }
  }
  return describeApiError(error);
}

function outcomeDiffers(entry: WhatIfEntry): boolean {
  const { recorded: r, candidate: c } = entry;
  return r.kind !== c.kind || r.state !== c.state || r.errorCode !== c.errorCode;
}

function parseRules(text: string): { rules?: Record<string, unknown>; error?: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Rules must be a JSON object.' };
    return { rules: value as Record<string, unknown> };
  } catch (error) {
    return { error: `Rules are not valid JSON: ${(error as Error).message}` };
  }
}

export function WhatIfPanel({
  runId,
  demoMode,
  modeName,
  recordedPolicyId
}: {
  runId: string;
  demoMode: boolean;
  modeName?: string;
  /** Policy the session ran under — its rules prefill the candidate editor. */
  recordedPolicyId?: string;
}) {
  const capabilities = useQuery({
    queryKey: ['runtime-capabilities', demoMode],
    queryFn: () => getRuntimeCapabilities(demoMode),
    staleTime: 5 * 60_000,
    retry: false
  });
  if (capabilities.data?.capabilities?.policyRegistry?.whatIfReplay !== true) return null;
  return <WhatIfEditor runId={runId} demoMode={demoMode} modeName={modeName} recordedPolicyId={recordedPolicyId} />;
}

function WhatIfEditor({
  runId,
  demoMode,
  modeName,
  recordedPolicyId
}: {
  runId: string;
  demoMode: boolean;
  modeName?: string;
  recordedPolicyId?: string;
}) {
  // A session started without a policy runs under the runtime's `policy.default`, and its run state
  // then carries no policy projection — prefill from that rather than an empty object.
  const prefillPolicyId = recordedPolicyId || DEFAULT_POLICY_ID;
  const recordedPolicy = useQuery({
    queryKey: ['runtime-policy', prefillPolicyId, demoMode],
    queryFn: () => getRuntimePolicy(prefillPolicyId, demoMode),
    retry: false
  });

  const [rulesText, setRulesText] = useState<string | null>(null);
  const [schemaVersion, setSchemaVersion] = useState<PolicySchemaVersion>(3);
  const [anyMode, setAnyMode] = useState(false);
  const [policyId, setPolicyId] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Prefill once with the recorded policy's rules, so the natural first edit is a small change.
  const prefill = recordedPolicy.data ? JSON.stringify(recordedPolicy.data.rules, null, 2) : '{}';
  const text = rulesText ?? prefill;

  const mutation = useMutation({
    mutationFn: (candidate: WhatIfCandidate) => runWhatIf(runId, candidate, demoMode)
  });

  function submit() {
    const parsed = parseRules(text);
    if (!parsed.rules) {
      setInputError(parsed.error ?? 'Invalid rules.');
      return;
    }
    setInputError(null);
    mutation.mutate({
      rules: parsed.rules,
      schemaVersion,
      ...(anyMode ? { mode: '*' } : {}),
      ...(policyId.trim() ? { policyId: policyId.trim() } : {})
    });
  }

  return (
    <Card data-testid="what-if-panel">
      <CardHeader>
        <CardTitle>What if a different policy had governed this run?</CardTitle>
        <CardDescription>
          Replays this session&apos;s recorded messages under a candidate policy and compares each step. Read-only: the
          candidate is not registered and the run is not changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        <div className="form-row">
          <div className="stack">
            <FieldLabel>Schema version</FieldLabel>
            <Select
              aria-label="Schema version"
              value={schemaVersion}
              onChange={(event) => setSchemaVersion(Number(event.target.value) as PolicySchemaVersion)}
            >
              {POLICY_SCHEMA_VERSIONS.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </Select>
          </div>
          <div className="stack">
            <FieldLabel>Candidate label (optional)</FieldLabel>
            <Input
              aria-label="Candidate label"
              placeholder="e.g. unanimous-trial"
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
            />
          </div>
        </div>
        <label className="what-if-checkbox">
          <input type="checkbox" checked={anyMode} onChange={(event) => setAnyMode(event.target.checked)} />
          Apply to any mode (<code>*</code>) instead of {modeName ? <code>{modeName}</code> : "the session's mode"}
        </label>
        <div className="stack">
          <FieldLabel>Candidate rules (JSON)</FieldLabel>
          <Textarea
            aria-label="Candidate rules"
            rows={10}
            spellCheck={false}
            value={text}
            onChange={(event) => setRulesText(event.target.value)}
          />
          <span className="muted">
            Prefilled from {recordedPolicyId ? 'the recorded policy' : 'the runtime default'}{' '}
            <code>{prefillPolicyId}</code>
            {recordedPolicy.isError ? ' (could not be loaded; start from {} instead)' : ''}.
          </span>
        </div>
        <div className="section-actions">
          <Button onClick={submit} disabled={mutation.isPending}>
            <FlaskConical size={16} /> {mutation.isPending ? 'Replaying…' : 'Run what-if'}
          </Button>
        </div>
        {inputError ? (
          <p role="alert" className="what-if-error">
            {inputError}
          </p>
        ) : null}
        {mutation.isError ? (
          <p role="alert" className="what-if-error">
            {describeWhatIfError(mutation.error)}
          </p>
        ) : null}
        {mutation.data ? <WhatIfDiff result={mutation.data} /> : null}
      </CardContent>
    </Card>
  );
}

function OutcomeSummary({ title, policyId, outcome }: { title: string; policyId: string; outcome: WhatIfOutcome }) {
  const action = typeof outcome.resolution?.action === 'string' ? outcome.resolution.action : null;
  return (
    <div className="what-if-outcome">
      <span className="muted">{title}</span>
      <strong>{policyId || '(unnamed candidate)'}</strong>
      <div className="section-actions">
        {outcome.state ? (
          <Badge label={outcome.state} tone={STATE_TONE[outcome.state] ?? 'neutral'} />
        ) : (
          <Badge label="No session" tone="danger" />
        )}
        {action ? <Badge label={`action: ${action}`} tone="neutral" /> : null}
      </div>
      {outcome.state === null ? (
        <span className="muted">The candidate refused SessionStart, so no session would have existed.</span>
      ) : outcome.resolvedBy ? (
        <span className="muted">
          Resolved by {outcome.resolvedBy.messageType} #{outcome.resolvedBy.historyIndex}
        </span>
      ) : (
        <span className="muted">Never resolved.</span>
      )}
    </div>
  );
}

function EntryCell({ outcome }: { outcome: WhatIfEntryOutcome }) {
  return (
    <div className="what-if-cell">
      <Badge label={outcome.kind} tone={KIND_TONE[outcome.kind]} />
      {outcome.state ? <span className="muted">→ {outcome.state}</span> : null}
      {outcome.errorCode ? <code>{outcome.errorCode}</code> : null}
      <DenialDetails details={outcome.details} />
    </div>
  );
}

function DenialDetails({ details }: { details: WhatIfDetails | null }) {
  if (!details) return null;
  return (
    <ul className="what-if-denials">
      {details.denials?.map((denial, index) => (
        <li key={`${denial.code}-${index}`}>
          <code>{denial.code}</code> {denial.message}
          {denial.participants?.length ? <span className="muted"> ({denial.participants.join(', ')})</span> : null}
        </li>
      ))}
      {!details.denials?.length
        ? details.reasons?.map((reason, index) => <li key={`reason-${index}`}>{reason}</li>)
        : null}
    </ul>
  );
}

export function WhatIfDiff({ result }: { result: WhatIfResult }) {
  const divergenceRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    divergenceRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [result]);

  const identical = result.firstDivergence === null;
  return (
    <div className="stack" data-testid="what-if-result">
      <div className="grid-2">
        <OutcomeSummary title="Recorded" policyId={result.recordedPolicyId} outcome={result.recorded} />
        <OutcomeSummary title="Candidate" policyId={result.candidatePolicyId} outcome={result.candidate} />
      </div>
      {identical ? (
        <p className="what-if-banner" data-testid="what-if-identical">
          No difference: the candidate handles every message exactly as the recorded policy did.
        </p>
      ) : (
        <p className="what-if-banner what-if-banner-diverged">
          First divergence at history entry #{result.firstDivergence}.
        </p>
      )}
      <div className="table-wrap what-if-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Message</th>
              <th>Recorded</th>
              <th>Candidate</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.map((entry) => {
              const differs = outcomeDiffers(entry);
              const isFirst = entry.historyIndex === result.firstDivergence;
              return (
                <tr
                  key={entry.historyIndex}
                  ref={isFirst ? divergenceRef : undefined}
                  className={cn(differs && 'what-if-row-diverged')}
                  data-diverged={differs || undefined}
                >
                  <td>{entry.historyIndex}</td>
                  <td>
                    <div className="what-if-cell">
                      <strong>{entry.messageType}</strong>
                      <code className="muted">{entry.messageId}</code>
                    </div>
                  </td>
                  <td>
                    <EntryCell outcome={entry.recorded} />
                  </td>
                  <td>
                    <EntryCell outcome={entry.candidate} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {result.denials.length > 0 ? (
        <div className="stack">
          <strong>Candidate denials ({result.denials.length})</strong>
          <ul className="what-if-denials">
            {result.denials.map((denial) => (
              <li key={`${denial.historyIndex}-${denial.messageId}`}>
                Entry #{denial.historyIndex} <code>{denial.messageId}</code>
                <DenialDetails details={denial.details} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
