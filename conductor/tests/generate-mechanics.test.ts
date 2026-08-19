// conductor/tests/generate-mechanics.test.ts — the GENERATOR's own witness.
//
// SUBJECT: conductor/tools/generate-mechanics.ts, the GAP-005 generation step that
// writes the derived mechanics block into all nine doctrine packs.
//
// WHY THIS FILE EXISTS. conductor/tests/doctrine-mechanics.test.ts pins that every
// pack's embedded block EQUALS a fresh derivation — but it reads the packs, never
// the tool that writes them. So the splice itself was unguarded: drop `block` from
// spliceBlock's return and the whole gate stays green, because nothing runs the
// generator. The damage only appears the next time someone does run it, and by then
// it has rewritten nine checked-in packs at once — the worst possible moment to
// discover the splice is wrong.
//
// So this file drives the REAL splice: the exported function directly for the
// marker law, and the CLI as an operator invokes it (`node
// conductor/tools/generate-mechanics.ts <doctrineDir>`) over a temp directory of
// fixture packs, twice, to pin that the block lands ONCE, IN PLACE, and that a
// second run changes nothing.
//
// The temp directory is the only thing this file writes. The shipped
// conductor/doctrine/ packs are hashed before and after the import-inertness row,
// because a generator that rewrites the repository merely by being IMPORTED would
// make every test that reads a pack a test of whatever the last import produced.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { spliceBlock } from "../tools/generate-mechanics.ts";
import { MECHANICS_BEGIN, MECHANICS_END, mechanicsBlock } from "../core/mechanics.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, "..", "tools", "generate-mechanics.ts");
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");

// The nine packs the tool rewrites (core/mechanics.ts PACK_SECTIONS names the same
// nine; a fixture directory missing one is not the input the tool takes).
const PACKS: readonly string[] = [
  "core.md",
  "decompose.md",
  "plan.md",
  "tdd.md",
  "test-vet.md",
  "debug.md",
  "review.md",
  "skeptic.md",
  "receive-review.md",
];

const TEMP_DIRS: string[] = [];

function tempDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  TEMP_DIRS.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const dir of TEMP_DIRS) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup; a leftover temp dir must never fail a gate
    }
  }
});

// A fixture pack: hand-written prose the generator must not touch, optionally with
// a STALE block already in the middle of it.
function fixturePack(name: string, opts: { stale?: boolean } = {}): string {
  const head = `# ${name} fixture\n\nHand-written doctrine above the block.\n`;
  const tail = `\n## A hand-written section BELOW the block\n\nStill here afterwards.\n`;
  if (opts.stale !== true) return head + tail;
  const stale = MECHANICS_BEGIN + "\n## Mechanics — a STALE derivation\n\nOut of date.\n" + MECHANICS_END;
  return head + "\n" + stale + tail;
}

function seedDoctrine(dir: string, stalePacks: readonly string[]): void {
  for (const name of PACKS) {
    writeFileSync(path.join(dir, name), fixturePack(name, { stale: stalePacks.includes(name) }), "utf8");
  }
}

function runTool(doctrineDir: string): string {
  return execFileSync(process.execPath, [TOOL, doctrineDir], { encoding: "utf8" });
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function digestOfDoctrine(): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(DOCTRINE_DIR).sort()) {
    hash.update(name);
    hash.update(readFileSync(path.join(DOCTRINE_DIR, name), "utf8"));
  }
  return hash.digest("hex");
}

// ===========================================================================
// (1) ROUND TRIP — the CLI, over a fixture directory, twice
// ===========================================================================

