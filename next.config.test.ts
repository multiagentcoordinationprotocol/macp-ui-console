import { describe, it, expect } from 'vitest';
import nextConfig, { CANONICAL_ORIGIN, RETIRED_HOST } from './next.config';

describe('retired livid host redirect', () => {
  it('sends every path on the retired host to the canonical console, permanently', async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({
      source: '/:path*',
      has: [{ type: 'host', value: RETIRED_HOST }],
      destination: `${CANONICAL_ORIGIN}/:path*`,
      permanent: true
    });
    expect(RETIRED_HOST).toBe('ui-console-livid.vercel.app');
    expect(CANONICAL_ORIGIN).toBe('https://console.multiagentcoordinationprotocol.io');
  });

  it('only matches on host, so the canonical domain is never redirected to itself', async () => {
    const redirects = await nextConfig.redirects!();
    for (const redirect of redirects) {
      expect(redirect.has?.some((condition) => condition.type === 'host')).toBe(true);
    }
  });
});
