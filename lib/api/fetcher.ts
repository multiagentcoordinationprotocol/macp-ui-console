import type { ProxyService } from '@/lib/server/integrations';

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly service: ProxyService;
  readonly path: string;

  constructor(status: number, statusText: string, body: string, service: ProxyService, path: string) {
    super(body || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.service = service;
    this.path = path;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * True when an error indicates the runtime's policy registry is read-only
 * (file-managed via `MACP_POLICIES_DIR`). The macp-control-plane surfaces this as
 * HTTP 405 with `errorCode: 'REGISTRY_READ_ONLY'` in the body (CP absorption T9).
 * We also match the underlying gRPC `FAILED_PRECONDITION` defensively, in case an
 * older CP build has not yet adopted the structured code.
 */
export function isRegistryReadOnlyError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 405) return true;
    return /REGISTRY_READ_ONLY|FAILED_PRECONDITION|read[-\s]?only/i.test(error.message);
  }
  if (error instanceof Error) {
    return /REGISTRY_READ_ONLY|read[-\s]?only/i.test(error.message);
  }
  return false;
}

export async function fetchJson<T>(service: ProxyService, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/proxy/${service}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(response.status, response.statusText, message, service, path);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

export function buildProxyUrl(service: ProxyService, path: string): string {
  return `/api/proxy/${service}${path}`;
}
