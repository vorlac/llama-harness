// conductor/tests/ops-docs.test.ts — Task 15.1's missing anchor test for the two
// operator-facing documents, conductor/docs/OPERATIONS.md and
// conductor/docs/HONEST-LIMITS.md.
//
// WHY THIS FILE EXISTS. Task 15.1 shipped both documents and no test. Its spec
// names this exact path, and until now the only surviving gate was
// verify-acceptance.sh's two counting checks (a file exists with N lines; a doc
// carries 15 numbered items). Neither reads a word of either file, so a limit can
// be inverted into reassurance, an exit code can be invented, and a filename can
// lose its extension, all while the suite stays green. Every row below is one
// assertion row of docs/build/specs/task-15.1.assertions.json, one named test each.
//
// THE RULE THIS FILE OBEYS. Every claim in these two documents is a claim ABOUT
// THE CODE, so each row is bound to the code and not to the document. The exit
// table is checked against the integers router/main.cpp can return from main();
// the run-dir map against the filenames adapter/state.ts actually builds; the
// component list against COMPONENTS; the stop-kind table against STOP_KINDS; the
// 503 envelope against the constants in router/admission.hpp; the retry budget
// against fanout.ts's MAX_ATTEMPTS; the futility cap against core/stops.ts's
// FUTILE_RE_PROMPT_LIMIT; the fifteen honest limits against the plan's own §9
// text. Nothing expected is ever computed FROM the document under test (the
// C-077 mistake). Where a value is not cheaply derivable the literal is pinned
// HERE, in the test, which still lives outside the file being checked.
//
// WHY IT IS RED RIGHT NOW. The phase gate confirmed ten defects in these two
// documents, and this file is written to fail on all of them: the llama-router
// exit row claims code 1 (never returned) and omits 2, 3 and 4; the run-dir map
// names `state/current-run` where state.ts writes `current-run.json` and omits
// questions.jsonl, reviews/, plan.md, run.lock, stale-red.json and both
// out-of-repo trees; report.md is described as a done-run-only artifact when
// tools.ts writes it for every stop kind; the router "never rejects" while
// router/admission.hpp pins a 503 envelope; the verbosity section carries neither
// default, neither retention bound, nor the trace-cost warning; the mandated
// no-banner troubleshooting entry is last rather than first; there is no table of
// contents; neither degraded mode (no-git, run.lock second session) is documented;
// and HONEST-LIMITS.md omits the whole build-discovered part it was the declared
// sink for. Making them pass is the fixer's job; this red is the evidence.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TypeScript only; every
// file read is .ts-relative via new URL(..., import.meta.url) so the suite is
// cwd-independent; no read happens at module top level, so a missing document
// fails one row at a time with an ENOENT naming the conductor/docs path rather
// than taking the module down. No skip, no todo, no vacuous assert, no empty
// catch. The forbidden marker words are assembled by concatenation so this file
// never carries the bare literals it forbids (the doctrine.test.ts:102 pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

import { COMPONENTS, EVENTS, DEFAULT_LEVEL, DEFAULT_CONSOLE_LEVEL } from "../core/journal-events.ts";
import { STOP_KINDS } from "../core/stops.ts";
import { LOG_LEVELS } from "../core/types.ts";

// ===========================================================================
// Readers — all lazy; nothing touches the filesystem at module load.
// ===========================================================================

const OPS_NAME = "OPERATIONS.md";
const LIMITS_NAME = "HONEST-LIMITS.md";

/** Throws ENOENT naming conductor/docs/<name> when the document is missing. */
function readDoc(name: string): string {
  return readFileSync(new URL("../docs/" + name, import.meta.url), "utf8");
}

