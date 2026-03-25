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
export class Router {
    routes = [];
    use(pathOrHandler, ...rest) {
        if (typeof pathOrHandler === "string") {
            const first = rest[0];
            if (first instanceof Router) {
                this.routes.push({ prefix: pathOrHandler, router: first });
            }
            else {
                this.routes.push({ kind: "middleware", path: pathOrHandler, handlers: rest });
            }
        }
        else if (pathOrHandler instanceof Router) {
            this.routes.push({ prefix: "", router: pathOrHandler });
        }
        else {
            this.routes.push({ kind: "middleware", path: null, handlers: [pathOrHandler, ...rest] });
        }
        return this;
    }
    get(path, ...handlers) {
        this.routes.push({ method: "GET", path, handlers });
        return this;
    }
    post(path, ...handlers) {
        this.routes.push({ method: "POST", path, handlers });
        return this;
    }
    patch(path, ...handlers) {
        this.routes.push({ method: "PATCH", path, handlers });
        return this;
    }
    async handle(req, res, basePath = "") {
        const stack = this.buildStack(req, basePath);
        await runStack(stack, 0, req, res, null);
    }
    buildStack(req, basePath) {
        const stack = [];
        for (const route of this.routes) {
            if ("kind" in route) {
                // Middleware
                if (route.path === null || req.path.startsWith(basePath + route.path)) {
                    stack.push(...route.handlers);
                }
            }
            else if ("prefix" in route) {
                // Sub-router
                const full = basePath + route.prefix;
                if (req.path.startsWith(full)) {
                    const sub = route.router;
                    const delegate = async (r, s, n) => {
                        await sub.handle(r, s, full);
                        n();
                    };
                    stack.push(delegate);
                }
            }
            else {
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
    settings = {};
    set(key, value) {
        this.settings[key] = value;
        return this;
    }
    disable(key) {
        this.settings[key] = false;
        return this;
    }
    listen(port, callback) {
        const server = http.createServer(async (inReq, inRes) => {
            try {
                await this.handleHttpRequest(inReq, inRes);
            }
            catch (err) {
                if (!inRes.headersSent) {
                    inRes.writeHead(500, { "Content-Type": "application/json" });
                    inRes.end(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Unhandled server error" } }));
                }
            }
        });
        server.listen(port, callback);
        return server;
    }
    async handleHttpRequest(inReq, inRes) {
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
        let body = undefined;
        if (contentType.includes("application/json")) {
            body = await readJSON(inReq, 65_536); // 64KB cap
        }
        // Build Req
        const headers = {};
        for (const [k, v] of Object.entries(inReq.headers)) {
            headers[k.toLowerCase()] = v;
        }
        const locals = {};
        const req = {
            method: inReq.method?.toUpperCase() ?? "GET",
            url: rawUrl,
            path,
            headers,
            body,
            params: {},
            query,
            ip,
            locals,
            get(name) {
                const val = headers[name.toLowerCase()];
                return Array.isArray(val) ? val[0] : val;
            },
        };
        // Build Res
        const resHeaders = {};
        let statusCode = 200;
        let finished = false;
        const finishListeners = [];
        const res = {
            get statusCode() { return statusCode; },
            set statusCode(v) { statusCode = v; },
            locals,
            get headersSent() { return finished; },
            status(code) { statusCode = code; return res; },
            setHeader(name, value) {
                resHeaders[name] = value;
                return res;
            },
            set(name, value) {
                resHeaders[name] = value;
                return res;
            },
            json(body2) {
                if (finished)
                    return res;
                const json = JSON.stringify(body2);
                const allHeaders = {
                    ...resHeaders,
                    "Content-Type": "application/json",
                    "Content-Length": String(Buffer.byteLength(json)),
                };
                inRes.writeHead(statusCode, allHeaders);
                inRes.end(json);
                finished = true;
                finishListeners.forEach((l) => l());
                return res;
            },
            send(body2) {
                if (finished)
                    return res;
                inRes.writeHead(statusCode, resHeaders);
                inRes.end(body2);
                finished = true;
                finishListeners.forEach((l) => l());
                return res;
            },
            sendBuffer(buffer, contentType, filename) {
                if (finished)
                    return res;
                const allHeaders = {
                    ...resHeaders,
                    "Content-Type": contentType,
                    "Content-Disposition": `attachment; filename="${filename}"`,
                    "Content-Length": String(buffer.length),
                };
                inRes.writeHead(statusCode, allHeaders);
                inRes.end(buffer);
                finished = true;
                finishListeners.forEach((l) => l());
                return res;
            },
            end() {
                if (finished)
                    return res;
                inRes.writeHead(statusCode, resHeaders);
                inRes.end();
                finished = true;
                finishListeners.forEach((l) => l());
                return res;
            },
            on(event, listener) {
                if (event === "finish")
                    finishListeners.push(listener);
                return res;
            },
        };
        // Run through route stack
        const stack = this.buildStack(req, "");
        // Add fallthrough 404
        stack.push((_r, s) => {
            if (!s.headersSent) {
                s.status(404).json({
                    ok: false,
                    requestId: s.locals["requestId"] ?? "unknown",
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
async function runStack(stack, index, req, res, err) {
    if (index >= stack.length || res.headersSent)
        return;
    const handler = stack[index];
    if (handler === undefined)
        return;
    if (err !== null) {
        // Error mode — only 4-arg handlers consume errors
        if (handler.length === 4) {
            const errHandler = handler;
            await new Promise((resolve) => {
                const next = (nextErr) => {
                    runStack(stack, index + 1, req, res, nextErr ?? null).then(resolve);
                };
                try {
                    errHandler(err, req, res, next);
                }
                catch (e) {
                    resolve();
                    runStack(stack, index + 1, req, res, e);
                }
            });
        }
        else {
            // Skip non-error handlers when in error mode
            await runStack(stack, index + 1, req, res, err);
        }
    }
    else {
        // Normal mode — skip 4-arg handlers
        if (handler.length === 4) {
            await runStack(stack, index + 1, req, res, null);
        }
        else {
            const h = handler;
            await new Promise((resolve) => {
                const next = (nextErr) => {
                    runStack(stack, index + 1, req, res, nextErr ?? null).then(resolve);
                };
                try {
                    const result = h(req, res, next);
                    if (result instanceof Promise) {
                        result.then(() => {
                            if (!res.headersSent)
                                resolve();
                        }).catch((e) => {
                            runStack(stack, index + 1, req, res, e).then(resolve);
                        });
                    }
                    else {
                        // Sync handler — if it didn't call next and didn't send, that's its choice
                        if (!res.headersSent)
                            resolve();
                    }
                }
                catch (e) {
                    runStack(stack, index + 1, req, res, e).then(resolve);
                }
            });
        }
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseQueryString(qs) {
    const result = {};
    if (!qs)
        return result;
    for (const part of qs.split("&")) {
        const eq = part.indexOf("=");
        if (eq === -1)
            continue;
        const key = decodeURIComponent(part.substring(0, eq));
        const val = decodeURIComponent(part.substring(eq + 1));
        result[key] = val;
    }
    return result;
}
async function readJSON(req, maxBytes) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
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
                const str = Buffer.concat(chunks).toString("utf8");
                resolve(JSON.parse(str));
            }
            catch {
                resolve(undefined);
            }
        });
        req.on("error", () => resolve(undefined));
    });
}
// ---------------------------------------------------------------------------
// Factory functions (mirror express() and express.Router())
// ---------------------------------------------------------------------------
export function createApp() {
    return new Application();
}
export function createRouter() {
    return new Router();
}
export function cors(options = {}) {
    return (req, res, next) => {
        const origin = req.get("origin") ?? "";
        const allowed = options.origin;
        let allowOrigin = "";
        if (allowed === true || allowed === undefined) {
            allowOrigin = origin || "*";
        }
        else if (allowed === false) {
            allowOrigin = "";
        }
        else if (typeof allowed === "string") {
            allowOrigin = allowed;
        }
        else if (Array.isArray(allowed)) {
            allowOrigin = allowed.includes(origin) ? origin : "";
        }
        if (allowOrigin) {
            res.setHeader("Access-Control-Allow-Origin", allowOrigin);
        }
        res.setHeader("Access-Control-Allow-Methods", (options.methods ?? ["GET", "POST", "OPTIONS"]).join(", "));
        res.setHeader("Access-Control-Allow-Headers", (options.allowedHeaders ?? ["Content-Type", "X-Api-Key", "X-Request-Id"]).join(", "));
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
