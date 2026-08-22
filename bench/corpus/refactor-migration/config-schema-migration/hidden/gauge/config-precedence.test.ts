// Observable behaviour of configuration resolution.
//
// Everything here goes through src/testsupport/harness.ts. No test in this file
// knows how the configuration is stored, only what it resolves to.

import test from "node:test";
import assert from "node:assert/strict";

import { loadForTest } from "../src/testsupport/harness.ts";

test("defaults resolve when nothing else is supplied", () => {
  const c = loadForTest();
  assert.equal(c.ok, true);
  assert.deepEqual(c.issues, []);
  assert.equal(c.effective("server.host"), "127.0.0.1");
  assert.equal(c.effective("server.port"), 8080);
  assert.equal(c.effective("log.level"), "info");
  assert.equal(c.effective("sink.kind"), "null");
  assert.equal(c.sourceOf("server.port"), "default");
});

test("a nested config file overrides defaults", () => {
  const c = loadForTest({ file: { server: { port: 9001 }, log: { level: "warn" } } });
  assert.equal(c.effective("server.port"), 9001);
  assert.equal(c.effective("log.level"), "warn");
  assert.equal(c.sourceOf("server.port"), "file");
  assert.equal(c.sourceOf("server.host"), "default");
});

test("a config file may use flat dotted keys instead of nesting", () => {
  const c = loadForTest({ file: { "server.port": 9002, "sink.file.path": "/tmp/out.ndjson" } });
  assert.equal(c.effective("server.port"), 9002);
  assert.equal(c.effective("sink.file.path"), "/tmp/out.ndjson");
});

test("a config file may mix nested and dotted keys", () => {
  const c = loadForTest({ file: { server: { port: 9003 }, "log.level": "error" } });
  assert.equal(c.effective("server.port"), 9003);
  assert.equal(c.effective("log.level"), "error");
});

test("precedence is defaults < file < env < cli < overrides", () => {
  const file = { "server.port": 1111 };
  const env = { RELAY_SERVER_PORT: "2222" };
  const argv = ["--server-port=3333"];

  assert.equal(loadForTest({}).effective("server.port"), 8080);
  assert.equal(loadForTest({ file }).effective("server.port"), 1111);
  assert.equal(loadForTest({ file, env }).effective("server.port"), 2222);
  assert.equal(loadForTest({ file, env, argv }).effective("server.port"), 3333);
  assert.equal(
    loadForTest({ file, env, argv, overrides: { "server.port": 4444 } }).effective("server.port"),
    4444,
  );
});

test("sourceOf names the layer that won", () => {
  const c = loadForTest({
    file: { "server.port": 1111, "log.format": "json" },
    env: { RELAY_SERVER_PORT: "2222", RELAY_LOG_LEVEL: "debug" },
    argv: ["--sink-kind=file"],
  });
  assert.equal(c.sourceOf("server.port"), "env");
  assert.equal(c.sourceOf("log.format"), "file");
  assert.equal(c.sourceOf("log.level"), "env");
  assert.equal(c.sourceOf("sink.kind"), "cli");
  assert.equal(c.sourceOf("server.host"), "default");
});

test("an explicitly configured zero is not replaced by a default", () => {
  const fromCli = loadForTest({ argv: ["--rate-limit-max=0"] });
  assert.equal(fromCli.effective("rateLimit.max"), 0);
  assert.equal(fromCli.sourceOf("rateLimit.max"), "cli");

  const fromEnv = loadForTest({ env: { RELAY_RATE_LIMIT_MAX: "0" } });
  assert.equal(fromEnv.effective("rateLimit.max"), 0);
  assert.equal(fromEnv.sourceOf("rateLimit.max"), "env");

  const fromFile = loadForTest({ file: { rateLimit: { max: 0 } } });
  assert.equal(fromFile.effective("rateLimit.max"), 0);
  assert.equal(fromFile.sourceOf("rateLimit.max"), "file");
});

test("an explicitly configured false is not replaced by a default", () => {
  assert.equal(loadForTest({ env: { RELAY_AUTH_REQUIRED: "false" } }).effective("auth.required"), false);
  assert.equal(loadForTest({ env: { RELAY_AUTH_REQUIRED: "0" } }).effective("auth.required"), false);
  assert.equal(loadForTest({ env: { RELAY_AUTH_REQUIRED: "no" } }).effective("auth.required"), false);
  assert.equal(loadForTest({ argv: ["--no-auth-required"] }).effective("auth.required"), false);
  assert.equal(loadForTest({ file: { auth: { required: false } } }).effective("auth.required"), false);
});

test("an explicitly configured empty string survives", () => {
  const c = loadForTest({ env: { RELAY_SINK_FILE_PATH: "" } });
  assert.equal(c.effective("sink.file.path"), "");
  assert.equal(c.sourceOf("sink.file.path"), "env");
});

test("environment values are coerced by the kind of key they set", () => {
  const c = loadForTest({
    env: {
      RELAY_SERVER_PORT: "9100",
      RELAY_METRICS_ENABLED: "true",
      RELAY_AUTH_TOKENS: "alpha,beta , gamma",
      RELAY_SERVER_HOST: "0.0.0.0",
    },
  });
  assert.equal(c.effective("server.port"), 9100);
  assert.equal(c.effective("metrics.enabled"), true);
  assert.deepEqual(c.effective("auth.tokens"), ["alpha", "beta", "gamma"]);
  assert.equal(c.effective("server.host"), "0.0.0.0");
});

