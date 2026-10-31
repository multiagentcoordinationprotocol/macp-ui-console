import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '@/test/fixtures/receipt/macp-decision-receipt.schema.json';
import vector002 from '@/test/fixtures/receipt/receipt_002_integrity_only.json';
import vector004 from '@/test/fixtures/receipt/receipt_004_body_tampered.json';
import signedReceipt from '@/test/fixtures/receipt/decision_receipt.json';
import receiptKeys from '@/test/fixtures/receipt/receipt_keys.json';
import {
  buildReceipt,
  checkRuntimeReceipt,
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

describe('checkRuntimeReceipt (W5 U1, RFC-MACP-0013 §13)', () => {
  const signedText = JSON.stringify(signedReceipt, null, 2);

  it('is attested when the signature verifies against the runtime key set', () => {
    const check = checkRuntimeReceipt(signedText, receiptKeys);
    expect(check).toMatchObject({ verdict: 'attested', verification: { attestations: ['valid'] } });
    expect(check.reason).toBeUndefined();
  });

  it('is integrity_only for an unsigned receipt from a runtime with no keys', () => {
    const check = checkRuntimeReceipt(JSON.stringify(vector002.receipt), { keys: [] });
    expect(check.verdict).toBe('integrity_only');
  });

  it('is integrity_only for an unsigned receipt whatever the key set holds (§13 item 6)', () => {
    expect(checkRuntimeReceipt(JSON.stringify(vector002.receipt), receiptKeys).verdict).toBe('integrity_only');
  });

  it('fails a signature that does not cover the body, though the SDK verdict is integrity_only', () => {
    const check = checkRuntimeReceipt(JSON.stringify(vector004.receipt), receiptKeys);
    expect(check.verification.verdict).toBe('integrity_only');
    expect(check).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/did not verify/) });
  });

  it('fails a signature whose kid the key set lacks', () => {
    const check = checkRuntimeReceipt(signedText, { keys: [] });
    expect(check.verification.attestations).toEqual(['unknown_key']);
    expect(check).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/does not hold/) });
  });

  it('fails a receipt whose commitment_hash does not match its commitment', () => {
    const tampered = { ...signedReceipt, commitment: { ...signedReceipt.commitment, action: 'decision.rejected' } };
    const check = checkRuntimeReceipt(JSON.stringify(tampered), receiptKeys);
    expect(check).toMatchObject({ verdict: 'failed', reason: expect.stringMatching(/does not match/) });
  });

  it('fails text that is not a receipt, without throwing', () => {
    expect(checkRuntimeReceipt('not json', receiptKeys)).toMatchObject({
      verdict: 'failed',
      reason: expect.stringMatching(/not a macp-receipt\/1/)
    });
  });
});
