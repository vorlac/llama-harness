// End-to-end behaviour of the request path. Every case is driven through the
// harness, in process, with a manual clock.

import test from "node:test";
import assert from "node:assert/strict";

import { bodyJson, makeApp } from "../src/testsupport/harness.ts";

const TOKEN = "s3cret";

function base(extra: Record<string, any> = {}): any {
  return { overrides: Object.assign({ "auth.tokens": [TOKEN] }, extra) };
}

test("health is served without authentication", async () => {
  const h = makeApp(base());
  try {
    const r = await h.request("GET", "/healthz");
    assert.equal(r.status, 200);
    const body = bodyJson(r);
    assert.equal(body.status, "ok");
    assert.equal(body.sink, "null");
  } finally {
    await h.close();
  }
});

test("an unknown route is a 404", async () => {
  const h = makeApp(base());
  try {
    const r = await h.request("GET", "/nope");
    assert.equal(r.status, 404);
  } finally {
    await h.close();
  }
});

test("ingest requires a token in the default header", async () => {
  const h = makeApp(base());
  try {
    const missing = await h.request("POST", "/ingest", { body: { a: 1 } });
    assert.equal(missing.status, 401);

    const wrong = await h.request("POST", "/ingest", {
      body: { a: 1 },
      headers: { "x-relay-token": "nope" },
    });
    assert.equal(wrong.status, 401);

    const ok = await h.request("POST", "/ingest", {
      body: { a: 1 },
      headers: { "x-relay-token": TOKEN },
    });
    assert.equal(ok.status, 202);
    assert.equal(bodyJson(ok).accepted, 1);
  } finally {
    await h.close();
  }
});

test("the token header name is configurable", async () => {
  const h = makeApp(base({ "auth.headerName": "x-my-key" }));
  try {
    const wrongHeader = await h.request("POST", "/ingest", {
      body: { a: 1 },
      headers: { "x-relay-token": TOKEN },
    });
    assert.equal(wrongHeader.status, 401);

    const rightHeader = await h.request("POST", "/ingest", {
      body: { a: 1 },
      headers: { "x-my-key": TOKEN },
    });
    assert.equal(rightHeader.status, 202);
  } finally {
    await h.close();
  }
});

test("authentication can be turned off entirely", async () => {
  const h = makeApp({ overrides: { "auth.required": false } });
  try {
    const r = await h.request("POST", "/ingest", { body: { a: 1 } });
    assert.equal(r.status, 202);
  } finally {
    await h.close();
  }
});

test("a batch of records is accepted in one request", async () => {
  const h = makeApp(base({ "pipeline.batchSize": 3 }));
  try {
    const r = await h.request("POST", "/ingest", {
      body: [{ a: 1 }, { a: 2 }, { a: 3 }],
      headers: { "x-relay-token": TOKEN },
    });
    assert.equal(r.status, 202);
    assert.equal(bodyJson(r).accepted, 3);
    await h.app.batcher.settled();
    assert.equal(h.sink.written.length, 3);
  } finally {
    await h.close();
  }
});

test("a malformed body is rejected", async () => {
  const h = makeApp(base());
  try {
    const r = await h.request("POST", "/ingest", {
      body: "{not json",
      headers: { "x-relay-token": TOKEN },
    });
    assert.equal(r.status, 400);
  } finally {
    await h.close();
  }
});

test("rateLimit.max of zero refuses every request", async () => {
  const h = makeApp(base({ "rateLimit.max": 0 }));
  try {
    const r = await h.request("GET", "/healthz");
    assert.equal(r.status, 429);
  } finally {
    await h.close();
  }
});

test("the fixed window resets once it elapses", async () => {
  const h = makeApp(base({ "rateLimit.max": 2, "rateLimit.windowMs": 1000, "auth.required": false }));
  try {
    assert.equal((await h.request("GET", "/healthz")).status, 200);
    assert.equal((await h.request("GET", "/healthz")).status, 200);
    assert.equal((await h.request("GET", "/healthz")).status, 429);
    h.scheduler.advance(1000);
    assert.equal((await h.request("GET", "/healthz")).status, 200);
  } finally {
    await h.close();
  }
});

