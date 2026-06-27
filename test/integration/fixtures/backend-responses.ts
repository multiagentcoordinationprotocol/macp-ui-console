/**
 * Canned backend responses matching the shapes returned by
 * the macp-control-plane and example-service APIs.
 */

/* ─── IDs ─── */

export const RUN_ID_1 = '00000000-0000-0000-0000-000000000001';
export const RUN_ID_2 = '00000000-0000-0000-0000-000000000002';
export const TRACE_ID = 'trace-integration-001';

/* ─── Control-plane responses ─── */

export function runRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'running',
    runtimeKind: 'rust',
    runtimeVersion: 'v1',
    runtimeSessionId: `session-${id}`,
    traceId: TRACE_ID,
    createdAt: '2026-04-01T10:00:00Z',
    startedAt: '2026-04-01T10:00:01Z',
    endedAt: null,
    tags: ['integration-test'],
    sourceKind: 'api',
    sourceRef: 'test',
    metadata: {},
    ...overrides
  };
}

export function runsListResponse(count = 2) {
  const data = Array.from({ length: count }, (_, i) =>
    runRecord(`00000000-0000-0000-0000-00000000000${i + 1}`, {
      status: i === 0 ? 'running' : 'completed'
    })
  );
  return { data, total: count };
}

export function runStateProjection(runId: string) {
  return {
    run: {
      runId,
      status: 'running',
      runtimeSessionId: `session-${runId}`,
      startedAt: '2026-04-01T10:00:01Z',
      traceId: TRACE_ID,
      modeName: 'macp.mode.decision.v1'
    },
    participants: [
      { participantId: 'agent-a', role: 'proposer', status: 'active', latestActivityAt: '2026-04-01T10:00:05Z' },
      { participantId: 'agent-b', role: 'evaluator', status: 'idle' }
    ],
    graph: {
      nodes: [
        { id: 'agent-a', kind: 'participant', status: 'active' },
        { id: 'agent-b', kind: 'participant', status: 'idle' }
      ],
      edges: [{ from: 'agent-a', to: 'agent-b', kind: 'message', ts: '2026-04-01T10:00:05Z' }]
    },
    decision: { current: { action: 'approve', confidence: 0.85, reasons: ['meets criteria'], finalized: false } },
    signals: { signals: [] },
    progress: { entries: [] },
    timeline: {
      latestSeq: 5,
      totalEvents: 5,
      recent: [
        {
          id: 'evt-001',
          seq: 5,
          ts: '2026-04-01T10:00:05Z',
          type: 'message.sent',
          subject: { kind: 'participant', id: 'agent-a' }
        }
      ]
    },
    trace: { traceId: TRACE_ID, spanCount: 3, linkedArtifacts: [] },
    outboundMessages: { total: 3, queued: 0, accepted: 3, rejected: 0 },
    policy: {
      policyVersion: 'policy.default',
      policyDescription: 'Default policy',
      resolvedAt: '2026-04-01T10:05:00Z',
      commitmentEvaluations: [
        { commitmentId: 'eval-001', decision: 'allow', reasons: ['Threshold met'], ts: '2026-04-01T10:04:00Z' }
      ]
    },
    llm: {
      calls: [
        {
          participantId: 'agent-a',
          model: 'claude-sonnet-4-6',
          promptTokens: 1200,
          completionTokens: 300,
          totalTokens: 1500,
          latencyMs: 540,
          estimatedCostUsd: 0.0081,
          ts: '2026-04-01T10:00:03Z',
          messageId: 'msg-llm-1'
        }
      ],
      totals: {
        callCount: 1,
        promptTokens: 1200,
        completionTokens: 300,
        totalTokens: 1500,
        estimatedCostUsd: 0.0081
      }
    }
  };
}

