// Buffering, transformation, retry and sink behaviour. All timing goes through
// the manual scheduler the rigs install, so nothing here waits on a clock.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  makeBatcher,
  makeFileSink,
  makeHttpSink,
  makeTempDir,
  runRetry,
  transformRecord,
} from "../src/testsupport/harness.ts";

test("configured fields are dropped and configured keys are redacted", () => {
  const out = transformRecord(
    { user: "ana", password: "hunter2", secret: "s", note: "keep" },
    { overrides: { "transform.dropFields": ["secret"], "transform.redactKeys": ["password"] } },
  );
  assert.deepEqual(out, { user: "ana", password: "[redacted]", note: "keep" });
});

test("redaction reaches nested objects and arrays", () => {
  const out = transformRecord(
    { outer: { password: "x", list: [{ password: "y" }, { ok: 1 }] } },
    { overrides: { "transform.dropFields": [], "transform.redactKeys": ["password"] } },
  );
  assert.deepEqual(out, {
    outer: { password: "[redacted]", list: [{ password: "[redacted]" }, { ok: 1 }] },
  });
});

test("redaction matches key names case insensitively", () => {
  const out = transformRecord(
    { Password: "x", TOKEN: "y" },
    { overrides: { "transform.dropFields": [], "transform.redactKeys": ["password", "token"] } },
  );
  assert.deepEqual(out, { Password: "[redacted]", TOKEN: "[redacted]" });
});

test("non-object records pass through untouched", () => {
  const opts = { overrides: { "transform.dropFields": ["a"], "transform.redactKeys": ["password"] } };
  assert.equal(transformRecord("plain", opts), "plain");
  assert.equal(transformRecord(42, opts), 42);
});

test("the batcher flushes when the batch size is reached", async () => {
  const rig = makeBatcher({ overrides: { "pipeline.batchSize": 2, "pipeline.flushIntervalMs": 10000 } });
  await rig.batcher.push({ n: 1 });
  assert.equal(rig.sink.written.length, 0);
  await rig.batcher.push({ n: 2 });
  await rig.batcher.settled();
  assert.equal(rig.sink.written.length, 2);
  assert.equal(rig.batcher.flushCount, 1);
});

test("the background interval flushes a partial batch", async () => {
  const rig = makeBatcher({
    overrides: { "pipeline.batchSize": 100, "pipeline.flushIntervalMs": 500 },
  });
  rig.batcher.start();
  await rig.batcher.push({ n: 1 });
  assert.equal(rig.sink.written.length, 0);
  rig.scheduler.advance(500);
  await rig.batcher.settled();
  assert.equal(rig.sink.written.length, 1);
  await rig.batcher.stop();
});

test("stopping the batcher flushes whatever is left", async () => {
  const rig = makeBatcher({
    overrides: { "pipeline.batchSize": 100, "pipeline.flushIntervalMs": 10000 },
  });
  await rig.batcher.push({ n: 1 });
  await rig.batcher.stop();
  assert.equal(rig.sink.written.length, 1);
});

test("records beyond the queue limit are dropped, not buffered", async () => {
  const rig = makeBatcher({
    overrides: { "pipeline.batchSize": 100, "pipeline.maxQueue": 2, "pipeline.flushIntervalMs": 10000 },
  });
  await rig.batcher.push({ n: 1 });
  await rig.batcher.push({ n: 2 });
  await rig.batcher.push({ n: 3 });
  assert.equal(rig.batcher.size, 2);
  assert.equal(rig.batcher.droppedCount, 1);
});

test("retry stops after the configured number of attempts", async () => {
  const run = await runRetry(
    async () => { throw new Error("boom"); },
    { overrides: { "retry.maxAttempts": 3, "retry.baseDelayMs": 10, "retry.jitter": false } },
  );
  assert.equal(run.attempts, 3);
  assert.deepEqual(run.delays, [10, 20]);
  assert.equal(run.value, undefined);
  assert.match(String(run.error && run.error.message), /boom/);
});

test("retry returns as soon as the call succeeds", async () => {
  const run = await runRetry(
    async (attempt: number) => {
      if (attempt < 2) throw new Error("not yet");
      return "done";
    },
    { overrides: { "retry.maxAttempts": 5, "retry.baseDelayMs": 10, "retry.jitter": false } },
  );
  assert.equal(run.attempts, 2);
  assert.deepEqual(run.delays, [10]);
  assert.equal(run.value, "done");
  assert.equal(run.error, null);
});

