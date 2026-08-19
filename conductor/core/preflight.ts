// conductor/core/preflight.ts — GAP-032 (spec currency) + GAP-033 (live-artifact
// checkers): the pre-live-contact go/no-go the owner runs before a scheduled live
// task (13.2, 14.2). Core module (G3): pure — no I/O, no clock, no runtime
// globals. Every HEAD, every diff path set, every ledger fact and every
// artifact body arrives as an input; the impure caller gathers them (a git diff, a
// run.json read, an evidence.jsonl count) and this module decides.
//
// Two failures this closes, both recorded in the step-2 register:
//   GAP-032 — a spec verified 142 commits behind HEAD, specced against code that
//     moved underneath it, is a live task that burns its model-gated budget
//     rediscovering drift. specCurrency compares the spec's own recorded
//     verifiedAgainstHead against the current HEAD and flags every CITED file that
//     altered since — so a stale spec is caught by a text check, not by a model.
//   GAP-033 — the two live artifacts (conductor/SMOKE.md, the bench
//     conductor-report.md) are the cheapest fabrication in the whole review: a
//     hand-written SMOKE.md flips an acceptance row in seconds, and neither has a
//     standing guard. checkLiveArtifact ships BEFORE the artifact and binds it to
//     the run's own ledger — its runId and an evidence seq the run actually
//     minted — plus a real command line and a content floor, so a body invented
//     without a run cannot pass.

// ---------------------------------------------------------------------------
// GAP-032 — spec currency
// ---------------------------------------------------------------------------

/**
 * The currency-relevant fields of a task spec (docs/build/specs/task-*.assertions.json).
 * `citedFiles` are the source paths the spec's assertions name at file:line — the
 * impure caller extracts them from the spec text (extractCitedFiles below) so this
 * module never reads a file.
 */
export interface SpecRecord {
  taskId: string;
  /** The commit the spec author states every code claim was verified against. */
  verifiedAgainstHead: string;
  /** Source paths the spec cites; a change to any of them can invalidate a claim. */
  citedFiles: readonly string[];
}

export interface SpecCurrencyInputs {
  /** HEAD the live task would actually run against. */
  currentHead: string;
  /**
   * Paths that differ between `verifiedAgainstHead` and `currentHead`, as a
   * `git diff --name-only <verified>..<current>` would report them (repo-relative).
   */
  changedPathsSinceVerifiedHead: readonly string[];
}

export interface SpecCurrencyVerdict {
  /** True iff nothing the spec CITES was altered since it was verified — safe to run. */
  current: boolean;
  /** Whether HEAD moved at all since the spec was verified (informational). */
  headMoved: boolean;
  /** The cited files altered since the verified head — the real drift. */
  driftedCitedFiles: string[];
  /** Human lines, one per drift fact; empty when current and HEAD unmoved. */
  notes: string[];
}

/**
 * A spec is CURRENT for a live run iff none of the files it cites were altered since
 * the head it was verified against. A moved HEAD alone is not drift — the 13.2
 * spec survived 142 commits with every cited fact intact — but it IS the trigger
 * to compute the intersection below, so it is reported.
 */
export function specCurrency(spec: SpecRecord, inputs: SpecCurrencyInputs): SpecCurrencyVerdict {
  const headMoved = spec.verifiedAgainstHead !== inputs.currentHead;
  const changed = new Set(inputs.changedPathsSinceVerifiedHead);
  const driftedCitedFiles: string[] = [];
  for (const file of spec.citedFiles) {
    if (changed.has(file) && !driftedCitedFiles.includes(file)) {
      driftedCitedFiles.push(file);
    }
  }

  const notes: string[] = [];
  if (headMoved) {
    notes.push(
      `spec ${spec.taskId} was verified against ${spec.verifiedAgainstHead}, but the run targets ${inputs.currentHead}`,
    );
  }
  for (const file of driftedCitedFiles) {
    notes.push(`cited file ${file} changed since the verified head — re-verify the assertions that name it`);
  }

  return {
    current: driftedCitedFiles.length === 0,
    headMoved,
    driftedCitedFiles,
    notes,
  };
}

// A spec cites a source file as a repo-relative path, sometimes with a `:line`
// or `:line-line` suffix. Pull the distinct code paths out of the spec text so
// the caller can diff them against HEAD. Only conductor/**, router/** and
// scripts/** are treated as code; docs and specs cite themselves constantly.
const CITED_FILE_RE = /\b((?:conductor|router|scripts)\/[A-Za-z0-9_./-]+?\.(?:ts|tsx|cpp|hpp|py|json))\b/g;

