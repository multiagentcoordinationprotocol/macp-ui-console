import type {
  AgentProfile,
  Artifact,
  AuditEntry,
  CanonicalEvent,
  CompileLaunchResult,
  CreateRunResponse,
  DashboardKpis,
  LaunchSchemaResponse,
  MetricsSummary,
  PackSummary,
  PolicyDefinition,
  ReplayDescriptor,
  RunComparisonResult,
  RunRecord,
  RunStateProjection,
  RuntimeHealth,
  RuntimeManifestResult,
  RuntimeModeDescriptor,
  RuntimePolicyDescriptor,
  RuntimeRootDescriptor,
  ScenarioSummary,
  TraceSummary,
  WebhookSubscription
} from '@/lib/types';

function isoMinutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const LIVE_RUN_ID = '11111111-1111-4111-8111-111111111111';
export const COMPLETED_RUN_ID = '22222222-2222-4222-8222-222222222222';
export const FAILED_RUN_ID = '33333333-3333-4333-8333-333333333333';
export const DECLINED_RUN_ID = '44444444-4444-4444-8444-444444444444';

export const MOCK_PACKS: PackSummary[] = [
  {
    slug: 'fraud',
    name: 'Fraud',
    description: 'Fraud and risk decisioning demos.',
    tags: ['fraud', 'risk', 'growth', 'demo']
  },
  {
    slug: 'trust',
    name: 'Trust',
    description: 'Trust and onboarding workflows used in demo mode.',
    tags: ['trust', 'onboarding', 'policy']
  },
  {
    slug: 'ops',
    name: 'Operations',
    description: 'Operational playbooks and escalation flows.',
    tags: ['ops', 'incident', 'playbook']
  }
];

export const MOCK_SCENARIOS: Record<string, ScenarioSummary[]> = {
  fraud: [
    {
      scenario: 'high-value-new-device',
      name: 'High Value Purchase From New Device',
      summary: 'Fraud Agent, Growth Agent, and Risk Agent discuss a transaction and produce a decision.',
      versions: ['1.0.0'],
      templates: ['default', 'majority-veto', 'unanimous', 'strict-risk'],
      tags: ['fraud', 'growth', 'risk', 'demo'],
      runtimeKind: 'rust',
      agentRefs: ['fraud-agent', 'growth-agent', 'risk-agent'],
      policyVersion: 'policy.default',
      policyHints: {
        type: 'none',
        description: 'Default policy — no additional governance constraints',
        vetoThreshold: 1,
        minimumConfidence: 0.0,
        designatedRoles: []
      }
    }
  ],
  trust: [
    {
      scenario: 'new-merchant-onboarding',
      name: 'New Merchant Onboarding',
      summary: 'Identity, policy, and growth agents coordinate a merchant approval decision.',
      versions: ['1.0.0'],
      templates: ['default', 'expedited'],
      tags: ['trust', 'merchant', 'kyc'],
      runtimeKind: 'rust',
      agentRefs: ['identity-agent', 'policy-agent', 'growth-agent'],
      policyVersion: 'policy.trust.majority',
      policyHints: { type: 'majority', description: 'Simple majority vote', threshold: 0.5, vetoEnabled: false }
    }
  ],
  ops: [
    {
      scenario: 'vendor-outage-triage',
      name: 'Vendor Outage Triage',
      summary: 'Operations specialists converge on severity, blast radius, and mitigation plan.',
      versions: ['1.0.0'],
      templates: ['default', 'major-incident'],
      tags: ['ops', 'incident', 'vendor'],
      runtimeKind: 'rust',
      agentRefs: ['ops-agent', 'comms-agent', 'risk-agent'],
      policyVersion: 'policy.ops.supermajority',
      policyHints: {
        type: 'supermajority',
        description: 'Supermajority approval for operational triage',
        threshold: 0.67,
        vetoEnabled: true,
        vetoThreshold: 1,
        designatedRoles: ['incident-lead']
      }
    }
  ]
};

export const MOCK_LAUNCH_SCHEMAS: Record<string, LaunchSchemaResponse> = {
  'fraud/high-value-new-device@1.0.0:default': {
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'default',
    formSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', default: 'CUST-1001' },
        transactionAmount: { type: 'number', default: 2400, minimum: 1 },
        deviceTrustScore: { type: 'number', default: 0.18, minimum: 0, maximum: 1 },
        accountAgeDays: { type: 'integer', default: 14, minimum: 0 },
        isVipCustomer: { type: 'boolean', default: true },
        priorChargebacks: { type: 'integer', default: 1, minimum: 0 }
      },
      required: ['transactionAmount', 'deviceTrustScore', 'accountAgeDays', 'isVipCustomer', 'priorChargebacks']
    },
    defaults: {
      customerId: 'CUST-1001',
      transactionAmount: 2400,
      deviceTrustScore: 0.18,
      accountAgeDays: 14,
      isVipCustomer: true,
      priorChargebacks: 1
    },
    participants: [
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
      { id: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
    ],
    agents: [
      {
        agentRef: 'fraud-agent',
        name: 'Fraud Agent',
        role: 'fraud',
        framework: 'langgraph',
        description: 'Evaluates device, chargeback, and identity-risk signals for the showcase flow.',
        transportIdentity: 'agent://fraud-agent',
        entrypoint: 'examples/fraud/langgraph_fraud_agent.py:create_graph',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['fraud', 'langgraph', 'risk']
      },
      {
        agentRef: 'growth-agent',
        name: 'Growth Agent',
        role: 'growth',
        framework: 'langchain',
        description: 'Assesses customer value, revenue impact, and experience trade-offs.',
        transportIdentity: 'agent://growth-agent',
        entrypoint: 'examples/growth/langchain_growth_agent.py:create_agent',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['growth', 'langchain', 'revenue']
      },
      {
        agentRef: 'risk-agent',
        name: 'Risk Agent',
        role: 'risk',
        framework: 'custom',
        description: 'Coordinates the final recommendation and turns specialist input into a decision.',
        transportIdentity: 'agent://risk-agent',
        entrypoint: 'examples/risk/risk_decider.ts:createCoordinator',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['risk', 'coordinator', 'decision']
      }
    ],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.default',
      policyHints: {
        type: 'none',
        description: 'Default policy — no additional governance constraints',
        vetoThreshold: 1,
        minimumConfidence: 0.0,
        designatedRoles: []
      },
      ttlMs: 300000,
      initiatorParticipantId: 'risk-agent'
    },
    expectedDecisionKinds: ['approve', 'step_up', 'decline']
  },
  'fraud/high-value-new-device@1.0.0:majority-veto': {
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'majority-veto',
    formSchema: {},
    defaults: { customerId: 'CUST-1001', transactionAmount: 2400 },
    participants: [
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
      { id: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
    ],
    agents: [],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.majority-veto',
      policyVersion: 'policy.fraud.majority-veto',
      policyHints: {
        type: 'majority',
        description: 'Simple majority vote with designated veto power',
        threshold: 0.5,
        vetoEnabled: true,
        criticalSeverityVetoes: true,
        vetoThreshold: 1,
        minimumConfidence: 0.0,
        designatedRoles: []
      },
      ttlMs: 300000,
      initiatorParticipantId: 'risk-agent'
    },
    expectedDecisionKinds: ['approve', 'step_up', 'decline']
  },
  'fraud/high-value-new-device@1.0.0:unanimous': {
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'unanimous',
    formSchema: {},
    defaults: { customerId: 'CUST-1001', transactionAmount: 2400 },
    participants: [
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
      { id: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
    ],
    agents: [],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.unanimous',
      policyVersion: 'policy.fraud.unanimous',
      policyHints: {
        type: 'unanimous',
        description: 'Fraud review: unanimous approval required',
        threshold: 1.0,
        vetoEnabled: true,
        criticalSeverityVetoes: true,
        vetoThreshold: 1,
        minimumConfidence: 0.7,
        designatedRoles: []
      },
      ttlMs: 300000,
      initiatorParticipantId: 'risk-agent'
    },
    expectedDecisionKinds: ['approve', 'step_up', 'decline']
  },
  'fraud/high-value-new-device@1.0.0:strict-risk': {
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'strict-risk',
    formSchema: {},
    defaults: {
      customerId: 'CUST-2048',
      transactionAmount: 3800,
      deviceTrustScore: 0.08,
      accountAgeDays: 7,
      isVipCustomer: true,
      priorChargebacks: 2
    },
    participants: [
      { id: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
      { id: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
    ],
    agents: [],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.default',
      policyHints: {
        type: 'none',
        description: 'Default policy — strict risk variant',
        vetoThreshold: 1,
        minimumConfidence: 0.0,
        designatedRoles: []
      },
      ttlMs: 180000,
      initiatorParticipantId: 'risk-agent'
    },
    expectedDecisionKinds: ['approve', 'step_up', 'decline']
  },
  'trust/new-merchant-onboarding@1.0.0:default': {
    scenarioRef: 'trust/new-merchant-onboarding@1.0.0',
    templateId: 'default',
    formSchema: {
      type: 'object',
      properties: {
        merchantId: { type: 'string', default: 'MERCH-39' },
        country: { type: 'string', default: 'US' },
        monthlyVolumeUsd: { type: 'number', default: 125000 },
        sanctionsHit: { type: 'boolean', default: false },
        priorViolations: { type: 'integer', default: 0 }
      }
    },
    defaults: {
      merchantId: 'MERCH-39',
      country: 'US',
      monthlyVolumeUsd: 125000,
      sanctionsHit: false,
      priorViolations: 0
    },
    participants: [
      { id: 'identity-agent', role: 'identity', agentRef: 'identity-agent' },
      { id: 'policy-agent', role: 'policy', agentRef: 'policy-agent' },
      { id: 'growth-agent', role: 'growth', agentRef: 'growth-agent' }
    ],
    agents: [
      {
        agentRef: 'identity-agent',
        name: 'Identity Agent',
        role: 'identity',
        framework: 'custom',
        transportIdentity: 'agent://identity-agent',
        entrypoint: 'examples/trust/identity.ts:createAgent',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['kyc', 'identity']
      },
      {
        agentRef: 'policy-agent',
        name: 'Policy Agent',
        role: 'policy',
        framework: 'langgraph',
        transportIdentity: 'agent://policy-agent',
        entrypoint: 'examples/trust/policy.py:create_agent',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['policy', 'compliance']
      },
      {
        agentRef: 'growth-agent',
        name: 'Growth Agent',
        role: 'growth',
        framework: 'langchain',
        transportIdentity: 'agent://growth-agent',
        entrypoint: 'examples/growth/langchain_growth_agent.py:create_agent',
        bootstrapStrategy: 'manifest-only',
        bootstrapMode: 'deferred',
        tags: ['growth']
      }
    ],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.onboarding',
      policyVersion: 'policy.standard',
      policyHints: { type: 'majority', description: 'Simple majority vote', threshold: 0.5, vetoEnabled: false },
      ttlMs: 240000,
      initiatorParticipantId: 'policy-agent'
    },
    expectedDecisionKinds: ['approve', 'manual_review', 'reject']
  }
};

