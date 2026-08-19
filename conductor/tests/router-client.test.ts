// conductor/tests/router-client.test.ts — Task 7.2 RED tests for THE router
// health/metrics client (adapter/router-client.ts, §4.4). This is a fail-soft,
// residual-risk adapter: every enumerated case is pinned against a real
// node:http STUB server the test starts on an EPHEMERAL port (never 8080), so
// the unit tests need neither the C++ llama-router nor a model.
//
// SUBJECT (must NOT exist when this goes red; the failure is
// `Cannot find module '.../conductor/adapter/router-client.ts'` — the
// missing-subject shape, a legal greenfield red because the unresolved path
// resolves inside THIS item's fileScope). The ONLY non-stdlib import in this
// file is that subject, so the red names it unambiguously and is not a
// SyntaxError:
//   - conductor/adapter/router-client.ts
//
// ADAPTER module (G14): node:http / node:net only on the module side; may read
// Date.now; no Bun, no shell tag. This test uses only node:test, node:assert,
// node:http, node:net.
//
// Spec read for this test (read verbatim, NOT thinned):
//   plan 2495-2511 (Task 7.2) — the three interfaces + the enumerated test list.
//   plan 1636-1698 §4.4 — llama-router semantics and the fail-soft failover:
//     "fails over to the upstream base URL for the remainder of the session,
//      journaling a router.failover warning and marking the run's metrics as
//      partial. Two failovers in one session stop retrying the router entirely."
//   docs/build/specs/task-7.2.assertions.json — the 4 rows.
//
// ------------------------------------------------------------------------- //
// PINNED INTERFACE (plan 2497-2504) + DESIGNED FAILOVER MECHANISM
// ------------------------------------------------------------------------- //
//   fetchMetricsSummary(routerCfg, log?)                -> Promise<MetricsSummary | null>
//   resolveBaseUrl(routerCfg, upstreamCfg, failoverState) -> string   (SYNC — returns a url)
//   noteRouterFailure(failoverState, log?)              -> void        (records one failover)
//   createFailoverState()                               -> FailoverState (fresh, unlatched)
//
// DESIGN CHOICES (this test author's contract; task granted authority over the
// failoverState shape, the partial-metrics signal, the injectable timeout, and
// the failover-latch mechanism — see the RETURN report for plan-line cites):
//
//   FailoverState (the session latch + the partial-metrics signal):
//     { failovers: number;        // count of recorded router request failures
//       useUpstream: boolean;     // latch — once true resolveBaseUrl returns upstream
//       metricsPartial: boolean;  // the signal Task 9.5b (conductor_report) reads
//       probingDisabled: boolean; // set after the 2nd failover; resolveBaseUrl then
//                                 // names the upstream unconditionally }
//     createFailoverState() -> all-zero/false fresh state.
//
//   Partial-metrics signal: noteRouterFailure sets failoverState.metricsPartial
//     = true. The report's metrics section consumes that boolean; there is no
//     hidden global — the latch and the partial flag travel together on the one
//     failoverState the fan-out engine threads through the session.
//
//   Injectable probe timeout: routerCfg.probeTimeoutMs bounds each network probe
//     so the "hang past the 2 s internal timeout" case is deterministic in CI —
//     a SHORT injected timeout (150 ms) + a stub route that never responds, with
//     NO real 2 s sleep. The elapsed-time bound (< 1500 ms) proves the injected
//     timeout was honoured rather than a hard-coded 2 s.
//
//   Failover-latch mechanism: resolveBaseUrl is a pure SYNC resolver over
//     failoverState (never does I/O — that is why it can return a url, not a
//     Promise). The fan-out engine, upon observing a router request failure,
//     records it via noteRouterFailure; the NEXT resolveBaseUrl returns upstream
//     and keeps doing so. The 2nd noteRouterFailure sets probingDisabled, after
//     which resolveBaseUrl names the upstream WITHOUT the router being touched.
//
//   Journaling: the two journaling entry points take an optional sink
//     `(level, event, data) => void` — component is fixed to "router-client" by
//     the module (core/journal-events.ts allows events request/response/failover/
//     retry there). fetchMetricsSummary journals at DEBUG on any failure;
//     noteRouterFailure journals event "failover" at WARN (§4.4 "warning").
//     An injected sink keeps this file's sole project import the subject itself.
//
// ------------------------------------------------------------------------- //
// Assertion id  -> test name
// ------------------------------------------------------------------------- //
//   7.2-api             -> "[7.2-api] exports the pinned surface + failover mechanism;
//                           createFailoverState() yields a fresh unlatched state"
//   7.2-cases           -> "[7.2-cases] fetchMetricsSummary: 200 + JSON body -> summary"
//                       -> "[7.2-cases] fetchMetricsSummary: 500 -> null (no throw)"
//                       -> "[7.2-cases] fetchMetricsSummary: garbage body -> null (no throw)"
//                       -> "[7.2-cases] fetchMetricsSummary: connection refused -> null (no throw)"
//                       -> "[7.2-cases] fetchMetricsSummary: hang past probeTimeoutMs -> null within bound (no throw); journals at debug"
//   7.2-failover        -> "[7.2-failover] refused router request -> resolveBaseUrl latches to upstream (stays latched);
//                           metrics marked partial; journals failover(warn)"
//   7.2-second-failover -> "[7.2-second-failover] two failovers disable probing -> the router origin is resolved away with zero network calls"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// SUBJECT under test — absent at red time (the missing-subject red). Values are
// imported for runtime linking (this is what makes node --test name the file);
// the types are `import type` so the stripper erases them (a type-only import of
// a missing module raises nothing, so the value import below carries the red).
import {
  fetchMetricsSummary,
  resolveBaseUrl,
  noteRouterFailure,
  createFailoverState,
} from "../adapter/router-client.ts";
import type { FailoverState, MetricsSummary } from "../adapter/router-client.ts";

