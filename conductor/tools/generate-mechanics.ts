// conductor/tools/generate-mechanics.ts — GAP-005's generation step.
//
// Rewrites the generated mechanics block inside every conductor/doctrine/*.md
// pack from core/mechanics.ts's derivation of the tool vocabulary. Run it after
// any change to the tool inventory or the legality machine; the guard test
// conductor/tests/doctrine-mechanics.test.ts is what makes forgetting to run it
// a red rather than a silent drift.
//
// A pack that carries no block yet gets one appended; a pack that carries one has
// it replaced in place, so the block never moves and never multiplies. A pack whose
// markers say neither of those things — a second block, an orphaned or an unclosed
// marker — is REFUSED by name rather than spliced on a guess.
//
// Usage: node conductor/tools/generate-mechanics.ts [doctrineDir]
//
// The CLI fires on invocation only (the argv[1] suffix guard at the bottom, the
// same entry-point shape conductor/tools/export-schemas.ts uses): importing this
// module must rewrite nothing, which is what lets
// conductor/tests/generate-mechanics.test.ts drive the splice directly.

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { MECHANICS_BEGIN, MECHANICS_END, mechanicsBlock } from "../core/mechanics.ts";

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

function occurrences(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

// Replace the fenced block, or append one to a pack that has none. Splicing on the
// markers (rather than rewriting the file from a template) keeps every hand-written
// word of the pack exactly where its author put it.
//
// The marker law is checked FIRST and refuses everything that is neither of those
// two cases. A pack carrying two opening markers would keep its second (stale)
// block beside the fresh one, so the pack would state the mechanics twice and
// disagree with itself; an orphaned closing marker means the region a splice would
// replace is not the region the markers describe. Both are repairs for a human,
// not guesses for a generator that rewrites nine checked-in files in one pass.
export function spliceBlock(text: string, block: string): string {
  const begins = occurrences(text, MECHANICS_BEGIN);
  const ends = occurrences(text, MECHANICS_END);
  if (begins > 1) {
    throw new Error(
      `this pack carries ${begins} ${MECHANICS_BEGIN} markers; exactly one (or none) is splicable — ` +
        "delete the extra block by hand, then regenerate",
    );
  }
  if (ends > 1) {
    throw new Error(
      `this pack carries ${ends} ${MECHANICS_END} markers; exactly one (or none) is splicable — ` +
        "delete the extra marker by hand, then regenerate",
    );
  }
  if (begins === 0) {
    if (ends === 1) {
      throw new Error(
        `this pack carries a ${MECHANICS_END} marker with no ${MECHANICS_BEGIN} to open it; the ` +
          "region a splice would replace is not the region the markers describe",
      );
    }
    const body = text.replace(/\s*$/, "");
    return body + "\n\n" + block + "\n";
  }
  const start = text.indexOf(MECHANICS_BEGIN);
  const endMarker = text.indexOf(MECHANICS_END, start);
  if (endMarker < 0) {
    throw new Error(`mechanics block in this pack opens but never closes (${MECHANICS_END} absent)`);
  }
  return text.slice(0, start) + block + text.slice(endMarker + MECHANICS_END.length);
}

export function main(argv: readonly string[]): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const doctrineDir = argv[2] ?? path.resolve(here, "..", "doctrine");
  for (const pack of PACKS) {
    const packPath = path.join(doctrineDir, pack);
    const before = readFileSync(packPath, "utf8");
    let after: string;
    try {
      after = spliceBlock(before, mechanicsBlock(pack));
    } catch (error) {
      // The refusal NAMES the file: the operator repairs one pack, and the eight
      // packs this pass has not reached yet stay as they are.
      throw new Error(
        `${packPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (after !== before) {
      writeFileSync(packPath, after, "utf8");
      process.stdout.write(`regenerated mechanics: ${pack}\n`);
    }
  }
}

// Entry-point guard, the conductor/tools/export-schemas.ts shape: under Node type
// stripping there is no import.meta.main, so the argv[1] suffix test is what keeps
// an import inert and the CLI live.
if (process.argv[1] && process.argv[1].endsWith("generate-mechanics.ts")) {
  main(process.argv);
}
