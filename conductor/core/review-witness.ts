// conductor/core/review-witness.ts — GAP-011 (ISSUE-072): the reviewer diligence
// witness. Core module (G3): pure — no I/O, no clock, no runtime globals.
//
// The defect this closes: the item-review blind-spot guard fires only when a lens
// returns no valid receipt, so a schema-valid `{"findings":[]}` was indistinguishable
// from a session that never opened the diff — and review.md's calibration line ("an
// empty findings list IS the approval") made that the cheapest sanctioned exit in the
// system.
//
// The honest boundary: a reviewer's JUDGEMENT stays trusted — the harness has no way
// to grade it and pretending otherwise would be theatre. CONTACT is not judgement, and
// contact is mechanically checkable. Every lens dispatch carries a nonce derived from
// the dispatch itself, and every reply carries a read witness: that nonce back, plus
// the ranges the reviewer read. The handler re-derives the item's touched-file/hunk set
// from the diff it built the prompt with and refuses a witness that cites a file the
// diff never touched, a span no hunk contains, or leaves a touched file uncited.
//
// What it does NOT do: force a finding. The empty review still IS the approval — at
// the price of one honest read.
//
// THE CREATION HOLE (Phase III fix round). Contact was derived from `git diff`
// alone, and an item whose scope is a file it CREATES has no tracked diff at all:
// the contact map came back empty, every citation demand vanished with it, and
// checkReadWitness degenerated into echoing the nonce the prompt printed. A lens
// that replied `{"findings":[]}` with the nonce copied back advanced a whole
// creation-shaped item without reading a line. So the diff a reviewer is shown —
// and the contact it is checked against — carries the created files too, as the
// creation hunks git itself would emit for them (`createdFileDiff`). One
// derivation still, over one string; what grew is the universe it runs over.

// One cited span of one file, as the reply carries it. Line numbers are post-image
// (the reviewed state of the file), 1-based and inclusive at both ends.
export interface CitedRange {
  file: string;
  startLine: number;
  endLine: number;
}

export interface ReadWitness {
  nonce: string;
  citedRanges: CitedRange[];
}

// A touched file's post-image hunk spans, as re-derived from the diff.
export type DiffContact = Map<string, Array<[number, number]>>;

