/**
 * W3.10 — RFC-MACP-0013 Appendix A decision receipts (`macp-receipt/1`).
 *
 * The console issues **unsigned, integrity-only** receipts: signing keys belong to the runtime or
 * another issuer, never to the console, so it never passes a `signer` and `attestations` is `[]`.
 * Building and verifying come from `macp-sdk-typescript/receipt` — the browser-safe subpath; the
 * package root pulls in gRPC and must not be imported from client code. This module adds only what
 * the console needs around it.
 */
import {
  buildReceipt,
  commitmentFromProjection,
  trustedKeysFromJwks,
  verifyReceipt,
  type ReceiptCommitment,
  type ReceiptVerification
} from 'macp-sdk-typescript/receipt';

export {
  buildReceipt,
  commitmentFromProjection,
  verifyReceipt,
  trustedKeysFromJwks,
  RECEIPT_FORMAT
} from 'macp-sdk-typescript/receipt';
export type { DecisionReceipt, ReceiptCommitment, ReceiptVerification } from 'macp-sdk-typescript/receipt';

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

/**
 * W5 U1 — how the console labels a runtime-issued receipt (RFC-MACP-0013 §13):
 * - `attested`: integrity holds and at least one `jws` attestation verifies against the runtime's key set.
 * - `integrity_only`: integrity holds and the receipt is unsigned, from a runtime that does not sign.
 * - `failed`: anything else — integrity broken, a signature that does not verify or names a key the set
 *   lacks, or no verifiable signature from a runtime that advertises `decisionReceipt.signed`. The SDK
 *   calls a receipt with a bad signature `integrity_only`; the console does not, because a signature
 *   that fails is a different finding from no signature at all.
 */
export type RuntimeReceiptVerdict = 'attested' | 'integrity_only' | 'failed';

export interface RuntimeReceiptCheck {
  verdict: RuntimeReceiptVerdict;
  verification: ReceiptVerification;
  /** Why the verdict is `failed`; absent otherwise. */
  reason?: string;
}

/**
 * Verifies the runtime's receipt text against its JWK Set with the SDK. Parses `receiptJson` itself
 * (the exact bytes the runtime issued), never the control plane's pre-parsed copy. Never throws.
 */
export function checkRuntimeReceipt(receiptJson: string, jwks: unknown, signed: boolean): RuntimeReceiptCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(receiptJson);
  } catch {
    parsed = undefined;
  }
  const verification = verifyReceipt(parsed, trustedKeysFromJwks(jwks));
  const fail = (reason: string): RuntimeReceiptCheck => ({ verdict: 'failed', verification, reason });

  if (verification.verdict === 'attested') return { verdict: 'attested', verification };
  if (verification.verdict === 'refused') return fail('The runtime returned something that is not a macp-receipt/1.');
  if (verification.verdict === 'unverified') {
    return fail(
      verification.integrity === 'mismatch'
        ? "The receipt's commitment_hash does not match its commitment."
        : "The receipt's commitment could not be checked against its commitment_hash."
    );
  }
  const invalid = verification.attestations.filter((o) => o === 'invalid').length;
  const unknown = verification.attestations.filter((o) => o === 'unknown_key').length;
  if (invalid > 0) return fail(`The receipt's signature did not verify (${count(invalid)} invalid).`);
  if (unknown > 0) {
    return fail(`The receipt is signed with a key the runtime's key set does not hold (${count(unknown)}).`);
  }
  if (signed) return fail('The runtime advertises signed receipts, but this receipt carries no signature.');
  return { verdict: 'integrity_only', verification };
}

function count(n: number): string {
  return n === 1 ? '1 signature' : `${n} signatures`;
}
