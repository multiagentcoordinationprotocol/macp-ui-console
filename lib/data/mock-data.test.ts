import { describe, expect, it } from 'vitest';

import {
  COMPLETED_RUN_ID,
  DECLINED_RUN_ID,
  MOCK_POLICY_DEFINITIONS,
  MOCK_RUNTIME_POLICIES,
  MOCK_RUN_EVENTS,
  MOCK_RUN_STATES,
  MOCK_RUNS
} from '@/lib/data/mock-data';
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

describe('MOCK_RUN_STATES — supersedes canonicality fixtures', () => {
  // Demo mode is the only backend-free path to the "Legacy hash format" badge. Without both
  // branches present the badge is unreachable without a running control plane, and a fixture
  // edit would silently remove the only way to see it.
  it('exercises the canonical branch on the completed run', () => {
    expect(MOCK_RUN_STATES[COMPLETED_RUN_ID].decision.current?.supersedes?.canonical).toBe(true);
  });

  it('exercises the non-canonical branch on the declined run', () => {
    expect(MOCK_RUN_STATES[DECLINED_RUN_ID].decision.current?.supersedes?.canonical).toBe(false);
  });

  it('uses a visibly non-canonical hash shape for the false branch', () => {
    // RFC-MACP-0013 §9: literally `sha256:` + exactly 64 lowercase hex.
    const CANONICAL = /^sha256:[0-9a-f]{64}$/;
    const legacy = MOCK_RUN_STATES[DECLINED_RUN_ID].decision.current?.supersedes?.commitmentHash;
    const canonical = MOCK_RUN_STATES[COMPLETED_RUN_ID].decision.current?.supersedes?.commitmentHash;
    expect(legacy).toBeDefined();
    expect(CANONICAL.test(legacy as string)).toBe(false);
    expect(CANONICAL.test(canonical as string)).toBe(true);
  });

  it('attaches both fixtures to runs that are listed, so they are reachable from the runs table', () => {
    const listedIds = MOCK_RUNS.map((run) => run.id);
    expect(listedIds).toContain(COMPLETED_RUN_ID);
    expect(listedIds).toContain(DECLINED_RUN_ID);
  });
});

describe('MOCK_RUN_STATES — timeline counters', () => {
  // These were hand-written literals and three of six had drifted from the fixture they describe,
  // so the demo showed "11 events" beside a 14-row rail. `syncTimeline` derives them; this is the
  // guard that keeps them derived — reintroducing a literal fails here rather than shipping a
  // number nothing checks.
  it('matches every run state to its own event fixture', () => {
    const runIds = Object.keys(MOCK_RUN_STATES);
    expect(runIds.length).toBeGreaterThan(0);

    for (const runId of runIds) {
      const events = MOCK_RUN_EVENTS[runId];
      // Every listed state must HAVE a fixture: the cancelled run had none while claiming three
      // events, which is the drift this guard exists to make impossible.
      expect(events, `no event fixture for ${runId}`).toBeDefined();

      const state = MOCK_RUN_STATES[runId];
      expect(state.timeline.totalEvents, `totalEvents for ${runId}`).toBe(events.length);
      expect(state.timeline.latestSeq, `latestSeq for ${runId}`).toBe(Math.max(...events.map((item) => item.seq)));
      // `recent` is the tail, capped at 8.
      expect(state.timeline.recent.map((item) => item.seq)).toEqual(events.slice(-8).map((item) => item.seq));
    }
  });

  it('gives the /logs run.cancelled filter something to match in demo mode', () => {
    // `app/logs/page.tsx` offers `run.cancelled` as a Run-category filter; demo mode is the
    // default, so an entry matching nothing reads as "no such events happen" rather than
    // "the fixture is missing".
    const allTypes = Object.values(MOCK_RUN_EVENTS).flatMap((events) => events.map((item) => item.type));
    expect(allTypes).toContain('run.cancelled');
  });
});