// The closed router-client event vocabulary (core/journal-events.ts line 54),
// inlined so the subject stays this file's ONLY project import.
const ROUTER_CLIENT_EVENTS = ["request", "response", "failover", "retry"] as const;

// A metrics aggregate as /conductor/metrics would serve it (§4.4 line 1680-1684).
const METRICS_FIXTURE = {
  totalRequests: 12,
  schemaMissing: 3,
  schemaConformed: 8,
  statusCounts: { "200": 10, "503": 2 },
  promptTokens: 3400,
  completionTokens: 900,
};

// A captured journal record from the injected sink.
interface CapturedLog {
  level: string;
  event: string;
  data: Record<string, unknown>;
}

// ------------------------------------------------------------------------- //
// Stub-server harness — every server lands on an EPHEMERAL 127.0.0.1 port
// (never 8080) and is force-closed (sockets included, so hung requests cannot
// wedge cleanup) in the single after() below.
// ------------------------------------------------------------------------- //

const servers: Server[] = [];

interface Stub {
  port: number;
  hits: () => number;
}

// Start a stub whose handler answers EVERY path uniformly, so the tests never
// couple to the exact health/metrics path the client happens to probe.
function startStub(
  handler: (respond: (status: number, body: string, contentType?: string) => void) => void,
): Promise<Stub> {
  let count = 0;
  const server = createServer((_req, res) => {
    count += 1;
    handler((status, body, contentType) => {
      res.writeHead(status, { "content-type": contentType ?? "application/json" });
      res.end(body);
    });
  });
  servers.push(server);
  return new Promise<Stub>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      if (port === 8080) throw new Error("ephemeral port collided with the reserved 8080");
      resolve({ port, hits: () => count });
    });
  });
}

// A stub that accepts the connection but NEVER responds — the deterministic
// stand-in for a router hang. The socket is torn down in after().
function startHangStub(): Promise<Stub> {
  let count = 0;
  const server = createServer((_req, _res) => {
    count += 1;
    // Intentionally never write nor end: the request hangs until the client's
    // injected probeTimeoutMs fires (or after() destroys the socket).
  });
  servers.push(server);
  return new Promise<Stub>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      if (port === 8080) throw new Error("ephemeral port collided with the reserved 8080");
      resolve({ port, hits: () => count });
    });
  });
}

