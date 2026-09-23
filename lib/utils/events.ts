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

/**
 * Render an event's `subject` for a detail row: `kind:id`, or `—` when there is nothing to show.
 *
 * Extracted because `live-event-feed.tsx` and `app/logs/page.tsx` built this expression identically
 * and both got the empty-id case wrong: the control plane's inline stream-error path emits a subject
 * with a populated `kind` and an **empty** `id` (`event-normalizer.service.ts`), which the old
 * `subject ? \`${kind}:${id}\` : '—'` rendered as a dangling `message:`. A subject with no id
 * identifies nothing, so it is treated the same as an absent one.
 */
export function formatEventSubject(event: CanonicalEvent): string {
  const subject = event.subject;
  if (!subject?.id) return '—';
  return `${subject.kind}:${subject.id}`;
}

/**
 * Merge the fetched event history with the live SSE buffer into one seq-ordered list.
 *
 * Exists because the two sources genuinely overlap and neither is a superset. `useLiveRun` reads its
 * `initialEvents` in a `useState` initializer — at mount only — and the live run route mounts with
 * streaming already enabled, before the history query has settled. So the live buffer never picks the
 * fetched history up, and picking one source over the other drops real events: preferring the live
 * buffer collapses the feed to whatever arrived after mount, preferring the fetched page hides the
 * live tail.
 *
 * Dedups on `id` rather than `seq`, matching the hook's own buffer, because a reconnect replays from
 * the resume cursor and legitimately re-delivers events already held. Sorts by `seq` because the live
 * buffer appends in arrival order, which the control plane does not guarantee matches seq order.
 */
export function mergeEventStreams(fetched: CanonicalEvent[], live: CanonicalEvent[]): CanonicalEvent[] {
  if (!live.length) return fetched;
  if (!fetched.length) return live;
  const byId = new Map(fetched.map((event) => [event.id, event]));
  for (const event of live) byId.set(event.id, event);
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq);
}

/**
 * Pull policy-denial reasons out of an event payload, across every shape that carries them.
 *
 * The control plane nests them under `decodedPayload.reasons` on all **three** deny paths — the
 * ack-error path (`event-normalizer.service.ts:111`), the inline `MACPError` path (`:161`), and the
 * envelope `PolicyDenied` path (`:359-379`, which passes the decoded payload through wholesale). The
 * inline path populates none of `commitmentId`, `decision` or `outcomePositive`, which were the only
 * fields the old shared summary read, so such a denial rendered as the bare string `Policy denied`
 * with the real reasons sitting unread.
 *
 * The top-level fallbacks are not speculative: demo data uses a singular top-level `reason`
 * (`mock-data.ts`, `evt-ops-policy-denied`), and dropping it would make the demo feed less
 * informative than the live one.
 */
function policyDenyReasons(data: Record<string, unknown>): string[] {
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter(
      (reason): reason is string => typeof reason === 'string' && reason.trim() !== ''
    );

  const decoded = data.decodedPayload;
  const nested =
    typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>).reasons : undefined;

  // `reasons` is an array wherever it appears; a non-array there is malformed and is ignored rather
  // than coerced into a single bogus reason. `reason` is the singular demo shape and is a string.
  for (const plural of [nested, data.reasons]) {
    const reasons = strings(plural);
    if (reasons.length > 0) return reasons;
  }
  const singular = data.reason;
  return typeof singular === 'string' && singular.trim() !== '' ? [singular] : [];
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

    // Split out of the shared policy case below. Appending reasons to that block would change the
    // label of `policy.resolved`, `policy.violated` and `policy.commitment.evaluated` too.
    case 'policy.denied': {
      // No `decision` here. All three control-plane deny paths nest it as
      // `decodedPayload.decision` and always as the literal `'deny'`, which says nothing next to the
      // label — and `pick` reads the top level, where nothing ever sets it.
      const reasons = policyDenyReasons(data);
      // Top level is the demo shape; the envelope path nests it instead
      // (`event-normalizer.service.ts:369` builds the subject from `decodedPayload.commitmentId ??
      // decodedPayload.policyId`). Reading only the top level meant the id never rendered on a real
      // denial.
      const decoded = data.decodedPayload;
      const nested = typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : {};
      const commitmentId = pick(data, 'commitmentId') ?? pick(nested, 'commitmentId', 'policyId');
      return ['Policy denied', commitmentId ? `#${commitmentId}` : '', reasons.join('; ')].filter(Boolean).join(' · ');
    }

    case 'session.stream.gap': {
      // Emitted when the control plane could not resume the runtime StreamSession from its last
      // ordinal. The payload is `{ requestedAfter, detail }` — verified against the emit site at
      // `macp-control-plane/src/runs/stream-consumer.service.ts:312-315`, not guessed. `detail`
      // already reads as a sentence, so it is used verbatim rather than re-worded here.
      const detail = pick(data, 'detail');
      const requestedAfter = pick(data, 'requestedAfter');
      return ['Stream history gap', detail, requestedAfter !== undefined ? `resume point ${requestedAfter}` : '']
        .filter(Boolean)
        .join(' · ');
    }

    case 'policy.resolved':
    case 'policy.violated':
    case 'policy.commitment.evaluated': {
      const verb = type.replace('policy.', '').replace('commitment.', 'commitment ');
      const commitmentId = pick(data, 'commitmentId');
      const decision = pick(data, 'decision');
      const outcome = data.outcomePositive;
      // The separator comes from the `join` below, not from this value. It used to be baked in as
      // `' · positive'` and then `.trim()`ed, which strips the space but leaves the bullet — so the
      // join added a second one and the label read `Policy commitment evaluated · · positive`.
      const outcomeStr =
        outcome === true ? 'positive' : outcome === false ? 'negative' : outcome === null ? 'no outcome' : '';
      return [`Policy ${verb}`, commitmentId ? `#${commitmentId}` : '', decision ? `→ ${decision}` : '', outcomeStr]
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