export const MOCK_COMPILED_RUN: CompileLaunchResult = {
  runDescriptor: {
    mode: 'live',
    runtime: { kind: 'rust', version: 'v1' },
    session: {
      sessionId: '00000000-0000-4000-8000-0000fa1d0001',
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.default',
      ttlMs: 300000,
      participants: [{ id: 'fraud-agent' }, { id: 'growth-agent' }, { id: 'risk-agent' }],
      metadata: {
        source: 'scenario-registry',
        sourceRef: 'fraud/high-value-new-device@1.0.0',
        intent: 'evaluate transaction'
      }
    },
    execution: {
      idempotencyKey: 'fraud-high-value-demo-1',
      tags: ['demo', 'fraud', 'examples'],
      requester: {
        actorId: 'example-service',
        actorType: 'service'
      }
    }
  },
  initiator: {
    participantId: 'risk-agent',
    sessionStart: {
      intent: 'evaluate transaction',
      participants: ['fraud-agent', 'growth-agent', 'risk-agent'],
      ttlMs: 300000,
      modeVersion: '1.0.0',
      configurationVersion: 'config.default',
      policyVersion: 'policy.default',
      context: {
        customerId: 'CUST-1001',
        transactionAmount: 2400,
        deviceTrustScore: 0.18,
        accountAgeDays: 14,
        isVipCustomer: true,
        priorChargebacks: 1
      }
    },
    kickoff: {
      messageType: 'Proposal',
      payload: {
        proposal_id: 'CUST-1001-initial-review',
        option: 'evaluate_transaction',
        rationale: 'Decide whether to approve, step_up, or decline the transaction.'
      }
    }
  },
  sessionId: '00000000-0000-4000-8000-0000fa1d0001',
  mode: 'live',
  scenarioMeta: {
    policyHints: { type: 'majority', description: 'Simple majority vote', threshold: 0.5, vetoEnabled: false },
    sessionContext: {
      customerId: 'CUST-1001',
      transactionAmount: 2400,
      deviceTrustScore: 0.18,
      accountAgeDays: 14,
      isVipCustomer: true,
      priorChargebacks: 1
    },
    initiatorParticipantId: 'risk-agent'
  },
  display: {
    title: 'High Value Purchase From New Device',
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'default',
    expectedDecisionKinds: ['approve', 'step_up', 'decline']
  },
  participantBindings: [
    { participantId: 'fraud-agent', role: 'fraud', agentRef: 'fraud-agent' },
    { participantId: 'growth-agent', role: 'growth', agentRef: 'growth-agent' },
    { participantId: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }
  ]
};

export const MOCK_CREATE_RUN_RESPONSE: CreateRunResponse = {
  runId: LIVE_RUN_ID,
  status: 'running',
  traceId: 'trace-live-fraud-001'
};

export const MOCK_RUNS: RunRecord[] = [
  {
    id: LIVE_RUN_ID,
    status: 'running',
    runtimeKind: 'rust',
    runtimeVersion: 'v1',
    runtimeSessionId: 'session-live-001',
    traceId: 'trace-live-fraud-001',
    createdAt: isoMinutesAgo(3),
    startedAt: isoMinutesAgo(3),
    tags: ['demo', 'fraud', 'live'],
    source: { kind: 'scenario-registry', ref: 'fraud/high-value-new-device@1.0.0' },
    metadata: {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'strict-risk',
      environment: 'local-dev',
      totalTokens: 3210,
      estimatedCostUsd: 0.41,
      modeName: 'macp.mode.decision.v1'
    }
  },
  {
    id: COMPLETED_RUN_ID,
    status: 'completed',
    runtimeKind: 'rust',
    runtimeVersion: 'v1',
    runtimeSessionId: 'session-complete-001',
    traceId: 'trace-complete-fraud-002',
    createdAt: isoMinutesAgo(58),
    startedAt: isoMinutesAgo(58),
    endedAt: isoMinutesAgo(55),
    tags: ['demo', 'fraud', 'historical'],
    source: { kind: 'scenario-registry', ref: 'fraud/high-value-new-device@1.0.0' },
    metadata: {
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'default',
      environment: 'local-dev',
      totalTokens: 2890,
      estimatedCostUsd: 0.34,
      modeName: 'macp.mode.decision.v1',
      finalAction: 'approve',
      finalConfidence: 0.87
    }
  },
  {
    id: FAILED_RUN_ID,
    status: 'failed',
    runtimeKind: 'rust',
    runtimeVersion: 'v1',
    runtimeSessionId: 'session-failed-003',
    traceId: 'trace-trust-003',
    createdAt: isoMinutesAgo(188),
    startedAt: isoMinutesAgo(188),
    endedAt: isoMinutesAgo(184),
    tags: ['trust', 'onboarding', 'failure'],
    source: { kind: 'scenario-registry', ref: 'trust/new-merchant-onboarding@1.0.0' },
    metadata: {
      scenarioRef: 'trust/new-merchant-onboarding@1.0.0',
      templateId: 'default',
      environment: 'stage',
      totalTokens: 2011,
      estimatedCostUsd: 0.27,
      modeName: 'macp.mode.decision.v1',
      failureCategory: 'policy_timeout'
    }
  },
  {
    id: DECLINED_RUN_ID,
    status: 'completed',
    runtimeKind: 'rust',
    runtimeVersion: 'v1',
    runtimeSessionId: 'session-ops-004',
    traceId: 'trace-ops-004',
    createdAt: isoMinutesAgo(420),
    startedAt: isoMinutesAgo(420),
    endedAt: isoMinutesAgo(414),
    tags: ['ops', 'incident', 'historical'],
    source: { kind: 'scenario-registry', ref: 'ops/vendor-outage-triage@1.0.0' },
    metadata: {
      scenarioRef: 'ops/vendor-outage-triage@1.0.0',
      templateId: 'major-incident',
      environment: 'prod',
      totalTokens: 3555,
      estimatedCostUsd: 0.58,
      modeName: 'macp.mode.decision.v1',
      finalAction: 'mitigate_and_communicate',
      finalConfidence: 0.93
    }
  }
];