// A port that is guaranteed to REFUSE connections: bind ephemeral, read the
// assigned port, then release it so nothing is listening there.
function refusedPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ------------------------------------------------------------------------- //
// Config builders — routerCfg carries {listen:{host,port}, probeTimeoutMs};
// upstreamCfg carries {host,port}. resolveBaseUrl formats both as origins.
// ------------------------------------------------------------------------- //

function routerCfgAt(port: number, probeTimeoutMs: number) {
  return { listen: { host: "127.0.0.1", port }, probeTimeoutMs };
}

const UPSTREAM_CFG = { host: "127.0.0.1", port: 59999 };
const UPSTREAM_URL = "http://127.0.0.1:59999";

// Normalize away an optional trailing slash so the assertions pin the origin
// without dictating that one convention.
function normUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

function sink(into: CapturedLog[]) {
  return (level: string, event: string, data: Record<string, unknown>) => {
    into.push({ level, event, data });
  };
}

// ------------------------------------------------------------------------- //
// 7.2-api — export surface + failoverState shape
// ------------------------------------------------------------------------- //

test("[7.2-api] exports the pinned surface + failover mechanism; createFailoverState() yields a fresh unlatched state", () => {
  assert.strictEqual(typeof fetchMetricsSummary, "function");
  assert.strictEqual(typeof resolveBaseUrl, "function");
  assert.strictEqual(typeof noteRouterFailure, "function");
  assert.strictEqual(typeof createFailoverState, "function");

  const state: FailoverState = createFailoverState();
  assert.strictEqual(state.failovers, 0);
  assert.strictEqual(state.useUpstream, false);
  assert.strictEqual(state.metricsPartial, false);
  assert.strictEqual(state.probingDisabled, false);

  // Fresh state (no failure recorded) => resolveBaseUrl points at the ROUTER.
  const routerCfg = routerCfgAt(41234, 1000);
  assert.strictEqual(
    normUrl(resolveBaseUrl(routerCfg, UPSTREAM_CFG, state)),
    normUrl("http://127.0.0.1:41234"),
  );
});

// ------------------------------------------------------------------------- //
// 7.2-cases — fetchMetricsSummary (strictly fail-soft: null on ANY failure)
// ------------------------------------------------------------------------- //

test("[7.2-cases] fetchMetricsSummary: 200 + JSON body -> summary", async () => {
  const stub = await startStub((respond) => respond(200, JSON.stringify(METRICS_FIXTURE)));
  const summary: MetricsSummary | null = await fetchMetricsSummary(routerCfgAt(stub.port, 1000));
  assert.ok(summary !== null);
  assert.strictEqual(summary.totalRequests, METRICS_FIXTURE.totalRequests);
  assert.strictEqual(summary.schemaMissing, METRICS_FIXTURE.schemaMissing);
  assert.strictEqual(summary.statusCounts["200"], METRICS_FIXTURE.statusCounts["200"]);
  assert.strictEqual(summary.completionTokens, METRICS_FIXTURE.completionTokens);
});

test("[7.2-cases] fetchMetricsSummary: 500 -> null (no throw)", async () => {
  const stub = await startStub((respond) => respond(500, JSON.stringify({ error: "boom" })));
  const summary = await fetchMetricsSummary(routerCfgAt(stub.port, 1000));
  assert.strictEqual(summary, null);
});

test("[7.2-cases] fetchMetricsSummary: garbage body -> null (no throw)", async () => {
  const stub = await startStub((respond) => respond(200, "this is <not> json {{{", "text/plain"));
  const summary = await fetchMetricsSummary(routerCfgAt(stub.port, 1000));
  assert.strictEqual(summary, null);
});

test("[7.2-cases] fetchMetricsSummary: connection refused -> null (no throw)", async () => {
  const port = await refusedPort();
  const summary = await fetchMetricsSummary(routerCfgAt(port, 1000));
  assert.strictEqual(summary, null);
});