export interface WitnessCheck {
  ok: boolean;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// The nonce
// ---------------------------------------------------------------------------

// FNV-1a over the joined parts, twice with different offsets, rendered hex. A
// cryptographic hash is not what this needs: the nonce is a per-dispatch marker a
// reply must carry back, and the handler re-derives it from the same parts rather
// than remembering it. What it must be is (a) stable for one dispatch and (b)
// different for every other dispatch of the same round.
function fnv1a(text: string, offset: number): number {
  let hash = offset;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

/**
 * The read-witness nonce for one lens dispatch, derived from the parts that
 * identify it (run, item, round, lens group). Pure: the handler mints it for the
 * prompt and re-derives it to check the reply.
 */
export function witnessNonce(parts: readonly string[]): string {
  const joined = parts.join("|");
  return "RW-" + hex8(fnv1a(joined, 0x811c9dc5)) + hex8(fnv1a(joined, 0x9e3779b9));
}

// ---------------------------------------------------------------------------
// The re-derivation
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * The touched files of a unified diff, each with its post-image hunk spans. A hunk
 * `@@ -a,b +c,d @@` covers post-image lines c..c+d-1 (d defaults to 1); a
 * zero-length post-image (a pure deletion) still yields the anchor line, so a
 * reviewer can cite the place a deletion happened.
 *
 * Tolerant of surrounding prose by construction — it keys off the `+++ b/<path>`
 * and `@@` lines and ignores everything else — which is what lets the same
 * derivation run over a raw diff and over a prompt that embeds one.
 */
export function diffContact(diff: string): DiffContact {
  const contact: DiffContact = new Map();
  let current: string | null = null;
  for (const raw of diff.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") {
        current = null;
        continue;
      }
      current = target.startsWith("b/") ? target.slice(2) : target;
      if (!contact.has(current)) contact.set(current, []);
      continue;
    }
    if (current === null) continue;
    const hunk = HUNK_HEADER.exec(line);
    if (hunk === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const end = count > 0 ? start + count - 1 : start;
    (contact.get(current) as Array<[number, number]>).push([start, end]);
  }
  // A file whose header appeared with no hunk (a pure rename or mode change)
  // carries no citable line: drop it rather than demand a citation nobody can make.
  for (const [file, ranges] of [...contact]) {
    if (ranges.length === 0) contact.delete(file);
  }
  return contact;
}

// One file the item CREATED: its repo-relative path and the content it holds in
// the tree under review.
export interface CreatedFile {
  path: string;
  content: string;
}

/**
 * The unified diff git emits for a file that did not exist before — one creation
 * hunk covering the whole post-image, so `diffContact` derives the same citable
 * span from it that it derives for an edited file's hunks.
 *
 * An EMPTY file gets a header and no hunk: it carries no citable line, and
 * diffContact drops a hunkless file rather than demanding a citation nobody can
 * make (the same rule a pure rename already takes).
 */
export function createdFileDiff(files: readonly CreatedFile[]): string {
  const parts: string[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    parts.push(
      "diff --git a/" + file.path + " b/" + file.path,
      "--- /dev/null",
      "+++ b/" + file.path,
    );
    if (lines.length === 0) continue;
    parts.push("@@ -0,0 +1," + String(lines.length) + " @@");
    for (const line of lines) parts.push("+" + line);
  }
  return parts.length === 0 ? "" : parts.join("\n") + "\n";
}

function spansOverlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * Is this reply's read witness admissible against the dispatch that asked for it?
 *
 * Refused when: the witness is absent; the nonce is not this dispatch's; a cited
 * range names a file the diff does not touch; a cited range falls outside every
 * hunk of the file it names; a touched file is left uncited; or a range is
 * malformed. An item whose diff carries no touched file demands only the nonce —
 * there is nothing to cite, and inventing a demand nobody can satisfy is how a
 * floor becomes a wedge.
 */
export function checkReadWitness(
  witness: ReadWitness | null | undefined,
  expected: { nonce: string; contact: DiffContact },
): WitnessCheck {
  const reasons: string[] = [];
  if (witness === null || witness === undefined) {
    return {
      ok: false,
      reasons: [
        "the reply carries no readWitness: a review that names no contact with the diff is " +
          "indistinguishable from one that never opened it",
      ],
    };
  }
  if (witness.nonce !== expected.nonce) {
    reasons.push(
      'the readWitness nonce "' +
        witness.nonce +
        '" is not this dispatch\'s (' +
        expected.nonce +
        "): the reply was not composed against the diff it was sent",
    );
  }
  const cited = new Set<string>();
  for (const range of witness.citedRanges) {
    const ranges = expected.contact.get(range.file);
    if (ranges === undefined) {
      reasons.push(
        'the readWitness cites "' + range.file + '", which the item\'s diff does not touch',
      );
      continue;
    }
    if (!Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine) {
      reasons.push(
        'the readWitness cites "' +
          range.file +
          '" lines ' +
          String(range.startLine) +
          "-" +
          String(range.endLine) +
          ", which is not a line span",
      );
      continue;
    }
    const span: [number, number] = [range.startLine, range.endLine];
    if (!ranges.some((hunk) => spansOverlap(hunk, span))) {
      reasons.push(
        'the readWitness cites "' +
          range.file +
          '" lines ' +
          String(range.startLine) +
          "-" +
          String(range.endLine) +
          ", which no hunk of that file's diff contains",
      );
      continue;
    }
    cited.add(range.file);
  }
  for (const file of expected.contact.keys()) {
    if (!cited.has(file)) {
      reasons.push('the readWitness cites no range of "' + file + '", which the item\'s change touches');
    }
  }
  return { ok: reasons.length === 0, reasons };
}
