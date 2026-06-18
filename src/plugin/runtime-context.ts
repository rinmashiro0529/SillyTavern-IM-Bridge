import path from "node:path";

export interface RuntimeContext {
  pluginRoot: string;
  databasePath: string;
  stInternalBaseUrl: string;
  stHostHeader: string | null;
  stTimeoutMs: number;
  pageSize: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strEnv(name: string): string | null {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
}

export function loadRuntimeContext(): RuntimeContext {
  const pluginRoot = path.resolve(__dirname, "..");
  const databasePath = path.join(pluginRoot, "data", "app.db");
  const explicitBase = strEnv("SILLYTAVERN_INTERNAL_BASE_URL");
  const port = strEnv("SILLYTAVERN_LISTEN_PORT") ?? "8000";
  return {
    pluginRoot,
    databasePath,
    stInternalBaseUrl: explicitBase ?? `http://127.0.0.1:${port}`,
    stHostHeader: strEnv("SILLYTAVERN_HOST_HEADER"),
    stTimeoutMs: intEnv("ST_TIMEOUT_MS", 15000),
    pageSize: intEnv("PAGE_SIZE", 8),
    rateLimitWindowMs: intEnv("RATE_LIMIT_WINDOW_MS", 60000),
    rateLimitMaxRequests: intEnv("RATE_LIMIT_MAX_REQUESTS", 60),
  };
}