/** Repo-root-relative read (conductor/tests -> repo root is two levels up). */
function readRepo(relative: string): string {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

function ops(): string {
  return readDoc(OPS_NAME);
}

function limits(): string {
  return readDoc(LIMITS_NAME);
}

// ===========================================================================
// Text helpers
// ===========================================================================

/** Collapse every run of whitespace to one space. No other normalization. */
function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Whitespace-collapsed, case-insensitive containment. */
function has(haystack: string, needle: string): boolean {
  return norm(haystack).toLowerCase().includes(norm(needle).toLowerCase());
}

function strip(cell: string): string {
  return cell.replace(/[`*_]/g, "").trim();
}

interface Section {
  heading: string;
  body: string;
  start: number;
}

/** Every `## ` section of a markdown document, with absolute start offsets. */
function sectionsOf(text: string): Section[] {
  const marks: Array<{ heading: string; at: number }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) marks.push({ heading: line, at: offset });
    offset += line.length + 1;
  }
  const out: Section[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    out.push({ heading: marks[i].heading, body: text.slice(marks[i].at, end), start: marks[i].at });
  }
  return out;
}

/** The one `## ` section whose heading matches `re`; fails naming the subject. */
function sectionFor(text: string, re: RegExp, subject: string): Section {
  const found = sectionsOf(text).filter((s) => re.test(s.heading));
  assert.ok(
    found.length > 0,
    OPS_NAME + " must carry a '## ' section for " + subject + " (no heading matched " + String(re) + ")",
  );
  return found[0];
}

interface Entry {
  heading: string;
  body: string;
  at: number;
}

/** The `### ` entries of a section, with absolute start offsets. */
function entriesOf(section: Section): Entry[] {
  const marks: Array<{ heading: string; at: number }> = [];
  let offset = 0;
  for (const line of section.body.split("\n")) {
    if (/^### /.test(line)) marks.push({ heading: line, at: offset });
    offset += line.length + 1;
  }
  const out: Entry[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].at : section.body.length;
    out.push({
      heading: marks[i].heading,
      body: section.body.slice(marks[i].at, end),
      at: section.start + marks[i].at,
    });
  }
  return out;
}

function entryFor(section: Section, re: RegExp, subject: string): Entry {
  const found = entriesOf(section).filter((e) => re.test(e.heading));
  assert.ok(
    found.length > 0,
    "the troubleshooting section must carry a '### ' entry for " +
      subject +
      " (no entry heading matched " +
      String(re) +
      ")",
  );
  return found[0];
}

/** The GitHub in-document anchor a heading line resolves to. */
function anchorOf(heading: string): string {
  return heading
    .replace(/^#+\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

interface MdTable {
  header: string[];
  rows: string[][];
  text: string;
}

function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

/** Every contiguous markdown pipe-table in `text`. */
function tablesIn(text: string): MdTable[] {
  const out: MdTable[] = [];
  let block: string[] = [];
  const flush = (): void => {
    if (block.length >= 2) {
      const parsed = block.filter((l) => !isSeparatorRow(l)).map(cellsOf);
      if (parsed.length >= 1) {
        out.push({ header: parsed[0], rows: parsed.slice(1), text: block.join("\n") });
      }
    }
    block = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*\|/.test(line)) block.push(line);
    else flush();
  }
  flush();
  return out;
}

/** Integers 0..125 that stand alone in `cell` (not §refs, versions or ports). */
function standaloneInts(cell: string): number[] {
  const out: number[] = [];
  const re = /(?<![\w.§$-])(\d{1,3})(?![\w.%])/g;
  let m: RegExpExecArray | null = re.exec(cell);
  while (m !== null) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 125) out.push(n);
    m = re.exec(cell);
  }
  return out;
}

function plainInt(cell: string): number | null {
  const s = strip(cell);
  return /^\d{1,3}$/.test(s) ? Number(s) : null;
}

function sortedNums(values: Iterable<number>): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

/** Every `--long-flag` token in `text`. */
function longFlags(text: string): string[] {
  const found = text.match(/--[a-z][a-z0-9-]*/g);
  return found === null ? [] : Array.from(new Set(found));
}

function requireAll(haystack: string, needles: readonly string[], what: string): void {
  const missing = needles.filter((n) => !has(haystack, n));
  assert.deepEqual(missing, [], what + " must name each of: " + needles.join(", ") + "; missing: " + missing.join(", "));
}

function requireMatch(haystack: string, re: RegExp, what: string): void {
  assert.ok(re.test(haystack), what + " (no match for " + String(re) + ")");
}

// Placeholder markers, assembled so this file never carries the bare literals.
const MARKER_WORDS: readonly string[] = [
  "TO" + "DO",
  "FIX" + "ME",
  "TB" + "D",
  "not " + "implemented",
  "place" + "holder",
];
const STANDALONE_XXX = new RegExp("\\b" + "X".repeat(3) + "\\b");

// ===========================================================================
// 15.1-files-exist-and-link
// ===========================================================================

test("[15.1-files-exist-and-link] both operator docs exist, are non-empty, and cross-link by ./ relative path", () => {
  // Each read throws ENOENT naming the missing conductor/docs path.
  const opsText = readDoc(OPS_NAME);
  const limitsText = readDoc(LIMITS_NAME);

  assert.ok(opsText.trim().length > 0, OPS_NAME + " must contain more than whitespace");
  assert.ok(limitsText.trim().length > 0, LIMITS_NAME + " must contain more than whitespace");

  assert.ok(
    opsText.includes("./" + LIMITS_NAME),
    OPS_NAME + " must link to " + LIMITS_NAME + " by the relative path ./" + LIMITS_NAME,
  );
  assert.ok(
    limitsText.includes("./" + OPS_NAME),
    LIMITS_NAME + " must link back to " + OPS_NAME + " by the relative path ./" + OPS_NAME,
  );

  // The relative link targets resolve on disk (statSync throws if they do not).
  assert.ok(statSync(new URL("../docs/" + LIMITS_NAME, import.meta.url)).isFile(), "./" + LIMITS_NAME + " must resolve");
  assert.ok(statSync(new URL("../docs/" + OPS_NAME, import.meta.url)).isFile(), "./" + OPS_NAME + " must resolve");
});

// ===========================================================================
// 15.1-no-placeholder-markers
// ===========================================================================

test("[15.1-no-placeholder-markers] neither doc carries a stub marker and no heading is left empty", () => {
  for (const name of [OPS_NAME, LIMITS_NAME]) {
    const text = readDoc(name);
    const lower = text.toLowerCase();
    for (const marker of MARKER_WORDS) {
      assert.ok(
        !lower.includes(marker.toLowerCase()),
        name + " must not carry the stub marker " + JSON.stringify(marker) + " (G4; C-013 excludes .md from M5)",
      );
    }
    assert.ok(!STANDALONE_XXX.test(text), name + " must not carry a standalone triple-X marker (C-026 precision fix)");

    // Every '## ' / '### ' heading is followed, before the next heading, by at
    // least one non-blank line that is not itself a heading.
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const opened = /^(#{2,3}) /.exec(lines[i]);
      if (opened === null) continue;
      const level = opened[1].length;
      let filled = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = /^(#{1,6}) /.exec(lines[j]);
        // A same-or-higher-level heading closes this section. A DEEPER heading is
        // a subsection of it, so its prose still counts as this section's body —
        // "## Troubleshooting" followed straight by its "### " entries is filled.
        if (next !== null && next[1].length <= level) break;
        if (next !== null) continue;
        if (lines[j].trim().length > 0) {
          filled = true;
          break;
        }
      }
      assert.ok(filled, name + ": section " + JSON.stringify(lines[i].trim()) + " is empty (line " + (i + 1) + ")");
    }
  }
});

// ===========================================================================
// 15.1-ops-sections
// ===========================================================================

const OPS_SUBJECTS: ReadonlyArray<{ subject: string; re: RegExp }> = [
  { subject: "serving with and without the router", re: /serv/i },
  { subject: "reading a run dir", re: /run dir/i },
  { subject: "driving replay.ts", re: /replay/i },
  { subject: "halting a run", re: /halt/i },
  { subject: "tuning verbosity", re: /verbosity/i },
  { subject: "editing doctrine", re: /doctrine/i },
  { subject: "exit codes", re: /exit code/i },
  { subject: "error envelopes", re: /error envelope/i },
  { subject: "troubleshooting", re: /troubleshoot/i },
];

test("[15.1-ops-sections] OPERATIONS.md heads all nine plan subjects and a top table of contents links to each anchor", () => {
  const text = ops();
  const sections = sectionsOf(text);
  assert.ok(sections.length > 0, OPS_NAME + " must use '## ' section headings");

  const matched: Section[] = [];
  for (const wanted of OPS_SUBJECTS) {
    const hit = sections.find((s) => wanted.re.test(s.heading));
    assert.ok(hit !== undefined, OPS_NAME + " is missing a heading for the subject: " + wanted.subject);
    if (hit !== undefined && !matched.includes(hit)) matched.push(hit);
  }

  // The table of contents is everything above the first '## ' heading.
  const toc = text.slice(0, sections[0].start);
  for (const section of matched) {
    const anchor = anchorOf(section.heading);
    assert.ok(
      toc.includes("](#" + anchor + ")"),
      OPS_NAME +
        " needs a table of contents at the top linking to " +
        JSON.stringify(section.heading.trim()) +
        " by its in-document anchor (#" +
        anchor +
        ")",
    );
  }
});

// ===========================================================================
// 15.1-banner-entry-is-first
// ===========================================================================

test("[15.1-banner-entry-is-first] the no-banner entry heads troubleshooting and names serve.py, the opencode log and the beacon fields", () => {
  const text = ops();
  const trouble = sectionFor(text, /troubleshoot/i, "troubleshooting");
  const banner = entryFor(trouble, /banner/i, "the §3.8 no-banner failure");

  for (const other of [
    { re: /stale/i, label: "publish denied stale" },
    { re: /env[- ]failed/i, label: "sub-session env-failed" },
    { re: /disengag/i, label: "run disengaged" },
  ]) {
    const entry = entryFor(trouble, other.re, other.label);
    assert.ok(
      banner.at < entry.at,
      "the no-banner entry must come FIRST (plan §3.8): its heading offset " +
        String(banner.at) +
        " must be < the " +
        other.label +
        " entry at offset " +
        String(entry.at),
    );
  }

  requireMatch(banner.body, /plugin did not load|plugin failed to load/i, "the no-banner entry must say the plugin did not load");
  requireMatch(banner.body, /serve\.py/, "the no-banner entry must tell the operator to run scripts/serve.py again");
  requireMatch(banner.body, /opencode log/i, "the no-banner entry must tell the operator to check the opencode log");

  // The beacon filename and its field names come from adapter/state.ts, not the doc.
  const stateSrc = readRepo("conductor/adapter/state.ts");
  const beaconFile = /path\.join\(stateDir, "(alive\.json)"\)/.exec(stateSrc);
  assert.ok(beaconFile !== null, "state.ts must build the liveness beacon path (regression in the derivation, not the doc)");
  const beaconBlock = /export interface Beacon \{([\s\S]*?)\}/.exec(stateSrc);
  assert.ok(beaconBlock !== null, "state.ts must declare the Beacon interface (regression in the derivation, not the doc)");
  const fields = Array.from((beaconBlock as RegExpExecArray)[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)).map(
    (m) => m[1],
  );
  assert.equal(fields.length, 4, "state.ts's Beacon must declare four fields; got " + fields.join(", "));

  assert.ok(
    banner.body.includes(".conductor/state/" + (beaconFile as RegExpExecArray)[1]),
    "the no-banner entry must name the liveness beacon file .conductor/state/" + (beaconFile as RegExpExecArray)[1],
  );
  requireAll(banner.body, fields, "the no-banner entry's beacon description");
});

// ===========================================================================
// 15.1-serve-router-flags-crosschecked
// ===========================================================================

test("[15.1-serve-router-flags-crosschecked] every serve.py flag the serving section prints is a real argparse flag, and the G5 posture is stated", () => {
  const text = ops();
  const serving = sectionFor(text, /serv/i, "serving");

  // The truth set: the long options scripts/serve.py actually declares.
  const serveSrc = readRepo("scripts/serve.py");
  const declared = new Set(Array.from(serveSrc.matchAll(/add_argument\(\s*"(--[a-z0-9-]+)"/g)).map((m) => m[1]));
  assert.ok(declared.size >= 5, "scripts/serve.py must declare long argparse options; found " + String(declared.size));

  // What the document presents as serve.py flags: command lines plus the flag
  // column of the serving-section table (never the prose, which cites
  // llama-server's own --parallel / --ctx-size).
  const documented = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.includes("serve.py")) for (const flag of longFlags(line)) documented.add(flag);
  }
  for (const table of tablesIn(serving.body)) {
    for (const row of table.rows) {
      if (row.length > 0) for (const flag of longFlags(row[0])) documented.add(flag);
    }
  }
  assert.ok(documented.size > 0, "the serving section must show scripts/serve.py flags");

  const invented = Array.from(documented).filter((f) => !declared.has(f)).sort();
  assert.deepEqual(
    invented,
    [],
    "OPERATIONS.md documents serve.py flag(s) that scripts/serve.py does not accept: " + invented.join(", "),
  );

  requireAll(serving.body, ["--router", "--no-router"], "the serving section");

  // The G5 posture, in the plan's own terms, cross-checked against the
  // router-client's component name and its `failover` event.
  assert.ok(COMPONENTS.includes("router-client"), "router-client must be a journal component");
  assert.ok(EVENTS["router-client"].includes("failover"), "failover must be a router-client journal event");

  requireMatch(
    serving.body,
    /identical/i,
    "the serving section must state that --no-router runs everything direct through the IDENTICAL code path",
  );
  requireMatch(serving.body, /failover/i, "the serving section must state the router-client failover to the upstream base URL");
  requireMatch(serving.body, /upstream/i, "the serving section must name the upstream base URL as the failover target");
  requireMatch(serving.body, /router-client/i, "the serving section must name the `router-client` journal component");
  requireMatch(serving.body, /\bwarn/i, "the serving section must state the failover is journaled as a warning");
  requireMatch(
    serving.body,
    /second failover|two failovers/i,
    "the serving section must state the router is no longer retried after two failovers",
  );
});

