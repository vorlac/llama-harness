// Hand-maintained tables describing "what kind of thing" a config key is.
//
// There are three of these tables and nothing keeps them in agreement with each
// other, with DEFAULTS in defaults.ts, or with the keys the modules actually
// read. Adding a key means remembering to touch all of them; nobody does.

export const CONFIG_KEYS: string[] = [
  "server.host",
  "server.port",
  "server.maxBodyBytes",
  "server.shutdownGraceMs",
  "auth.required",
  "auth.tokens",
  "auth.headerName",
  "rateLimit.enabled",
  "rateLimit.windowMs",
  "rateLimit.max",
  "cors.origins",
  "pipeline.batchSize",
  "pipeline.flushIntervalMs",
  "pipeline.maxQueue",
  "retry.maxAttempts",
  "retry.baseDelayMs",
  "retry.jitter",
  "sink.kind",
  "sink.http.endpoint",
  "sink.http.timeoutMs",
  "sink.file.path",
  "sink.file.rotateBytes",
  "transform.dropFields",
  "transform.redactKeys",
  "log.level",
  "log.format",
  "log.color",
  "metrics.enabled",
  "metrics.prefix",
  "metrics.flushIntervalMs",
  "spool.enabled",
  "spool.dir",
  "spool.maxBytes",
];

export const NUM_KEYS: string[] = [
  "server.port",
  "server.maxBodyBytes",
  "server.shutdownGraceMs",
  "rateLimit.windowMs",
  "rateLimit.max",
  "pipeline.batchSize",
  "pipeline.flushIntervalMs",
  "pipeline.maxQueue",
  "retry.maxAttempts",
  "retry.baseDelayMs",
  "sink.http.timeoutMs",
  "sink.file.rotateBytes",
  "metrics.flushIntervalMs",
  "spool.maxBytes",
];

export const BOOL_KEYS: string[] = [
  "auth.required",
  "rateLimit.enabled",
  "retry.jitter",
  "log.color",
  "metrics.enabled",
  "spool.enabled",
];

export const LIST_KEYS: string[] = [
  "auth.tokens",
  "cors.origins",
  "transform.dropFields",
  "transform.redactKeys",
];

export const LOG_LEVELS: string[] = ["debug", "info", "warn", "error"];
export const LOG_FORMATS: string[] = ["text", "json"];
export const SINK_KINDS: string[] = ["null", "file", "http"];

// ---------------------------------------------------------------- accessors
//
// Four ad-hoc accessors with four different ideas of what a missing or
// malformed value means. Call sites pick whichever one they remembered.

export function getStr(cfg: Record<string, any>, key: string, fallback: string = ""): string {
  const raw = cfg[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "string") return raw;
  return String(raw);
}

export function getNum(cfg: Record<string, any>, key: string, fallback: number = 0): number {
  const raw = cfg[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(n)) return fallback;
  return n;
}

export function getBool(cfg: Record<string, any>, key: string, fallback: boolean = false): boolean {
  const raw = cfg[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  // Anything else is quietly false. Nobody is told.
  return false;
}

export function getList(cfg: Record<string, any>, key: string, fallback: string[] = []): string[] {
  const raw = cfg[key];
  if (raw === undefined || raw === null) return fallback.slice();
  if (Array.isArray(raw)) return raw.map((v: any) => String(v));
  const s = String(raw).trim();
  if (s === "") return [];
  return s.split(",").map((v: string) => v.trim()).filter((v: string) => v !== "");
}

export function coerceForKey(key: string, raw: string): any {
  if (NUM_KEYS.indexOf(key) >= 0) {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (BOOL_KEYS.indexOf(key) >= 0) {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
    return raw;
  }
  if (LIST_KEYS.indexOf(key) >= 0) {
    const s = raw.trim();
    if (s === "") return [];
    return s.split(",").map((v: string) => v.trim()).filter((v: string) => v !== "");
  }
  return raw;
}
