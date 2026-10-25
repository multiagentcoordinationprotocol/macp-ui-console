import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@/test/fixtures/receipt/macp-decision-receipt.schema.json';
import vector002 from '@/test/fixtures/receipt/receipt_002_integrity_only.json';
import {
  buildReceipt,
  commitmentFromProjection,
  projectionHash,
  receiptFilename,
  rfc3339Utc,
  toCommitmentProjection,
  verifyReceipt,
  type ReceiptCommitment
} from './receipt';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

/** RFC-MACP-0013 §11 vectors cmt_hash_001 and cmt_hash_005 (escapes, astral plane, outcome false). */
const VECTOR_001: ReceiptCommitment = {
  commitment_id: 'c1',
  action: 'decision.approved',
  authority_scope: 'seam',
  reason: 'sealed by seam',
  mode_version: 'macp.mode.decision.v1',
  policy_version: '1.0.0',
  configuration_version: '1.0.0',
  outcome_positive: true
};
const VECTOR_005: ReceiptCommitment = {
  commitment_id: 'c5',
  action: 'decision."appro\\ved"',
  authority_scope: 'café',
  reason: 'ré\tsumé\n— naïve 🜂',
  mode_version: 'macp.mode.decision.v1',
  policy_version: '1.0.0',
  configuration_version: '1.0.0',
  outcome_positive: false
};

describe('projectionHash (RFC-MACP-0013 §4, via the SDK)', () => {
  it('matches the pinned spec vectors', () => {
    expect(projectionHash(VECTOR_001)).toBe('sha256:9f58e9d114d11860d48aa2bcb8cda458b9618b1cc8560595a802b68c4af85d41');
    expect(projectionHash(VECTOR_005)).toBe('sha256:03f8ac2b8172958504092ce9fe5154dbcfe300fd30a350453d4e4bd715822ab2');
    // cmt_hash_002: supersedes chaining, the commitment of the spec's example receipt.
    expect(projectionHash(vector002.receipt.commitment)).toBe(vector002.receipt.commitment_hash);
  });
});

describe('toCommitmentProjection (RFC-MACP-0013 §3)', () => {
  it('materializes missing scalars and keeps supersedes only when set', () => {
    expect(toCommitmentProjection({ action: 'approve' })).toEqual({
      commitment_id: '',
      action: 'approve',
      authority_scope: '',
      reason: '',
      mode_version: '',
      policy_version: '',
      configuration_version: '',
      outcome_positive: false
    });
    expect(toCommitmentProjection({ supersedes: { session_id: '', commitment_hash: '' } })?.supersedes).toEqual({
      session_id: '',
      commitment_hash: ''
    });
  });

  it('refuses a field outside the frozen set (cannot-verify, §5)', () => {
    expect(toCommitmentProjection({ ...VECTOR_001, extra: 'x' })).toBeNull();
    expect(toCommitmentProjection({ ...VECTOR_001, supersedes: { session_id: 's', other: 1 } })).toBeNull();
  });
});

describe('buildReceipt (RFC-MACP-0013 Appendix A, via the SDK)', () => {
  it('produces a schema-valid receipt that verifies as integrity_only', () => {
    const receipt = buildReceipt(commitmentFromProjection(VECTOR_001), {
      sessionId: 'sess-1',
      mode: 'macp.mode.decision.v1',
      issuer: 'console:example.test',
      issuedAt: rfc3339Utc(new Date('2026-10-25T10:11:12.345Z'))
    });

    expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true);
    expect(receipt).toMatchObject({
      receipt_format: 'macp-receipt/1',
      commitment: VECTOR_001,
      issued_at: '2026-10-25T10:11:12Z',
      attestations: []
    });
    expect(verifyReceipt(receipt, {})).toEqual({ integrity: 'match', attestations: [], verdict: 'integrity_only' });
  });

  it('reproduces the spec integrity-only vector', () => {
    const { receipt: expected } = vector002;
    const receipt = buildReceipt(commitmentFromProjection(expected.commitment), {
      sessionId: expected.session_id,
      mode: expected.mode,
      issuer: expected.issuer,
      issuedAt: expected.issued_at
    });
    expect(receipt.commitment_hash).toBe(expected.commitment_hash);
    expect(validate(receipt)).toBe(true);
    expect(verifyReceipt(expected, {}).verdict).toBe('integrity_only');
  });

  it('names the file after the session id', () => {
    expect(receiptFilename('0192f1a4-7c3e')).toBe('receipt-0192f1a4-7c3e.json');
    expect(receiptFilename('a/b')).toBe('receipt-a_b.json');
  });
});
