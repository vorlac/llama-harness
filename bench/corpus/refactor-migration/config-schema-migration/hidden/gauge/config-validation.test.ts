// Validation is expected to report the offending key and the source the bad
// value came from. Today only three keys are checked; the shape of what it
// reports is what these tests pin.

import test from "node:test";
import assert from "node:assert/strict";

import { loadForTest, makeApp } from "../src/testsupport/harness.ts";

function issueFor(issues: any[], key: string): any {
  const found = issues.filter((i: any) => i.key === key);
  assert.equal(found.length >= 1, true, "expected an issue for " + key);
  return found[0];
}

test("a valid configuration reports no issues", () => {
  const c = loadForTest({ argv: ["--server-port=9000", "--log-level=debug", "--sink-kind=null"] });
  assert.equal(c.ok, true);
  assert.deepEqual(c.issues, []);
});

test("an out of range port is reported against the source that set it", () => {
  const c = loadForTest({ env: { RELAY_SERVER_PORT: "70000" } });
  assert.equal(c.ok, false);
  const i = issueFor(c.issues, "server.port");
  assert.equal(i.source, "env");
  assert.equal(typeof i.message, "string");
  assert.match(i.message, /65535/);
});

test("a non-numeric port is reported", () => {
  const c = loadForTest({ argv: ["--server-port=eighty"] });
  assert.equal(c.ok, false);
  const i = issueFor(c.issues, "server.port");
  assert.equal(i.source, "cli");
});

test("an unknown log level is reported against the command line", () => {
  const c = loadForTest({ argv: ["--log-level=verbose"] });
  assert.equal(c.ok, false);
  const i = issueFor(c.issues, "log.level");
  assert.equal(i.source, "cli");
  assert.match(i.message, /debug/);
});

test("an unknown sink kind is reported against the file", () => {
  const c = loadForTest({ file: { sink: { kind: "kafka" } } });
  assert.equal(c.ok, false);
  const i = issueFor(c.issues, "sink.kind");
  assert.equal(i.source, "file");
});

test("several bad values are all reported, not just the first", () => {
  const c = loadForTest({ env: { RELAY_SERVER_PORT: "-1" }, argv: ["--log-level=chatty"] });
  assert.equal(c.ok, false);
  assert.equal(issueFor(c.issues, "server.port").source, "env");
  assert.equal(issueFor(c.issues, "log.level").source, "cli");
});

test("building an application on an invalid configuration fails, naming the key", () => {
  assert.throws(
    () => makeApp({ argv: ["--server-port=99999"] }),
    /server\.port/,
  );
});

test("an http sink with no endpoint fails, naming the key", () => {
  assert.throws(
    () => makeApp({ overrides: { "sink.kind": "http" } }),
    /sink\.http\.endpoint/,
  );
});
