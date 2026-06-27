import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FetchMocker } from './helpers/fetch-mocker';
import {
  packsList,
  scenariosList,
  launchSchema,
  compileLaunchResult,
  agentProfiles
} from './fixtures/backend-responses';

/**
 * Integration tests for scenario catalog operations through the API client.
 * Covers: listPacks, listScenarios, getLaunchSchema, compileLaunch,
 * runExample, getAgentProfiles/getAgentProfile.
 */
describe('Scenarios Catalog (integration)', () => {
  let mocker: FetchMocker;

  beforeAll(() => {
    mocker = new FetchMocker();
    mocker.install();
  });

  afterAll(() => {
    mocker.restore();
  });

  beforeEach(() => {
    mocker.clearRequests();
  });

  describe('listPacks', () => {
    it('returns packs from example-service', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
        status: 200,
        body: packsList()
      }));

      const { listPacks } = await import('@/lib/api/client');
      const packs = await listPacks(false);

      expect(packs).toHaveLength(2);
      expect(packs[0].slug).toBe('fraud');
      expect(packs[1].slug).toBe('lending');
    });

    it('returns empty array when no packs exist', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/packs', () => ({
        status: 200,
        body: []
      }));

      const { listPacks } = await import('@/lib/api/client');
      const packs = await listPacks(false);

      expect(packs).toEqual([]);
    });
  });

  describe('listScenarios', () => {
    it('returns scenarios for a specific pack', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/packs/fraud/scenarios', () => ({
        status: 200,
        body: scenariosList('fraud')
      }));

      const { listScenarios } = await import('@/lib/api/client');
      const scenarios = await listScenarios('fraud', false);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].scenario).toBe('high-value-new-device');
      expect(scenarios[0].versions).toContain('1.0.0');
      expect(scenarios[0].templates).toContain('default');
    });

    it('returns scenarios with policyVersion when backend provides it', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/packs/fraud/scenarios', () => ({
        status: 200,
        body: scenariosList('fraud')
      }));

      const { listScenarios } = await import('@/lib/api/client');
      const scenarios = await listScenarios('fraud', false);

      expect(scenarios[0]).toHaveProperty('policyVersion', 'policy.default');
      expect(scenarios[0]).toHaveProperty('policyHints');
      expect(scenarios[0].policyHints).toHaveProperty('type', 'none');
    });

    it('returns different scenarios per pack', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/packs/lending/scenarios', () => ({
        status: 200,
        body: scenariosList('lending')
      }));

      const { listScenarios } = await import('@/lib/api/client');
      const scenarios = await listScenarios('lending', false);

      expect(scenarios[0].scenario).toBe('mortgage-approval');
    });
  });

  describe('getLaunchSchema', () => {
    it('returns form schema, agents, and launch summary', async () => {
      mocker.on(
        'GET',
        '/api/proxy/macp-playground/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema',
        () => ({
          status: 200,
          body: launchSchema()
        })
      );

      const { getLaunchSchema } = await import('@/lib/api/client');
      const schema = await getLaunchSchema('fraud', 'high-value-new-device', '1.0.0', undefined, false);

      expect(schema.scenarioRef).toContain('fraud/high-value-new-device');
      expect(schema.formSchema).toHaveProperty('properties');
      expect(schema.agents).toHaveLength(2);
      expect(schema.participants).toHaveLength(2);
      expect(schema.launchSummary.modeName).toBe('macp.mode.decision.v1');
    });

    it('passes template as query parameter', async () => {
      mocker.on(
        'GET',
        '/api/proxy/macp-playground/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema',
        () => ({
          status: 200,
          body: launchSchema()
        })
      );

      const { getLaunchSchema } = await import('@/lib/api/client');
      await getLaunchSchema('fraud', 'high-value-new-device', '1.0.0', 'strict-risk', false);

      const req = mocker.requests.at(-1)!;
      expect(req.url).toContain('template=strict-risk');
    });
  });

  describe('compileLaunch', () => {
    it('sends compile request and returns execution request + display', async () => {
      mocker.on('POST', '/api/proxy/macp-playground/launch/compile', () => ({
        status: 200,
        body: compileLaunchResult()
      }));

      const { compileLaunch } = await import('@/lib/api/client');
      const result = await compileLaunch(
        {
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          inputs: { transactionAmount: 5000 }
        },
        false
      );

      expect(result.mode).toBe('live');
      expect(result.runDescriptor.session.modeName).toBe('macp.mode.decision.v1');
      expect(result.display.title).toBe('High-Value New-Device Transaction');
      expect(result.participantBindings).toHaveLength(2);

      // Verify POST body
      const postBody = mocker.requests.at(-1)!.body as Record<string, unknown>;
      expect(postBody.scenarioRef).toBe('fraud/high-value-new-device@1.0.0');
      expect(postBody.inputs).toEqual({ transactionAmount: 5000 });
    });
  });

  describe('runExample', () => {
    it('sends run request to example-service', async () => {
      mocker.on('POST', '/api/proxy/macp-playground/examples/run', () => ({
        status: 200,
        body: {
          compiled: compileLaunchResult(),
          hostedAgents: [{ agentRef: 'fraud-detector', participantId: 'fraud-detector', status: 'bootstrapped' }],
          sessionId: '00000000-0000-0000-0000-000000000001'
        }
      }));

      const { runExample } = await import('@/lib/api/client');
      const result = await runExample(
        {
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          inputs: { transactionAmount: 5000 },
          bootstrapAgents: true
        },
        false
      );

      expect(result.sessionId).toBeDefined();
      expect(result.hostedAgents).toBeDefined();
    });
  });

  describe('Agent profiles', () => {
    it('getAgentProfiles returns all agents', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/agents', () => ({
        status: 200,
        body: agentProfiles()
      }));

      const { getAgentProfiles } = await import('@/lib/api/client');
      const agents = await getAgentProfiles(false);

      expect(agents).toHaveLength(2);
      expect(agents[0].agentRef).toBe('fraud-detector');
      expect(agents[0].framework).toBe('langchain');
      expect(agents[0].metrics?.runs).toBe(24);
    });

    it('getAgentProfile returns single agent by ref', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/agents/fraud-detector', () => ({
        status: 200,
        body: agentProfiles()[0]
      }));

      const { getAgentProfile } = await import('@/lib/api/client');
      const agent = await getAgentProfile('fraud-detector', false);

      expect(agent).toBeDefined();
      expect(agent!.agentRef).toBe('fraud-detector');
      expect(agent!.scenarios).toContain('fraud/high-value-new-device@1.0.0');
    });

    it('getAgentProfile returns undefined for unknown agent', async () => {
      mocker.on('GET', '/api/proxy/macp-playground/agents/unknown-agent', () => ({
        status: 404,
        body: { error: 'not found' }
      }));

      const { getAgentProfile } = await import('@/lib/api/client');
      const agent = await getAgentProfile('unknown-agent', false);

      expect(agent).toBeUndefined();
    });
  });
});