test("[gen-mechanics-roundtrip] the generator writes each pack's block ONCE, IN PLACE, and is idempotent", () => {
  const dir = tempDir("conductor-genmech-roundtrip-");
  const stale: readonly string[] = ["core.md", "tdd.md"];
  seedDoctrine(dir, stale);

  const firstOut = runTool(dir);
  for (const name of PACKS) {
    assert.ok(
      firstOut.includes(name),
      `the generator must report the pack it rewrote (${name}); got:\n${firstOut}`,
    );
  }

  const after: Record<string, string> = {};
  for (const name of PACKS) {
    const text = readFileSync(path.join(dir, name), "utf8");
    after[name] = text;

    assert.equal(
      countOf(text, MECHANICS_BEGIN),
      1,
      `${name} must carry exactly ONE ${MECHANICS_BEGIN} after generation — a second block is a ` +
        "second spelling of the mechanics, which is the defect the derivation exists to remove",
    );
    assert.equal(countOf(text, MECHANICS_END), 1, `${name} must carry exactly one ${MECHANICS_END}`);
    assert.ok(
      text.includes(mechanicsBlock(name)),
      `${name} must carry the derived block for ITS pack profile, markers included — the block the ` +
        "guard test compares against is the block the generator writes, or the two are unrelated",
    );

    // The hand-written words are still where their author put them, on BOTH sides
    // of the block: a generator that rewrites the pack from a template would keep
    // the block and lose the doctrine.
    assert.ok(text.startsWith(`# ${name} fixture\n`), `${name}'s hand-written head must survive`);
    assert.ok(
      text.includes("## A hand-written section BELOW the block"),
      `${name}'s hand-written tail must survive — the block replaced the block, not the pack`,
    );
    assert.ok(
      text.indexOf(MECHANICS_BEGIN) > text.indexOf("Hand-written doctrine above the block."),
      `${name}'s block must stay BELOW the head prose it was spliced under`,
    );
    assert.ok(
      !text.includes("STALE"),
      `${name}'s stale block must be REPLACED, never left beside the fresh one`,
    );
  }

  // The pack that already carried a block keeps it in the SAME position: prefix and
  // suffix are byte-identical to the fixture's, so nothing moved.
  for (const name of stale) {
    const original = fixturePack(name, { stale: true });
    const prefix = original.slice(0, original.indexOf(MECHANICS_BEGIN));
    const suffix = original.slice(original.indexOf(MECHANICS_END) + MECHANICS_END.length);
    assert.equal(
      after[name],
      prefix + mechanicsBlock(name) + suffix,
      `${name}'s regenerated block must sit exactly where the stale one did, between the same bytes`,
    );
  }

  // A pack with NO block gets one appended, once, at the end of its prose.
  const fresh = "decompose.md";
  assert.ok(
    after[fresh].trimEnd().endsWith(MECHANICS_END),
    `${fresh} carried no block, so the appended one must land at the END of the pack; got tail: ` +
      JSON.stringify(after[fresh].slice(-120)),
  );

  // Idempotent: a second run rewrites nothing and says so.
  const secondOut = runTool(dir);
  assert.equal(
    secondOut.trim(),
    "",
    "a second run over an already-generated directory must write nothing and report nothing — a " +
      `generator that rewrites on every run cannot tell drift from noise; got:\n${secondOut}`,
  );
  for (const name of PACKS) {
    assert.equal(
      readFileSync(path.join(dir, name), "utf8"),
      after[name],
      `${name} must be byte-identical after a second generation`,
    );
  }
});

// ===========================================================================
// (2) THE MARKER LAW — a malformed pack is REFUSED, never half-spliced
// ===========================================================================

test("[gen-mechanics-marker-law] spliceBlock refuses a pack whose markers are duplicated, orphaned or unclosed", () => {
  const block = mechanicsBlock("core.md");
  const body = "# a pack\n\nprose\n";

  const rows: ReadonlyArray<{ label: string; text: string; names: RegExp }> = [
    {
      label: "two opening markers",
      text: body + MECHANICS_BEGIN + "\nA\n" + MECHANICS_END + "\n" + MECHANICS_BEGIN + "\nB\n" + MECHANICS_END + "\n",
      names: /BEGIN GENERATED MECHANICS/,
    },
    {
      label: "an opening marker that never closes",
      text: body + MECHANICS_BEGIN + "\nA\n",
      names: /END GENERATED MECHANICS/,
    },
    {
      label: "a closing marker with no opening one",
      text: body + MECHANICS_END + "\n",
      names: /BEGIN GENERATED MECHANICS/,
    },
    {
      label: "one opening marker and two closing ones",
      text: body + MECHANICS_BEGIN + "\nA\n" + MECHANICS_END + "\ntail\n" + MECHANICS_END + "\n",
      names: /END GENERATED MECHANICS/,
    },
  ];

  for (const row of rows) {
    assert.throws(
      () => spliceBlock(row.text, block),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(
          message,
          row.names,
          `the refusal for ${row.label} must name the marker it judged; got: ${message}`,
        );
        return true;
      },
      `a pack with ${row.label} must be REFUSED: splicing it would leave a stale block beside the ` +
        "fresh one (or swallow the pack's own prose), and a doctrine pack carrying two mechanics " +
        "sections says two different things to the same reader",
    );
  }
});

