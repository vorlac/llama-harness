// conductor/adapter/router-client.ts — Task 7.2: the plugin-side health/metrics
// client for the C++ llama-router, plus the §4.4 fail-soft failover (plan lines
// 1636-1698, interfaces 2495-2511).
//
// An ADAPTER (G14): it does network I/O, so it lives outside the pure core. It
// runs under BOTH the opencode runtime and Node type-stripping, so it uses only
// cross-runtime built-ins — node:http and the standard timer functions — with no
// single-runtime global, no shell tag, no single-runtime import (the purity guard
// scans it). It reads no wall clock and touches no filesystem.
//
// Failure discipline (§4.4 "Fail-soft"): the router is a residual-risk dependency.
// While it is down, requests to it fail, and this client must ABSORB every such
// failure — routerHealthy resolves false and fetchMetricsSummary resolves null,
// each without ever throwing or rejecting. The fan-out engine, on observing a
// router request failure, records it via noteRouterFailure, which latches the
// session onto the upstream base URL (resolveBaseUrl then returns the upstream for
// the rest of the session) and marks the run's metrics partial. A second failover
// in one session disables router probing entirely (§4.4 lines 1690-1692).
//
// Interfaces (plan 2497-2504):
//   routerHealthy(routerCfg, failoverState?)              -> Promise<boolean>
//   fetchMetricsSummary(routerCfg, log?)                  -> Promise<MetricsSummary | null>
//   resolveBaseUrl(routerCfg, upstreamCfg, failoverState) -> string   (SYNC pure resolver)
//   noteRouterFailure(failoverState, log?)                -> void      (records one failover)
//   createFailoverState()                                 -> FailoverState

import { request as httpRequest } from "node:http";
import type { LogLevel } from "../core/types.ts";

// The router's per-session failover latch AND the partial-metrics signal, threaded
// through the session by the fan-out engine (§4.4). `useUpstream` diverts the base
// URL to the upstream once a router request has failed; `metricsPartial` is the
// boolean Task 9.5b (conductor_report) reads; `probingDisabled` short-circuits
// routerHealthy after the second failover so the router is never probed again.
export interface FailoverState {
  failovers: number;
  useUpstream: boolean;
  metricsPartial: boolean;
  probingDisabled: boolean;
}

// The aggregate /conductor/metrics serves (§4.4 lines 1680-1684). Fail-soft: a
// malformed body never reaches a consumer — fetchMetricsSummary returns null first.
export interface MetricsSummary {
  totalRequests: number;
  schemaMissing: number;
  schemaConformed: number;
  statusCounts: Record<string, number>;
  promptTokens: number;
  completionTokens: number;
}

// Config shapes the fan-out engine passes in. Kept local to this adapter so the
// origin resolver and the probe share one source of truth for host/port.
export interface RouterClientConfig {
  listen: { host: string; port: number };
  probeTimeoutMs: number;
}
export interface UpstreamConfig {
  host: string;
  port: number;
}

// The injected journal sink: (level, event, data) => void. The component is pinned
// to "router-client" by the journal adapter; the events here stay within that
// component's closed vocabulary (core/journal-events.ts line 54:
// request/response/failover/retry). Optional so unit tests can omit it.
export type RouterClientLog = (
  level: LogLevel,
  event: string,
  data: Record<string, unknown>,
) => void;

const HEALTH_PATH = "/conductor/health";
const METRICS_PATH = "/conductor/metrics";

interface HttpResult {
  status: number;
  body: string;
}

// A fresh, unlatched failover state (all-zero / all-false).
export function createFailoverState(): FailoverState {
  return { failovers: 0, useUpstream: false, metricsPartial: false, probingDisabled: false };
}

// Format host/port as an http origin (no trailing slash).
function originOf(host: string, port: number): string {
  return "http://" + host + ":" + String(port);
}

// SYNC pure resolver over the failover latch: the router origin normally; the
// upstream origin once the session has failed over (useUpstream) or stopped
// probing the router (probingDisabled). No I/O — that is why it returns a string.
export function resolveBaseUrl(
  routerCfg: RouterClientConfig,
  upstreamCfg: UpstreamConfig,
  failoverState: FailoverState,
): string {
  if (failoverState.useUpstream || failoverState.probingDisabled) {
    return originOf(upstreamCfg.host, upstreamCfg.port);
  }
  return originOf(routerCfg.listen.host, routerCfg.listen.port);
}

