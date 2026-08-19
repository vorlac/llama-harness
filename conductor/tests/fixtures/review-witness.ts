// conductor/tests/fixtures/review-witness.ts — the honest reviewer, as a fixture.
//
// GAP-011 made a §3.3 lens reply carry a read witness: the dispatch's nonce plus
// ranges the item's diff really contains. Every fake lens session in the suite has
// to produce one, and it must be produced the way a real reviewer produces it —
// by reading the prompt it was handed — rather than by a literal typed beside the
// assertion, which would pass whether or not the handler checks anything.
//
// So this reads the nonce off the prompt and re-derives the citable ranges from
// the diff the prompt carries, using the SAME core derivation the handler checks
// against (core/review-witness.ts diffContact). A prompt with no nonce yields an
// empty nonce, which is exactly what the refusal rows want.

import { diffContact } from "../../core/review-witness.ts";
import type { ReadWitness } from "../../core/review-witness.ts";

const NONCE_LINE = /READ WITNESS NONCE:[ \t]*(\S+)/;

/** The witness a reviewer who actually read this prompt would return. */
export function witnessFromPrompt(promptText: string): ReadWitness {
  const nonce = NONCE_LINE.exec(promptText)?.[1] ?? "";
  const citedRanges: ReadWitness["citedRanges"] = [];
  for (const [file, ranges] of diffContact(promptText)) {
    citedRanges.push({ file, startLine: ranges[0][0], endLine: ranges[0][1] });
  }
  return { nonce, citedRanges };
}

/** The same reply body every lens fixture returns, witness attached. */
export function findingsReply(findings: readonly unknown[], promptText: string): Record<string, unknown> {
  return { findings: [...findings], readWitness: witnessFromPrompt(promptText) };
}
