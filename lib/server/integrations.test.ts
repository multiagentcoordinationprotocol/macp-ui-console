import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getIntegrationConfig, buildUpstreamUrl } from '@/lib/server/integrations';

/**
 * `resolveBaseUrl` throws in production and falls back only in dev, so these cases pin the
 * dev-only fallbacks — the values a developer gets from `npm run dev:real` with no env file
 * written, which is a supported way to start the console.
 *
 * The playground fallback was `http://localhost:3000` until reconciliation: that is the Next.js
 * dev server, i.e. the console itself, so an unset variable made the proxy forward Examples
 * Service calls back into the console and surface a baffling 404 from Next's own router rather
 * than a connection error. The playground listens on `3100` on the host (`docker-compose.e2e.yml`
 * maps `3100:3000`).
 */
describe('getIntegrationConfig dev fallbacks', () => {
  const saved = {
    playground: process.env.MACP_PLAYGROUND_BASE_URL,
    controlPlane: process.env.MACP_CONTROL_PLANE_BASE_URL
  };
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.MACP_PLAYGROUND_BASE_URL;
    delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    if (saved.playground === undefined) delete process.env.MACP_PLAYGROUND_BASE_URL;
    else process.env.MACP_PLAYGROUND_BASE_URL = saved.playground;
    if (saved.controlPlane === undefined) delete process.env.MACP_CONTROL_PLANE_BASE_URL;
    else process.env.MACP_CONTROL_PLANE_BASE_URL = saved.controlPlane;
  });

  it('falls back the playground to port 3100, not the console dev server on 3000', () => {
    expect(getIntegrationConfig('macp-playground').baseUrl).toBe('http://localhost:3100');
  });

  it('falls back the control plane to port 3001', () => {
    expect(getIntegrationConfig('macp-control-plane').baseUrl).toBe('http://localhost:3001');
  });

  it('never resolves an upstream that points back at the console itself', () => {
    expect(buildUpstreamUrl('macp-playground', '/packs')).toBe('http://localhost:3100/packs');
    expect(buildUpstreamUrl('macp-playground', '/packs')).not.toContain('localhost:3000');
  });

  it('still prefers an explicit MACP_PLAYGROUND_BASE_URL over the fallback', () => {
    process.env.MACP_PLAYGROUND_BASE_URL = 'http://example.test:9999';
    expect(buildUpstreamUrl('macp-playground', '/packs')).toBe('http://example.test:9999/packs');
  });
});
