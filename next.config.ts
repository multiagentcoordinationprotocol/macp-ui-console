import type { NextConfig } from 'next';

/**
 * `ui-console-livid.vercel.app` is the Vercel project's default domain. It once served a mock-data
 * build and still circulates in old links, so it is retired by sending every request on that host to
 * the real console, path and query intact (W1.7). Matching on the exact host leaves preview and
 * per-deployment `*.vercel.app` URLs alone. 308 keeps the method, so a stray POST is not turned into
 * a GET.
 */
export const RETIRED_HOST = 'ui-console-livid.vercel.app';
export const CANONICAL_ORIGIN = 'https://console.multiagentcoordinationprotocol.io';

const nextConfig: NextConfig = {
  // Standalone output only for the container image (Dockerfile sets MACP_UI_STANDALONE=1, W3.7);
  // the Vercel build is left exactly as it was.
  ...(process.env.MACP_UI_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  reactStrictMode: true,
  typedRoutes: false,
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: RETIRED_HOST }],
        destination: `${CANONICAL_ORIGIN}/:path*`,
        permanent: true
      }
    ];
  }
};

export default nextConfig;