// ===========================================================================
// 15.1-rundir-map-complete
// ===========================================================================

test("[15.1-rundir-map-complete] the run-dir map names every §1.2 path, the git-ignore registration, and report.md on every stop", () => {
  const text = ops();
  const rundir = sectionFor(text, /run dir/i, "reading a run directory");

  // State-dir filenames are derived from adapter/state.ts, so `current-run`
  // without its .json extension reddens here.
  const stateSrc = readRepo("conductor/adapter/state.ts");
  const stateFiles = Array.from(stateSrc.matchAll(/path\.join\(stateDir, "([^"]+)"\)/g)).map((m) => m[1]);
  assert.ok(stateFiles.length >= 5, "state.ts must build the .conductor/state entries; found " + stateFiles.join(", "));
  requireAll(rundir.body, stateFiles, "the run-dir map's .conductor/state listing");

  const runDirFiles = Array.from(stateSrc.matchAll(/path\.join\(runDirOf\(runId\), "([^"]+)"\)/g)).map((m) => m[1]);
  assert.ok(runDirFiles.length >= 2, "state.ts must build run-dir entries; found " + runDirFiles.join(", "));
  requireAll(rundir.body, runDirFiles, "the run-dir map");

  // The rest of the §1.2 inventory, pinned here rather than read from the doc.
  requireAll(
    rundir.body,
    [
      "run.json",
      "queue.json",
      "items/",
      "plan.md",
      "report.md",
      "journal.jsonl",
      "evidence.jsonl",
      "decisions.jsonl",
      "anomalies.jsonl",
      "questions.jsonl",
      "reviews/",
    ],
    "the run-dir map",
  );

  // The two OUT-OF-REPO trees live on the home volume, not under .conductor/.
  requireAll(rundir.body, ["quarantine", "worktrees", "stateHome"], "the run-dir map's out-of-repo listing");
  requireMatch(
    rundir.body,
    /out[- ]of[- ]repo|outside the repo|outside the repository/i,
    "the run-dir map must mark the quarantine and worktree trees as living OUTSIDE the repo",
  );

  requireMatch(rundir.body, /\.git\/info\/exclude/, "the run-dir section must say .conductor/ is git-ignored via .git/info/exclude");
  requireMatch(rundir.body, /git[- ]ignored|gitignored/i, "the run-dir section must say .conductor/ is git-ignored");

  // tools.ts guards the stop-report writer on `run.stop !== null` alone, so
  // report.md exists for all six stop kinds — not only `done`.
  requireMatch(
    rundir.body,
    /every (terminal )?stop|all (six )?stop kinds|each stop kind|regardless of the stop|not only .{0,20}done/i,
    "the run-dir map must state that report.md is written on EVERY terminal stop, not only on done",
  );
  assert.ok(
    !has(rundir.body, "the report was refused"),
    "the run-dir section must not claim a non-done stop means the report was refused: tools.ts writes report.md for every stop kind",
  );
});

// ===========================================================================
// 15.1-rundir-entry-point
// ===========================================================================

test("[15.1-rundir-entry-point] the run-dir section gives the live-run pointer, the retention prune, and a report-first reading order", () => {
  const text = ops();
  const rundir = sectionFor(text, /run dir/i, "reading a run directory");

  const stateSrc = readRepo("conductor/adapter/state.ts");
  const pointer = /path\.join\(stateDir, "(current-run[^"]*)"\)/.exec(stateSrc);
  assert.ok(pointer !== null, "state.ts must build the live-run pointer path");
  assert.ok(
    rundir.body.includes(".conductor/state/" + (pointer as RegExpExecArray)[1]),
    "the run-dir section must name the live-run pointer as .conductor/state/" + (pointer as RegExpExecArray)[1],
  );
  requireAll(rundir.body, ["runId", "null"], "the live-run pointer description");
  requireMatch(rundir.body, /\.conductor\/runs\//, "the run-dir section must give the run dir path .conductor/runs/<runId>/");

  // retention.keepRuns is a real §2.1 config key, read from core/types.ts.
  const typesSrc = readRepo("conductor/core/types.ts");
  const retention = /retention:\s*\{([^}]*)\}/.exec(typesSrc);
  assert.ok(retention !== null, "core/types.ts must declare the retention config block");
  const retentionKeys = Array.from((retention as RegExpExecArray)[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)).map(
    (m) => m[1],
  );
  assert.ok(retentionKeys.includes("keepRuns"), "retention must declare keepRuns; got " + retentionKeys.join(", "));
  requireAll(rundir.body, ["keepRuns"], "the run-dir section");
  requireMatch(
    rundir.body,
    /prune/i,
    "the run-dir section must say older runs are PRUNED to retention.keepRuns at run creation, so an absent run dir can mean pruned",
  );

  // The post-mortem reading order: the ordered list, not the tree listing.
  const listStart = rundir.body.search(/^\s*1\.\s+\S/m);
  assert.ok(listStart >= 0, "the run-dir section must give a numbered post-mortem reading order");
  const order = rundir.body.slice(listStart);

  const positions: Array<{ name: string; at: number }> = [
    "report.md",
    "journal.jsonl",
    "evidence.jsonl",
    "questions.jsonl",
    "anomalies.jsonl",
  ].map((name) => ({ name, at: order.indexOf(name) }));
  for (const p of positions) {
    assert.ok(p.at >= 0, "the post-mortem reading order must name " + p.name);
  }
  assert.equal(
    positions[0].at,
    Math.min(...positions.map((p) => p.at)),
    "report.md must be FIRST in the post-mortem reading order (the curated human read), ahead of " +
      positions
        .filter((p) => p.at < positions[0].at)
        .map((p) => p.name)
        .join(", "),
  );
  assert.ok(positions[0].at < positions[1].at, "journal.jsonl must be read after report.md, via replay");

  requireMatch(order, /replay/i, "the reading order must send the operator through replay for journal.jsonl");
  requireAll(order, Array.from(EVENTS["evidence"]), "the reading order's evidence.jsonl step");
  requireMatch(order, /blocked/i, "the reading order must say questions.jsonl carries the blocked set");
  requireMatch(order, /override/i, "the reading order must say anomalies.jsonl carries overrides");
  requireMatch(order, /gate crash|gate-crash/i, "the reading order must say anomalies.jsonl carries gate crashes");
  requireMatch(order, /disengage/i, "the reading order must say anomalies.jsonl carries disengages");
});

// ===========================================================================
// 15.1-replay-usage-crosschecked
// ===========================================================================

test("[15.1-replay-usage-crosschecked] every replay flag the doc shows is one replay.ts parses, and all three are documented", () => {
  const text = ops();
  const replay = sectionFor(text, /replay/i, "driving replay.ts");

  // The truth set: the flags conductor/tools/replay.ts actually accepts.
  const replaySrc = readRepo("conductor/tools/replay.ts");
  const accepted = new Set(Array.from(replaySrc.matchAll(/name !== "(--[a-z-]+)"/g)).map((m) => m[1]));
  assert.ok(accepted.size === 3, "replay.ts must accept exactly three flags; found " + Array.from(accepted).join(", "));

  const documented = new Set<string>();
  for (const line of replay.body.split("\n")) {
    if (line.includes("replay.ts")) for (const flag of longFlags(line)) documented.add(flag);
  }
  for (const table of tablesIn(replay.body)) {
    for (const row of table.rows) {
      if (row.length > 0) for (const flag of longFlags(row[0])) documented.add(flag);
    }
  }

  const invented = Array.from(documented).filter((f) => !accepted.has(f)).sort();
  assert.deepEqual(invented, [], "the replay section documents flag(s) replay.ts does not parse: " + invented.join(", "));

  const undocumented = Array.from(accepted).filter((f) => !documented.has(f)).sort();
  assert.deepEqual(undocumented, [], "the replay section must document every replay flag; missing: " + undocumented.join(", "));

  requireMatch(
    replay.body,
    /node conductor\/tools\/replay\.ts/,
    "the replay section must show the invocation `node conductor/tools/replay.ts <run dir>`",
  );
  requireMatch(replay.body, /swimlane/i, "the replay section must state that replay renders per-item swimlanes");
  requireMatch(replay.body, /gate denial/i, "the replay section must state that replay highlights gate denials");
  requireMatch(replay.body, /fan-?out duration/i, "the replay section must state that replay prints the fan-out duration table");
  requireMatch(replay.body, /review[- ]verdict/i, "the replay section must state that replay prints the review verdict table");

  // conductor_status is a real tool binding, so the doc may point at it by name.
  const bindings = readRepo("conductor/core/tool-bindings.ts");
  assert.ok(/conductor_status\s*:/.test(bindings), "core/tool-bindings.ts must declare conductor_status");
  requireMatch(
    replay.body,
    /conductor_status/,
    "the replay section must name conductor_status as the live in-session equivalent",
  );
});

// ===========================================================================
// 15.1-halt-procedure
// ===========================================================================

test("[15.1-halt-procedure] the halt section gives the owner-only halt file, presence-only semantics, the interrupt stop and the stop-report", () => {
  const text = ops();
  const halt = sectionFor(text, /halt/i, "halting a run");

  const stateSrc = readRepo("conductor/adapter/state.ts");
  const haltFile = /path\.join\(stateDir, "(halt)"\)/.exec(stateSrc);
  assert.ok(haltFile !== null, "state.ts must build the halt path");
  assert.ok(
    halt.body.includes(".conductor/state/" + (haltFile as RegExpExecArray)[1]),
    "the halt section must name the exact path .conductor/state/" + (haltFile as RegExpExecArray)[1],
  );

  // isHalted is `existsSync(haltPath)`: presence alone halts, content is unread.
  assert.ok(/existsSync\(haltPath\)/.test(stateSrc), "state.ts's halt check must be an existence test");
  requireMatch(halt.body, /presence/i, "the halt section must state that PRESENCE alone halts");
  requireMatch(
    halt.body,
    /never read|not read|content[^.]{0,60}(ignored|irrelevant|does not matter)/i,
    "the halt section must state that the halt file's content is never read",
  );

  requireMatch(halt.body, /owner/i, "the halt section must state the halt file is OWNER-ONLY (§1.2)");
  requireMatch(
    halt.body,
    /the model never|never creates|model must never/i,
    "the halt section must state that the model never creates, edits or deletes the halt file",
  );

  assert.ok(STOP_KINDS.includes("interrupt"), "interrupt must be a §2.9 stop kind");
  requireMatch(halt.body, /\binterrupt\b/, "the halt section must state the run stops with kind `interrupt`");
  requireMatch(
    halt.body,
    /stop-report/i,
    "the halt section must state that a stop-report is still written before the run goes quiet",
  );
  requireMatch(halt.body, /resume|allow runs again|normal operation/i, "the halt section must tell the operator to delete the file to resume");
});

// ===========================================================================
// 15.1-verbosity-crosschecked
// ===========================================================================

test("[15.1-verbosity-crosschecked] the verbosity section names both config keys, both env forms, all five levels, all eight components and both defaults", () => {
  const text = ops();
  const verbosity = sectionFor(text, /verbosity/i, "tuning verbosity");

  const typesSrc = readRepo("conductor/core/types.ts");
  assert.ok(
    /logging:\s*\{\s*level:[^}]*components:/.test(typesSrc),
    "core/types.ts must declare logging.level and logging.components",
  );
  requireAll(verbosity.body, ["logging.level", "logging.components", "CONDUCTOR_LOG"], "the verbosity section");

  const levels = Array.from(LOG_LEVELS);
  assert.equal(levels.length, 5, "LOG_LEVELS must hold the five §7.1 levels; got " + levels.join(", "));

  requireMatch(
    verbosity.body,
    new RegExp("CONDUCTOR_LOG=(" + levels.join("|") + ")\\b"),
    "the verbosity section must show the BARE env form (e.g. CONDUCTOR_LOG=debug)",
  );
  requireMatch(
    verbosity.body,
    new RegExp("CONDUCTOR_LOG=[a-z][a-z-]*:(" + levels.join("|") + ")"),
    "the verbosity section must show the PER-COMPONENT env form (e.g. CONDUCTOR_LOG=fanout:trace,gates:debug)",
  );
  requireMatch(
    verbosity.body,
    /env (beats|wins|overrides)|environment (beats|wins|overrides)/i,
    "the verbosity section must state that env wins over config",
  );

  requireAll(verbosity.body, levels, "the verbosity section's level list");
  requireAll(verbosity.body, Array.from(COMPONENTS), "the verbosity section's component list");
  assert.equal(COMPONENTS.length, 8, "COMPONENTS must hold exactly eight names; got " + COMPONENTS.join(", "));

  requireMatch(
    verbosity.body,
    new RegExp("journal[^.]{0,120}\\b" + DEFAULT_LEVEL + "\\b", "i"),
    "the verbosity section must state the journal default level (" + DEFAULT_LEVEL + ", core/journal-events.ts DEFAULT_LEVEL)",
  );
  requireMatch(
    verbosity.body,
    new RegExp("(stderr|console)[^.]{0,120}\\b" + DEFAULT_CONSOLE_LEVEL + "\\b", "i"),
    "the verbosity section must state the stderr/console default level (" +
      DEFAULT_CONSOLE_LEVEL +
      ", core/journal-events.ts DEFAULT_CONSOLE_LEVEL)",
  );
  requireMatch(
    verbosity.body,
    /always written|regardless of/i,
    "the verbosity section must state that error and warn records are written regardless of the configured level",
  );
});

// ===========================================================================
// 15.1-verbosity-trace-warning
// ===========================================================================

test("[15.1-verbosity-trace-warning] the verbosity section carries the §7.1 trace-cost warning and names both retention bounds", () => {
  const text = ops();
  const verbosity = sectionFor(text, /verbosity/i, "tuning verbosity");

  requireMatch(verbosity.body, /\btrace\b/, "the verbosity section must discuss the `trace` level");
  requireMatch(
    verbosity.body,
    /prompt/i,
    "the verbosity section must warn that at trace the journal holds full sub-session prompts",
  );
  requireMatch(verbosity.body, /output/i, "the verbosity section must warn that at trace the journal holds full sub-session outputs");
  requireMatch(
    verbosity.body,
    /per lens|per round|per item/i,
    "the trace warning must state the multiplier: once per lens, per round, per item",
  );
  requireMatch(
    verbosity.body,
    /git[- ]ignored|gitignored/i,
    "the trace warning must state the journal grows inside the user's repository in a git-ignored directory",
  );
  requireMatch(verbosity.body, /grow/i, "the trace warning must state that nothing else will notice the directory growing");

  // Both bounds are real §2.1 config keys.
  const typesSrc = readRepo("conductor/core/types.ts");
  const retention = /retention:\s*\{([^}]*)\}/.exec(typesSrc);
  assert.ok(retention !== null, "core/types.ts must declare the retention config block");
  const keys = Array.from((retention as RegExpExecArray)[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:/g)).map((m) => m[1]);
  for (const key of ["keepRuns", "maxRunDirBytes"]) {
    assert.ok(keys.includes(key), "core/types.ts retention must declare " + key + "; got " + keys.join(", "));
  }
  requireAll(verbosity.body, ["retention", "keepRuns", "maxRunDirBytes"], "the trace-cost warning's bounds");
  requireMatch(
    verbosity.body,
    /journal\.N\.jsonl\.gz|journal\.\d+\.jsonl\.gz/,
    "the trace warning must state that maxRunDirBytes rotates the journal to journal.N.jsonl.gz",
  );
});