test("[gen-mechanics-cli-refuses] the CLI FAILS on a malformed pack, names the file, and leaves the others alone", () => {
  const dir = tempDir("conductor-genmech-refuse-");
  seedDoctrine(dir, []);
  const broken = "review.md";
  const brokenPath = path.join(dir, broken);
  const doubled =
    fixturePack(broken) + "\n" + MECHANICS_BEGIN + "\nA\n" + MECHANICS_END + "\n" +
    MECHANICS_BEGIN + "\nB\n" + MECHANICS_END + "\n";
  writeFileSync(brokenPath, doubled, "utf8");

  let failed = false;
  let message = "";
  try {
    runTool(dir);
  } catch (error) {
    failed = true;
    message = String((error as { stderr?: unknown }).stderr ?? error);
  }
  assert.ok(
    failed,
    "a malformed pack must FAIL the run: a generator that skips the file it cannot splice leaves the " +
      "pack stale while reporting success, and the guard test then blames the doctrine rather than " +
      "the generator that declined to write it",
  );
  assert.ok(
    message.includes(broken),
    `and the failure must NAME the pack to repair; got: ${message}`,
  );
  assert.equal(
    readFileSync(brokenPath, "utf8"),
    doubled,
    "the malformed pack is left exactly as it was — nothing is half-spliced",
  );
});

test("[gen-mechanics-splice-shape] spliceBlock replaces between the markers and appends when there are none", () => {
  const block = mechanicsBlock("core.md");
  assert.ok(block.startsWith(MECHANICS_BEGIN) && block.endsWith(MECHANICS_END), "premise: the block is fenced");

  const none = "# a pack\n\nprose\n";
  const appended = spliceBlock(none, block);
  assert.ok(appended.startsWith("# a pack\n\nprose"), "the pack's own prose is kept, verbatim and first");
  assert.ok(appended.includes(block), "and the whole fenced block is appended");
  assert.equal(countOf(appended, MECHANICS_BEGIN), 1, "exactly once");
  assert.equal(
    spliceBlock(appended, block),
    appended,
    "and splicing the result again is a no-op — the append path must produce the replace path's input",
  );

  const withStale = "head\n\n" + MECHANICS_BEGIN + "\nstale\n" + MECHANICS_END + "\n\ntail\n";
  const replaced = spliceBlock(withStale, block);
  assert.equal(
    replaced,
    "head\n\n" + block + "\n\ntail\n",
    "the replace path swaps exactly the fenced region and touches no byte outside it",
  );
  assert.ok(!replaced.includes("stale"), "the stale body is gone");
});

// ===========================================================================
// (3) IMPORTING THE TOOL MUST NOT WRITE ANYTHING
// ===========================================================================

test("[gen-mechanics-import-inert] importing the generator rewrites nothing: the CLI runs on invocation only", () => {
  const before = digestOfDoctrine();
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(TOOL)}); process.stdout.write("imported");`],
    { encoding: "utf8" },
  );
  assert.equal(out, "imported", `the module must import cleanly; got: ${out}`);
  assert.equal(
    digestOfDoctrine(),
    before,
    "importing conductor/tools/generate-mechanics.ts must leave conductor/doctrine/ byte-identical — " +
      "a module that rewrites nine checked-in packs as an import side effect turns every pack-reading " +
      "test into a test of whatever imported it last",
  );
});