export function canonicalEvents(runId: string, count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${String(i + 1).padStart(3, '0')}`,
    runId,
    seq: i + 1,
    ts: `2026-04-01T10:00:0${i + 1}Z`,
    type: i === 0 ? 'session.opened' : 'message.sent',
    subject: { kind: 'participant', id: 'agent-a' },
    source: { kind: 'runtime', name: 'rust-runtime', rawType: 'StreamEnvelope' },
    data: { messageType: 'Proposal', payload: { value: i } }
  }));
}

export function metricsSummary(runId: string) {
  return {
    runId,
    eventCount: 12,
    messageCount: 8,
    signalCount: 2,
    proposalCount: 1,
    toolCallCount: 0,
    decisionCount: 1,
    streamReconnectCount: 0,
    firstEventAt: '2026-04-01T10:00:01Z',
    lastEventAt: '2026-04-01T10:00:12Z',
    durationMs: 11000,
    sessionState: 'SESSION_STATE_OPEN',
    promptTokens: 1500,
    completionTokens: 400,
    totalTokens: 1900,
    estimatedCostUsd: 0.005
  };
}

export function traceSummary() {
  return {
    traceId: TRACE_ID,
    spanCount: 8,
    lastSpanId: 'span-008',
    linkedArtifacts: ['artifact-001']
  };
}

export function artifactsList(runId: string) {
  return [
    {
      id: 'artifact-001',
      runId,
      kind: 'trace',
      label: 'OpenTelemetry trace',
      uri: `https://traces.example.com/${TRACE_ID}`,
      createdAt: '2026-04-01T10:00:12Z'
    },
    {
      id: 'artifact-002',
      runId,
      kind: 'json',
      label: 'Decision summary',
      inline: { action: 'approve', confidence: 0.85 },
      createdAt: '2026-04-01T10:00:12Z'
    }
  ];
}

export function dashboardOverview() {
  return {
    kpis: {
      totalRuns: 42,
      activeRuns: 3,
      completedRuns: 35,
      failedRuns: 4,
      cancelledRuns: 0,
      avgDurationMs: 8500,
      totalSignals: 120,
      totalTokens: 84200,
      totalCostUsd: 3.42
    },
    charts: {
      runVolume: { labels: ['Mon', 'Tue', 'Wed'], data: [10, 12, 8] },
      latency: { labels: ['Mon', 'Tue', 'Wed'], data: [200, 180, 210] },
      errorClasses: { labels: ['timeout', 'validation'], data: [3, 1] },
      signalVolume: { labels: ['Mon', 'Tue', 'Wed'], data: [30, 40, 50] },
      throughput: { labels: ['Mon', 'Tue', 'Wed'], data: [9, 11, 7] },
      queueDepth: { labels: ['Mon', 'Tue', 'Wed'], data: [2, 1, 3] },
      latencyP50: { labels: ['Mon', 'Tue', 'Wed'], data: [150, 140, 160] },
      latencyP95: { labels: ['Mon', 'Tue', 'Wed'], data: [420, 380, 440] },
      latencyP99: { labels: ['Mon', 'Tue', 'Wed'], data: [900, 820, 980] },
      cost: { labels: ['Mon', 'Tue', 'Wed'], data: [1.1, 1.3, 1.0] },
      successRate: { labels: ['Mon', 'Tue', 'Wed'], data: [92, 88, 95] },
      decisionOutcome: { labels: ['Mon', 'Tue', 'Wed'], data: [5, -1, 3] },
      perScenario: { labels: ['fraud', 'lending', 'compliance'], data: [18, 12, 4] }
    },
    recentRuns: [runRecord(RUN_ID_1, { status: 'running' }), runRecord(RUN_ID_2, { status: 'completed' })],
    runtimeHealth: { ok: true, runtimeKind: 'rust', detail: 'healthy' }
  };
}

export function runtimeHealth() {
  return { ok: true, runtimeKind: 'rust', detail: 'all systems operational' };
}

export function runtimeManifest() {
  return {
    agentId: 'macp-runtime',
    title: 'MACP Rust Runtime',
    description: 'Multi-Agent Coordination Protocol runtime',
    supportedModes: ['macp.mode.decision.v1', 'macp.mode.task.v1'],
    metadata: { version: '0.5.0' }
  };
}

export function runtimeModes() {
  return [
    {
      mode: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      title: 'Decision Mode',
      description: 'Collaborative decision-making',
      messageTypes: ['Proposal', 'Evaluation', 'Vote', 'Commitment'],
      terminalMessageTypes: ['Commitment']
    }
  ];
}

export function runtimeRoots() {
  return [{ uri: 'file:///workspace', name: 'workspace' }];
}

export function auditLogs() {
  return {
    data: [
      {
        id: 'audit-001',
        actor: 'user:admin',
        actorType: 'user',
        action: 'run.create',
        resource: 'run',
        resourceId: RUN_ID_1,
        details: {},
        createdAt: '2026-04-01T10:00:00Z'
      },
      {
        id: 'audit-002',
        actor: 'system',
        actorType: 'system',
        action: 'run.complete',
        resource: 'run',
        resourceId: RUN_ID_1,
        details: { durationMs: 8500 },
        createdAt: '2026-04-01T10:00:09Z'
      }
    ],
    total: 2
  };
}