/** Distinct code paths a spec text cites, in first-seen order (the `:line` stripped). */
export function extractCitedFiles(specText: string): string[] {
  const out: string[] = [];
  for (const match of specText.matchAll(CITED_FILE_RE)) {
    const file = match[1];
    if (!out.includes(file)) out.push(file);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GAP-033 — live-artifact checkers (ship BEFORE the artifact)
// ---------------------------------------------------------------------------

/**
 * The run facts a live artifact must be bound to, read by the impure caller from
 * the run's own ledger (run.json for the id, evidence.jsonl for the seq
 * high-water). A checker that trusted the artifact for these would prove nothing.
 */
export interface LiveArtifactLedger {
  /** The run's real id, from run.json. */
  runId: string;
  /** The highest evidence seq the run actually minted (evidence.jsonl line count). */
  evidenceSeqHighWater: number;
}

/** What a given artifact kind must satisfy. */
export interface LiveArtifactSpec {
  /** For messages only: "SMOKE.md" / "conductor-report.md". */
  label: string;
  /** Minimum non-blank line count — a body too thin to be a real capture. */
  minLines: number;
  /** Whether the artifact must show at least one real `$ ` command line. */
  requireCommandLine: boolean;
}

export interface LiveArtifactCheck {
  ok: boolean;
  problems: string[];
}

// A recorded command line, the M8 shape: a `$ ` prompt with a command after it,
// at any indentation (fenced captures are commonly indented).
const COMMAND_LINE_RE = /^\s*\$ \S/;

// An evidence-seq citation in the artifact: "evidence seq 12", "seq: 12", "#12".
const SEQ_CITATION_RE = /(?:evidence\s+seq|seq)\b[^0-9]{0,4}(\d+)|#(\d+)\b/gi;

function citedSeqs(content: string): number[] {
  const seqs: number[] = [];
  for (const match of content.matchAll(SEQ_CITATION_RE)) {
    const raw = match[1] ?? match[2];
    if (raw === undefined) continue;
    const value = Number.parseInt(raw, 10);
    if (Number.isInteger(value)) seqs.push(value);
  }
  return seqs;
}

function nonBlankLineCount(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (line.trim().length > 0) count += 1;
  }
  return count;
}

/**
 * Whether a live artifact is bound to the run it claims and carries the marks of a
 * real capture. Every problem is one line naming what is missing; an empty
 * problems list (ok) is the go signal.
 *
 * The four binds, weakest honest set:
 *  1. the artifact names the run's real runId (else it is bound to no run);
 *  2. it cites at least one evidence seq the run ACTUALLY minted — a seq in
 *     [1, evidenceSeqHighWater]; a body citing none, or one past the high-water,
 *     was not produced by this run's ledger;
 *  3. (when required) it shows at least one real `$ ` command line — M8's floor;
 *  4. it clears a content floor, so a stub cannot pass on the ids alone.
 */
export function checkLiveArtifact(
  content: string,
  spec: LiveArtifactSpec,
  ledger: LiveArtifactLedger,
): LiveArtifactCheck {
  const problems: string[] = [];

  if (ledger.runId.length === 0 || !content.includes(ledger.runId)) {
    problems.push(`${spec.label} does not cite the run's id ${ledger.runId || "(empty)"} — it is bound to no run`);
  }

  const seqs = citedSeqs(content);
  const boundSeq = seqs.some((seq) => seq >= 1 && seq <= ledger.evidenceSeqHighWater);
  if (ledger.evidenceSeqHighWater < 1) {
    problems.push(`${spec.label} run minted no evidence — there is nothing to bind to (ledger high-water 0)`);
  } else if (!boundSeq) {
    problems.push(
      `${spec.label} cites no evidence seq within the run's ledger [1, ${ledger.evidenceSeqHighWater}] — the run did not produce it`,
    );
  }

  if (spec.requireCommandLine) {
    const hasCommand = content.split("\n").some((line) => COMMAND_LINE_RE.test(line));
    if (!hasCommand) {
      problems.push(`${spec.label} shows no verbatim "$ " command line — an M8 live capture requires at least one`);
    }
  }

  const lines = nonBlankLineCount(content);
  if (lines < spec.minLines) {
    problems.push(`${spec.label} has ${lines} non-blank line(s), below the ${spec.minLines}-line content floor`);
  }

  return { ok: problems.length === 0, problems };
}
