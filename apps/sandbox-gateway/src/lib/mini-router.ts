/**
 * @file lib/mini-router.ts
 * @description Zero-dependency HTTP router that mirrors the Express API
 * used by the rest of the gateway.
 *
 * Implements:
 *   - app.use(path, handler) — prefix-based routing
 *   - router.get(path, ...handlers) — method + exact path
 *   - router.post(path, ...handlers) — method + exact path
 *   - req.body parsing (JSON)
 *   - req.get(header) — header lookup
 *   - res.status(code).json(body) — response builder
 *   - res.setHeader / res.set
 *   - res.locals — per-request storage
 *   - Error middleware (4-arg)
 *   - next(err) propagation
 *
 * Security: body size is capped at maxBodyBytes before JSON.parse.
 * Memory exhaustion via crafted large bodies is prevented.
 */

import http from "http";

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface Req {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  ip: string;
  locals: Record<string, unknown>;
  get(name: string): string | undefined;
}

export interface Res {
  statusCode: number;
  locals: Record<string, unknown>;
  headersSent: boolean;
  status(code: number): Res;
  json(body: unknown): Res;
  send(body: string): Res;
  /** Send raw binary data with a Content-Disposition attachment header. */
  sendBuffer(buffer: Buffer, contentType: string, filename: string): Res;
  set(name: string, value: string | string[]): Res;
  setHeader(name: string, value: string | string[]): Res;
  end(): Res;
  on(event: string, listener: () => void): Res;
}

export type NextFn = (err?: unknown) => void;
export type Handler = (req: Req, res: Res, next: NextFn) => void | Promise<void>;
export type ErrorHandler = (err: unknown, req: Req, res: Res, next: NextFn) => void;
export type AnyHandler = Handler | ErrorHandler;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type MethodRoute = {
  method: string;
  path: string;
  handlers: Handler[];
};

type SubRouter = {
  prefix: string;
  router: Router;
};

type Middleware = {
  kind: "middleware";
  path: string | null;
  handlers: AnyHandler[];
};

type Route = MethodRoute | SubRouter | Middleware;

export class Router {
  protected routes: Route[] = [];

  use(pathOrHandler: string | AnyHandler | Router, ...rest: Array<AnyHandler | Router>): this {
    if (typeof pathOrHandler === "string") {
      const first = rest[0];
      if (first instanceof Router) {
        this.routes.push({ prefix: pathOrHandler, router: first });
      } else {
        this.routes.push({ kind: "middleware", path: pathOrHandler, handlers: rest as AnyHandler[] });
      }
    } else if (pathOrHandler instanceof Router) {
      this.routes.push({ prefix: "", router: pathOrHandler });
    } else {
      this.routes.push({ kind: "middleware", path: null, handlers: [pathOrHandler as AnyHandler, ...(rest as AnyHandler[])] });
    }
    return this;
  }

  get(path: string, ...handlers: Handler[]): this {
    this.routes.push({ method: "GET", path, handlers });
    return this;
  }

  post(path: string, ...handlers: Handler[]): this {
    this.routes.push({ method: "POST", path, handlers });
    return this;
  }

  patch(path: string, ...handlers: Handler[]): this {
    this.routes.push({ method: "PATCH", path, handlers });
    return this;
  }

  async handle(req: Req, res: Res, basePath = ""): Promise<void> {
    const stack = this.buildStack(req, basePath);
    await runStack(stack, 0, req, res, null);
  }

