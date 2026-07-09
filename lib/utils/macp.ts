import type { CanonicalEvent, RunRecord, ScenarioSummary } from '@/lib/types';

export function parseScenarioRef(scenarioRef?: string | null) {
  if (!scenarioRef) {
    return { packSlug: undefined, scenarioSlug: undefined, version: undefined };
  }

  const [packAndScenario, version] = scenarioRef.split('@');
  const [packSlug, ...scenarioParts] = packAndScenario.split('/');
  return {
    packSlug,
    scenarioSlug: scenarioParts.join('/'),
    version
  };
}

export function getScenarioRefFromRun(run?: RunRecord | null) {
  return String(run?.metadata?.scenarioRef ?? run?.source?.ref ?? '');
}

export function getRunDurationMs(run?: RunRecord | null) {
  if (!run?.startedAt) return 0;
  const start = new Date(run.startedAt).getTime();
  const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

export function getScenarioName(
  packSlug: string | undefined,
  scenarioSlug: string | undefined,
  scenarios: ScenarioSummary[]
) {
  const match = scenarios.find((scenario) => scenario.scenario === scenarioSlug);
  if (match) return match.name;
  if (!packSlug && !scenarioSlug) return 'Unknown scenario';
  return [packSlug, scenarioSlug].filter(Boolean).join('/');
}

export function optionValue(value: string | undefined, fallback = '') {
  return value ?? fallback;
}

export function unique<T>(items: T[]) {
  return [...new Set(items)];
}

/**
 * Detects a runtime-synthesized *implicit* handoff accept (RFC-MACP-0010 §5.1).
 *
 * When a handoff target stays silent past the accept window, the runtime emits a
 * synthetic `HandoffAccept` with `sender = target_participant`,
 * `messageId = implicit-accept:<handoff_id>`, and `implicit = true` on the decoded
 * payload. The macp-control-plane surfaces it as a normal `proposal.updated` canonical
 * event — so without this marker it looks *exactly* like an explicit accept the target
 * never sent, which is misleading in a transcript.
 *
 * Detection is deliberately defensive: the exact JSON casing the CP emits for the
 * decoded proto and the location of the message id are pinned only loosely by the CP
 * absorption (which carries `decodedPayload.implicit`). We accept both camelCase and
 * snake_case, a top-level flag, and the `implicit-accept:` id prefix on any of the
 * plausible id fields.
 */
export function isImplicitAccept(event: Pick<CanonicalEvent, 'data'> & { id?: string }): boolean {
  const data = (event.data ?? {}) as Record<string, unknown>;

  const decoded = (data.decodedPayload ?? data.decoded_payload) as Record<string, unknown> | undefined;
  if (decoded && (decoded.implicit === true || decoded.implicitAccept === true || decoded.implicit_accept === true)) {
    return true;
  }
  if (data.implicit === true || data.implicitAccept === true || data.implicit_accept === true) {
    return true;
  }

  const idCandidates = [data.messageId, data.message_id, decoded?.handoffId, decoded?.handoff_id, event.id];
  return idCandidates.some((id) => typeof id === 'string' && id.startsWith('implicit-accept:'));
}
