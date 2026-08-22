// The "central" defaults table. It is not central.
//
// Two kinds of gap live here. First, it has no entry at all for
// server.maxBodyBytes, server.shutdownGraceMs, auth.headerName, cors.origins,
// pipeline.maxQueue, retry.maxAttempts, retry.jitter, sink.file.rotateBytes,
// metrics.prefix or metrics.flushIntervalMs, so the default for those keys is
// whatever the module that reads them happens to hard-code -- and for
// server.maxBodyBytes and retry.maxAttempts two different modules hard-code
// two different numbers.
//
// Second, several entries that ARE here disagree with the inline fallback in
// the module that consumes them. Those fallbacks are unreachable in practice,
// because this table always supplies a value; whether the table or the module
// records the intended default is a judgement call.

export const DEFAULTS: Record<string, any> = {
  "server.host": "127.0.0.1",
  "server.port": 8080,

  "auth.required": true,
  "auth.tokens": [],

  "rateLimit.enabled": true,
  "rateLimit.windowMs": 1000,
  "rateLimit.max": 100,

  "pipeline.batchSize": 50,
  "pipeline.flushIntervalMs": 1000,

  "retry.baseDelayMs": 100,

  "sink.kind": "null",
  "sink.http.endpoint": "",
  "sink.http.timeoutMs": 5000,
  "sink.file.path": "./relay-out.ndjson",

  "transform.dropFields": [],
  "transform.redactKeys": ["password", "token"],

  "log.level": "info",
  "log.format": "text",
  "log.color": false,

  "metrics.enabled": false,

  "spool.enabled": false,
  "spool.dir": "./.relay-spool",
  "spool.maxBytes": 10485760,
};