const liveBaseState: RunStateProjection = {
  run: {
    runId: LIVE_RUN_ID,
    status: 'running',
    runtimeSessionId: 'session-live-001',
    startedAt: isoMinutesAgo(3),
    traceId: 'trace-live-fraud-001',
    modeName: 'macp.mode.decision.v1',
    contextId: 'ctx:sha256:a1b2c3d4e5f6',
    extensionKeys: ['ctxm', 'billing']
  },
  participants: [
    { participantId: 'fraud-agent', role: 'fraud', status: 'waiting' },
    { participantId: 'growth-agent', role: 'growth', status: 'waiting' },
    { participantId: 'risk-agent', role: 'risk', status: 'active' }
  ],
  graph: {
    nodes: [
      { id: 'start', kind: 'start', status: 'completed' },
      { id: 'context-fetch', kind: 'context', status: 'completed' },
      { id: 'fraud-agent', kind: 'agent', status: 'waiting' },
      { id: 'growth-agent', kind: 'agent', status: 'waiting' },
      { id: 'risk-agent', kind: 'agent', status: 'active' },
      { id: 'decision', kind: 'decision', status: 'waiting' },
      { id: 'final-output', kind: 'output', status: 'waiting' }
    ],
    edges: [
      { from: 'start', to: 'context-fetch', kind: 'control', ts: isoMinutesAgo(3) },
      { from: 'context-fetch', to: 'fraud-agent', kind: 'data', ts: isoMinutesAgo(3) },
      { from: 'context-fetch', to: 'growth-agent', kind: 'data', ts: isoMinutesAgo(3) },
      { from: 'fraud-agent', to: 'decision', kind: 'analysis', ts: isoMinutesAgo(2) },
      { from: 'growth-agent', to: 'decision', kind: 'analysis', ts: isoMinutesAgo(2) },
      { from: 'risk-agent', to: 'decision', kind: 'coordination', ts: isoMinutesAgo(2) },
      { from: 'decision', to: 'final-output', kind: 'output', ts: isoMinutesAgo(1) }
    ]
  },
  decision: {
    current: {
      action: 'step_up',
      confidence: 0.71,
      reasons: ['Device trust score dipped below policy threshold.'],
      finalized: false,
      proposalId: 'CUST-2048-initial-review'
    }
  },
  signals: {
    signals: [
      {
        id: 'sig-device-risk',
        name: 'low_device_trust',
        severity: 'high',
        sourceParticipantId: 'fraud-agent',
        ts: isoMinutesAgo(2),
        confidence: 0.92,
        payload: { deviceTrustScore: 0.08 }
      },
      {
        id: 'sig-vip',
        name: 'vip_customer',
        severity: 'info',
        sourceParticipantId: 'growth-agent',
        ts: isoMinutesAgo(2),
        confidence: 0.84,
        payload: { ltvBand: 'high' }
      }
    ]
  },
  progress: {
    entries: [
      { participantId: 'risk-agent', percentage: 25, message: 'Kickoff broadcast sent', ts: isoMinutesAgo(3) },
      { participantId: 'fraud-agent', percentage: 60, message: 'Device graph evaluated', ts: isoMinutesAgo(2) },
      { participantId: 'growth-agent', percentage: 50, message: 'LTV context fetched', ts: isoMinutesAgo(2) }
    ]
  },
  timeline: {
    latestSeq: 6,
    totalEvents: 6,
    recent: []
  },
  trace: {
    traceId: 'trace-live-fraud-001',
    spanCount: 18,
    lastSpanId: 'span-18',
    linkedArtifacts: ['artifact-live-trace']
  },
  outboundMessages: {
    total: 4,
    queued: 0,
    accepted: 4,
    rejected: 0
  },
  policy: {
    policyVersion: 'policy.default',
    policyDescription: 'Default policy — no additional governance constraints',
    commitmentEvaluations: []
  }
};

const completedState: RunStateProjection = {
  run: {
    runId: COMPLETED_RUN_ID,
    status: 'completed',
    runtimeSessionId: 'session-complete-001',
    startedAt: isoMinutesAgo(58),
    endedAt: isoMinutesAgo(55),
    traceId: 'trace-complete-fraud-002',
    modeName: 'macp.mode.decision.v1'
  },
  participants: [
    { participantId: 'fraud-agent', role: 'fraud', status: 'completed', latestSummary: 'Fraud risk moderate.' },
    {
      participantId: 'growth-agent',
      role: 'growth',
      status: 'completed',
      latestSummary: 'VIP status reduces friction cost.'
    },
    { participantId: 'risk-agent', role: 'risk', status: 'completed', latestSummary: 'Approved with confidence 0.87.' }
  ],
  graph: {
    nodes: [
      { id: 'start', kind: 'start', status: 'completed' },
      { id: 'context-fetch', kind: 'context', status: 'completed' },
      { id: 'fraud-agent', kind: 'agent', status: 'completed' },
      { id: 'growth-agent', kind: 'agent', status: 'completed' },
      { id: 'risk-agent', kind: 'agent', status: 'completed' },
      { id: 'decision', kind: 'decision', status: 'completed' },
      { id: 'final-output', kind: 'output', status: 'completed' }
    ],
    edges: liveBaseState.graph.edges
  },
  decision: {
    current: {
      action: 'approve',
      confidence: 0.87,
      reasons: ['Chargeback history was low.', 'Growth upside outweighed friction cost.'],
      finalized: true,
      outcomePositive: true,
      proposalId: 'CUST-1001-initial-review',
      prompt: 'Decide whether to approve, step_up, or decline the transaction.',
      resolvedAt: isoMinutesAgo(55),
      resolvedBy: 'risk-agent',
      // macp-proto 0.1.3 (§7.3) — this commitment supersedes a prior cross-session one.
      supersedes: {
        sessionId: 'session-prior-fraud-000',
        commitmentHash: 'sha256:9f2c1ab7e4d8c3061f5a2b9d7e0c4a18b6d35f92ac71e0d4b8f6a23c1e5079db'
      },
      proposals: [
        {
          participantId: 'fraud-agent',
          action: 'approve',
          confidence: 0.78,
          reasons: ['No chargeback history in last 180 days.'],
          ts: isoMinutesAgo(56),
          vote: 'allow'
        },
        {
          participantId: 'growth-agent',
          action: 'approve',
          confidence: 0.92,
          reasons: ['VIP cohort — revenue upside significant.'],
          ts: isoMinutesAgo(56),
          vote: 'allow'
        },
        {
          participantId: 'risk-agent',
          action: 'approve',
          confidence: 0.87,
          reasons: ['Aggregate signals meet threshold; no veto.'],
          ts: isoMinutesAgo(55),
          vote: 'allow'
        }
      ]
    }
  },
  signals: {
    signals: [
      {
        id: 'sig-chargeback-history',
        name: 'chargeback_history',
        severity: 'medium',
        sourceParticipantId: 'fraud-agent',
        ts: isoMinutesAgo(56),
        confidence: 0.62
      },
      {
        id: 'sig-vip-customer',
        name: 'vip_customer',
        severity: 'info',
        sourceParticipantId: 'growth-agent',
        ts: isoMinutesAgo(56),
        confidence: 0.91
      }
    ]
  },
  progress: {
    entries: [
      { participantId: 'fraud-agent', percentage: 100, message: 'Fraud evaluation complete', ts: isoMinutesAgo(56) },
      { participantId: 'growth-agent', percentage: 100, message: 'Growth analysis complete', ts: isoMinutesAgo(56) },
      { participantId: 'risk-agent', percentage: 100, message: 'Decision finalized', ts: isoMinutesAgo(55) }
    ]
  },
  timeline: { latestSeq: 11, totalEvents: 11, recent: [] },
  trace: {
    traceId: 'trace-complete-fraud-002',
    spanCount: 26,
    lastSpanId: 'span-complete-26',
    linkedArtifacts: ['artifact-complete-trace', 'artifact-complete-report']
  },
  outboundMessages: { total: 5, queued: 0, accepted: 5, rejected: 0 },
  policy: {
    policyVersion: 'policy.default',
    policyDescription: 'Default policy — no additional governance constraints',
    resolvedAt: isoMinutesAgo(55),
    outcomePositive: true,
    commitmentEvaluations: [
      {
        commitmentId: 'eval-001',
        decision: 'allow',
        reasons: ['Confidence threshold met', 'No veto raised'],
        ts: isoMinutesAgo(56)
      },
      { commitmentId: 'eval-002', decision: 'allow', reasons: ['Majority quorum satisfied'], ts: isoMinutesAgo(55) }
    ],
    expectedCommitments: [
      {
        commitmentId: 'eval-001',
        title: 'Fraud risk attestation',
        description: 'Confirm that aggregated fraud signals fall below the decision threshold.',
        requiredRoles: ['fraud', 'risk']
      },
      {
        commitmentId: 'eval-002',
        title: 'Growth quorum',
        description: 'Require a majority vote to approve high-value purchases.',
        requiredRoles: ['growth', 'risk']
      }
    ],
    voteTally: [
      {
        commitmentId: 'eval-001',
        allow: 2,
        deny: 0,
        threshold: 0.66,
        quorum: { required: 2, cast: 2 }
      },
      {
        commitmentId: 'eval-002',
        allow: 3,
        deny: 0,
        threshold: 0.5,
        quorum: { required: 2, cast: 3 }
      }
    ],
    quorumStatus: 'reached'
  },
  llm: {
    calls: [
      {
        participantId: 'risk-agent',
        model: 'claude-sonnet-4-6',
        promptTokens: 1820,
        completionTokens: 312,
        totalTokens: 2132,
        latencyMs: 870,
        estimatedCostUsd: 0.0104,
        ts: isoMinutesAgo(56),
        messageId: 'msg-risk-llm-1'
      },
      {
        participantId: 'fraud-agent',
        model: 'gpt-4o-mini',
        promptTokens: 980,
        completionTokens: 124,
        totalTokens: 1104,
        latencyMs: 420,
        estimatedCostUsd: 0.00022,
        ts: isoMinutesAgo(57),
        messageId: 'msg-fraud-llm-1'
      }
    ],
    totals: {
      callCount: 2,
      promptTokens: 2800,
      completionTokens: 436,
      totalTokens: 3236,
      estimatedCostUsd: 0.01062
    }
  }
};

