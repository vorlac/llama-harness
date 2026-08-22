import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { makeTempDir, runWithSpool } from "../src/testsupport/harness.ts";

test("a disabled spool accepts nothing and creates nothing", async () => {
  const tmp = makeTempDir();
  try {
    const dir = tmp.join("spool");
    await runWithSpool({ overrides: { "spool.enabled": false, "spool.dir": dir } }, async (spool) => {
      assert.equal(spool.enabled, false);
      assert.equal(spool.append("a.ndjson", "hello"), false);
      assert.deepEqual(spool.files(), []);
    });
    assert.equal(existsSync(dir), false);
  } finally {
    tmp.cleanup();
  }
});

test("an enabled spool writes files that outlive the scope", async () => {
  const tmp = makeTempDir();
  try {
    const dir = tmp.join("spool");
    await runWithSpool({ overrides: { "spool.enabled": true, "spool.dir": dir } }, async (spool) => {
      assert.equal(spool.append("a.ndjson", "one\n"), true);
      assert.equal(spool.append("a.ndjson", "two\n"), true);
      assert.deepEqual(spool.files(), ["a.ndjson"]);
      assert.equal(spool.bytes, 8);
    });
    assert.equal(existsSync(dir), true);
    assert.equal(readFileSync(tmp.join("spool", "a.ndjson"), "utf8"), "one\ntwo\n");
  } finally {
    tmp.cleanup();
  }
});

test("a spool directory that stayed empty is cleaned up again", async () => {
  const tmp = makeTempDir();
  try {
    const dir = tmp.join("spool");
    await runWithSpool({ overrides: { "spool.enabled": true, "spool.dir": dir } }, async (spool) => {
      assert.equal(existsSync(dir), true);
      assert.deepEqual(spool.files(), []);
    });
    assert.equal(existsSync(dir), false);
  } finally {
    tmp.cleanup();
  }
});

test("the spool refuses writes that would exceed its byte budget", async () => {
  const tmp = makeTempDir();
  try {
    const dir = tmp.join("spool");
    await runWithSpool(
      { overrides: { "spool.enabled": true, "spool.dir": dir, "spool.maxBytes": 8 } },
      async (spool) => {
        assert.equal(spool.maxBytes, 8);
        assert.equal(spool.append("a.ndjson", "12345"), true);
        assert.equal(spool.append("a.ndjson", "678901"), false);
        assert.equal(spool.append("a.ndjson", "678"), true);
        assert.equal(spool.bytes, 8);
      },
    );
  } finally {
    tmp.cleanup();
  }
});

test("the spool scope propagates what the body returned", async () => {
  const tmp = makeTempDir();
  try {
    const value = await runWithSpool(
      { overrides: { "spool.enabled": true, "spool.dir": tmp.join("spool") } },
      async () => 42,
    );
    assert.equal(value, 42);
  } finally {
    tmp.cleanup();
  }
});

test("the spool scope tears down even when the body throws", async () => {
  const tmp = makeTempDir();
  try {
    const dir = tmp.join("spool");
    await assert.rejects(
      () => runWithSpool(
        { overrides: { "spool.enabled": true, "spool.dir": dir } },
        async () => { throw new Error("body failed"); },
      ),
      /body failed/,
    );
    assert.equal(existsSync(dir), false);
  } finally {
    tmp.cleanup();
  }
});
