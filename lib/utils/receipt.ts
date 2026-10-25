/**
 * W3.10 — RFC-MACP-0013 Appendix A decision receipts (`macp-receipt/1`).
 *
 * The console issues **unsigned, integrity-only** receipts: signing keys belong to the runtime or
 * another issuer, never to the console, so it never passes a `signer` and `attestations` is `[]`.
 * Building and verifying come from `macp-sdk-typescript/receipt` — the browser-safe subpath; the
 * package root pulls in gRPC and must not be imported from client code. This module adds only what
 * the console needs around it.
 */
import { buildReceipt, commitmentFromProjection, type ReceiptCommitment } from 'macp-sdk-typescript/receipt';

export { buildReceipt, commitmentFromProjection, verifyReceipt, RECEIPT_FORMAT } from 'macp-sdk-typescript/receipt';
export type { DecisionReceipt, ReceiptCommitment } from 'macp-sdk-typescript/receipt';

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
 * Normalizes a control-plane payload to the exact §3 projection: every string field materialized as
 * `""` when missing, `outcome_positive` always a boolean, `supersedes` only when set. Returns `null`
 * when the payload carries a field outside the frozen set — that is *cannot-verify* under §5, and a
 * receipt that silently dropped the field would record a hash of something else.
 */
export function toCommitmentProjection(payload: Record<string, unknown>): ReceiptCommitment | null {
  const allowed = new Set<string>([...STRING_FIELDS, 'outcome_positive', 'supersedes']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  const projection = Object.fromEntries(STRING_FIELDS.map((key) => [key, str(payload[key])])) as Omit<
    ReceiptCommitment,
    'outcome_positive' | 'supersedes'
  >;
  const result: ReceiptCommitment = { ...projection, outcome_positive: payload.outcome_positive === true };
  const supersedes = payload.supersedes;
  if (supersedes && typeof supersedes === 'object') {
    const ref = supersedes as Record<string, unknown>;
    if (Object.keys(ref).some((key) => key !== 'session_id' && key !== 'commitment_hash')) return null;
    result.supersedes = { session_id: str(ref.session_id), commitment_hash: str(ref.commitment_hash) };
  }
  return result;
}

/** RFC-MACP-0013 §4 hash of a §3 projection, computed by the SDK. */
export function projectionHash(projection: ReceiptCommitment): string {
  return buildReceipt(commitmentFromProjection(projection), {
    sessionId: '-',
    mode: '-',
    issuer: '-',
    issuedAt: '1970-01-01T00:00:00Z'
  }).commitment_hash;
}

/** RFC 3339 UTC without milliseconds, the style the spec's examples use. */
export function rfc3339Utc(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function receiptFilename(sessionId: string): string {
  return `receipt-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}
