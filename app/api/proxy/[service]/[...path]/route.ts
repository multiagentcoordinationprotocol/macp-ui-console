import { NextRequest } from 'next/server';
import { buildUpstreamUrl, getIntegrationConfig, isProxyService } from '@/lib/server/integrations';
import { findAllowedRoute, type RateLimitClass } from '@/lib/server/proxy-allowlist';
import { getClientIp, proxyRateLimiter, RATE_LIMIT_POLICIES } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';

async function forward(request: NextRequest, context: { params: Promise<{ service: string; path: string[] }> }) {
  const { service, path } = await context.params;
  if (!isProxyService(service)) {
    return Response.json({ message: `Unknown proxy service '${service}'.` }, { status: 404 });
  }

  // W0.1: the proxy forwards with server-held credentials and has no visitor auth, so only the
  // (service, method, path) triples the console UI needs are forwarded. Everything else is refused
  // here, before any upstream URL is built or fetched.
  const segments = path ?? [];
  const method = request.method.toUpperCase();
  const route = findAllowedRoute(service, method, segments);
  if (!route) {
    return Response.json(
      { message: `${method} /${segments.join('/')} is not exposed by the console proxy.` },
      { status: 403 }
    );
  }

  const limitClass = route.limit ?? 'read';
  const ip = getClientIp(request.headers);
  // Every allowed request draws from the read quota; launch and what-if routes additionally draw from
  // their own, much smaller quota, so read traffic cannot be used to dodge those caps or vice versa.
  const buckets: RateLimitClass[] = limitClass === 'read' ? ['read'] : ['read', limitClass];
  for (const bucket of buckets) {
    const result = proxyRateLimiter.check(`${bucket}:${ip}`, RATE_LIMIT_POLICIES[bucket]);
    if (!result.allowed) {
      return Response.json(
        { message: 'Too many requests. Please slow down and try again shortly.' },
        {
          status: 429,
          headers: {
            'retry-after': String(result.retryAfterSeconds),
            'x-ratelimit-limit': String(result.limit),
            'x-ratelimit-remaining': '0'
          }
        }
      );
    }
  }

  const config = getIntegrationConfig(service);
  const upstreamUrl = buildUpstreamUrl(service, `/${segments.join('/')}`, request.nextUrl.search);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (['host', 'connection', 'content-length'].includes(key.toLowerCase())) return;
    headers.set(key, value);
  });

  if (config.authToken) {
    if (config.authHeaderName === 'authorization') {
      headers.set('authorization', `Bearer ${config.authToken}`);
    } else if (config.authHeaderName) {
      headers.set(config.authHeaderName, config.authToken);
    }
  }

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.text();

  const response = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store'
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('x-macp-ui-proxy', service);
  responseHeaders.delete('content-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