test(
  "[7.2-cases] fetchMetricsSummary: hang past probeTimeoutMs -> null within bound (no throw); journals at debug",
  { timeout: 5000 },
  async () => {
    const stub = await startHangStub();
    const logs: CapturedLog[] = [];
    const t0 = Date.now();
    const summary = await fetchMetricsSummary(routerCfgAt(stub.port, 150), sink(logs));
    const elapsed = Date.now() - t0;
    assert.strictEqual(summary, null);
    assert.ok(elapsed < 1500, `metrics fetch should time out fast; took ${elapsed} ms`);
    // Fail-soft still leaves a trail: journals the failure at debug (§4.4 /
    // plan 2498-2499), under a known router-client event name.
    const debugRecords = logs.filter((r) => r.level === "debug");
    assert.ok(debugRecords.length >= 1, "expected at least one debug journal record on failure");
    assert.ok(
      (ROUTER_CLIENT_EVENTS as readonly string[]).includes(debugRecords[0].event),
      `event "${debugRecords[0].event}" is not a known router-client event`,
    );
  },
);

// ------------------------------------------------------------------------- //
// 7.2-failover — first failover latches to upstream, marks partial, journals
// ------------------------------------------------------------------------- //

test(
  "[7.2-failover] refused router request -> resolveBaseUrl latches to upstream (stays latched); metrics marked partial; journals failover(warn)",
  async () => {
    // The router is down: its listen port refuses connections.
    const refused = await refusedPort();
    const routerCfg = routerCfgAt(refused, 1000);
    const state = createFailoverState();

    // Pre-failover, the base URL points at the ROUTER.
    assert.strictEqual(
      normUrl(resolveBaseUrl(routerCfg, UPSTREAM_CFG, state)),
      normUrl(`http://127.0.0.1:${refused}`),
    );

    // The conductor observes the refused router request through the one call it
    // actually makes against the router (fail-soft: null, no throw).
    const summary = await fetchMetricsSummary(routerCfg);
    assert.strictEqual(summary, null);

    // ...and records the failover.
    const logs: CapturedLog[] = [];
    noteRouterFailure(state, sink(logs));

    // The latch is set and the metrics are marked partial.
    assert.strictEqual(state.failovers, 1);
    assert.strictEqual(state.useUpstream, true);
    assert.strictEqual(state.metricsPartial, true);
    assert.strictEqual(state.probingDisabled, false);

    // resolveBaseUrl now returns UPSTREAM and KEEPS returning it for the session.
    for (let i = 0; i < 3; i += 1) {
      assert.strictEqual(normUrl(resolveBaseUrl(routerCfg, UPSTREAM_CFG, state)), normUrl(UPSTREAM_URL));
    }

    // Exactly one router.failover journal record, at warn (§4.4 "warning").
    const failoverRecords = logs.filter((r) => r.event === "failover");
    assert.strictEqual(failoverRecords.length, 1);
    assert.strictEqual(failoverRecords[0].level, "warn");
  },
);

// ------------------------------------------------------------------------- //
// 7.2-second-failover — two failovers disable probing entirely
// ------------------------------------------------------------------------- //

test(
  "[7.2-second-failover] two failovers disable probing -> the router origin is resolved away with zero network calls",
  async () => {
    const state = createFailoverState();

    // First failover: latched, but probing is still enabled.
    noteRouterFailure(state);
    assert.strictEqual(state.failovers, 1);
    assert.strictEqual(state.probingDisabled, false);

    // Second failover in the session: probing is disabled entirely.
    noteRouterFailure(state);
    assert.strictEqual(state.failovers, 2);
    assert.strictEqual(state.probingDisabled, true);

    // A stub that WOULD answer 200 if contacted — proof that "stop probing" is
    // real rather than nominal. resolveBaseUrl is the seam every conductor-issued
    // router request passes through, and once probing is disabled it names the
    // upstream, so the router's own port is never dialled: zero hits on a live
    // server standing at that port.
    const stub = await startStub((respond) => respond(200, JSON.stringify({ status: "ok" })));
    const routerCfg = routerCfgAt(stub.port, 1000);
    assert.strictEqual(normUrl(resolveBaseUrl(routerCfg, UPSTREAM_CFG, state)), normUrl(UPSTREAM_URL));
    assert.strictEqual(stub.hits(), 0);
  },
);