// ===========================================================================
// 15.1-doctrine-editing-crosschecked
// ===========================================================================

test("[15.1-doctrine-editing-crosschecked] the doctrine section lists every pack on disk and both hard rules, and mandates the test gate", () => {
  const text = ops();
  const doctrine = sectionFor(text, /doctrine/i, "editing doctrine");

  const packs = readdirSync(new URL("../doctrine/", import.meta.url))
    .filter((f) => f.endsWith(".md"))
    .sort();
  assert.ok(packs.length > 0, "conductor/doctrine/ must hold at least one pack");
  requireAll(doctrine.body, packs, "the doctrine section's pack listing");
  requireMatch(doctrine.body, /conductor\/doctrine\//, "the doctrine section must name the directory conductor/doctrine/");

  requireMatch(doctrine.body, /\b120\b/, "the doctrine section must state the <= 120-line rule a pack edit must preserve");
  requireMatch(doctrine.body, /line/i, "the doctrine section's 120 rule must be stated in lines");
  requireMatch(
    doctrine.body,
    /client/i,
    "the doctrine section must state that model-facing packs never name a client",
  );
  requireAll(doctrine.body, ["opencode", "Cursor"], "the doctrine section's client-name rule");
  requireMatch(doctrine.body, /claude/i, "the doctrine section's client-name rule must name Claude");

  requireMatch(
    doctrine.body,
    /bash scripts\/test-conductor\.sh/,
    "the doctrine section must tell the operator to run `bash scripts/test-conductor.sh` after ANY doctrine edit",
  );
  requireMatch(
    doctrine.body,
    /doctrine\.test\.ts/,
    "the doctrine section must say doctrine.test.ts anchors the required content of every pack",
  );
});

// ===========================================================================
// 15.1-exit-table-run
// ===========================================================================

test("[15.1-exit-table-run] the RUN-exit table holds exactly the STOP_KINDS vocabulary and states the every-stop report rule", () => {
  const text = ops();
  const exits = sectionFor(text, /exit code/i, "exit codes");

  const kinds = new Set<string>(STOP_KINDS);
  const runTables = tablesIn(exits.body).filter((t) => {
    const firsts = t.rows.map((r) => strip(r.length > 0 ? r[0] : ""));
    return firsts.filter((f) => kinds.has(f)).length >= 2;
  });
  assert.equal(
    runTables.length,
    1,
    "the exit-codes section must carry exactly one RUN-exit table whose first column is the §2.9 stop-kind vocabulary (" +
      STOP_KINDS.join(", ") +
      "); found " +
      String(runTables.length),
  );

  const listed = runTables[0].rows.map((r) => strip(r.length > 0 ? r[0] : "")).filter((f) => f.length > 0);
  assert.deepEqual(
    listed.slice().sort(),
    Array.from(STOP_KINDS).slice().sort(),
    "the RUN-exit table must hold exactly one row per STOP_KINDS entry and no row naming a kind outside that vocabulary; rows: " +
      listed.join(", "),
  );

  requireMatch(
    exits.body,
    /every stop kind|all six stop kinds|each stop kind/i,
    "the RUN-exit table must state the §2.9 rule that EVERY stop kind writes report.md",
  );
  requireMatch(exits.body, /report\.md/, "the RUN-exit table must name report.md as the artifact every stop kind writes");
  requireMatch(exits.body, /stop-report/i, "the RUN-exit table must name the stop-report written for the non-done kinds");
  requireMatch(
    exits.body,
    /continuation engine/i,
    "the RUN-exit table must name the continuation engine as the recorder for noop and interrupt",
  );
  requireMatch(exits.body, /fan-?out engine/i, "the RUN-exit table must name the fan-out engine as the recorder for env");
  requireMatch(
    exits.body,
    /report tool|conductor_report/i,
    "the RUN-exit table must name the report tool as the recorder for the rest",
  );
});

// ===========================================================================
// 15.1-exit-table-process
// ===========================================================================

test("[15.1-exit-table-process] the PROCESS-exit table covers all four entry points and claims exactly the codes router/main.cpp returns", () => {
  const text = ops();
  const exits = sectionFor(text, /exit code/i, "exit codes");

  // The truth set: every integer main() can return.
  const mainSrc = readRepo("router/main.cpp");
  const returned = sortedNums(Array.from(mainSrc.matchAll(/\breturn\s+(\d+)\s*;/g)).map((m) => Number(m[1])));
  assert.ok(returned.length >= 2, "router/main.cpp must return integer exit codes; found " + returned.join(", "));
  assert.ok(returned.includes(0), "router/main.cpp must have a success return");

  const claimed = new Set<number>();
  for (const table of tablesIn(exits.body)) {
    if (!table.text.includes("llama-router")) continue;
    const headerCodes = table.header.map((h) => plainInt(h));
    let rows = table.rows.filter((r) => r.join(" ").includes("llama-router"));
    if (rows.length === 0) rows = table.rows;
    for (const row of rows) {
      for (let i = 1; i < table.header.length; i += 1) {
        const code = headerCodes[i];
        if (code === null) continue;
        const cell = i < row.length ? strip(row[i]) : "";
        if (cell.length > 0 && !/^[—–-]+$/.test(cell) && !/^n\/?a$/i.test(cell)) claimed.add(code);
      }
      for (let i = 0; i < row.length; i += 1) {
        if (row[i].includes("llama-router")) continue;
        for (const n of standaloneInts(row[i])) claimed.add(n);
      }
    }
  }

  const claimedSorted = sortedNums(claimed);
  const invented = claimedSorted.filter((n) => !returned.includes(n));
  const missing = returned.filter((n) => !claimedSorted.includes(n));
  assert.deepEqual(
    claimedSorted,
    returned,
    "the llama-router exit row must document exactly the codes router/main.cpp implements and invent none (SG-2). " +
      "main() returns [" +
      returned.join(", ") +
      "]; the table claims [" +
      claimedSorted.join(", ") +
      "]; invented: [" +
      invented.join(", ") +
      "]; missing: [" +
      missing.join(", ") +
      "]",
  );

  requireAll(
    exits.body,
    ["scripts/test-conductor.sh", "conductor/tools/replay.ts", "scripts/serve.py", "llama-router"],
    "the PROCESS-exit table's operator-runnable entry points",
  );
  requireMatch(exits.body, /\b0\b/, "the PROCESS-exit table must state exit 0 for success");
});

// ===========================================================================
// 15.1-envelope-router-503
// ===========================================================================

test("[15.1-envelope-router-503] the envelope section reproduces the router's pinned 503 admission envelope and the health-route guarantee", () => {
  const text = ops();
  const envelopes = sectionFor(text, /error envelope/i, "error envelopes");

  // The three literals and the health path come from router/admission.hpp.
  const admission = readRepo("router/admission.hpp");
  const literalOf = (name: string): string => {
    const m = new RegExp(name + '\\s*=\\s*"([^"]+)"').exec(admission);
    assert.ok(m !== null, "router/admission.hpp must define " + name);
    return (m as RegExpExecArray)[1];
  };
  const errorType = literalOf("kAdmissionErrorType");
  const timeoutCode = literalOf("kQueueTimeoutCode");
  const overflowCode = literalOf("kQueueOverflowCode");
  const healthPath = literalOf("kHealthPath");

  requireMatch(envelopes.body, /\b503\b/, "the envelope section must document the router's 503 admission response");
  requireAll(envelopes.body, [errorType, timeoutCode, overflowCode], "the 503 admission envelope");
  requireAll(envelopes.body, ['"error"', '"message"', '"type"', '"code"'], "the 503 admission envelope shape");

  requireMatch(
    envelopes.body,
    /maxQueued/,
    "the envelope section must state that " + overflowCode + " is the maxQueued overflow condition",
  );
  requireMatch(
    envelopes.body,
    /expir|wait|timeout/i,
    "the envelope section must state that " + timeoutCode + " is the queue-timeout wait expiry",
  );

  assert.ok(envelopes.body.includes(healthPath), "the envelope section must name the health route " + healthPath);
  requireMatch(
    envelopes.body,
    /every slot|all slots|slot and queue/i,
    "the envelope section must state that " + healthPath + " answers even while every slot and queue entry is held",
  );
});

// ===========================================================================
// 15.1-envelope-tool-deny
// ===========================================================================

test("[15.1-envelope-tool-deny] the envelope section describes the thrown gate deny, its journal record and the fail-closed crash prefix", () => {
  const text = ops();
  const envelopes = sectionFor(text, /error envelope/i, "error envelopes");

  requireMatch(envelopes.body, /thrown|throws|throw/i, "the envelope section must say a denied call is a THROWN Error, not a JSON body");
  requireMatch(
    envelopes.body,
    /not a JSON body|no separate error object|is not a JSON/i,
    "the envelope section must say the deny is not a JSON body / not a separate error object",
  );
  requireMatch(
    envelopes.body,
    /reason/i,
    "the envelope section must say the thrown message IS the gate's reason string",
  );
  requireMatch(
    envelopes.body,
    /refusal reason/i,
    "the envelope section must say the message is relayed back to the model as the refusal reason",
  );

  // The same deny is journaled under a real component/event pair.
  assert.ok(COMPONENTS.includes("gates"), "gates must be a journal component");
  for (const event of ["deny", "snapshot", "gate-crash"]) {
    assert.ok(EVENTS["gates"].includes(event), "gates must own the `" + event + "` journal event");
  }
  requireAll(envelopes.body, ["gates", "deny", "gate-crash"], "the gate-deny envelope's journal pointers");
  requireMatch(envelopes.body, /snapshot/i, "the envelope section must say the deny carries its input snapshot");
  requireMatch(envelopes.body, /\bdebug\b/i, "the envelope section must say the input snapshot is journaled at debug level");

  // The fail-closed prefix is pinned by adapter/tools.ts, quoted verbatim.
  const toolsSrc = readRepo("conductor/adapter/tools.ts");
  const crash = /"(a security gate crashed[^"]*)"/.exec(toolsSrc);
  assert.ok(crash !== null, "adapter/tools.ts must define the fail-closed gate-crash reason prefix");
  const prefix = (crash as RegExpExecArray)[1].replace(/:\s*$/, "").trim();
  assert.ok(
    norm(envelopes.body).includes(norm(prefix)),
    "the envelope section must quote the fail-closed gate-crash reason prefix VERBATIM: " + JSON.stringify(prefix),
  );
});

