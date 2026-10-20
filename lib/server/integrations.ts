export const PROXY_SERVICES = ['macp-playground', 'macp-control-plane'] as const;

export type ProxyService = (typeof PROXY_SERVICES)[number];

/**
 * Narrows the raw `[service]` route segment. The proxy attaches server-held credentials, so it must
 * forward only to a known service; anything else is refused before an upstream URL is built (#58).
 */
export function isProxyService(value: string): value is ProxyService {
  return (PROXY_SERVICES as readonly string[]).includes(value);
}

interface ServiceConfig {
  service: ProxyService;
  baseUrl: string;
  authHeaderName?: string;
  authToken?: string;
}

const isProduction = process.env.NODE_ENV === 'production';

function resolveBaseUrl(envVar: string, fallback: string, service: ProxyService): string {
  const url = process.env[envVar];
  if (url) return url;
  if (isProduction) {
    throw new Error(
      `[MACP UI] ${envVar} is required in production. ` +
        `Service '${service}' cannot fall back to ${fallback} in a production build.`
    );
  }
  console.warn(`[MACP UI] ${envVar} not set, falling back to ${fallback} (dev only)`);
  return fallback;
}

function resolveAuthToken(envVar: string, service: ProxyService): string {
  const token = process.env[envVar] ?? '';
  if (!token && isProduction) {
    console.warn(`[MACP UI] ${envVar} is not set. Requests to '${service}' will be unauthenticated.`);
  }
  return token;
}

export function getIntegrationConfig(service: ProxyService): ServiceConfig {
  if (service === 'macp-playground') {
    return {
      service,
      baseUrl: resolveBaseUrl('MACP_PLAYGROUND_BASE_URL', 'http://localhost:3100', service),
      authHeaderName: 'x-api-key',
      authToken: resolveAuthToken('MACP_PLAYGROUND_API_KEY', service)
    };
  }

  // Fail closed: an unknown service must never inherit the control plane's URL and API key.
  if (service !== 'macp-control-plane') {
    throw new Error(`[MACP UI] Unknown proxy service '${String(service)}'.`);
  }

  return {
    service,
    baseUrl: resolveBaseUrl('MACP_CONTROL_PLANE_BASE_URL', 'http://localhost:3001', service),
    authHeaderName: 'authorization',
    authToken: resolveAuthToken('MACP_CONTROL_PLANE_API_KEY', service)
  };
}

export function buildUpstreamUrl(service: ProxyService, path: string, search?: string): string {
  const config = getIntegrationConfig(service);
  const normalizedBase = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}${search ?? ''}`;
}