// Record one router request failure (§4.4). The first failover latches the session
// onto the upstream and marks the metrics partial, journaling `failover` at WARN.
// The second failover in a session additionally disables router probing.
export function noteRouterFailure(failoverState: FailoverState, log?: RouterClientLog): void {
  failoverState.failovers += 1;
  failoverState.useUpstream = true;
  failoverState.metricsPartial = true;
  if (failoverState.failovers >= 2) {
    failoverState.probingDisabled = true;
  }
  emit(log, "warn", "failover", {
    failovers: failoverState.failovers,
    probingDisabled: failoverState.probingDisabled,
  });
}

// A single bounded, fail-soft GET. It NEVER rejects: every failure mode — a refused
// connection, a socket-level error, a body-read error, or a hang past
// probeTimeoutMs — resolves null. On success it resolves the status + body. The
// promise settles exactly once (guarded by `settled`); the injected timeout bounds
// the whole request and destroys the socket so no probe can wedge the event loop.
function httpGet(routerCfg: RouterClientConfig, pathName: string): Promise<HttpResult | null> {
  return new Promise<HttpResult | null>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: HttpResult | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };

    const req = httpRequest(
      { host: routerCfg.listen.host, port: routerCfg.listen.port, path: pathName, method: "GET" },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", () => {
          req.destroy();
          finish(null);
        });
      },
    );

    // A connection-level failure (refused host, reset socket, destroy after a
    // timeout) lands here; absorb it into a null result rather than a rejection.
    req.on("error", () => {
      finish(null);
    });

    timer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, routerCfg.probeTimeoutMs);
    // Do not let a pending probe keep the process alive on its own.
    if (typeof timer.unref === "function") timer.unref();

    req.end();
  });
}

// True iff the router answers its health endpoint with 200. Any other status, a
// refused connection, or a hang past probeTimeoutMs resolves false WITHOUT throwing.
// Once the session has recorded two failovers (probingDisabled), this short-circuits
// false with ZERO network calls.
export async function routerHealthy(
  routerCfg: RouterClientConfig,
  failoverState?: FailoverState,
): Promise<boolean> {
  if (failoverState !== undefined && failoverState.probingDisabled) {
    return false;
  }
  const res = await httpGet(routerCfg, HEALTH_PATH);
  return res !== null && res.status === 200;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Fetch and parse the /conductor/metrics aggregate. STRICTLY fail-soft: it NEVER
// throws and returns null on ANY failure — a refused connection, a hang past
// probeTimeoutMs, a non-200 status, or a body that is not a JSON object. Every such
// failure is journaled at DEBUG under the "response" event so the fail-soft path
// still leaves a greppable trail (§4.4 / plan 2498-2499).
export async function fetchMetricsSummary(
  routerCfg: RouterClientConfig,
  log?: RouterClientLog,
): Promise<MetricsSummary | null> {
  const res = await httpGet(routerCfg, METRICS_PATH);
  if (res === null) {
    emit(log, "debug", "response", { path: METRICS_PATH, reason: "metrics request failed" });
    return null;
  }
  if (res.status !== 200) {
    emit(log, "debug", "response", {
      path: METRICS_PATH,
      reason: "metrics non-200",
      status: res.status,
    });
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(res.body);
    if (typeof parsed !== "object" || parsed === null) {
      emit(log, "debug", "response", { path: METRICS_PATH, reason: "metrics body not an object" });
      return null;
    }
    return parsed as MetricsSummary;
  } catch (err) {
    emit(log, "debug", "response", {
      path: METRICS_PATH,
      reason: "metrics body parse failed",
      error: errText(err),
    });
    return null;
  }
}

// Forward one record to the injected sink when present. A run with no sink simply
// carries no trail; the sink itself is the journal adapter's concern.
function emit(
  log: RouterClientLog | undefined,
  level: LogLevel,
  event: string,
  data: Record<string, unknown>,
): void {
  if (log === undefined) return;
  log(level, event, data);
}