export function webhooksList() {
  return [
    {
      id: 'wh-001',
      url: 'https://hooks.example.com/macp',
      events: ['run.completed', 'run.failed'],
      active: true,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z'
    }
  ];
}

export function validateRunResponse(valid = true) {
  return {
    valid,
    errors: valid ? [] : ['session.participants must have at least 2 entries'],
    warnings: [],
    runtime: { reachable: true, supportedModes: ['macp.mode.decision.v1'], capabilities: null }
  };
}

export function createRunResponse(runId = RUN_ID_1) {
  // CP `POST /runs` now also returns sessionId alongside runId.
  return { runId, sessionId: runId, status: 'queued', traceId: TRACE_ID };
}

export function readinessProbe() {
  return {
    ok: true,
    database: 'ok',
    runtime: { ok: true, runtimeKind: 'rust', detail: 'Healthy' },
    streamConsumer: 'ok',
    circuitBreaker: 'CLOSED'
  };
}

/* ─── Example-service responses ─── */

export function packsList() {
  return [
    { slug: 'fraud', name: 'Fraud Detection', description: 'Fraud detection scenarios', tags: ['finance'] },
    { slug: 'lending', name: 'Lending', description: 'Lending decision scenarios', tags: ['finance'] }
  ];
}

export function scenariosList(packSlug: string) {
  if (packSlug === 'fraud') {
    return [
      {
        scenario: 'high-value-new-device',
        name: 'High-Value New-Device Transaction',
        summary: 'Detects fraud on high-value transactions from new devices',
        versions: ['1.0.0'],
        templates: ['default', 'strict-risk'],
        tags: ['fraud', 'device-fingerprinting'],
        policyVersion: 'policy.default',
        policyHints: {
          type: 'none',
          description: 'Default policy',
          vetoThreshold: 1,
          minimumConfidence: 0.0,
          designatedRoles: []
        }
      }
    ];
  }
  return [
    {
      scenario: 'mortgage-approval',
      name: 'Mortgage Approval',
      summary: 'Multi-agent mortgage risk assessment',
      versions: ['1.0.0'],
      templates: ['default'],
      tags: ['lending'],
      policyVersion: 'policy.lending.standard',
      policyHints: { type: 'majority', description: 'Majority vote', threshold: 0.5, vetoEnabled: false }
    }
  ];
}

export function launchSchema(scenarioRef = 'high-value-new-device') {
  return {
    scenarioRef: `fraud/${scenarioRef}@1.0.0`,
    templateId: 'default',
    formSchema: {
      type: 'object',
      properties: {
        transactionAmount: { type: 'number', description: 'Transaction amount in USD' },
        deviceId: { type: 'string', description: 'Device fingerprint identifier' }
      },
      required: ['transactionAmount']
    },
    defaults: { transactionAmount: 5000, deviceId: 'device-abc-123' },
    participants: [
      { id: 'fraud-detector', role: 'proposer', agentRef: 'fraud-detector' },
      { id: 'risk-assessor', role: 'evaluator', agentRef: 'risk-assessor' }
    ],
    agents: [
      {
        agentRef: 'fraud-detector',
        name: 'Fraud Detector',
        role: 'proposer',
        framework: 'langchain',
        transportIdentity: 'grpc://fraud-detector:50051',
        entrypoint: 'agents/fraud_detector.py',
        bootstrapStrategy: 'container',
        bootstrapMode: 'eager'
      },
      {
        agentRef: 'risk-assessor',
        name: 'Risk Assessor',
        role: 'evaluator',
        framework: 'custom',
        transportIdentity: 'grpc://risk-assessor:50052',
        entrypoint: 'agents/risk_assessor.py',
        bootstrapStrategy: 'container',
        bootstrapMode: 'lazy'
      }
    ],
    runtime: { kind: 'rust', version: 'v1' },
    launchSummary: {
      modeName: 'macp.mode.decision.v1',
      modeVersion: '1.0.0',
      configurationVersion: '1.0.0',
      policyVersion: 'policy.default',
      policyHints: {
        type: 'none',
        description: 'Default policy',
        vetoThreshold: 1,
        minimumConfidence: 0.0,
        designatedRoles: []
      },
      ttlMs: 300000,
      initiatorParticipantId: 'fraud-detector'
    }
  };
}