// ===========================================================================
// 15.1-envelope-fanout-env
// ===========================================================================

test("[15.1-envelope-fanout-env] the envelope section gives the fan-out env stop shape, the 3-attempt budget and the four fanout events", () => {
  const text = ops();
  const envelopes = sectionFor(text, /error envelope/i, "error envelopes");

  const fanoutSrc = readRepo("conductor/adapter/fanout.ts");
  const attempts = /MAX_ATTEMPTS\s*=\s*(\d+)/.exec(fanoutSrc);
  assert.ok(attempts !== null, "adapter/fanout.ts must define MAX_ATTEMPTS");
  const budget = (attempts as RegExpExecArray)[1];

  const reason = /"(sub-session output failed schema validation[^"]*)"/.exec(fanoutSrc);
  assert.ok(reason !== null, "adapter/fanout.ts must define the env-stop reason string");

  assert.ok(STOP_KINDS.includes("env"), "env must be a §2.9 stop kind");
  requireMatch(envelopes.body, /\benv\b/, "the envelope section must name the `env` stop kind the fan-out engine finishes with");
  assert.ok(
    norm(envelopes.body).includes(norm((reason as RegExpExecArray)[1])),
    "the envelope section must reproduce the env stop reason verbatim: " + JSON.stringify((reason as RegExpExecArray)[1]),
  );
  requireMatch(envelopes.body, /errors/i, "the env stop shape must name its `errors` field");
  requireMatch(
    envelopes.body,
    new RegExp("(?<![\\w.])" + budget + "(?![\\w.])"),
    "the envelope section must state the fixed budget of " + budget + " attempts (fanout.ts MAX_ATTEMPTS)",
  );

  const wanted = ["subsession.dispatched", "subsession.retry", "subsession.complete", "subsession.abort"];
  for (const event of wanted) {
    assert.ok(EVENTS["fanout"].includes(event), "fanout must own the `" + event + "` journal event");
  }
  requireAll(envelopes.body, wanted, "the fan-out env envelope's journal events");

  requireMatch(envelopes.body, /schema-invalid/, "the envelope section must name reason \"schema-invalid\" on retry exhaustion");
  requireMatch(envelopes.body, /ok\W{0,3}false/i, "the envelope section must show subsession.complete carrying {ok:false}");
  requireMatch(envelopes.body, /watchdog/i, "the envelope section must state that a watchdog abort is a DIFFERENT terminal path");
});

