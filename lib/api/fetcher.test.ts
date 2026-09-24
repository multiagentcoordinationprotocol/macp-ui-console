import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError, describeApiError, fetchJson, buildProxyUrl, isRegistryReadOnlyError } from './fetcher';

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
// isRegistryReadOnlyError
// ---------------------------------------------------------------------------
describe('isRegistryReadOnlyError', () => {
  it('detects the CP 405 REGISTRY_READ_ONLY response', () => {
    const err = new ApiError(
      405,
      'Method Not Allowed',
      JSON.stringify({ errorCode: 'REGISTRY_READ_ONLY' }),
      'macp-control-plane',
      '/runtime/policies'
    );
    expect(isRegistryReadOnlyError(err)).toBe(true);
  });

  it('detects the structured errorCode on a status other than 405', () => {
    // Today's CP always pairs REGISTRY_READ_ONLY with 405, so the status check alone would
    // suffice against it — this pins the structured path independently, so the function keeps
    // working if the CP ever raises the same code with a different status.
    //
    // The code is written with an escaped `Y` on purpose. `ApiError.message` is the *raw* body,
    // so a plainly-spelled body would also satisfy the regex fallback below — and this test would
    // then pass even with the structured check deleted, pinning nothing. `\\u0059` survives
    // `JSON.parse` (so `errorCode` really is `REGISTRY_READ_ONLY`) but defeats a text search,
    // leaving the structured path as the only thing that can make this assertion true.
    const err = new ApiError(
      409,
      'Conflict',
      '{"statusCode":409,"errorCode":"REGISTRY_READ_ONL\\u0059","message":"registry is file-managed"}',
      'macp-control-plane',
      '/runtime/policies'
    );
    expect(isRegistryReadOnlyError(err)).toBe(true);
  });

  it('matches the REGISTRY_READ_ONLY / FAILED_PRECONDITION body defensively on other statuses', () => {
    expect(
      isRegistryReadOnlyError(
        new ApiError(409, 'Conflict', 'FAILED_PRECONDITION: read only', 'macp-control-plane', '/x')
      )
    ).toBe(true);
    expect(isRegistryReadOnlyError(new Error('registry is read-only'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRegistryReadOnlyError(new ApiError(500, 'Server Error', 'boom', 'macp-control-plane', '/x'))).toBe(false);
    expect(isRegistryReadOnlyError(new Error('network down'))).toBe(false);
    expect(isRegistryReadOnlyError('nope')).toBe(false);
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

// ---------------------------------------------------------------------------
// ApiError — structured control-plane error envelopes
// ---------------------------------------------------------------------------
describe('ApiError — errorCode and detail', () => {
  const cp = 'macp-control-plane' as const;

  it('parses the AppException envelope into errorCode and detail', () => {
    const err = new ApiError(
      503,
      'Service Unavailable',
      JSON.stringify({ statusCode: 503, errorCode: 'CIRCUIT_BREAKER_OPEN', message: 'breaker open' }),
      cp,
      '/x'
    );

    expect(err.errorCode).toBe('CIRCUIT_BREAKER_OPEN');
    expect(err.detail).toBe('breaker open');
  });

  it('reads detail from the Nest-default envelope, which carries no errorCode', () => {
    // This is the exact shape of every POST /runtime/policies validation rejection, including
    // the schemaVersion constraint — a design that only understood AppException would render
    // nothing for it.
    const err = new ApiError(
      400,
      'Bad Request',
      JSON.stringify({ statusCode: 400, message: 'schemaVersion must be one of 1, 2, 3', error: 'Bad Request' }),
      cp,
      '/runtime/policies'
    );

    expect(err.errorCode).toBeUndefined();
    expect(err.detail).toBe('schemaVersion must be one of 1, 2, 3');
  });

  it('never falls back to the Nest `error` field, which only restates the status', () => {
    const body = JSON.stringify({ statusCode: 401, error: 'Unauthorized' });
    const err = new ApiError(401, 'Unauthorized', body, cp, '/x');

    expect(err.errorCode).toBeUndefined();
    // No usable `message`, so it falls through to the RAW BODY. Pinned exactly: a `not.toBe`
    // here would also pass for `undefined` or `''` and would not test the branch it names.
    expect(err.detail).toBe(body);
  });

  it('handles every malformed-but-parseable envelope without throwing or leaking objects', () => {
    const cases: Array<{ body: string; errorCode: undefined; detail: string }> = [
      // `message` present but empty → no usable prose, fall through to the raw body.
      { body: JSON.stringify({ statusCode: 400, message: '' }), errorCode: undefined, detail: '' },
      // `message` is an empty array, or an array with no strings in it.
      { body: JSON.stringify({ statusCode: 400, message: [] }), errorCode: undefined, detail: '' },
      { body: JSON.stringify({ statusCode: 400, message: [1, 2] }), errorCode: undefined, detail: '' },
      // `message` is an object — must not render as [object Object].
      { body: JSON.stringify({ statusCode: 400, message: { a: 1 } }), errorCode: undefined, detail: '' },
      // `errorCode` present but not a usable string.
      {
        body: JSON.stringify({ errorCode: 123, message: 'numeric code' }),
        errorCode: undefined,
        detail: 'numeric code'
      },
      { body: JSON.stringify({ errorCode: '', message: 'empty code' }), errorCode: undefined, detail: 'empty code' },
      // A parsed object with no `message` key at all.
      { body: JSON.stringify({}), errorCode: undefined, detail: '' }
    ];

    for (const testCase of cases) {
      const err = new ApiError(400, 'Bad Request', testCase.body, cp, '/x');
      expect(() => err.errorCode).not.toThrow();
      expect(err.errorCode).toBe(testCase.errorCode);
      // Where no usable prose exists, detail falls through to the raw body verbatim.
      expect(err.detail).toBe(testCase.detail === '' ? testCase.body : testCase.detail);
      expect(err.detail).not.toContain('[object Object]');
    }
  });

  it('joins an array message (Nest ValidationPipe shape) rather than rendering [object Object]', () => {
    const err = new ApiError(
      400,
      'Bad Request',
      JSON.stringify({ statusCode: 400, message: ['mode must be a string', 'policyId should not be empty'] }),
      cp,
      '/x'
    );

    expect(err.detail).toBe('mode must be a string; policyId should not be empty');
    expect(err.detail).not.toContain('[object Object]');
  });

  it('falls back to the raw body for a non-JSON body, and throws nothing', () => {
    const html = '<html><body>502 Bad Gateway</body></html>';
    const err = new ApiError(502, 'Bad Gateway', html, cp, '/x');

    expect(() => err.errorCode).not.toThrow();
    expect(err.errorCode).toBeUndefined();
    expect(err.detail).toBe(html);
  });

  it('does not throw on JSON that is not an object', () => {
    for (const body of ['null', '[]', '42', '"a string"']) {
      const err = new ApiError(500, 'Server Error', body, cp, '/x');
      expect(() => err.errorCode).not.toThrow();
      expect(err.errorCode).toBeUndefined();
      expect(err.detail).toBe(body);
    }
  });

  it('reports detail as undefined for an empty body while message keeps the status sentence', () => {
    const err = new ApiError(503, 'Service Unavailable', '', cp, '/health');

    expect(err.detail).toBeUndefined();
    expect(err.message).toBe('Request failed with status 503');
  });

  it('exposes the raw body verbatim', () => {
    const err = new ApiError(400, 'Bad Request', 'plain text', cp, '/x');
    expect(err.body).toBe('plain text');
    expect(new ApiError(503, 'Service Unavailable', '', cp, '/x').body).toBe('');
  });

  it('parses lazily and at most once', () => {
    const spy = vi.spyOn(JSON, 'parse');
    const err = new ApiError(503, 'Service Unavailable', JSON.stringify({ errorCode: 'X', message: 'y' }), cp, '/x');

    // Construction alone must not parse — a hot error path should not pay for an error nobody
    // inspects.
    expect(spy).not.toHaveBeenCalled();

    void err.errorCode;
    void err.detail;
    void err.errorCode;

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('memoises a NON-JSON body too, rather than re-parsing on every access', () => {
    // The `#parsed` sentinel distinguishes "not yet parsed" (undefined) from "parsed, and it
    // was not an object" (null). A truthiness check instead would make every non-JSON error
    // body re-parse on every property read — and would pass all the other tests here.
    const spy = vi.spyOn(JSON, 'parse');
    const err = new ApiError(502, 'Bad Gateway', '<html>502</html>', cp, '/x');

    void err.errorCode;
    void err.detail;
    void err.errorCode;
    void err.detail;

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not attempt to parse an empty body at all', () => {
    const spy = vi.spyOn(JSON, 'parse');
    const err = new ApiError(503, 'Service Unavailable', '', cp, '/x');

    void err.errorCode;
    void err.detail;

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// describeApiError
// ---------------------------------------------------------------------------
describe('describeApiError', () => {
  const cp = 'macp-control-plane' as const;

  it('returns the control plane sentence for a structured body', () => {
    expect(
      describeApiError(
        new ApiError(
          503,
          'Service Unavailable',
          JSON.stringify({ statusCode: 503, errorCode: 'RUNTIME_UNAVAILABLE', message: 'runtime is not reachable' }),
          cp,
          '/x'
        )
      )
    ).toBe('runtime is not reachable');
  });

  it('returns the raw body for a non-JSON body', () => {
    expect(describeApiError(new ApiError(502, 'Bad Gateway', 'upstream timed out', cp, '/x'))).toBe(
      'upstream timed out'
    );
  });

  it('returns the status sentence for an empty body', () => {
    expect(describeApiError(new ApiError(503, 'Service Unavailable', '', cp, '/x'))).toBe(
      'Request failed with status 503'
    );
  });

  it('returns error.message for a plain Error — the commonest input at the call sites', () => {
    // A network failure rejects before fetchJson reaches its status check, so it never becomes
    // an ApiError. A helper that returned the generic fallback here would be a regression
    // against the `error instanceof Error ? error.message : ''` code it replaces.
    expect(describeApiError(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
    expect(describeApiError(new Error('aborted'))).toBe('aborted');
  });

  it('caps an unbounded upstream body so a multi-megabyte page cannot reach the UI', () => {
    const huge = 'x'.repeat(50_000);
    const err = new ApiError(502, 'Bad Gateway', huge, cp, '/x');

    // detail and message stay uncapped — they are for logging and matching...
    expect(err.detail).toHaveLength(50_000);
    expect(err.message).toHaveLength(50_000);
    // ...but the "fit to show a user" boundary truncates.
    const described = describeApiError(err);
    expect(described.length).toBeLessThanOrEqual(500);
    expect(described.endsWith('…')).toBe(true);
  });

  it('returns a non-empty string for every non-Error input', () => {
    for (const input of [null, undefined, 42, {}, [], new Error('')]) {
      const result = describeApiError(input);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('[object Object]');
    }
    expect(describeApiError('a bare string')).toBe('a bare string');
  });
});
