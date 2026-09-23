import { describe, expect, it } from 'vitest';

import { MOCK_POLICY_DEFINITIONS, MOCK_RUNTIME_POLICIES } from '@/lib/data/mock-data';
import type { CommitmentAuthority } from '@/lib/types';

/**
 * Exhaustiveness anchor for `CommitmentAuthority`.
 *
 * The union previously carried a value no component in the stack has ever emitted
 * (`'designated_roles'`, plural) and survived indefinitely, because a type with zero consumers cannot
 * be *detectably* wrong — `tsc` reports nothing either way. This record is that missing consumer.
 *
 * It fails `npm run typecheck` in BOTH directions:
 *   - a member ADDED to the union → this literal is missing a key;
 *   - a member REMOVED or RENAMED → excess-property checking rejects the now-unknown key.
 *
 * Two things this guard depends on, both of which would disable it *silently* if changed:
 *
 *  1. **The object literal must stay inline at the annotation site.** Hoisting it
 *     (`const x = {…}; const A: Record<CommitmentAuthority, true> = x;`) discards excess-property
 *     checking, and removals stop being caught — verified empirically: hoisted, deleting a union
 *     member typechecks clean.
 *  2. **`tsconfig.json` must keep including test files.** Its recursive `.ts` include (excluding only
 *     `node_modules`) is what puts this file under `npm run typecheck`. Adding a `*.test.ts` exclude
 *     for build speed would kill this gate with no signal at all — the same failure mode as the bug
 *     it exists to prevent. If that ever becomes desirable, move this anchor into shipped code (a
 *     `Record<CommitmentAuthority, string>` label map on the policy detail page) first.
 */
const COMMITMENT_AUTHORITIES: Record<CommitmentAuthority, true> = {
  initiator_only: true,
  designated_role: true,
  any_participant: true
};

describe('CommitmentAuthority', () => {
  it('covers exactly the three authority modes the runtime accepts', () => {
    // Also the regression guard for the historical plural spelling `designated_roles`, which is a
    // FIELD name elsewhere but was never a valid authority VALUE.
    expect(Object.keys(COMMITMENT_AUTHORITIES).sort()).toEqual([
      'any_participant',
      'designated_role',
      'initiator_only'
    ]);
  });
});

describe('MOCK_POLICY_DEFINITIONS', () => {
  it('exercises the designated_role authority, so the corrected union member is load-bearing', () => {
    const designated = MOCK_POLICY_DEFINITIONS.filter(
      (policy) => policy.rules.commitment.authority === 'designated_role'
    );
    expect(designated.length).toBeGreaterThan(0);
  });

  it('mirrors the upstream policy.lending.conservative definition field for field', () => {
    // Source of truth: macp-playground/policies/policy.lending.conservative.json
    const policy = MOCK_POLICY_DEFINITIONS.find((entry) => entry.policy_id === 'policy.lending.conservative');
    expect(policy).toEqual({
      policy_id: 'policy.lending.conservative',
      mode: 'macp.mode.decision.v1',
      schema_version: 3,
      description: 'Lending: supermajority with compliance veto and mandatory evaluations before voting',
      rules: {
        voting: { algorithm: 'supermajority', threshold: 0.67, quorum: { type: 'count', value: 3 } },
        objection_handling: { critical_severity_vetoes: true, veto_threshold: 1 },
        evaluation: { minimum_confidence: 0.6, required_before_voting: true },
        commitment: {
          authority: 'designated_role',
          require_vote_quorum: true,
          designated_roles: ['risk-agent', 'compliance-agent']
        }
      }
    });
  });

  it('never declares designated_role authority with an empty designated_roles list', () => {
    // Mirrors the runtime's own registration invariant
    // (macp-runtime/crates/macp-policy/src/registry.rs) — a designated-role policy with nobody
    // designated can never commit.
    for (const policy of MOCK_POLICY_DEFINITIONS) {
      if (policy.rules.commitment.authority === 'designated_role') {
        expect(policy.rules.commitment.designated_roles.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('MOCK_RUNTIME_POLICIES', () => {
  it('registers at least one policy using designated_role, so demo /policies renders it', () => {
    // Without this the corrected union member is data that never reaches a screen:
    // `listRuntimePolicies`/`getRuntimePolicy` read only MOCK_RUNTIME_POLICIES in demo mode.
    const authorities = MOCK_RUNTIME_POLICIES.map(
      (policy) => (policy.rules as (typeof MOCK_POLICY_DEFINITIONS)[number]['rules']).commitment.authority
    );
    expect(authorities).toContain('designated_role');
  });
});
