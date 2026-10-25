/**
 * W3.10 — RFC-MACP-0013 Appendix A decision receipts (`macp-receipt/1`).
 *
 * The console issues **unsigned, integrity-only** receipts: signing keys belong to the runtime or
 * another issuer, never to the console, so `attestations` is always `[]`. The receipt is built from
 * the Section 3 projection the control plane's verification endpoint already returns, and its
 * `commitment_hash` is recomputed here (Section 4) rather than copied, so a receipt can never record
 * a hash its own `commitment` does not produce.
 *
 * Local stand-in for `buildReceipt` from `macp-sdk-typescript/receipt` (0.18.0); swap to the SDK
 * once it is published. Schema: multiagentcoordinationprotocol `schemas/json/macp-decision-receipt.schema.json`.
 */

export const RECEIPT_FORMAT = 'macp-receipt/1';
export const COMMITMENT_HASH_LABEL = 'macp-commitment-hash/1';

/** RFC-MACP-0013 §3 hashing projection: snake_case, scalars always materialized. */
export interface CommitmentProjection {
  commitment_id: string;
  action: string;
  authority_scope: string;
  reason: string;
  mode_version: string;
  policy_version: string;
  configuration_version: string;
  outcome_positive: boolean;
  supersedes?: { session_id: string; commitment_hash: string };
}

export interface DecisionReceipt {
  receipt_format: typeof RECEIPT_FORMAT;
  session_id: string;
  mode: string;
  commitment: CommitmentProjection;
  commitment_hash: string;
  issuer: string;
  issued_at: string;
  attestations: [];
}

const STRING_FIELDS = [
  'commitment_id',
  'action',
  'authority_scope',
  'reason',
  'mode_version',
  'policy_version',
  'configuration_version'
] as const;

/**
 * Normalizes a payload to the exact §3 projection: every string field materialized as `""` when
 * missing, `outcome_positive` always a boolean, `supersedes` only when set. Returns `null` when the
 * payload carries a field outside the frozen set — that is *cannot-verify* under §5, and a receipt
 * over it would not be hashable.
 */
export function toCommitmentProjection(payload: Record<string, unknown>): CommitmentProjection | null {
  const allowed = new Set<string>([...STRING_FIELDS, 'outcome_positive', 'supersedes']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const projection = Object.fromEntries(STRING_FIELDS.map((key) => [key, str(payload[key])])) as Omit<
    CommitmentProjection,
    'outcome_positive' | 'supersedes'
  >;
  const result: CommitmentProjection = { ...projection, outcome_positive: payload.outcome_positive === true };
  const supersedes = payload.supersedes;
  if (supersedes && typeof supersedes === 'object') {
    const ref = supersedes as Record<string, unknown>;
    if (Object.keys(ref).some((key) => key !== 'session_id' && key !== 'commitment_hash')) return null;
    result.supersedes = { session_id: str(ref.session_id), commitment_hash: str(ref.commitment_hash) };
  }
  return result;
}

/**
 * RFC 8785 JCS for the subset receipts need: strings, booleans, null, objects, arrays and
 * non-negative safe integers. `JSON.stringify` already escapes strings exactly as §3.2.2.2 requires;
 * keys sort by UTF-16 code units, which is JavaScript's default string order.
 */
export function jcs(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`JCS subset: unsupported number ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${jcs(v)}`).join(',')}}`;
  }
  throw new Error(`JCS subset: unsupported value of type ${typeof value}`);
}

/** RFC-MACP-0013 §4: `sha256:` + hex(SHA-256("macp-commitment-hash/1:" || JCS(projection))). */
export async function commitmentHash(projection: CommitmentProjection): Promise<string> {
  const preimage = new TextEncoder().encode(`${COMMITMENT_HASH_LABEL}:${jcs(projection)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', preimage));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** RFC 3339 UTC without milliseconds, the style the spec's examples use. */
export function rfc3339Utc(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function buildReceipt(
  commitment: CommitmentProjection,
  options: { sessionId: string; mode: string; issuer: string; issuedAt: string }
): Promise<DecisionReceipt> {
  return {
    receipt_format: RECEIPT_FORMAT,
    session_id: options.sessionId,
    mode: options.mode,
    commitment,
    commitment_hash: await commitmentHash(commitment),
    issuer: options.issuer,
    issued_at: options.issuedAt,
    attestations: []
  };
}

export function receiptFilename(sessionId: string): string {
  return `receipt-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}