// ===========================================================================
// 15.1-ts-publish-denied-stale
// ===========================================================================

test("[15.1-ts-publish-denied-stale] the stale-publish entry gives both freshness conditions, both causes, the action and the 9.5b re-verify behaviours", () => {
  const text = ops();
  const trouble = sectionFor(text, /troubleshoot/i, "troubleshooting");
  const entry = entryFor(trouble, /stale/i, "publish denied stale");

  requireAll(
    entry.body,
    ["startedMs", "mtime", "head"],
    "the stale-publish entry's two freshness conditions (startedMs at or after the newest staged mtime; head equal to current HEAD)",
  );
  requireMatch(
    entry.body,
    /no-git/i,
    "the stale-publish entry must state the HEAD condition is skipped in no-git mode",
  );

  requireMatch(
    entry.body,
    /edit/i,
    "the stale-publish entry must name the first ordinary cause: an edit landed after the verify started",
  );
  requireMatch(
    entry.body,
    /branch switch|git switch/i,
    "the stale-publish entry must name HEAD moving under it via a branch switch",
  );
  requireMatch(
    entry.body,
    /sibling/i,
    "the stale-publish entry must name a sibling item's publish as the other way HEAD moves",
  );

  requireMatch(entry.body, /validate/i, "the stale-publish entry must tell the operator to re-run validate for a fresh verify");
  requireMatch(entry.body, /publish/i, "the stale-publish entry must tell the operator to publish after the fresh verify");

  // Publish auto-re-verifies once; a failing auto re-verify lands the item back
  // at the stage adapter/tools.ts names in its own denial.
  const toolsSrc = readRepo("conductor/adapter/tools.ts");
  const stage = /publishDenial\("([A-Z_]+)",[^\n]*auto re-verify failed/.exec(toolsSrc);
  assert.ok(stage !== null, "adapter/tools.ts must name the stage a failed auto re-verify drops the item to");
  requireMatch(entry.body, /auto re-verif/i, "the stale-publish entry must record that publish auto-re-verifies on a stale verdict");
  requireMatch(entry.body, /\bonce\b/i, "the stale-publish entry must record that the auto re-verify happens EXACTLY ONCE");
  assert.ok(
    entry.body.includes((stage as RegExpExecArray)[1]),
    "the stale-publish entry must record that a failing auto re-verify drops the item back to " +
      (stage as RegExpExecArray)[1] +
      " rather than looping",
  );
  requireMatch(entry.body, /debug/i, "the stale-publish entry must record that the dropped item has debugging set");
});

// ===========================================================================
// 15.1-ts-subsession-env-failed
// ===========================================================================

test("[15.1-ts-subsession-env-failed] the env-failed entry names the exact journal records, the budget, the completion path and the env stop", () => {
  const text = ops();
  const trouble = sectionFor(text, /troubleshoot/i, "troubleshooting");
  const entry = entryFor(trouble, /env[- ]failed/i, "sub-session env-failed");

  requireMatch(entry.body, /journal\.jsonl/, "the env-failed entry must send the operator to journal.jsonl (plan :3042)");

  for (const event of ["subsession.retry", "subsession.complete"]) {
    assert.ok(EVENTS["fanout"].includes(event), "fanout must own the `" + event + "` journal event");
  }
  requireAll(entry.body, ["subsession.retry", "subsession.complete"], "the env-failed entry's grep targets");
  requireMatch(entry.body, /attempt/i, "the env-failed entry must say subsession.retry carries its attempt number");
  requireMatch(entry.body, /validation error|errors/i, "the env-failed entry must say subsession.retry carries the validation errors");

  const fanoutSrc = readRepo("conductor/adapter/fanout.ts");
  const attempts = /MAX_ATTEMPTS\s*=\s*(\d+)/.exec(fanoutSrc);
  assert.ok(attempts !== null, "adapter/fanout.ts must define MAX_ATTEMPTS");
  requireMatch(
    entry.body,
    new RegExp("(?<![\\w.])" + (attempts as RegExpExecArray)[1] + "(?![\\w.])"),
    "the env-failed entry must state the " + (attempts as RegExpExecArray)[1] + "-attempt budget",
  );
  requireMatch(entry.body, /schema-invalid/, "the env-failed entry must name reason \"schema-invalid\" on exhaustion");

  requireMatch(
    entry.body,
    /watchdog/i,
    "the env-failed entry must state that this path is a COMPLETION and not a watchdog abort",
  );
  assert.ok(STOP_KINDS.includes("env"), "env must be a §2.9 stop kind");
  requireMatch(entry.body, /\benv\b/, "the env-failed entry must state the sub-session contributes to the run's `env` stop");
  requireMatch(entry.body, /stop-report/i, "the env-failed entry must state the env stop still writes a stop-report");
});

// ===========================================================================
// 15.1-ts-run-disengaged
// ===========================================================================

test("[15.1-ts-run-disengaged] the disengaged entry states the futility cap, the noop stop, the disengage anomaly and all three continuation events", () => {
  const text = ops();
  const trouble = sectionFor(text, /troubleshoot/i, "troubleshooting");
  const entry = entryFor(trouble, /disengag/i, "run disengaged");

  // The cap is core/stops.ts's FUTILE_RE_PROMPT_LIMIT, not a number in the doc.
  const stopsSrc = readRepo("conductor/core/stops.ts");
  const cap = /FUTILE_RE_PROMPT_LIMIT\s*=\s*(\d+)/.exec(stopsSrc);
  assert.ok(cap !== null, "core/stops.ts must define FUTILE_RE_PROMPT_LIMIT");
  requireMatch(
    entry.body,
    new RegExp("(?<![\\w.])" + (cap as RegExpExecArray)[1] + "(?![\\w.])"),
    "the disengaged entry must state the §3.7 cap of " + (cap as RegExpExecArray)[1] + " consecutive futile idle re-prompts",
  );
  requireMatch(entry.body, /consecutive/i, "the disengaged entry must state the re-prompts are CONSECUTIVE");
  requireMatch(
    entry.body,
    /signature/i,
    "the disengaged entry must define futile as the run-state signature not changing",
  );

  assert.ok(STOP_KINDS.includes("noop"), "noop must be a §2.9 stop kind");
  requireMatch(entry.body, /\bnoop\b/, "the disengaged entry must name stop kind `noop`");
  requireMatch(entry.body, /anomalies\.jsonl/, "the disengaged entry must say a `disengage` anomaly lands in anomalies.jsonl");

  const continuationEvents = Array.from(EVENTS["continuation"]);
  assert.equal(
    continuationEvents.length,
    3,
    "EVENTS['continuation'] must hold exactly three events; got " + continuationEvents.join(", "),
  );
  requireAll(entry.body, continuationEvents, "the disengaged entry's continuation events");
  requireMatch(entry.body, /continuation/i, "the disengaged entry must name the `continuation` component");

  requireMatch(entry.body, /stop-report/i, "the disengaged entry must state the run still writes a stop-report");
  requireMatch(
    entry.body,
    /not a fix|bound on the failure mode|bounds the failure mode/i,
    "the disengaged entry must state the disengage backstop is a BOUND on the failure mode, not a fix (§9 limit 2)",
  );
});

// ===========================================================================
// 15.1-degraded-modes
// ===========================================================================

test("[15.1-degraded-modes] OPERATIONS.md documents no-git mode and the advisory run.lock second-session behaviour", () => {
  const text = ops();

  // --- §3.9 no-git mode ---------------------------------------------------
  const typesSrc = readRepo("conductor/core/types.ts");
  const gitModes = /const GIT_MODES\s*=\s*\[([^\]]*)\]/.exec(typesSrc);
  assert.ok(gitModes !== null, "core/types.ts must declare GIT_MODES");
  const modes = Array.from((gitModes as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(modes.includes("read-only"), "GIT_MODES must include read-only; got " + modes.join(", "));

  requireMatch(text, /no-git/i, "OPERATIONS.md must document §3.9 no-git mode");
  requireMatch(text, /conductor_setup/, "the no-git description must say conductor_setup offers the choice");
  requireMatch(text, /initiali[sz]e a (git )?repo/i, "the no-git description must name the first choice: initialize a repo");
  requireMatch(text, /git\.mode/, "the no-git description must name the git.mode config key");
  requireMatch(text, /read-only/, "the no-git description must state git.mode becomes 'read-only'");
  requireMatch(text, /publish[^.]{0,80}disabl|disabl[^.]{0,80}publish/i, "the no-git description must state publish is DISABLED");
  requireMatch(text, /REVIEWED/, "the no-git description must state items terminate at REVIEWED with their diff in the report");
  requireMatch(text, /worktree/i, "the no-git description must state worktree mode is disabled");
  requireMatch(text, /freshness/i, "the no-git description must state the HEAD term is dropped from the freshness rule");
  requireMatch(text, /\.git\/info\/exclude/, "the no-git description must state .git/info/exclude registration is skipped");
  requireMatch(text, /unchanged/i, "the no-git description must state FSM, gates, evidence and review are unchanged");

  // --- second session / run.lock -----------------------------------------
  const stateSrc = readRepo("conductor/adapter/state.ts");
  const lockFile = /path\.join\(stateDir, "(run\.lock)"\)/.exec(stateSrc);
  assert.ok(lockFile !== null, "state.ts must build the run.lock path");
  assert.ok(
    text.includes(".conductor/state/" + (lockFile as RegExpExecArray)[1]),
    "OPERATIONS.md must name .conductor/state/" + (lockFile as RegExpExecArray)[1] + " as the advisory single-writer lock",
  );
  requireMatch(text, /advisory/i, "the second-session description must call run.lock ADVISORY");
  requireMatch(text, /single-writer/i, "the second-session description must call run.lock a single-writer lock");
  requireMatch(text, /second[^.]{0,60}session/i, "the second-session description must say the second conductor session gets read-only conductor");

  const staleLock = /DEFAULT_STALE_LOCK_MS\s*=\s*([0-9*\s]+);/.exec(stateSrc);
  assert.ok(staleLock !== null, "state.ts must define DEFAULT_STALE_LOCK_MS");
  const ms = (staleLock as RegExpExecArray)[1]
    .split("*")
    .map((p) => Number(p.trim()))
    .reduce((a, b) => a * b, 1);
  const hours = ms / 3600000;
  requireMatch(
    text,
    new RegExp("(?<![\\w.])" + String(hours) + "\\s*h", "i"),
    "the second-session description must state the " + String(hours) + "h default lock staleness (state.ts DEFAULT_STALE_LOCK_MS)",
  );
  requireMatch(text, /broken automatically|automatically broken/i, "the second-session description must state a dead holder's lock is broken automatically");
  requireMatch(text, /never delete/i, "the second-session description must state a read-only instance never deletes the lock it observed");
  requireMatch(text, /lies to both/i, "the second-session description must state a human deleting the lock lies to both sessions");
});

// ===========================================================================
// 15.1-honest-limits-verbatim-fifteen
// ===========================================================================

const PLAN_PATH = "docs/plans/2026-08-07-conductor-harness-plan.md";

interface PlanLimit {
  number: number;
  text: string;
}

/** The §9 items, extracted from the plan at runtime. Never from the doc. */
function planLimits(): PlanLimit[] {
  const plan = readRepo(PLAN_PATH);
  const start = plan.search(/^## §9\./m);
  assert.ok(start >= 0, PLAN_PATH + " must carry a '## §9.' heading");
  const rest = plan.slice(start);
  const endRel = rest.search(/^## §10\./m);
  assert.ok(endRel > 0, PLAN_PATH + " must carry a '## §10.' heading after §9");
  const body = rest.slice(0, endRel);

  const lines = body.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\d+\. \*\*/.test(lines[i])) starts.push(i);
  }
  const out: PlanLimit[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i];
    const to = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const chunk = lines.slice(from, to).join("\n");
    const num = /^(\d+)\./.exec(lines[from]);
    assert.ok(num !== null, "plan §9 item at line offset " + String(from) + " must be numbered");
    out.push({ number: Number((num as RegExpExecArray)[1]), text: chunk });
  }
  return out;
}

test("[15.1-honest-limits-verbatim-fifteen] HONEST-LIMITS.md reproduces all fifteen plan §9 limits verbatim and in order", () => {
  const items = planLimits();
  assert.equal(items.length, 15, "plan §9 must hold exactly fifteen limits; found " + String(items.length));
  assert.deepEqual(
    items.map((i) => i.number),
    Array.from({ length: 15 }, (_unused, i) => i + 1),
    "plan §9's items must be numbered 1-15 in order",
  );

  const body = norm(limits());
  let previous = -1;
  for (const item of items) {
    const needle = norm(item.text);
    const at = body.indexOf(needle);
    assert.ok(
      at >= 0,
      LIMITS_NAME + " must reproduce plan §9 limit " + String(item.number) + " VERBATIM (whitespace-collapsed match only)",
    );
    assert.ok(
      at > previous,
      LIMITS_NAME + " must carry plan §9 limit " + String(item.number) + " AFTER limit " + String(item.number - 1),
    );
    previous = at;
  }

  const numbering = Array.from(limits().matchAll(/^(\d+)\. \*\*/gm)).map((m) => Number(m[1]));
  assert.deepEqual(
    numbering.slice(0, 15),
    Array.from({ length: 15 }, (_unused, i) => i + 1),
    LIMITS_NAME + "'s numbering must run 1-15; got " + numbering.join(", "),
  );
  requireMatch(limits(), /§9/, LIMITS_NAME + " must name §9 of the plan as the source of this part");
});

// ===========================================================================
// 15.1-honest-limits-build-discovered-appended
// ===========================================================================

/** Where the build-discovered second part begins: the first '## ' after limit 15. */
function buildDiscoveredTail(text: string): string {
  const fifteenth = text.search(/^15\. \*\*/m);
  assert.ok(fifteenth >= 0, LIMITS_NAME + " must carry a fifteenth §9 limit");
  const after = text.slice(fifteenth);
  const headingRel = after.search(/^## /m);
  assert.ok(
    headingRel > 0,
    LIMITS_NAME + " must carry a clearly separated second part (a '## ' heading) after the fifteen §9 limits",
  );
  return after.slice(headingRel);
}

test("[15.1-honest-limits-build-discovered-appended] the build-discovered second part folds all five accumulator subjects after the fifteen", () => {
  const text = limits();
  const tail = buildDiscoveredTail(text);

  // Never interleaved: every §9 item sits before the second part begins.
  const tailStart = text.length - tail.length;
  for (const item of planLimits()) {
    const at = norm(text).indexOf(norm(item.text));
    assert.ok(at >= 0, LIMITS_NAME + " must still carry plan §9 limit " + String(item.number));
  }
  const lastNumbered = Array.from(text.matchAll(/^\d+\. \*\*/gm)).map((m) => m.index);
  for (const at of lastNumbered) {
    assert.ok(
      typeof at === "number" && at < tailStart,
      LIMITS_NAME + ": the §9 limits must never be interleaved with the build-discovered part",
    );
  }

  // 1. git-command detection gaps, now failing safe by DENYING.
  requireMatch(tail, /git/i, "the build-discovered part must cover the git-command detection gaps");
  requireMatch(tail, /detect/i, "the git-command entry must state what detection does not reach");
  requireMatch(
    tail,
    /separate[- ]value|non-enumerated|--git-dir/i,
    "the git-command entry must name the non-enumerated separate-value globals",
  );
  requireMatch(tail, /den(y|ies|ied|ying)/i, "the git-command entry must state those globals now fail safe by DENYING");
  requireMatch(tail, /over-den|over-block|legitimate/i, "the git-command entry must state the over-deny of some legitimate reads");

  // 2. freshness fail-safe on non-finite timestamps.
  const freshnessSrc = readRepo("conductor/core/freshness.ts");
  assert.ok(/Number\.isFinite/.test(freshnessSrc), "core/freshness.ts must guard on finite timestamps");
  requireMatch(tail, /freshness/i, "the build-discovered part must cover the freshness fail-safe");
  requireMatch(tail, /non-finite|not finite|NaN|Infinity/i, "the freshness entry must name the non-finite timestamp case");

  // 3. classifyFailure's text-only causality.
  assert.ok(/classifyFailure/.test(freshnessSrc), "core/freshness.ts must export classifyFailure");
  requireMatch(tail, /classifyFailure/, "the build-discovered part must cover classifyFailure's causality bound");
  requireMatch(tail, /text[- ]only|text only/i, "the classifyFailure entry must state the causality is TEXT-ONLY");
  requireMatch(tail, /runner rule/i, "the classifyFailure entry must state it is bounded by the runner rule data");

  // 4. the enumerated write-shape set for edit detection.
  requireMatch(tail, /write[- ]shape/i, "the build-discovered part must cover the enumerated write-shape set");
  requireMatch(tail, /enumerat/i, "the write-shape entry must state the set is ENUMERATED");

  // 5. the M5 stub-marker scan's production-source-only scope.
  requireMatch(tail, /\bM5\b/, "the build-discovered part must cover the M5 marker scan");
  requireMatch(tail, /production/i, "the M5 entry must state the scan covers production sources only");
});

// ===========================================================================
// 15.1-honest-limits-current-posture
// ===========================================================================

test("[15.1-honest-limits-current-posture] the build-discovered part states the C-022 deny posture, not the superseded open bypass", () => {
  const text = limits();
  const normalized = norm(text);

  // Negative: neither backtick substitution nor alias injection may be described
  // as an open bypass. C-022 closed that route by denying.
  for (const re of [
    /(backtick|command substitution)[^.]{0,200}(bypass|not (caught|detected)|slips? (past|through)|evades?|undetected)/i,
    /(git )?alias[^.]{0,200}(bypass|not (caught|detected)|slips? (past|through)|evades?|undetected)/i,
    /(bypass|slips? past|evades?)[^.]{0,200}(backtick|command substitution|git alias)/i,
  ]) {
    assert.ok(
      !re.test(normalized),
      LIMITS_NAME +
        " must NOT describe backtick command substitution or git alias injection as an open bypass (C-022 closed it by denying); matched " +
        String(re),
    );
  }

  // Positive: the current posture, cross-checked against core/gates-git.ts.
  const gitGates = readRepo("conductor/core/gates-git.ts");
  assert.ok(
    /unresolved shell-expansion|shell expansion in command position/.test(gitGates),
    "core/gates-git.ts must implement the unresolved shell-expansion deny",
  );
  assert.ok(/conductor_surface/.test(gitGates), "core/gates-git.ts must route the denied command to conductor_surface");

  const tail = buildDiscoveredTail(text);
  requireMatch(tail, /shell[- ]expansion/i, "the current-posture entry must name the shell-expansion sigil rule");
  requireMatch(
    tail,
    /unresolved|sigil/i,
    "the current-posture entry must state that an UNRESOLVED expansion sigil in command position is what triggers the deny",
  );
  requireMatch(tail, /den(y|ies|ied)/i, "the current-posture entry must state the command word is DENIED");
  requireMatch(
    tail,
    /surface[sd]? a question|conductor_surface/i,
    "the current-posture entry must state a question is surfaced instead of executing",
  );

  requireMatch(
    tail,
    /over-block|over-den/i,
    "the current-posture entry must name the residual: the over-block of a legitimate expansion in a gated session",
  );
  requireMatch(tail, /in-place/i, "the current-posture entry must name the residual in-place writers outside the write-shape set");
  requireMatch(tail, /write[- ]shape/i, "the current-posture entry must scope the in-place-writer residual to the write-shape set");
});

// ===========================================================================
// 15.1-honest-limits-detection-posture-stated
// ===========================================================================

test("[15.1-honest-limits-detection-posture-stated] HONEST-LIMITS.md states the G7 detection-over-prevention posture and the three absence limits", () => {
  const text = limits();

  requireMatch(text, /\bG7\b/, LIMITS_NAME + " must name the G7 posture the whole document rests on");
  requireMatch(text, /detection[- ]over[- ]prevention/i, LIMITS_NAME + " must state detection over prevention");
  requireMatch(
    text,
    /documented rather than prevented|document(s|ed)?[^.]{0,60}rather than prevent/i,
    LIMITS_NAME + " must state that these limits are DOCUMENTED rather than prevented",
  );

  // Absence limit 1 — conductor cannot detect its own absence.
  requireMatch(text, /detect its own absence/i, LIMITS_NAME + " must state that conductor cannot detect its own absence");
  requireMatch(text, /banner/i, "the self-absence limit must be tied to the missing banner");

  // Absence limit 2 — a second, plain opencode session is ungated and races.
  requireMatch(text, /second, ?plain/i, LIMITS_NAME + " must state that a second, plain opencode session in the same repo is ungated");
  requireMatch(text, /ungated/i, "the second-plain-session limit must call that session ungated");
  requireAll(text, ["freshness stamp", "quarantine move", "freeze window"], "the second-plain-session limit's race list");

  // Absence limit 3 — in-session interpreters write without a write shape.
  requireAll(text, ["node -e", "python -c"], "the in-session interpreter limit");
  requireMatch(
    text,
    /write[- ]shape/i,
    "the in-session interpreter limit must state those writes match no write-shape pattern",
  );
});