  protected buildStack(req: Req, basePath: string): AnyHandler[] {
    const stack: AnyHandler[] = [];

    for (const route of this.routes) {
      if ("kind" in route) {
        // Middleware
        if (route.path === null || req.path.startsWith(basePath + route.path)) {
          stack.push(...route.handlers);
        }
      } else if ("prefix" in route) {
        // Sub-router
        const full = basePath + route.prefix;
        if (req.path.startsWith(full)) {
          const sub = route.router;
          const delegate: Handler = async (r, s, n) => {
            await sub.handle(r, s, full);
            n();
          };
          stack.push(delegate);
        }
      } else {
        // Method route
        const fullPath = basePath + route.path;
        // Handle "/" routes at basePath level: "/health" + "/" should match "/health", not "/health/"
        const normalizedFullPath = route.path === "/" && basePath ? basePath : fullPath;
        if (req.method === route.method && (req.path === normalizedFullPath || req.path === normalizedFullPath + "/")) {
          stack.push(...route.handlers);
        }
      }
    }

    return stack;
  }
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export class Application extends Router {
  private settings: Record<string, unknown> = {};

  set(key: string, value: unknown): this {
    this.settings[key] = value;
    return this;
  }

  disable(key: string): this {
    this.settings[key] = false;
    return this;
  }

  listen(port: number, callback?: () => void): http.Server {
    const server = http.createServer(async (inReq: import("http").IncomingMessage, inRes: import("http").ServerResponse) => {
      try {
        await this.handleHttpRequest(inReq, inRes);
      } catch (err) {
        if (!inRes.headersSent) {
          inRes.writeHead(500, { "Content-Type": "application/json" });
          inRes.end(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Unhandled server error" } }));
        }
      }
    });
    server.listen(port, callback);
    return server;
  }

  private async handleHttpRequest(
    inReq: http.IncomingMessage,
    inRes: http.ServerResponse
  ): Promise<void> {
    // Parse URL and query string
    const rawUrl = inReq.url ?? "/";
    const qIdx = rawUrl.indexOf("?");
    const path = qIdx === -1 ? rawUrl : rawUrl.substring(0, qIdx);
    const queryStr = qIdx === -1 ? "" : rawUrl.substring(qIdx + 1);
    const query = parseQueryString(queryStr);

    // Extract IP
    const forwarded = inReq.headers["x-forwarded-for"];
    const ip = typeof forwarded === "string"
      ? (forwarded.split(",")[0] ?? "unknown").trim()
      : (inReq.socket.remoteAddress ?? "unknown");

    // Read body
    const contentType = inReq.headers["content-type"] ?? "";
    let body: unknown = undefined;
    if (contentType.includes("application/json")) {
      body = await readJSON(inReq, 65_536); // 64KB cap
    }

    // Build Req
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(inReq.headers)) {
      headers[k.toLowerCase()] = v as string | string[] | undefined;
    }

    const locals: Record<string, unknown> = {};

    const req: Req = {
      method: inReq.method?.toUpperCase() ?? "GET",
      url: rawUrl,
      path,
      headers,
      body,
      params: {},
      query,
      ip,
      locals,
      get(name: string) {
        const val = headers[name.toLowerCase()];
        return Array.isArray(val) ? val[0] : val;
      },
    };

    // Build Res
    const resHeaders: Record<string, string | string[]> = {};
    let statusCode = 200;
    let finished = false;
    const finishListeners: Array<() => void> = [];

    const res: Res = {
      get statusCode() { return statusCode; },
      set statusCode(v: number) { statusCode = v; },
      locals,
      get headersSent() { return finished; },
      status(code: number) { statusCode = code; return res; },
      setHeader(name: string, value: string | string[]) {
        resHeaders[name] = value;
        return res;
      },
      set(name: string, value: string | string[]) {
        resHeaders[name] = value;
        return res;
      },
      json(body2: unknown) {
        if (finished) return res;
        const json = JSON.stringify(body2);
        const allHeaders: Record<string, string | string[]> = {
          ...resHeaders,
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(json)),
        };
        inRes.writeHead(statusCode, allHeaders as Record<string, string>);
        inRes.end(json);
        finished = true;
        finishListeners.forEach((l) => l());
        return res;
      },
      send(body2: string) {
        if (finished) return res;
        inRes.writeHead(statusCode, resHeaders as Record<string, string>);
        inRes.end(body2);
        finished = true;
        finishListeners.forEach((l) => l());
        return res;
      },
      sendBuffer(buffer: Buffer, contentType: string, filename: string) {
        if (finished) return res;
        const allHeaders: Record<string, string | string[]> = {
          ...resHeaders,
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(buffer.length),
        };
        inRes.writeHead(statusCode, allHeaders as Record<string, string>);
        inRes.end(buffer);
        finished = true;
        finishListeners.forEach((l) => l());
        return res;
      },
      end() {
        if (finished) return res;
        inRes.writeHead(statusCode, resHeaders as Record<string, string>);
        inRes.end();
        finished = true;
        finishListeners.forEach((l) => l());
        return res;
      },
      on(event: string, listener: () => void) {
        if (event === "finish") finishListeners.push(listener);
        return res;
      },
    };

    // Run through route stack
    const stack = this.buildStack(req, "");

    // Add fallthrough 404
    stack.push((_r: Req, s: Res) => {
      if (!s.headersSent) {
        s.status(404).json({
          ok: false,
          requestId: (s.locals["requestId"] as string | undefined) ?? "unknown",
          timestamp: new Date().toISOString(),
          error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} does not exist.` },
        });
      }
    });

    await runStack(stack, 0, req, res, null);
  }
}

// ---------------------------------------------------------------------------
// Stack runner (supports error propagation via next(err))
// ---------------------------------------------------------------------------

async function runStack(
  stack: AnyHandler[],
  index: number,
  req: Req,
  res: Res,
  err: unknown
): Promise<void> {
  if (index >= stack.length || res.headersSent) return;

  const handler = stack[index];
  if (handler === undefined) return;

  if (err !== null) {
    // Error mode — only 4-arg handlers consume errors
    if (handler.length === 4) {
      const errHandler = handler as ErrorHandler;
      await new Promise<void>((resolve) => {
        const next: NextFn = (nextErr) => {
          runStack(stack, index + 1, req, res, nextErr ?? null).then(resolve);
        };
        try {
          errHandler(err, req, res, next);
        } catch (e) {
          resolve();
          runStack(stack, index + 1, req, res, e);
        }
      });
    } else {
      // Skip non-error handlers when in error mode
      await runStack(stack, index + 1, req, res, err);
    }
  } else {
    // Normal mode — skip 4-arg handlers
    if (handler.length === 4) {
      await runStack(stack, index + 1, req, res, null);
    } else {
      const h = handler as Handler;
      await new Promise<void>((resolve) => {
        const next: NextFn = (nextErr) => {
          runStack(stack, index + 1, req, res, nextErr ?? null).then(resolve);
        };
        try {
          const result = h(req, res, next);
          if (result instanceof Promise) {
            result.then(() => {
              if (!res.headersSent) resolve();
            }).catch((e) => {
              runStack(stack, index + 1, req, res, e).then(resolve);
            });
          } else {
            // Sync handler — if it didn't call next and didn't send, that's its choice
            if (!res.headersSent) resolve();
          }
        } catch (e) {
          runStack(stack, index + 1, req, res, e).then(resolve);
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseQueryString(qs: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!qs) return result;
  for (const part of qs.split("&")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = decodeURIComponent(part.substring(0, eq));
    const val = decodeURIComponent(part.substring(eq + 1));
    result[key] = val;
  }
  return result;
}

async function readJSON(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const str = Buffer.concat(chunks as unknown as Uint8Array[]).toString("utf8");
        resolve(JSON.parse(str));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

// ---------------------------------------------------------------------------
// Factory functions (mirror express() and express.Router())
// ---------------------------------------------------------------------------

export function createApp(): Application {
  return new Application();
}

export function createRouter(): Router {
  return new Router();
}

// CORS middleware (inline — no cors package needed)
export interface CorsOptions {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
  credentials?: boolean;
}

export function cors(options: CorsOptions = {}): Handler {
  return (req, res, next) => {
    const origin = req.get("origin") ?? "";
    const allowed = options.origin;

    let allowOrigin = "";
    if (allowed === true || allowed === undefined) {
      allowOrigin = origin || "*";
    } else if (allowed === false) {
      allowOrigin = "";
    } else if (typeof allowed === "string") {
      allowOrigin = allowed;
    } else if (Array.isArray(allowed)) {
      allowOrigin = (allowed as string[]).includes(origin) ? origin : "";
    }

    if (allowOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    }
    res.setHeader(
      "Access-Control-Allow-Methods",
      (options.methods ?? ["GET", "POST", "OPTIONS"]).join(", ")
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      (options.allowedHeaders ?? ["Content-Type", "X-Api-Key", "X-Request-Id"]).join(", ")
    );
    if (options.exposedHeaders?.length) {
      res.setHeader("Access-Control-Expose-Headers", options.exposedHeaders.join(", "));
    }
    if (options.maxAge !== undefined) {
      res.setHeader("Access-Control-Max-Age", String(options.maxAge));
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
