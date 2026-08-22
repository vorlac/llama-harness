import test from "node:test";
import assert from "node:assert/strict";

import { makeLogger, makeMetrics } from "../src/testsupport/harness.ts";

test("messages below the configured level are not emitted", () => {
  const rig = makeLogger({ overrides: { "log.level": "warn" } });
  rig.logger.debug("d");
  rig.logger.info("i");
  rig.logger.warn("w");
  rig.logger.error("e");
  assert.deepEqual(rig.lines, ["WARN w", "ERROR e"]);
});

test("the level can be raised from the environment", () => {
  const rig = makeLogger({ env: { RELAY_LOG_LEVEL: "error" } });
  rig.logger.warn("w");
  rig.logger.error("e");
  assert.deepEqual(rig.lines, ["ERROR e"]);
});

test("RELAY_DEBUG lowers the level to debug", () => {
  const rig = makeLogger({ env: { RELAY_DEBUG: "1" } });
  rig.logger.debug("d");
  assert.deepEqual(rig.lines, ["DEBUG d"]);
});

test("structured fields are appended in text format", () => {
  const rig = makeLogger({ overrides: { "log.level": "info", "log.format": "text" } });
  rig.logger.info("started", { port: 8080, host: "127.0.0.1" });
  assert.deepEqual(rig.lines, ["INFO started port=8080 host=127.0.0.1"]);
});

test("json format emits one parseable object per line", () => {
  const rig = makeLogger({ overrides: { "log.level": "info", "log.format": "json" } });
  rig.logger.info("started", { port: 8080 });
  assert.equal(rig.lines.length, 1);
  assert.deepEqual(JSON.parse(rig.lines[0]), { level: "info", msg: "started", port: 8080 });
});

test("metrics are disabled by default and record nothing", () => {
  const metrics = makeMetrics();
  assert.equal(metrics.enabled, false);
  metrics.inc("requests");
  assert.deepEqual(metrics.snapshot(), {});
  assert.equal(metrics.render(), "");
});

test("enabled metrics count under the configured prefix", () => {
  const metrics = makeMetrics({
    overrides: { "metrics.enabled": true, "metrics.prefix": "acme_" },
  });
  metrics.inc("requests");
  metrics.inc("requests", 4);
  metrics.inc("errors");
  assert.deepEqual(metrics.snapshot(), { acme_errors: 1, acme_requests: 5 });
  assert.equal(metrics.render(), "acme_errors 1\nacme_requests 5\n");
});

test("the default metric prefix is relay_", () => {
  const metrics = makeMetrics({ overrides: { "metrics.enabled": true } });
  metrics.inc("requests");
  assert.deepEqual(metrics.snapshot(), { relay_requests: 1 });
});
