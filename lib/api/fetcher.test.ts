import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, fetchJson, buildProxyUrl } from './fetcher';

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------
describe('ApiError', () => {
  it('sets all properties from constructor arguments', () => {
    const err = new ApiError(422, 'Unprocessable Entity', 'bad input', 'macp-playground', '/runs');

    expect(err.status).toBe(422);
    expect(err.statusText).toBe('Unprocessable Entity');
    expect(err.message).toBe('bad input');
    expect(err.name).toBe('ApiError');
    expect(err.service).toBe('macp-playground');
    expect(err.path).toBe('/runs');
  });

  it('uses body as message when provided', () => {
    const err = new ApiError(400, 'Bad Request', 'Validation failed', 'macp-control-plane', '/state');

    expect(err.message).toBe('Validation failed');
  });

  it('falls back to "Request failed with status X" when body is empty', () => {
    const err = new ApiError(503, 'Service Unavailable', '', 'macp-playground', '/health');

    expect(err.message).toBe('Request failed with status 503');
  });

  it('isNotFound returns true for 404', () => {
    const err = new ApiError(404, 'Not Found', 'missing', 'macp-control-plane', '/runs/abc');

    expect(err.isNotFound).toBe(true);
  });

  it('isNotFound returns false for other statuses', () => {
    const err400 = new ApiError(400, 'Bad Request', 'bad', 'macp-playground', '/foo');
    const err500 = new ApiError(500, 'Internal Server Error', 'oops', 'macp-playground', '/bar');

    expect(err400.isNotFound).toBe(false);
    expect(err500.isNotFound).toBe(false);
  });

  it('is an instance of Error', () => {
    const err = new ApiError(500, 'Internal Server Error', 'boom', 'macp-playground', '/x');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------
describe('fetchJson', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  function mockResponse(status: number, body: unknown, statusText = 'OK') {
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      statusText,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body))
    };
  }

  it('makes GET request to correct proxy URL', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { id: 1 }));

    await fetchJson('macp-control-plane', '/runs/123');

    expect(mockFetch).toHaveBeenCalledWith('/api/proxy/macp-control-plane/runs/123', expect.any(Object));
  });

  it('sets content-type: application/json header', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));

    await fetchJson('macp-playground', '/packs');

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['content-type']).toBe('application/json');
  });

  it('sets cache: no-store', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));

    await fetchJson('macp-playground', '/packs');

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.cache).toBe('no-store');
  });

  it('passes through custom headers and they override defaults', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, {}));

    await fetchJson('macp-playground', '/packs', {
      headers: { 'content-type': 'text/plain', 'x-custom': 'value' }
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.headers['content-type']).toBe('text/plain');
    expect(callArgs.headers['x-custom']).toBe('value');
  });

  it('passes through init options (method, body)', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { ok: true }));

    await fetchJson('macp-control-plane', '/runs', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' })
    });

    const callArgs = mockFetch.mock.calls[0][1];
    expect(callArgs.method).toBe('POST');
    expect(callArgs.body).toBe(JSON.stringify({ name: 'test' }));
  });

  it('returns parsed JSON on 200', async () => {
    const payload = { id: 'run-1', status: 'completed' };
    mockFetch.mockResolvedValue(mockResponse(200, payload));

    const result = await fetchJson<{ id: string; status: string }>('macp-control-plane', '/runs/run-1');

    expect(result).toEqual(payload);
  });

  it('returns undefined on 204', async () => {
    mockFetch.mockResolvedValue(mockResponse(204, undefined));

    const result = await fetchJson('macp-control-plane', '/runs/run-1/cancel');

    expect(result).toBeUndefined();
  });

  it('throws ApiError on 400 with body text as message', async () => {
    mockFetch.mockResolvedValue(mockResponse(400, 'Invalid request body', 'Bad Request'));

    await expect(fetchJson('macp-playground', '/compile')).rejects.toThrow(ApiError);

    try {
      await fetchJson('macp-playground', '/compile');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toBe('Invalid request body');
    }
  });

  it('throws ApiError on 500 with correct status, service, and path', async () => {
    mockFetch.mockResolvedValue(mockResponse(500, 'Internal error', 'Internal Server Error'));

    try {
      await fetchJson('macp-control-plane', '/events');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.statusText).toBe('Internal Server Error');
      expect(apiErr.service).toBe('macp-control-plane');
      expect(apiErr.path).toBe('/events');
      expect(apiErr.message).toBe('Internal error');
    }
  });

  it('throws ApiError on 404', async () => {
    mockFetch.mockResolvedValue(mockResponse(404, 'Not found', 'Not Found'));

    try {
      await fetchJson('macp-playground', '/packs/missing');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.isNotFound).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// buildProxyUrl
// ---------------------------------------------------------------------------
describe('buildProxyUrl', () => {
  it('constructs correct URL for example service', () => {
    expect(buildProxyUrl('macp-playground', '/packs')).toBe('/api/proxy/macp-playground/packs');
  });

  it('constructs correct URL for macp-control-plane service', () => {
    expect(buildProxyUrl('macp-control-plane', '/runs')).toBe('/api/proxy/macp-control-plane/runs');
  });

  it('handles paths with query strings', () => {
    expect(buildProxyUrl('macp-control-plane', '/runs?status=completed&limit=10')).toBe(
      '/api/proxy/macp-control-plane/runs?status=completed&limit=10'
    );
  });
});