export function compileLaunchResult() {
  return {
    runDescriptor: {
      mode: 'live',
      runtime: { kind: 'rust', version: 'v1' },
      session: {
        sessionId: '00000000-0000-4000-8000-0000ca7a1001',
        modeName: 'macp.mode.decision.v1',
        modeVersion: '1.0.0',
        configurationVersion: '1.0.0',
        ttlMs: 300000,
        participants: [{ id: 'fraud-detector' }, { id: 'risk-assessor' }]
      }
    },
    initiator: {
      participantId: 'fraud-detector',
      sessionStart: {
        intent: 'evaluate transaction',
        participants: ['fraud-detector', 'risk-assessor'],
        ttlMs: 300000,
        modeVersion: '1.0.0',
        configurationVersion: '1.0.0',
        context: { transactionAmount: 5000 }
      },
      kickoff: {
        messageType: 'FraudAnalysis',
        payload: { transactionAmount: 5000 }
      }
    },
    sessionId: '00000000-0000-4000-8000-0000ca7a1001',
    mode: 'live',
    scenarioMeta: {
      sessionContext: { transactionAmount: 5000 },
      initiatorParticipantId: 'fraud-detector'
    },
    display: {
      title: 'High-Value New-Device Transaction',
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      templateId: 'default'
    },
    participantBindings: [
      { participantId: 'fraud-detector', role: 'proposer', agentRef: 'fraud-detector' },
      { participantId: 'risk-assessor', role: 'evaluator', agentRef: 'risk-assessor' }
    ]
  };
}

export function agentMetrics() {
  return [
    { participantId: 'fraud-detector', runs: 24, signals: 48, messages: 96, averageConfidence: 0.87 },
    { participantId: 'risk-assessor', runs: 24, signals: 24, messages: 48, averageConfidence: 0.92 }
  ];
}

export function batchExportResponse(runIds: string[]) {
  return runIds.map((id) => ({
    run: runRecord(id, { status: 'completed' }),
    projection: runStateProjection(id),
    canonicalEvents: canonicalEvents(id, 2),
    rawEvents: [],
    artifacts: artifactsList(id),
    metrics: metricsSummary(id),
    exportedAt: new Date().toISOString()
  }));
}

export function prometheusMetrics() {
  return '# HELP macp_runs_total Total runs\nmacp_runs_total 42\n# HELP macp_events_total Total events\nmacp_events_total 1200\n';
}

export function readinessProbeResponse() {
  return {
    ok: true,
    database: 'ok',
    runtime: { ok: true, runtimeKind: 'rust', detail: 'Healthy' },
    streamConsumer: 'ok',
    circuitBreaker: 'CLOSED'
  };
}

export function runtimeManifestResponse() {
  return {
    agentId: 'macp-runtime-1',
    title: 'MACP Runtime',
    supportedModes: ['negotiation', 'decision'],
    metadata: { version: '1.0.0' }
  };
}

export function runtimeModesResponse() {
  return [
    {
      mode: 'negotiation',
      modeVersion: '1.0.0',
      title: 'Negotiation Mode',
      description: 'Multi-party negotiation protocol',
      messageTypes: ['Offer', 'CounterOffer', 'Accept', 'Reject'],
      terminalMessageTypes: ['Accept', 'Reject']
    }
  ];
}

export function runtimeRootsResponse() {
  return [{ uri: 'file:///opt/macp/workspace', name: 'macp-workspace' }];
}

export function agentProfiles() {
  return [
    {
      agentRef: 'fraud-detector',
      name: 'Fraud Detector',
      role: 'proposer',
      framework: 'langchain',
      description: 'Analyzes transactions for fraud signals',
      transportIdentity: 'grpc://fraud-detector:50051',
      tags: ['fraud'],
      scenarios: ['fraud/high-value-new-device@1.0.0'],
      metrics: { runs: 24, signals: 48, averageLatencyMs: 1200, averageConfidence: 0.87 }
    },
    {
      agentRef: 'risk-assessor',
      name: 'Risk Assessor',
      role: 'evaluator',
      framework: 'custom',
      description: 'Evaluates risk based on multiple signals',
      transportIdentity: 'grpc://risk-assessor:50052',
      tags: ['risk'],
      scenarios: ['fraud/high-value-new-device@1.0.0'],
      metrics: { runs: 24, signals: 24, averageLatencyMs: 800, averageConfidence: 0.92 }
    }
  ];
}
