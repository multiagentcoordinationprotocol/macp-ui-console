import http from 'node:http';

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export type RouteHandler = (
  req: RecordedRequest
) =>
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

/**
 * Lightweight HTTP server that records incoming requests and serves
 * canned responses. Mirrors the mock-macp-control-plane helper used in
 * the macp-playground integration tests.
 */
export class MockBackend {
  private server: http.Server | null = null;
  private routes = new Map<string, RouteHandler>();
  private recorded: RecordedRequest[] = [];
  private _port = 0;

  /** Register a handler for METHOD /path. Path is matched exactly (no pattern support). */
  on(method: string, path: string, handler: RouteHandler): this {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
    return this;
  }

  /** Register a fallback handler that matches any request to the given path prefix. */
  onPrefix(method: string, prefix: string, handler: RouteHandler): this {
    this.routes.set(`PREFIX:${method.toUpperCase()} ${prefix}`, handler);
    return this;
  }

  get requests(): ReadonlyArray<RecordedRequest> {
    return this.recorded;
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  clearRequests(): void {
    this.recorded = [];
  }

  reset(): void {
    this.recorded = [];
    this.routes.clear();
  }

  async start(): Promise<{ url: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const [pathPart, queryPart] = (req.url ?? '/').split('?');
        const body = await readBody(req);

        const recorded: RecordedRequest = {
          method: req.method ?? 'GET',
          path: pathPart,
          query: queryPart ?? '',
          headers: req.headers as Record<string, string | string[] | undefined>,
          body
        };
        this.recorded.push(recorded);

        // Try exact match first
        const exactKey = `${req.method?.toUpperCase()} ${pathPart}`;
        let handler = this.routes.get(exactKey);

        // Then try prefix match
        if (!handler) {
          for (const [key, h] of this.routes) {
            if (key.startsWith('PREFIX:') && exactKey.startsWith(key.slice(7))) {
              handler = h;
              break;
            }
          }
        }

        if (!handler) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found', path: pathPart }));
          return;
        }

        try {
          const result = await handler(recorded);
          const headers: Record<string, string> = {
            'content-type': 'application/json',
            ...(result.headers ?? {})
          };
          res.writeHead(result.status, headers);
          res.end(result.body !== undefined ? JSON.stringify(result.body) : '');
        } catch (err) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr !== null) {
          this._port = addr.port;
          resolve({ url: this.url, port: this._port });
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

/**
 * SSE helper — writes SSE events to an http.ServerResponse.
 * Used for testing the live-run streaming path.
 */
export class SSEWriter {
  constructor(private res: http.ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
  }

  send(eventType: string, data: unknown, id?: string): void {
    if (id) this.res.write(`id: ${id}\n`);
    this.res.write(`event: ${eventType}\n`);
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  heartbeat(): void {
    this.res.write(`event: heartbeat\ndata: {}\n\n`);
  }

  close(): void {
    this.res.end();
  }
}
