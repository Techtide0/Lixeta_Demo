/**
 * @file config/env.ts
 * @description Runtime environment configuration with strict validation.
 *
 * All configuration is read from environment variables at startup.
 * The gateway refuses to start if any required variable is missing or invalid.
 *
 * Security notes
 * ──────────────
 * • No secrets live in this file — only variable names and defaults.
 * • `ALLOWED_ORIGINS` is a comma-separated allowlist. Wildcard "*" is only
 *   permitted when NODE_ENV !== "production".
 * • `TRUSTED_SOURCE_IDS` is fed directly to the engine's security policy —
 *   events from unlisted sources are rejected before any rule runs.
 * • `API_KEY_HASH` is a SHA-256 hex digest of the expected API key.
 *   The raw key is never stored — only the hash is compared.
 * • Rate-limit parameters are capped to prevent misconfiguration from
 *   disabling the limiter entirely.
 */

export type NodeEnvironment = "development" | "test" | "production";

export interface GatewayEnv {
  readonly NODE_ENV: NodeEnvironment;
  readonly PORT: number;

  // CORS
  readonly ALLOWED_ORIGINS: ReadonlyArray<string>;

  // Engine
  /** Comma-separated list of trusted event source IDs (empty = allow all, dev only) */
  readonly TRUSTED_SOURCE_IDS: ReadonlyArray<string>;
  /** Which rule IDs are active (empty = all built-in rules) */
  readonly ENABLED_RULE_IDS: ReadonlyArray<string>;
  /** ISO 4217 currency code for revenue accounting */
  readonly REVENUE_CURRENCY: string;

  // Auth
  /** SHA-256 hex hash of the API key; empty string = auth disabled (dev only) */
  readonly API_KEY_HASH: string;
  /** Whether to require API key auth on every request */
  readonly REQUIRE_AUTH: boolean;

  // Rate limiting (requests per window per IP)
  readonly RATE_LIMIT_MAX: number;
  readonly RATE_LIMIT_WINDOW_MS: number;

  // Engine limits (hard ceilings — override only in tests)
  readonly ENGINE_MAX_PAYLOAD_BYTES: number;
  readonly ENGINE_MAX_RULES: number;
  readonly ENGINE_MAX_TOTAL_MS: number;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function envString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value !== undefined && value.trim() !== "") return value.trim();
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`[Config] Missing required environment variable: ${key}`);
}

function envInt(key: string, defaultValue?: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`[Config] Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`[Config] ${key} must be an integer, got: "${raw}"`);
  }
  return parsed;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw.trim().toLowerCase() === "true";
}

function envList(key: string, defaultValue: ReadonlyArray<string> = []): ReadonlyArray<string> {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function assertNodeEnv(value: string): NodeEnvironment {
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  throw new Error(
    `[Config] NODE_ENV must be "development", "test", or "production". Got: "${value}"`
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateEnv(env: GatewayEnv): void {
  // Wildcard CORS in production is forbidden
  if (
    env.NODE_ENV === "production" &&
    env.ALLOWED_ORIGINS.includes("*")
  ) {
    throw new Error(
      "[Config] ALLOWED_ORIGINS cannot contain '*' in production. " +
        "Set explicit origin allowlist."
    );
  }

  // If auth is required, a key hash must be present
  if (env.REQUIRE_AUTH && env.API_KEY_HASH.trim() === "") {
    throw new Error(
      "[Config] REQUIRE_AUTH is true but API_KEY_HASH is not set."
    );
  }

  // Warn if auth is disabled in production (not an error — operator may have removed it intentionally)
  if (env.NODE_ENV === "production" && !env.REQUIRE_AUTH) {
    console.warn(
      "[Config] WARNING: REQUIRE_AUTH is false in production. " +
        "API key authentication is disabled. Set REQUIRE_AUTH=true to enable it."
    );
  }

  // Rate limit floor (prevent misconfiguration from disabling the limiter)
  if (env.RATE_LIMIT_MAX < 1) {
    throw new Error("[Config] RATE_LIMIT_MAX must be >= 1.");
  }
  if (env.RATE_LIMIT_WINDOW_MS < 1000) {
    throw new Error("[Config] RATE_LIMIT_WINDOW_MS must be >= 1000ms.");
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function loadEnv(): GatewayEnv {
  const nodeEnv = assertNodeEnv(
    envString("NODE_ENV", "development")
  );

  const env: GatewayEnv = {
    NODE_ENV: nodeEnv,
    PORT: envInt("PORT", 4000),

    ALLOWED_ORIGINS: envList(
      "ALLOWED_ORIGINS",
      nodeEnv === "production" ? [] : ["http://localhost:3000", "http://localhost:5173"]
    ),

    TRUSTED_SOURCE_IDS: envList("TRUSTED_SOURCE_IDS", []),
    ENABLED_RULE_IDS: envList("ENABLED_RULE_IDS", []),
    REVENUE_CURRENCY: envString("REVENUE_CURRENCY", "NGN"),

    API_KEY_HASH: envString("API_KEY_HASH", ""),
    REQUIRE_AUTH: envBool("REQUIRE_AUTH", nodeEnv === "production"),

    RATE_LIMIT_MAX: Math.max(1, envInt("RATE_LIMIT_MAX", 60)),
    RATE_LIMIT_WINDOW_MS: Math.max(1000, envInt("RATE_LIMIT_WINDOW_MS", 60_000)),

    ENGINE_MAX_PAYLOAD_BYTES: envInt("ENGINE_MAX_PAYLOAD_BYTES", 32_768),
    ENGINE_MAX_RULES: envInt("ENGINE_MAX_RULES", 50),
    ENGINE_MAX_TOTAL_MS: envInt("ENGINE_MAX_TOTAL_MS", 200),
  };

  validateEnv(env);
  return env;
}

// ---------------------------------------------------------------------------
// Singleton — loaded once at startup
// ---------------------------------------------------------------------------

let _env: GatewayEnv | null = null;

export function getEnv(): GatewayEnv {
  if (_env === null) {
    _env = loadEnv();
  }
  return _env;
}

/** FOR TESTING ONLY — reloads env from current process.env. */
export function _reloadEnvForTesting(): GatewayEnv {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("_reloadEnvForTesting() is not allowed in production.");
  }
  _env = loadEnv();
  return _env;
}