const failedState: RunStateProjection = {
  run: {
    runId: FAILED_RUN_ID,
    status: 'failed',
    runtimeSessionId: 'session-failed-003',
    startedAt: isoMinutesAgo(188),
    endedAt: isoMinutesAgo(184),
    traceId: 'trace-trust-003',
    modeName: 'macp.mode.decision.v1'
  },
  participants: [
    {
      participantId: 'identity-agent',
      role: 'identity',
      status: 'completed',
      latestSummary: 'Identity checks passed.'
    },
    { participantId: 'policy-agent', role: 'policy', status: 'failed', latestSummary: 'Policy model timed out.' },
    { participantId: 'growth-agent', role: 'growth', status: 'waiting', latestSummary: 'Awaiting policy context.' }
  ],
  graph: {
    nodes: [
      { id: 'identity-agent', kind: 'agent', status: 'completed' },
      { id: 'policy-agent', kind: 'agent', status: 'failed' },
      { id: 'growth-agent', kind: 'agent', status: 'waiting' },
      { id: 'decision', kind: 'decision', status: 'failed' }
    ],
    edges: [
      { from: 'identity-agent', to: 'policy-agent', kind: 'context', ts: isoMinutesAgo(186) },
      { from: 'policy-agent', to: 'decision', kind: 'policy', ts: isoMinutesAgo(185) }
    ]
  },
  decision: {},
  signals: {
    signals: [
      {
        id: 'sig-timeout',
        name: 'policy_timeout',
        severity: 'high',
        sourceParticipantId: 'policy-agent',
        ts: isoMinutesAgo(184),
        confidence: 1
      }
    ]
  },
  progress: {
    entries: [
      { participantId: 'policy-agent', percentage: 70, message: 'Timeout during evaluation', ts: isoMinutesAgo(184) }
    ]
  },
  timeline: { latestSeq: 7, totalEvents: 7, recent: [] },
  trace: {
    traceId: 'trace-trust-003',
    spanCount: 14,
    lastSpanId: 'span-failed-14',
    linkedArtifacts: ['artifact-failed-log']
  },
  outboundMessages: { total: 3, queued: 0, accepted: 2, rejected: 1 },
  policy: {
    policyVersion: 'policy.trust.majority',
    policyDescription: 'Simple majority vote for trust onboarding',
    resolvedAt: isoMinutesAgo(188),
    commitmentEvaluations: []
  }
};

const opsState: RunStateProjection = {
  run: {
    runId: DECLINED_RUN_ID,
    status: 'completed',
    runtimeSessionId: 'session-ops-004',
    startedAt: isoMinutesAgo(420),
    endedAt: isoMinutesAgo(414),
    traceId: 'trace-ops-004',
    modeName: 'macp.mode.decision.v1'
  },
  participants: [
    {
      participantId: 'ops-agent',
      role: 'ops',
      status: 'completed',
      latestSummary: 'Blast radius narrowed to EU only.'
    },
    { participantId: 'comms-agent', role: 'comms', status: 'completed', latestSummary: 'Customer comms drafted.' },
    { participantId: 'risk-agent', role: 'risk', status: 'completed', latestSummary: 'Major incident declared.' }
  ],
  graph: {
    nodes: [
      { id: 'ops-agent', kind: 'agent', status: 'completed' },
      { id: 'comms-agent', kind: 'agent', status: 'completed' },
      { id: 'risk-agent', kind: 'agent', status: 'completed' },
      { id: 'decision', kind: 'decision', status: 'completed' },
      { id: 'final-output', kind: 'output', status: 'completed' }
    ],
    edges: [
      { from: 'ops-agent', to: 'decision', kind: 'analysis', ts: isoMinutesAgo(417) },
      { from: 'comms-agent', to: 'decision', kind: 'analysis', ts: isoMinutesAgo(417) },
      { from: 'risk-agent', to: 'decision', kind: 'coordination', ts: isoMinutesAgo(416) },
      { from: 'decision', to: 'final-output', kind: 'output', ts: isoMinutesAgo(414) }
    ]
  },
  decision: {
    current: {
      action: 'mitigate_and_communicate',
      confidence: 0.93,
      reasons: ['Vendor outage impacted checkout flows.', 'Immediate customer notice reduced escalations.'],
      finalized: true,
      outcomePositive: true,
      proposalId: 'incident-ops-004'
    }
  },
  signals: {
    signals: [
      {
        id: 'sig-major-incident',
        name: 'major_incident',
        severity: 'high',
        sourceParticipantId: 'risk-agent',
        ts: isoMinutesAgo(416),
        confidence: 0.96
      },
      {
        id: 'sig-blast-radius',
        name: 'blast_radius_eu',
        severity: 'medium',
        sourceParticipantId: 'ops-agent',
        ts: isoMinutesAgo(417),
        confidence: 0.81
      }
    ]
  },
  progress: {
    entries: [{ participantId: 'ops-agent', percentage: 100, message: 'Mitigation executed', ts: isoMinutesAgo(414) }]
  },
  timeline: { latestSeq: 8, totalEvents: 8, recent: [] },
  trace: {
    traceId: 'trace-ops-004',
    spanCount: 22,
    lastSpanId: 'span-ops-22',
    linkedArtifacts: ['artifact-ops-report']
  },
  outboundMessages: { total: 4, queued: 0, accepted: 4, rejected: 0 },
  policy: {
    policyVersion: 'policy.ops.supermajority',
    policyDescription: 'Supermajority approval for operational triage',
    resolvedAt: isoMinutesAgo(414),
    outcomePositive: true,
    commitmentEvaluations: [
      { commitmentId: 'ops-eval-001', decision: 'allow', reasons: ['Supermajority achieved'], ts: isoMinutesAgo(415) }
    ]
  }
};

function buildRecent(events: CanonicalEvent[]) {
  return events.slice(-8).map((event) => ({
    id: event.id,
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    subject: event.subject
  }));
}

function event(
  runId: string,
  seq: number,
  type: string,
  data: Record<string, unknown>,
  subject?: CanonicalEvent['subject']
): CanonicalEvent {
  return {
    id: `${runId}-${seq}`,
    runId,
    seq,
    ts: isoMinutesAgo(Math.max(1, 30 - seq * 2)),
    type,
    subject,
    source: { kind: 'runtime', name: 'rust-runtime' },
    data
  };
}

