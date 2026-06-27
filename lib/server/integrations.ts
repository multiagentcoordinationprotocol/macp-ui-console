export type ProxyService = 'macp-playground' | 'macp-control-plane';

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
      baseUrl: resolveBaseUrl('MACP_PLAYGROUND_BASE_URL', 'http://localhost:3000', service),
      authHeaderName: 'x-api-key',
      authToken: resolveAuthToken('MACP_PLAYGROUND_API_KEY', service)
    };
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