test("rate limiting can be disabled", async () => {
  const h = makeApp(base({ "rateLimit.enabled": false, "rateLimit.max": 0, "auth.required": false }));
  try {
    assert.equal((await h.request("GET", "/healthz")).status, 200);
    assert.equal((await h.request("GET", "/healthz")).status, 200);
  } finally {
    await h.close();
  }
});

test("rate limit buckets are per client", async () => {
  const h = makeApp(base({ "rateLimit.max": 1, "auth.required": false }));
  try {
    assert.equal((await h.request("GET", "/healthz", { remote: "10.0.0.1" })).status, 200);
    assert.equal((await h.request("GET", "/healthz", { remote: "10.0.0.1" })).status, 429);
    assert.equal((await h.request("GET", "/healthz", { remote: "10.0.0.2" })).status, 200);
  } finally {
    await h.close();
  }
});

test("an oversized body is refused", async () => {
  const h = makeApp(base({ "server.maxBodyBytes": 16 }));
  try {
    const r = await h.request("POST", "/ingest", {
      body: { note: "far more than sixteen bytes of payload" },
      headers: { "x-relay-token": TOKEN },
    });
    assert.equal(r.status, 413);
  } finally {
    await h.close();
  }
});

test("preflight requests are answered with the configured origins", async () => {
  const wide = makeApp(base());
  try {
    const r = await wide.request("OPTIONS", "/ingest");
    assert.equal(r.status, 204);
    assert.equal(r.headers["access-control-allow-origin"], "*");
  } finally {
    await wide.close();
  }

  const narrow = makeApp(base({ "cors.origins": ["https://a.example"] }));
  try {
    const r = await narrow.request("OPTIONS", "/ingest");
    assert.equal(r.headers["access-control-allow-origin"], "https://a.example");
  } finally {
    await narrow.close();
  }
});

test("metrics are off by default and served when enabled", async () => {
  const off = makeApp(base());
  try {
    assert.equal((await off.request("GET", "/metrics")).status, 404);
  } finally {
    await off.close();
  }

  const on = makeApp(base({ "metrics.enabled": true }));
  try {
    await on.request("POST", "/ingest", { body: { a: 1 }, headers: { "x-relay-token": TOKEN } });
    const r = await on.request("GET", "/metrics");
    assert.equal(r.status, 200);
    assert.match(r.body, /relay_records_accepted 1/);
  } finally {
    await on.close();
  }
});

test("the metric prefix is configurable", async () => {
  const h = makeApp(base({ "metrics.enabled": true, "metrics.prefix": "acme_" }));
  try {
    await h.request("POST", "/ingest", { body: { a: 1 }, headers: { "x-relay-token": TOKEN } });
    const r = await h.request("GET", "/metrics");
    assert.match(r.body, /acme_records_accepted 1/);
  } finally {
    await h.close();
  }
});

test("records are transformed before they reach the sink", async () => {
  const h = makeApp(base({
    "pipeline.batchSize": 1,
    "transform.dropFields": ["internal"],
    "transform.redactKeys": ["password"],
  }));
  try {
    await h.request("POST", "/ingest", {
      body: { user: "ana", password: "hunter2", internal: true, nested: { password: "x" } },
      headers: { "x-relay-token": TOKEN },
    });
    await h.app.batcher.settled();
    assert.equal(h.sink.written.length, 1);
    const written = h.sink.written[0];
    assert.equal(written.user, "ana");
    assert.equal(written.password, "[redacted]");
    assert.equal(written.nested.password, "[redacted]");
    assert.equal("internal" in written, false);
  } finally {
    await h.close();
  }
});

test("the server binds a real socket and serves over it", async () => {
  const h = makeApp(base({ "server.port": 0, "auth.required": false }));
  try {
    const url = await h.listen();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(url + "/healthz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  } finally {
    await h.close();
  }
});