test("jitter scales the backoff instead of replacing it", async () => {
  const run = await runRetry(
    async () => { throw new Error("boom"); },
    { overrides: { "retry.maxAttempts": 3, "retry.baseDelayMs": 10, "retry.jitter": true } },
  );
  assert.equal(run.attempts, 3);
  assert.deepEqual(run.delays, [8, 15]);
});

test("a single attempt means no backoff at all", async () => {
  const run = await runRetry(
    async () => { throw new Error("boom"); },
    { overrides: { "retry.maxAttempts": 1, "retry.baseDelayMs": 10, "retry.jitter": false } },
  );
  assert.equal(run.attempts, 1);
  assert.deepEqual(run.delays, []);
});

test("the http sink retries failed posts and reports the batch size", async () => {
  const statuses = [500, 500, 200];
  let calls = 0;
  const rig = makeHttpSink(
    {
      overrides: {
        "sink.kind": "http",
        "sink.http.endpoint": "http://collector.invalid/ingest",
        "retry.maxAttempts": 3,
        "retry.baseDelayMs": 50,
      },
    },
    async () => {
      const status = statuses[calls];
      calls += 1;
      return status;
    },
  );
  const written = await rig.sink.write([{ a: 1 }, { a: 2 }]);
  assert.equal(written, 2);
  assert.equal(calls, 3);
  assert.deepEqual(rig.delays, [50, 100]);
});

test("the http sink gives up once its attempts are exhausted", async () => {
  const rig = makeHttpSink(
    {
      overrides: {
        "sink.kind": "http",
        "sink.http.endpoint": "http://collector.invalid/ingest",
        "retry.maxAttempts": 2,
        "retry.baseDelayMs": 50,
      },
    },
    async () => 503,
  );
  await assert.rejects(() => rig.sink.write([{ a: 1 }]), /503/);
});

test("the http sink posts the batch as newline delimited JSON", async () => {
  let seen = "";
  let seenTimeout = 0;
  const rig = makeHttpSink(
    {
      overrides: {
        "sink.kind": "http",
        "sink.http.endpoint": "http://collector.invalid/ingest",
        "sink.http.timeoutMs": 250,
      },
    },
    async (_url: string, body: string, timeoutMs: number) => {
      seen = body;
      seenTimeout = timeoutMs;
      return 200;
    },
  );
  await rig.sink.write([{ a: 1 }, { a: 2 }]);
  assert.equal(seen, '{"a":1}\n{"a":2}\n');
  assert.equal(seenTimeout, 250);
});

test("the file sink appends newline delimited JSON", async () => {
  const tmp = makeTempDir();
  try {
    const path = tmp.join("out.ndjson");
    const sink = makeFileSink({ overrides: { "sink.kind": "file", "sink.file.path": path } });
    await sink.write([{ a: 1 }]);
    await sink.write([{ a: 2 }, { a: 3 }]);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.deepEqual(lines, ['{"a":1}', '{"a":2}', '{"a":3}']);
  } finally {
    tmp.cleanup();
  }
});

test("the file sink rotates once the configured size is exceeded", async () => {
  const tmp = makeTempDir();
  try {
    const path = tmp.join("rotate.ndjson");
    const sink = makeFileSink({
      overrides: { "sink.kind": "file", "sink.file.path": path, "sink.file.rotateBytes": 8 },
    });
    await sink.write([{ a: "0123456789" }]);
    await sink.write([{ b: 1 }]);
    assert.equal(existsSync(path + ".1"), true);
    assert.equal(readFileSync(path, "utf8").trim(), '{"b":1}');
  } finally {
    tmp.cleanup();
  }
});

test("the file sink creates the directory it was pointed at", async () => {
  const tmp = makeTempDir();
  try {
    const path = tmp.join("nested", "deeper", "out.ndjson");
    const sink = makeFileSink({ overrides: { "sink.kind": "file", "sink.file.path": path } });
    await sink.write([{ a: 1 }]);
    assert.equal(existsSync(path), true);
  } finally {
    tmp.cleanup();
  }
});
