import type { ProxyService } from '@/lib/server/integrations';
import { truncate } from '@/lib/utils/format';

/** Upper bound on the string {@link describeApiError} will hand back for rendering. */
const MAX_DESCRIBED_ERROR_LENGTH = 500;

/**
 * Read a Nest `message` field, which is either a string or — under `ValidationPipe` — an array
 * of strings. Anything else is not usable prose and becomes `undefined` rather than
 * `[object Object]`.
 */
function readMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return parts.length > 0 ? parts.join('; ') : undefined;
  }
  return undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly service: ProxyService;
  readonly path: string;
  /** The upstream response body, verbatim. Empty string when the response had no body. */
  readonly body: string;

  /**
   * Memoised parse of {@link body}. `undefined` means "not parsed yet"; `null` means "parsed, and
   * it was not a JSON object". Parsing is deliberately lazy — a hot error path should not pay
   * `JSON.parse` for an error nobody inspects.
   */
  #parsed: Record<string, unknown> | null | undefined;

  constructor(status: number, statusText: string, body: string, service: ProxyService, path: string) {
    super(body || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.service = service;
    this.path = path;
    this.body = body;
  }

  private parsedBody(): Record<string, unknown> | null {
    if (this.#parsed !== undefined) return this.#parsed;
    let result: Record<string, unknown> | null = null;
    if (this.body) {
      try {
        const candidate: unknown = JSON.parse(this.body);
        // Valid JSON that is not an object ("null", "[]", "42") carries no envelope.
        if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
          result = candidate as Record<string, unknown>;
        }
      } catch {
        // Not JSON at all — an HTML 502 from a proxy, a plain-text nginx error. Never throw here:
        // this is an error path, and failing to describe an error must not replace it.
        result = null;
      }
    }
    this.#parsed = result;
    return result;
  }

  /**
   * The control plane's machine-readable error code, when it sent one.
   *
   * `undefined` means "the backend did not classify this", never "unknown code": errors raised as
   * plain Nest exceptions with an object body — 401 from the auth guard, and every
   * `POST /runtime/policies` validation rejection — use the framework default
   * `{statusCode, message, error}` and carry no `errorCode` at all.
   *
   * **A present `errorCode` is not always a real classification.** The CP's `GlobalExceptionFilter`
   * has a third path: an `HttpException` whose body is a *string*, and any unhandled error, are
   * rewritten to `{statusCode, errorCode: 'INTERNAL_ERROR', message}`. A throttled 429 goes down
   * that path, so a rate limit arrives labelled `INTERNAL_ERROR`. Callers branching on this value
   * should switch on the codes they actually handle and treat everything else — `INTERNAL_ERROR`
   * included — as unclassified, rather than trusting it to describe the failure.
   */
  get errorCode(): string | undefined {
    const value = this.parsedBody()?.errorCode;
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /**
   * The human-readable sentence describing the failure, suitable for showing a user.
   *
   * Reads `message` from any control-plane envelope. Deliberately does NOT fall back to the Nest
   * `error` field (`"Bad Request"`, `"Unauthorized"`): that restates the status code rather than
   * saying anything about what went wrong.
   *
   * Fallbacks, in order:
   *  - body is not a JSON *object* (not JSON at all, or `42`/`[]`/`null`) → the raw body;
   *  - body parses to an object with no usable `message` → **the raw body**, i.e. raw JSON. Showing
   *    something beats showing nothing for a pathological envelope, but it is the one case where a
   *    user can still see JSON, so prefer a caller-supplied sentence when the shape is known;
   *  - no body at all → `undefined`, so a caller can distinguish "no detail" and fall through to
   *    the status line in one place rather than two.
   */
  get detail(): string | undefined {
    if (!this.body) return undefined;
    const parsed = this.parsedBody();
    if (!parsed) return this.body;
    return readMessage(parsed.message) ?? this.body;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Render any thrown value to a sentence fit for a user, in one place.
 *
 * Resolution order:
 *  - `ApiError` with a structured body → the control plane's `message`
 *  - `ApiError` with a non-object body → the raw body
 *  - `ApiError` whose JSON body carries no usable `message` → the raw body (raw JSON)
 *  - `ApiError` with an empty body     → `Request failed with status N`
 *  - a plain `Error`                   → `error.message`
 *  - a non-empty `string`              → the string itself
 *  - anything else                     → a generic fallback; never `''`, never `[object Object]`
 *
 * The plain-`Error` row is the commonest input, not an edge case: a network failure rejects before
 * `fetchJson` ever reaches its status check, so it arrives as a bare `TypeError`. This is what the
 * repo's many `error instanceof Error ? error.message : ''` sites can adopt incrementally.
 *
 * The result is capped at {@link MAX_DESCRIBED_ERROR_LENGTH}. An upstream body is arbitrary bytes —
 * a multi-megabyte nginx HTML page or a full stack trace — and this function is explicitly the
 * "fit to show a user" boundary, so the cap belongs here rather than at each of the call sites.
 * `ApiError.detail` and `.message` stay uncapped for logging and matching.
 */
export function describeApiError(error: unknown): string {
  return truncate(describeRaw(error), MAX_DESCRIBED_ERROR_LENGTH);
}

function describeRaw(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed with status ${error.status}`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'An unexpected error occurred.';
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
    // Most precise signal first: the structured code, now that ApiError parses it. Today's CP
    // always pairs REGISTRY_READ_ONLY with 405 (`runtime.controller.ts` readOnlyException
    // hardcodes METHOD_NOT_ALLOWED), so this and the status check agree — but the code is the
    // claim and the status is the heuristic, so check the claim first.
    if (error.errorCode === 'REGISTRY_READ_ONLY') return true;
    if (error.status === 405) return true;
    // Fallback for older CP builds that have not adopted the structured code, and for the
    // underlying gRPC status leaking through as free text.
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