export const MOCK_RUN_EVENTS: Record<string, CanonicalEvent[]> = {
  [LIVE_RUN_ID]: [
    event(LIVE_RUN_ID, 1, 'run.created', { status: 'queued' }, { kind: 'run', id: LIVE_RUN_ID }),
    event(LIVE_RUN_ID, 2, 'run.started', { status: 'running' }, { kind: 'run', id: LIVE_RUN_ID }),
    event(
      LIVE_RUN_ID,
      3,
      'participant.seen',
      { participantId: 'risk-agent' },
      { kind: 'participant', id: 'risk-agent' }
    ),
    event(
      LIVE_RUN_ID,
      4,
      'proposal.created',
      { sender: 'risk-agent', proposalId: 'CUST-2048-initial-review' },
      { kind: 'proposal', id: 'CUST-2048-initial-review' }
    ),
    event(
      LIVE_RUN_ID,
      5,
      'signal.emitted',
      { sender: 'fraud-agent', name: 'low_device_trust', confidence: 0.92 },
      { kind: 'signal', id: 'sig-device-risk' }
    ),
    event(
      LIVE_RUN_ID,
      6,
      'proposal.updated',
      { sender: 'growth-agent', reason: 'vip customer' },
      { kind: 'proposal', id: 'CUST-2048-initial-review' }
    )
  ],
  [COMPLETED_RUN_ID]: [
    event(COMPLETED_RUN_ID, 1, 'run.created', { status: 'queued' }),
    event(COMPLETED_RUN_ID, 2, 'run.started', { status: 'running' }),
    event(
      COMPLETED_RUN_ID,
      3,
      'proposal.created',
      { sender: 'risk-agent', proposalId: 'CUST-1001-initial-review' },
      { kind: 'proposal', id: 'CUST-1001-initial-review' }
    ),
    event(
      COMPLETED_RUN_ID,
      4,
      'signal.emitted',
      { sender: 'fraud-agent', name: 'chargeback_history' },
      { kind: 'signal', id: 'sig-chargeback-history' }
    ),
    event(
      COMPLETED_RUN_ID,
      5,
      'signal.emitted',
      { sender: 'growth-agent', name: 'vip_customer' },
      { kind: 'signal', id: 'sig-vip-customer' }
    ),
    event(
      COMPLETED_RUN_ID,
      6,
      'tool.called',
      { sender: 'fraud-agent', tool: 'device_graph.lookup' },
      { kind: 'tool', id: 'tool-lookup-01' }
    ),
    event(
      COMPLETED_RUN_ID,
      7,
      'tool.completed',
      { sender: 'fraud-agent', tool: 'device_graph.lookup' },
      { kind: 'tool', id: 'tool-lookup-01' }
    ),
    event(
      COMPLETED_RUN_ID,
      8,
      'decision.finalized',
      { action: 'approve', confidence: 0.87 },
      { kind: 'decision', id: 'decision-complete-01' }
    ),
    event(COMPLETED_RUN_ID, 9, 'run.completed', { status: 'completed' }, { kind: 'run', id: COMPLETED_RUN_ID }),
    {
      id: 'evt-policy-resolved',
      runId: COMPLETED_RUN_ID,
      seq: 10,
      ts: isoMinutesAgo(55),
      type: 'policy.resolved',
      subject: { kind: 'policy', id: 'policy.default' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { policyVersion: 'policy.default', status: 'resolved' }
    },
    {
      id: 'evt-policy-eval',
      runId: COMPLETED_RUN_ID,
      seq: 11,
      ts: isoMinutesAgo(55),
      type: 'policy.commitment.evaluated',
      subject: { kind: 'commitment', id: 'eval-001' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { decision: 'allow', reasons: ['Confidence threshold met'] }
    },
    {
      id: 'evt-decision-proposed',
      runId: COMPLETED_RUN_ID,
      seq: 12,
      ts: isoMinutesAgo(56),
      type: 'decision.proposed',
      subject: { kind: 'decision', id: 'CUST-1001-initial-review' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { action: 'approve', confidence: 0.87 }
    },
    // LLM call events synthesized by the CP per BE §3.3 — one per
    // participant that hit the model. Mock data here drives the
    // NodeInspector "LLM" tab in demo mode.
    {
      id: 'evt-llm-risk-1',
      runId: COMPLETED_RUN_ID,
      seq: 13,
      ts: isoMinutesAgo(56),
      type: 'llm.call.completed',
      subject: { kind: 'participant', id: 'risk-agent' },
      source: { kind: 'control-plane', name: 'macp-control-plane' },
      data: {
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        promptTokens: 1820,
        completionTokens: 312,
        totalTokens: 2132,
        latencyMs: 870,
        estimatedCostUsd: 0.0104,
        prompt:
          'You are a fraud risk analyst. Given the transaction signals below, ' +
          'recommend APPROVE, STEP_UP, or DECLINE with confidence and reasons.\n\n' +
          'Signals: chargeback_history (medium, 0.62), vip_customer (info, 0.91)',
        response:
          'APPROVE (confidence 0.87). Chargeback history is within tolerance; ' +
          'VIP signal offsets device-trust risk.'
      }
    },
    {
      id: 'evt-llm-fraud-1',
      runId: COMPLETED_RUN_ID,
      seq: 14,
      ts: isoMinutesAgo(57),
      type: 'llm.call.completed',
      subject: { kind: 'participant', id: 'fraud-agent' },
      source: { kind: 'control-plane', name: 'macp-control-plane' },
      data: {
        model: 'gpt-4o-mini',
        provider: 'openai',
        promptTokens: 980,
        completionTokens: 124,
        totalTokens: 1104,
        latencyMs: 420,
        estimatedCostUsd: 0.00022,
        prompt: 'Inspect transaction for CUST-1001. Return structured fraud signals.',
        response: 'chargeback_history=0.62, device_fingerprint_risk=0.48'
      }
    }
  ],
  [FAILED_RUN_ID]: [
    event(FAILED_RUN_ID, 1, 'run.created', { status: 'queued' }),
    event(FAILED_RUN_ID, 2, 'run.started', { status: 'running' }),
    event(
      FAILED_RUN_ID,
      3,
      'proposal.created',
      { sender: 'policy-agent', proposalId: 'MERCH-39-review' },
      { kind: 'proposal', id: 'MERCH-39-review' }
    ),
    event(
      FAILED_RUN_ID,
      4,
      'tool.called',
      { sender: 'policy-agent', tool: 'policy.llm' },
      { kind: 'tool', id: 'tool-policy-01' }
    ),
    event(
      FAILED_RUN_ID,
      5,
      'message.send_failed',
      { sender: 'policy-agent', code: 'TIMEOUT' },
      { kind: 'message', id: 'msg-timeout-01' }
    ),
    event(
      FAILED_RUN_ID,
      6,
      'signal.emitted',
      { sender: 'policy-agent', name: 'policy_timeout' },
      { kind: 'signal', id: 'sig-timeout' }
    ),
    event(FAILED_RUN_ID, 7, 'run.failed', { status: 'failed' }, { kind: 'run', id: FAILED_RUN_ID })
  ],
  [DECLINED_RUN_ID]: [
    event(DECLINED_RUN_ID, 1, 'run.created', { status: 'queued' }),
    event(DECLINED_RUN_ID, 2, 'run.started', { status: 'running' }),
    event(
      DECLINED_RUN_ID,
      3,
      'proposal.created',
      { sender: 'risk-agent', proposalId: 'incident-ops-004' },
      { kind: 'proposal', id: 'incident-ops-004' }
    ),
    event(
      DECLINED_RUN_ID,
      4,
      'signal.emitted',
      { sender: 'ops-agent', name: 'blast_radius_eu' },
      { kind: 'signal', id: 'sig-blast-radius' }
    ),
    event(
      DECLINED_RUN_ID,
      5,
      'signal.emitted',
      { sender: 'risk-agent', name: 'major_incident' },
      { kind: 'signal', id: 'sig-major-incident' }
    ),
    event(
      DECLINED_RUN_ID,
      6,
      'proposal.updated',
      { sender: 'comms-agent', reason: 'drafted customer comms' },
      { kind: 'proposal', id: 'incident-ops-004' }
    ),
    event(
      DECLINED_RUN_ID,
      7,
      'decision.finalized',
      { action: 'mitigate_and_communicate', confidence: 0.93 },
      { kind: 'decision', id: 'decision-ops-01' }
    ),
    event(DECLINED_RUN_ID, 8, 'run.completed', { status: 'completed' }, { kind: 'run', id: DECLINED_RUN_ID }),
    {
      id: 'evt-ops-policy-resolved',
      runId: DECLINED_RUN_ID,
      seq: 9,
      ts: isoMinutesAgo(414),
      type: 'policy.resolved',
      subject: { kind: 'policy', id: 'policy.ops.supermajority' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { policyVersion: 'policy.ops.supermajority', status: 'resolved' }
    },
    {
      id: 'evt-ops-decision-proposed',
      runId: DECLINED_RUN_ID,
      seq: 10,
      ts: isoMinutesAgo(416),
      type: 'decision.proposed',
      subject: { kind: 'decision', id: 'incident-ops-004' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { action: 'mitigate_and_communicate', confidence: 0.88 }
    },
    {
      id: 'evt-ops-policy-denied',
      runId: DECLINED_RUN_ID,
      seq: 11,
      ts: isoMinutesAgo(417),
      type: 'policy.denied',
      subject: { kind: 'commitment', id: 'commitment-ops-002' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { reason: 'Supermajority threshold not met', commitmentId: 'commitment-ops-002' }
    },
    {
      id: 'evt-ops-msg-failed',
      runId: DECLINED_RUN_ID,
      seq: 12,
      ts: isoMinutesAgo(418),
      type: 'message.send_failed',
      subject: { kind: 'message', id: 'msg-comms-fail-001' },
      source: { kind: 'runtime', name: 'macp-runtime' },
      data: { from: 'comms-agent', to: 'external-api', error: 'Connection timeout' }
    }
  ]
};

liveBaseState.timeline.recent = buildRecent(MOCK_RUN_EVENTS[LIVE_RUN_ID]);
completedState.timeline.recent = buildRecent(MOCK_RUN_EVENTS[COMPLETED_RUN_ID]);
failedState.timeline.recent = buildRecent(MOCK_RUN_EVENTS[FAILED_RUN_ID]);
opsState.timeline.recent = buildRecent(MOCK_RUN_EVENTS[DECLINED_RUN_ID]);

export const MOCK_RUN_STATES: Record<string, RunStateProjection> = {
  [LIVE_RUN_ID]: liveBaseState,
  [COMPLETED_RUN_ID]: completedState,
  [FAILED_RUN_ID]: failedState,
  [DECLINED_RUN_ID]: opsState
};

export const MOCK_RUN_METRICS: Record<string, MetricsSummary> = {
  [LIVE_RUN_ID]: {
    runId: LIVE_RUN_ID,
    eventCount: 6,
    messageCount: 4,
    signalCount: 2,
    proposalCount: 2,
    toolCallCount: 1,
    decisionCount: 0,
    streamReconnectCount: 0,
    firstEventAt: isoMinutesAgo(3),
    lastEventAt: isoMinutesAgo(1),
    durationMs: 158000,
    sessionState: 'SESSION_STATE_OPEN',
    promptTokens: 800,
    completionTokens: 240,
    totalTokens: 1040,
    estimatedCostUsd: 0.0031
  },
  [COMPLETED_RUN_ID]: {
    runId: COMPLETED_RUN_ID,
    eventCount: 11,
    messageCount: 5,
    signalCount: 2,
    proposalCount: 2,
    toolCallCount: 2,
    decisionCount: 1,
    streamReconnectCount: 0,
    firstEventAt: isoMinutesAgo(58),
    lastEventAt: isoMinutesAgo(55),
    durationMs: 183000,
    sessionState: 'SESSION_STATE_RESOLVED',
    promptTokens: 2400,
    completionTokens: 680,
    totalTokens: 3080,
    estimatedCostUsd: 0.0086
  },
  [FAILED_RUN_ID]: {
    runId: FAILED_RUN_ID,
    eventCount: 7,
    messageCount: 3,
    signalCount: 1,
    proposalCount: 1,
    toolCallCount: 1,
    decisionCount: 0,
    streamReconnectCount: 2,
    firstEventAt: isoMinutesAgo(188),
    lastEventAt: isoMinutesAgo(184),
    durationMs: 221000,
    sessionState: 'SESSION_STATE_OPEN',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0
  },
  [DECLINED_RUN_ID]: {
    runId: DECLINED_RUN_ID,
    eventCount: 8,
    messageCount: 4,
    signalCount: 2,
    proposalCount: 2,
    toolCallCount: 0,
    decisionCount: 1,
    streamReconnectCount: 0,
    firstEventAt: isoMinutesAgo(420),
    lastEventAt: isoMinutesAgo(414),
    durationMs: 367000,
    sessionState: 'SESSION_STATE_RESOLVED',
    promptTokens: 1200,
    completionTokens: 340,
    totalTokens: 1540,
    estimatedCostUsd: 0.0046
  }
};

export const MOCK_RUN_TRACES: Record<string, TraceSummary> = {
  [LIVE_RUN_ID]: liveBaseState.trace,
  [COMPLETED_RUN_ID]: completedState.trace,
  [FAILED_RUN_ID]: failedState.trace,
  [DECLINED_RUN_ID]: opsState.trace
};

export const MOCK_RUN_ARTIFACTS: Record<string, Artifact[]> = {
  [LIVE_RUN_ID]: [
    {
      id: 'artifact-live-trace',
      runId: LIVE_RUN_ID,
      kind: 'trace',
      label: 'Live trace spans',
      inline: {
        spans: [
          { spanId: 'span-17', operation: 'fraud-agent.llm', durationMs: 941, status: 'ok' },
          { spanId: 'span-18', operation: 'growth-agent.context_fetch', durationMs: 188, status: 'ok' }
        ]
      },
      createdAt: isoMinutesAgo(1)
    }
  ],
  [COMPLETED_RUN_ID]: [
    {
      id: 'artifact-complete-trace',
      runId: COMPLETED_RUN_ID,
      kind: 'trace',
      label: 'Trace waterfall',
      inline: {
        spans: [
          { spanId: 'span-complete-19', operation: 'runtime.stream', durationMs: 183000, status: 'ok' },
          { spanId: 'span-complete-26', operation: 'risk-agent.commitment', durationMs: 1042, status: 'ok' }
        ]
      },
      createdAt: isoMinutesAgo(55)
    },
    {
      id: 'artifact-complete-report',
      runId: COMPLETED_RUN_ID,
      kind: 'report',
      label: 'Decision report',
      inline: {
        decision: 'approve',
        confidence: 0.87,
        notes: ['Risk below threshold', 'VIP revenue upside preserved']
      },
      createdAt: isoMinutesAgo(55)
    }
  ],
  [FAILED_RUN_ID]: [
    {
      id: 'artifact-failed-log',
      runId: FAILED_RUN_ID,
      kind: 'log',
      label: 'Failure log excerpt',
      inline: {
        lines: [
          'policy-agent: request timed out after 12s',
          'stream consumer reconnect attempt #2',
          'run failed: policy timeout'
        ]
      },
      createdAt: isoMinutesAgo(184)
    }
  ],
  [DECLINED_RUN_ID]: [
    {
      id: 'artifact-ops-report',
      runId: DECLINED_RUN_ID,
      kind: 'report',
      label: 'Incident decision report',
      inline: {
        action: 'mitigate_and_communicate',
        blastRadius: 'EU checkout only',
        severity: 'SEV-1'
      },
      createdAt: isoMinutesAgo(414)
    }
  ]
};

export const MOCK_REPLAY_DESCRIPTORS: Record<string, ReplayDescriptor> = {
  [COMPLETED_RUN_ID]: {
    runId: COMPLETED_RUN_ID,
    mode: 'timed',
    speed: 1,
    streamUrl: `/api/proxy/control-plane/runs/${COMPLETED_RUN_ID}/replay/stream`,
    stateUrl: `/api/proxy/control-plane/runs/${COMPLETED_RUN_ID}/replay/state`
  }
};

export const MOCK_AGENT_PROFILES: AgentProfile[] = [
  {
    agentRef: 'fraud-agent',
    name: 'Fraud Agent',
    role: 'fraud',
    framework: 'langgraph',
    description: 'Evaluates device, chargeback, and identity-risk signals.',
    transportIdentity: 'agent://fraud-agent',
    entrypoint: 'examples/fraud/langgraph_fraud_agent.py:create_graph',
    bootstrapStrategy: 'manifest-only',
    bootstrapMode: 'deferred',
    tags: ['fraud', 'risk', 'langgraph'],
    scenarios: ['fraud/high-value-new-device@1.0.0'],
    metrics: { runs: 2, signals: 3, averageLatencyMs: 821, averageConfidence: 0.77 }
  },
  {
    agentRef: 'growth-agent',
    name: 'Growth Agent',
    role: 'growth',
    framework: 'langchain',
    description: 'Measures revenue upside, customer value, and experience trade-offs.',
    transportIdentity: 'agent://growth-agent',
    entrypoint: 'examples/growth/langchain_growth_agent.py:create_agent',
    bootstrapStrategy: 'manifest-only',
    bootstrapMode: 'deferred',
    tags: ['growth', 'langchain'],
    scenarios: ['fraud/high-value-new-device@1.0.0', 'trust/new-merchant-onboarding@1.0.0'],
    metrics: { runs: 3, signals: 2, averageLatencyMs: 668, averageConfidence: 0.81 }
  },
  {
    agentRef: 'risk-agent',
    name: 'Risk Agent',
    role: 'risk',
    framework: 'custom',
    description: 'Coordinates multi-agent votes and emits the final commitment.',
    transportIdentity: 'agent://risk-agent',
    entrypoint: 'examples/risk/risk_decider.ts:createCoordinator',
    bootstrapStrategy: 'manifest-only',
    bootstrapMode: 'deferred',
    tags: ['risk', 'decision'],
    scenarios: ['fraud/high-value-new-device@1.0.0', 'ops/vendor-outage-triage@1.0.0'],
    metrics: { runs: 3, signals: 1, averageLatencyMs: 1048, averageConfidence: 0.9 }
  },
  {
    agentRef: 'policy-agent',
    name: 'Policy Agent',
    role: 'policy',
    framework: 'langgraph',
    description: 'Applies trust, policy, and onboarding checks.',
    scenarios: ['trust/new-merchant-onboarding@1.0.0'],
    metrics: { runs: 1, signals: 1, averageLatencyMs: 1450, averageConfidence: 0.56 }
  }
];

export const MOCK_RUNTIME_MODES: RuntimeModeDescriptor[] = [
  {
    mode: 'macp.mode.decision.v1',
    modeVersion: '1.0.0',
    title: 'Decision',
    description: 'Proposal, evaluation, voting, and commitment.',
    determinismClass: 'eventual',
    participantModel: 'coordinator + specialists',
    messageTypes: ['Proposal', 'Evaluation', 'Vote', 'Commitment', 'Signal'],
    terminalMessageTypes: ['Commitment']
  },
  {
    mode: 'macp.mode.quorum.v1',
    modeVersion: '1.0.0',
    title: 'Quorum',
    description: 'Threshold approval with ballots.',
    determinismClass: 'eventual',
    participantModel: 'voters',
    messageTypes: ['ApprovalRequest', 'Approve', 'Reject', 'Abstain'],
    terminalMessageTypes: ['Approve', 'Reject']
  },
  {
    mode: 'ext.multi_round.v1',
    modeVersion: '0.1.0',
    title: 'Multi-Round Extension',
    description: 'Iterative convergence with explicit commitment.',
    determinismClass: 'iterative',
    participantModel: 'round-robin',
    messageTypes: ['Contribute', 'Commitment'],
    terminalMessageTypes: ['Commitment']
  }
];

export const MOCK_RUNTIME_MANIFEST: RuntimeManifestResult = {
  agentId: 'runtime://macp-rust-v1',
  title: 'MACP Rust Runtime',
  description: 'Reference runtime with file-backed replay and dynamic mode registry.',
  supportedModes: MOCK_RUNTIME_MODES.map((mode) => mode.mode),
  metadata: {
    protocolVersion: '0.4.0',
    storage: 'file-backend',
    transport: 'grpc'
  }
};

export const MOCK_RUNTIME_ROOTS: RuntimeRootDescriptor[] = [
  { uri: 'root://fraud/device-graph', name: 'Fraud Device Graph' },
  { uri: 'root://growth/customer-profile', name: 'Customer Profile' },
  { uri: 'root://ops/incidents', name: 'Incident Registry' }
];

export const MOCK_RUNTIME_HEALTH: RuntimeHealth = {
  ok: true,
  runtimeKind: 'rust',
  detail: 'streams healthy, circuit breaker closed',
  manifest: MOCK_RUNTIME_MANIFEST
};

export const MOCK_WEBHOOKS: WebhookSubscription[] = [
  {
    id: 'webhook-1',
    url: 'https://example.invalid/hooks/macp-runs',
    events: ['run.completed', 'run.failed'],
    active: true,
    createdAt: isoMinutesAgo(1200),
    updatedAt: isoMinutesAgo(120)
  }
];

export const MOCK_AUDIT_LOGS: AuditEntry[] = [
  {
    actor: 'ajitkoti',
    actorType: 'user',
    action: 'run.create',
    resource: 'run',
    resourceId: LIVE_RUN_ID,
    details: { scenarioRef: 'fraud/high-value-new-device@1.0.0' },
    requestId: 'req-live-1',
    createdAt: isoMinutesAgo(3)
  },
  {
    actor: 'system',
    actorType: 'service',
    action: 'run.archive',
    resource: 'run',
    resourceId: DECLINED_RUN_ID,
    details: { archivedBy: 'ops-automation' },
    requestId: 'req-ops-1',
    createdAt: isoMinutesAgo(380)
  }
];

export const MOCK_PROMETHEUS_METRICS = `# HELP macp_runs_total Total runs seen by control plane\n# TYPE macp_runs_total counter\nmacp_runs_total 4\n# HELP macp_live_runs Active runs\n# TYPE macp_live_runs gauge\nmacp_live_runs 1\n# HELP macp_stream_reconnects_total SSE reconnect count\n# TYPE macp_stream_reconnects_total counter\nmacp_stream_reconnects_total 2\n`;

export const MOCK_POLICY_DEFINITIONS: PolicyDefinition[] = [
  {
    policy_id: 'policy.default',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Default — no additional governance constraints',
    rules: {
      voting: { algorithm: 'none' },
      objection_handling: { critical_severity_vetoes: false, veto_threshold: 0 },
      evaluation: { minimum_confidence: 0.0, required_before_voting: false },
      commitment: { authority: 'initiator_only', require_vote_quorum: false, designated_roles: [] }
    }
  },
  {
    policy_id: 'policy.fraud.majority-veto',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Simple majority vote with designated veto power',
    rules: {
      voting: { algorithm: 'majority', threshold: 0.5, quorum: { type: 'percentage', value: 0.5 } },
      objection_handling: { critical_severity_vetoes: true, veto_threshold: 1 },
      evaluation: { minimum_confidence: 0.0, required_before_voting: false },
      commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
    }
  },
  {
    policy_id: 'policy.fraud.supermajority',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Supermajority (67%) approval required',
    rules: {
      voting: { algorithm: 'supermajority', threshold: 0.67, quorum: { type: 'percentage', value: 0.67 } },
      objection_handling: { critical_severity_vetoes: false, veto_threshold: 0 },
      evaluation: { minimum_confidence: 0.0, required_before_voting: false },
      commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
    }
  },
  {
    policy_id: 'policy.fraud.unanimous',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Fraud review: unanimous approval required',
    rules: {
      voting: { algorithm: 'unanimous', quorum: { type: 'percentage', value: 1.0 } },
      objection_handling: { critical_severity_vetoes: true, veto_threshold: 1 },
      evaluation: { minimum_confidence: 0.7, required_before_voting: true },
      commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
    }
  },
  {
    policy_id: 'policy.lending.conservative',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Conservative lending: supermajority with confidence floor',
    rules: {
      voting: { algorithm: 'supermajority', threshold: 0.67, quorum: { type: 'percentage', value: 0.67 } },
      objection_handling: { critical_severity_vetoes: true, veto_threshold: 1 },
      evaluation: { minimum_confidence: 0.6, required_before_voting: true },
      commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
    }
  },
  {
    policy_id: 'policy.claims.majority',
    mode: 'macp.mode.decision.v1',
    schema_version: 1,
    description: 'Claims review: simple majority',
    rules: {
      voting: { algorithm: 'majority', threshold: 0.5, quorum: { type: 'percentage', value: 0.5 } },
      objection_handling: { critical_severity_vetoes: false, veto_threshold: 0 },
      evaluation: { minimum_confidence: 0.0, required_before_voting: false },
      commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
    }
  }
];

export const MOCK_RUNTIME_POLICIES: RuntimePolicyDescriptor[] = [
  {
    policyId: 'policy.default',
    mode: 'macp.mode.decision.v1',
    description: 'Default — no additional governance constraints',
    rules: MOCK_POLICY_DEFINITIONS[0].rules,
    schemaVersion: 1,
    registeredAtUnixMs: Date.now() - 86400000 * 7
  },
  {
    policyId: 'policy.fraud.majority-veto',
    mode: 'macp.mode.decision.v1',
    description: 'Simple majority vote with designated veto power',
    rules: MOCK_POLICY_DEFINITIONS[1].rules,
    schemaVersion: 1,
    registeredAtUnixMs: Date.now() - 86400000 * 3
  },
  {
    policyId: 'policy.fraud.unanimous',
    mode: 'macp.mode.decision.v1',
    description: 'Fraud review: unanimous approval required',
    rules: MOCK_POLICY_DEFINITIONS[3].rules,
    schemaVersion: 1,
    registeredAtUnixMs: Date.now() - 86400000
  }
];

export const MOCK_CHARTS = {
  runVolume: [
    { label: '00:00', value: 4 },
    { label: '04:00', value: 7 },
    { label: '08:00', value: 9 },
    { label: '12:00', value: 12 },
    { label: '16:00', value: 8 },
    { label: '20:00', value: 5 }
  ],
  latency: [
    { label: 'Decision', value: 780, secondary: 1290 },
    { label: 'Task', value: 420, secondary: 880 },
    { label: 'Quorum', value: 605, secondary: 1104 },
    { label: 'Handoff', value: 310, secondary: 760 }
  ],
  errors: [
    { label: 'policy_timeout', value: 2 },
    { label: 'signal_validation', value: 1 },
    { label: 'runtime_disconnect', value: 1 }
  ],
  signals: [
    { label: 'low_device_trust', value: 3 },
    { label: 'vip_customer', value: 2 },
    { label: 'major_incident', value: 1 },
    { label: 'policy_timeout', value: 1 }
  ]
};

/**
 * Compute dashboard KPIs over an optional subset of runs. When `runs` is
 * omitted, falls back to the full mock set — preserves back-compat.
 * Used by `/observability` filter wiring to respond to scenario /
 * environment pickers in demo mode.
 */
export function computeDashboardKpis(runs: RunRecord[] = MOCK_RUNS): DashboardKpis {
  const totalRuns = runs.length;
  const activeRuns = runs.filter((run) =>
    ['queued', 'starting', 'binding_session', 'running'].includes(run.status)
  ).length;
  const completedRuns = runs.filter((run) => run.status === 'completed').length;
  const failedRuns = runs.filter((run) => run.status === 'failed').length;
  const cancelledRuns = runs.filter((run) => run.status === 'cancelled').length;
  const suspendedRuns = runs.filter((run) => run.status === 'suspended').length;
  const includedIds = new Set(runs.map((run) => run.id));
  const metricsForRuns = Object.entries(MOCK_RUN_METRICS).filter(([runId]) => includedIds.has(runId));
  const averageDurationMs =
    totalRuns > 0
      ? metricsForRuns.reduce((acc, [, metric]) => acc + (metric.durationMs ?? 0), 0) /
        Math.max(metricsForRuns.length, 1)
      : 0;
  const totalSignals = metricsForRuns.reduce((acc, [, metric]) => acc + metric.signalCount, 0);
  const totalCostUsd = runs.reduce((acc, run) => acc + Number(run.metadata?.estimatedCostUsd ?? 0), 0);
  const totalTokens = runs.reduce((acc, run) => acc + Number(run.metadata?.totalTokens ?? 0), 0);
  return {
    totalRuns,
    activeRuns,
    completedRuns,
    failedRuns,
    cancelledRuns,
    suspendedRuns,
    averageDurationMs,
    totalSignals,
    totalCostUsd,
    totalTokens
  };
}

export function compareMockRuns(leftRunId: string, rightRunId: string): RunComparisonResult {
  const leftState = MOCK_RUN_STATES[leftRunId];
  const rightState = MOCK_RUN_STATES[rightRunId];
  const leftRun = MOCK_RUNS.find((run) => run.id === leftRunId);
  const rightRun = MOCK_RUNS.find((run) => run.id === rightRunId);
  const leftParticipants = new Set(leftState?.participants.map((item) => item.participantId) ?? []);
  const rightParticipants = new Set(rightState?.participants.map((item) => item.participantId) ?? []);
  const leftSignals = new Set(leftState?.signals.signals.map((item) => item.name) ?? []);
  const rightSignals = new Set(rightState?.signals.signals.map((item) => item.name) ?? []);

  return {
    left: {
      runId: leftRunId,
      status: leftRun?.status ?? 'failed',
      modeName: String(leftRun?.metadata?.modeName ?? leftState?.run.modeName ?? ''),
      durationMs: MOCK_RUN_METRICS[leftRunId]?.durationMs
    },
    right: {
      runId: rightRunId,
      status: rightRun?.status ?? 'failed',
      modeName: String(rightRun?.metadata?.modeName ?? rightState?.run.modeName ?? ''),
      durationMs: MOCK_RUN_METRICS[rightRunId]?.durationMs
    },
    statusMatch: leftRun?.status === rightRun?.status,
    durationDeltaMs: (MOCK_RUN_METRICS[rightRunId]?.durationMs ?? 0) - (MOCK_RUN_METRICS[leftRunId]?.durationMs ?? 0),
    confidenceDelta: (rightState?.decision.current?.confidence ?? 0) - (leftState?.decision.current?.confidence ?? 0),
    participantsDiff: {
      added: [...rightParticipants].filter((value) => !leftParticipants.has(value)),
      removed: [...leftParticipants].filter((value) => !rightParticipants.has(value)),
      common: [...leftParticipants].filter((value) => rightParticipants.has(value))
    },
    signalsDiff: {
      added: [...rightSignals].filter((value) => !leftSignals.has(value)),
      removed: [...leftSignals].filter((value) => !rightSignals.has(value))
    }
  };
}

const frame0 = clone(liveBaseState);
frame0.timeline.latestSeq = 0;
frame0.timeline.totalEvents = 0;
frame0.timeline.recent = [];
frame0.participants[0].status = 'waiting';
frame0.participants[1].status = 'waiting';
frame0.participants[2].status = 'idle';
frame0.decision.current = undefined;
frame0.signals.signals = [];
frame0.progress.entries = [];

const frame1 = clone(frame0);
frame1.timeline.latestSeq = 1;
frame1.timeline.totalEvents = 1;
frame1.run.status = 'starting';
frame1.participants[2].status = 'active';
frame1.progress.entries = [
  { participantId: 'risk-agent', percentage: 10, message: 'Run created', ts: isoMinutesAgo(3) }
];

const frame2 = clone(frame1);
frame2.timeline.latestSeq = 2;
frame2.timeline.totalEvents = 2;
frame2.run.status = 'running';
frame2.progress.entries.push({
  participantId: 'risk-agent',
  percentage: 20,
  message: 'Session started',
  ts: isoMinutesAgo(3)
});

const frame3 = clone(frame2);
frame3.timeline.latestSeq = 3;
frame3.timeline.totalEvents = 3;
frame3.graph.nodes.find((node) => node.id === 'risk-agent')!.status = 'active';
frame3.progress.entries.push({
  participantId: 'risk-agent',
  percentage: 30,
  message: 'Participants observed',
  ts: isoMinutesAgo(3)
});

const frame4 = clone(frame3);
frame4.timeline.latestSeq = 4;
frame4.timeline.totalEvents = 4;
frame4.decision.current = {
  action: 'evaluate_transaction',
  confidence: 0.5,
  reasons: ['Initial proposal dispatched.'],
  finalized: false,
  proposalId: 'CUST-2048-initial-review'
};
frame4.progress.entries.push({
  participantId: 'risk-agent',
  percentage: 40,
  message: 'Kickoff proposal created',
  ts: isoMinutesAgo(2)
});

const frame5 = clone(frame4);
frame5.timeline.latestSeq = 5;
frame5.timeline.totalEvents = 5;
frame5.participants[0].status = 'active';
frame5.signals.signals = [liveBaseState.signals.signals[0]];
frame5.progress.entries.push({
  participantId: 'fraud-agent',
  percentage: 60,
  message: 'Low trust signal emitted',
  ts: isoMinutesAgo(2)
});

const frame6 = clone(liveBaseState);
frame6.timeline.recent = buildRecent(MOCK_RUN_EVENTS[LIVE_RUN_ID]);

const completedFrame0 = clone(completedState);
completedFrame0.run.status = 'queued';
completedFrame0.timeline.latestSeq = 0;
completedFrame0.timeline.totalEvents = 0;
completedFrame0.timeline.recent = [];
completedFrame0.decision.current = undefined;
completedFrame0.signals.signals = [];
completedFrame0.progress.entries = [];
completedFrame0.participants.forEach((participant) => {
  participant.status = 'waiting';
  participant.latestSummary = undefined;
});
completedFrame0.graph.nodes.forEach((node) => {
  node.status = node.id === 'start' ? 'completed' : 'waiting';
});

const completedFrame1 = clone(completedFrame0);
completedFrame1.timeline.latestSeq = 1;
completedFrame1.timeline.totalEvents = 1;
completedFrame1.run.status = 'starting';
completedFrame1.participants[2].status = 'active';
completedFrame1.graph.nodes.find((node) => node.id === 'risk-agent')!.status = 'active';
completedFrame1.progress.entries = [
  { participantId: 'risk-agent', percentage: 15, message: 'Run created', ts: isoMinutesAgo(58) }
];

const completedFrame2 = clone(completedFrame1);
completedFrame2.timeline.latestSeq = 3;
completedFrame2.timeline.totalEvents = 3;
completedFrame2.run.status = 'running';
completedFrame2.decision.current = {
  action: 'evaluate_transaction',
  confidence: 0.58,
  reasons: ['Specialist proposal broadcast.'],
  finalized: false,
  proposalId: 'CUST-1001-initial-review'
};
completedFrame2.progress.entries.push({
  participantId: 'risk-agent',
  percentage: 35,
  message: 'Initial proposal created',
  ts: isoMinutesAgo(57)
});

const completedFrame3 = clone(completedFrame2);
completedFrame3.timeline.latestSeq = 5;
completedFrame3.timeline.totalEvents = 5;
completedFrame3.participants[0].status = 'completed';
completedFrame3.participants[1].status = 'completed';
completedFrame3.participants[0].latestSummary = 'Fraud signal emitted.';
completedFrame3.participants[1].latestSummary = 'Growth signal emitted.';
completedFrame3.signals.signals = [...completedState.signals.signals];
completedFrame3.graph.nodes.find((node) => node.id === 'fraud-agent')!.status = 'completed';
completedFrame3.graph.nodes.find((node) => node.id === 'growth-agent')!.status = 'completed';
completedFrame3.progress.entries.push({
  participantId: 'fraud-agent',
  percentage: 80,
  message: 'Fraud evaluation complete',
  ts: isoMinutesAgo(56)
});
completedFrame3.progress.entries.push({
  participantId: 'growth-agent',
  percentage: 80,
  message: 'Growth analysis complete',
  ts: isoMinutesAgo(56)
});

const completedFrame4 = clone(completedState);
completedFrame4.run.status = 'running';
completedFrame4.timeline.latestSeq = 8;
completedFrame4.timeline.totalEvents = 8;
completedFrame4.graph.nodes.find((node) => node.id === 'final-output')!.status = 'active';
completedFrame4.progress.entries = [...completedState.progress.entries];
completedFrame4.progress.entries[2] = {
  participantId: 'risk-agent',
  percentage: 95,
  message: 'Decision finalized, output emitting',
  ts: isoMinutesAgo(55)
};

const completedFrame5 = clone(completedState);
completedFrame5.timeline.recent = buildRecent(MOCK_RUN_EVENTS[COMPLETED_RUN_ID]);

export const MOCK_RUN_FRAMES: Record<
  string,
  Array<{ seq: number; event: CanonicalEvent; snapshot: RunStateProjection }>
> = {
  [LIVE_RUN_ID]: [
    { seq: 1, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][0], snapshot: frame1 },
    { seq: 2, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][1], snapshot: frame2 },
    { seq: 3, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][2], snapshot: frame3 },
    { seq: 4, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][3], snapshot: frame4 },
    { seq: 5, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][4], snapshot: frame5 },
    { seq: 6, event: MOCK_RUN_EVENTS[LIVE_RUN_ID][5], snapshot: frame6 }
  ],
  [COMPLETED_RUN_ID]: [
    { seq: 1, event: MOCK_RUN_EVENTS[COMPLETED_RUN_ID][0], snapshot: completedFrame1 },
    { seq: 3, event: MOCK_RUN_EVENTS[COMPLETED_RUN_ID][2], snapshot: completedFrame2 },
    { seq: 5, event: MOCK_RUN_EVENTS[COMPLETED_RUN_ID][4], snapshot: completedFrame3 },
    { seq: 8, event: MOCK_RUN_EVENTS[COMPLETED_RUN_ID][7], snapshot: completedFrame4 },
    { seq: 9, event: MOCK_RUN_EVENTS[COMPLETED_RUN_ID][8], snapshot: completedFrame5 }
  ]
};
