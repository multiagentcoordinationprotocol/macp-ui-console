import type { CanonicalEvent } from '@/lib/types';
import { isImplicitAccept } from '@/lib/utils/macp';

/**
 * PR-A4 — `summarizeEvent()`
 *
 * Pure, type-aware helper that produces a one-line semantic summary for
 * a canonical event. Consumers (LiveEventFeed row, /logs payload column)
 * drop it in where a raw-JSON snippet used to be, so rows become
 * skim-friendly without losing detail — click the row to open the full
 * payload in a modal.
 *
 * Coverage strategy (per Q11 decision): 6–8 highest-volume types get
 * dedicated summarizers; everything else falls back to a generic
 * `<type> · <subject>` shape.
 *
 * Kept deliberately in `lib/utils/` (not a component) so it's trivially
 * unit-testable and reusable from non-React contexts.
 */

function pick(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function fmtConfidence(data: Record<string, unknown>): string {
  const v = data.confidence;
  if (typeof v !== 'number') return '';
  return ` · conf ${(v * 100).toFixed(0)}%`;
}

export function summarizeEvent(event: CanonicalEvent): string {
  const { type, data } = event;
  const subject = event.subject ? `${event.subject.kind}:${event.subject.id}` : '';

  switch (type) {
    case 'run.created':
    case 'run.started':
    case 'run.completed':
    case 'run.failed':
    case 'run.cancelled':
    case 'run.suspended':
    case 'run.resumed': {
      const status = type.split('.')[1];
      return `Run ${status}${subject ? ` · ${subject}` : ''}`;
    }

    // Real macp-control-plane session vocabulary (control-plane.ts canonical events).
    // Suspend/resume/resolve/expire/cancel transitions all arrive as
    // `session.state.changed` carrying `data.state` (e.g. SESSION_STATE_SUSPENDED).
    case 'session.bound':
    case 'session.stream.opened': {
      const verb = type === 'session.bound' ? 'bound' : 'stream opened';
      const sessionId = pick(data, 'sessionId', 'runtimeSessionId');
      return `Session ${verb}${sessionId ? ` · ${sessionId.slice(0, 8)}…` : ''}`;
    }

    case 'session.state.changed': {
      const state = pick(data, 'state', 'sessionState');
      const label = state ? state.replace(/^SESSION_STATE_/, '') : 'changed';
      const sessionId = pick(data, 'sessionId', 'runtimeSessionId');
      return `Session → ${label}${sessionId ? ` · ${sessionId.slice(0, 8)}…` : ''}`;
    }

    // Legacy session vocabulary — retained so old exports / demo data still summarize.
    case 'session.opened':
    case 'session.resolved':
    case 'session.expired': {
      const state = type.split('.')[1];
      const sessionId = pick(data, 'sessionId', 'runtimeSessionId');
      return `Session ${state}${sessionId ? ` · ${sessionId.slice(0, 8)}…` : ''}`;
    }

    case 'participant.joined':
    case 'participant.left': {
      const verb = type === 'participant.joined' ? 'joined' : 'left';
      const id = pick(data, 'participantId', 'id') ?? subject;
      return `${id} ${verb}`;
    }

    case 'participant.progress': {
      const id = pick(data, 'participantId') ?? subject;
      const pct = typeof data.percentage === 'number' ? ` (${data.percentage}%)` : '';
      const msg = pick(data, 'message');
      return `${id}${pct}${msg ? ` · ${msg}` : ''}`;
    }

    case 'message.sent':
    case 'message.received':
    case 'message.send_failed': {
      const verb = type.replace('message.', '');
      const from = pick(data, 'from', 'sender') ?? '';
      const to = Array.isArray(data.to) ? (data.to as unknown[]).join(', ') : (pick(data, 'to') ?? '');
      const messageType = pick(data, 'messageType', 'kind');
      const arrow = from && to ? `${from} → ${to}` : from || to || '';
      return `${verb}${arrow ? ` · ${arrow}` : ''}${messageType ? ` · ${messageType}` : ''}`;
    }

    case 'signal.emitted':
    case 'signal.acknowledged': {
      const verb = type === 'signal.emitted' ? 'emitted' : 'acknowledged';
      const name = pick(data, 'name', 'signalType') ?? 'signal';
      const severity = pick(data, 'severity');
      return `${name} ${verb}${severity ? ` (${severity})` : ''}${fmtConfidence(data)}`;
    }

    case 'proposal.submitted':
    case 'proposal.accepted':
    case 'proposal.rejected':
    case 'proposal.created':
    case 'proposal.updated': {
      const verb = type.replace('proposal.', '');
      const action = pick(data, 'action');
      const participantId = pick(data, 'participantId', 'sender') ?? '';
      const proposalId = pick(data, 'proposalId');
      return [
        `proposal ${verb}`,
        participantId,
        action ? `→ ${action.toUpperCase()}` : '',
        fmtConfidence(data).trim(),
        proposalId ? `#${proposalId.slice(0, 8)}` : '',
        // Runtime-emitted implicit accept (silent handoff target past the accept window).
        isImplicitAccept(event) ? 'implicit (runtime)' : ''
      ]
        .filter(Boolean)
        .join(' · ');
    }

    case 'decision.proposed':
    case 'decision.finalized': {
      const verb = type === 'decision.proposed' ? 'proposed' : 'finalized';
      const action = pick(data, 'action');
      return `Decision ${verb}${action ? ` → ${action.toUpperCase()}` : ''}${fmtConfidence(data)}`;
    }

    case 'policy.resolved':
    case 'policy.violated':
    case 'policy.denied':
    case 'policy.commitment.evaluated': {
      const verb = type.replace('policy.', '').replace('commitment.', 'commitment ');
      const commitmentId = pick(data, 'commitmentId');
      const decision = pick(data, 'decision');
      const outcome = data.outcomePositive;
      const outcomeStr =
        outcome === true ? ' · positive' : outcome === false ? ' · negative' : outcome === null ? ' · no outcome' : '';
      return [
        `Policy ${verb}`,
        commitmentId ? `#${commitmentId}` : '',
        decision ? `→ ${decision}` : '',
        outcomeStr.trim()
      ]
        .filter(Boolean)
        .join(' · ');
    }

    case 'vote.cast': {
      const voter = pick(data, 'voterId', 'participantId') ?? '';
      const vote = pick(data, 'vote');
      const commitmentId = pick(data, 'commitmentId');
      return [`vote cast`, voter, vote ? `→ ${vote}` : '', commitmentId ? `#${commitmentId}` : '']
        .filter(Boolean)
        .join(' · ');
    }

    case 'tool.call.started':
    case 'tool.call.completed': {
      const verb = type === 'tool.call.started' ? 'called' : 'completed';
      const tool = pick(data, 'name', 'tool', 'toolName') ?? 'tool';
      const participantId = pick(data, 'participantId') ?? '';
      const ms = typeof data.durationMs === 'number' ? ` · ${data.durationMs}ms` : '';
      return `${tool} ${verb}${participantId ? ` · ${participantId}` : ''}${ms}`;
    }

    case 'llm.call.completed': {
      const model = pick(data, 'model') ?? 'model';
      // participantId is carried on `event.subject.id` at wire level;
      // fall back to data for scenarios that copy it through.
      const participantId = event.subject?.id ?? pick(data, 'participantId') ?? '';
      const promptTokens = typeof data.promptTokens === 'number' ? data.promptTokens : undefined;
      const completionTokens = typeof data.completionTokens === 'number' ? data.completionTokens : undefined;
      const totalTokens = typeof data.totalTokens === 'number' ? data.totalTokens : undefined;
      const latency = typeof data.latencyMs === 'number' ? `${data.latencyMs}ms` : undefined;
      const cost = typeof data.estimatedCostUsd === 'number' ? `$${data.estimatedCostUsd.toFixed(4)}` : undefined;
      const tokens =
        totalTokens !== undefined
          ? `Σ${totalTokens}`
          : promptTokens !== undefined && completionTokens !== undefined
            ? `${promptTokens}→${completionTokens}`
            : '';
      return [`LLM call`, participantId, model, tokens, latency, cost].filter(Boolean).join(' · ');
    }

    default: {
      // Generic fallback: use subject and first meaningful string in data.
      const firstString = Object.entries(data).find(
        ([, v]) => typeof v === 'string' && v.length > 0 && v.length < 80
      )?.[1] as string | undefined;
      const tail = firstString ? ` · ${firstString}` : '';
      return subject ? `${type} · ${subject}${tail}` : `${type}${tail}`;
    }
  }
}