test("legacy 0.2 environment names still work", () => {
  const port = loadForTest({ env: { RELAY_PORT: "7000" } });
  assert.equal(port.effective("server.port"), 7000);
  assert.equal(port.sourceOf("server.port"), "env");

  const host = loadForTest({ env: { RELAY_HOST: "10.0.0.5" } });
  assert.equal(host.effective("server.host"), "10.0.0.5");

  const tokens = loadForTest({ env: { RELAY_TOKENS: "one,two" } });
  assert.deepEqual(tokens.effective("auth.tokens"), ["one", "two"]);

  const endpoint = loadForTest({ env: { RELAY_ENDPOINT: "http://collector.internal/ingest" } });
  assert.equal(endpoint.effective("sink.http.endpoint"), "http://collector.internal/ingest");
});

test("RELAY_DEBUG raises the log level rather than being renamed", () => {
  assert.equal(loadForTest({ env: { RELAY_DEBUG: "1" } }).effective("log.level"), "debug");
  assert.equal(loadForTest({ env: { RELAY_DEBUG: "yes" } }).effective("log.level"), "debug");
  assert.equal(loadForTest({ env: { RELAY_DEBUG: "0" } }).effective("log.level"), "info");
  assert.equal(loadForTest({ env: { RELAY_DEBUG: "" } }).effective("log.level"), "info");
});

test("legacy 0.2 command line flags still work", () => {
  assert.equal(loadForTest({ argv: ["--port", "7100"] }).effective("server.port"), 7100);
  assert.equal(loadForTest({ argv: ["--port=7101"] }).effective("server.port"), 7101);
  assert.equal(loadForTest({ argv: ["-p", "7102"] }).effective("server.port"), 7102);
  assert.equal(loadForTest({ argv: ["-p7103"] }).effective("server.port"), 7103);
  assert.equal(loadForTest({ argv: ["--host", "10.0.0.6"] }).effective("server.host"), "10.0.0.6");
  assert.equal(loadForTest({ argv: ["--log-level", "error"] }).effective("log.level"), "error");
  assert.equal(loadForTest({ argv: ["--batch-size=7"] }).effective("pipeline.batchSize"), 7);
  assert.equal(
    loadForTest({ argv: ["--endpoint", "http://c/i"] }).effective("sink.http.endpoint"),
    "http://c/i",
  );
});

test("canonical command line flags are the kebab-case form of the key", () => {
  const c = loadForTest({
    argv: ["--server-max-body-bytes", "2048", "--sink-http-timeout-ms=250", "--spool-dir=/tmp/s"],
  });
  assert.equal(c.effective("server.maxBodyBytes"), 2048);
  assert.equal(c.effective("sink.http.timeoutMs"), 250);
  assert.equal(c.effective("spool.dir"), "/tmp/s");
});

test("boolean flags accept the bare, explicit and negated forms", () => {
  assert.equal(loadForTest({ argv: ["--metrics-enabled"] }).effective("metrics.enabled"), true);
  assert.equal(loadForTest({ argv: ["--metrics-enabled", "false"] }).effective("metrics.enabled"), false);
  assert.equal(loadForTest({ argv: ["--metrics-enabled=true"] }).effective("metrics.enabled"), true);
  assert.equal(loadForTest({ argv: ["--no-metrics-enabled"] }).effective("metrics.enabled"), false);
  assert.equal(loadForTest({ argv: ["--no-rate-limit-enabled"] }).effective("rateLimit.enabled"), false);
});

test("list-valued options accept a comma separated string", () => {
  const c = loadForTest({ argv: ["--auth-tokens=a,b,c", "--transform-drop-fields", "x,y"] });
  assert.deepEqual(c.effective("auth.tokens"), ["a", "b", "c"]);
  assert.deepEqual(c.effective("transform.dropFields"), ["x", "y"]);
});

test("a config file may carry keys this version does not know about", () => {
  const c = loadForTest({
    file: { "server.port": 9500, "experimental.turbo": true, future: { thing: 1 } },
  });
  assert.equal(c.ok, true);
  assert.deepEqual(c.issues, []);
  assert.equal(c.effective("server.port"), 9500);
  assert.equal(c.effective("experimental.turbo"), undefined);
});

test("an unrecognised command line flag does not invalidate the configuration", () => {
  const c = loadForTest({ argv: ["--not-a-real-flag=1", "--server-port=9600"] });
  assert.equal(c.ok, true);
  assert.equal(c.effective("server.port"), 9600);
});

test("keys() lists the canonical dotted keys, sorted", () => {
  const keys = loadForTest().keys();
  const sorted = keys.slice().sort();
  assert.deepEqual(keys, sorted);
  for (const expected of [
    "auth.tokens",
    "log.level",
    "metrics.flushIntervalMs",
    "pipeline.batchSize",
    "rateLimit.max",
    "retry.maxAttempts",
    "server.maxBodyBytes",
    "server.port",
    "sink.file.rotateBytes",
    "spool.maxBytes",
    "transform.redactKeys",
  ]) {
    assert.ok(keys.indexOf(expected) >= 0, "keys() is missing " + expected);
  }
});
