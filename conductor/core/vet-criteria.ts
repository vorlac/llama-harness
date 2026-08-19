// conductor/core/vet-criteria.ts — GAP-041 / ISSUE-013: the ONE list behind the
// §2.10 TEST_VET criteria, and the rule that makes a verdict on them bite.
//
// Three consumers read this module and nothing restates it:
//
//   (1) core/types.ts builds SCHEMAS.TestVet's `verdictsByCriterion` out of
//       VET_CRITERIA, so the keys a critic receipt is VALIDATED against are the
//       criteria themselves — and adapter/tools.ts's tally reads those keys back
//       out of the registered schema.
//
//   (2) core/mechanics.ts renders `renderVetCriteria()` into test-vet.md's
//       generated block, so the checklist the pack TEACHES is the checklist the
//       critic is SCORED on. GAP-041's defect was two unrelated lists: five
//       scored criteria in two prompt literals, five mock anti-patterns in the
//       pack, and three scored criteria with no doctrine at all.
//
//   (3) adapter/tools.ts composes both vet prompts from that same rendering, so
//       the examination and the doctrine cannot drift apart in one context window
//       (the ISSUE-003 failure shape, where the model weights the tail).
//
// `impliedMustFix` is the ISSUE-013 half. The CONTENT of a critic's judgement is
// model judgement and stays trusted — nothing here decides whether a verdict is
// right. What binds is the handling of the fields the critic DID return: a
// `pass:false` it wrote down cannot be erased by an empty `mustFix`, because
// advancing on that self-contradiction resolves the ambiguity in the less strict
// direction against the critic's own words.
//
// Core module (G3): pure — no I/O, no clock, no runtime globals.

export interface VetCriterion {
  // The key in a TestVet receipt's `verdictsByCriterion`.
  name: string;
  // The single sentence the critic scores the test by.
  rule: string;
  // The doctrine a reader of test-vet.md gets for this criterion.
  doctrine: string;
}

// The §2.10 criteria, plan lines 958-965, in the order every consumer presents
// them: the schema's `required`, the tally rows, the pack's checklist.
export const VET_CRITERIA: readonly VetCriterion[] = [
  {
    name: "observableBehavior",
    rule: "it asserts observable behaviour through the subject's public surface, not internals.",
    doctrine:
      "Assert what a caller can see: a returned value, a thrown error, a written file. A test " +
      "that reaches past the public surface pins the implementation the subject happens to have, " +
      "and goes red on a refactor that broke nothing.",
  },
  {
    name: "wouldCatchWrongImpl",
    rule:
      "a subtly WRONG implementation would still fail it — it is not a tautology and it is not " +
      "testing a mock.",
    doctrine:
      "Name the wrong implementation this test would catch, then check the assertion really " +
      "would catch it. A test that passes against a stub, a mock's own return, or any " +
      "implementation at all pins nothing — the one failure this stage exists to find.",
  },
  {
    name: "rightLevel",
    rule: "it is at the right level (unit vs integration) for what it pins.",
    doctrine:
      "Pin a self-contained decision at unit level; pin a seam between components where that seam " +
      "actually runs. A unit test standing in for an integration concern passes while the wiring " +
      "is broken, and the reverse is slow and names no cause when it fails.",
  },
  {
    name: "pinsAcceptance",
    rule: "it pins THIS item's acceptance criteria, not a neighbouring concern.",
    doctrine:
      "Read the item's acceptance and point every assertion at one of its clauses. A test aimed " +
      "at a neighbouring concern earns a green the item's acceptance never demanded and leaves " +
      "the behaviour it owed untested.",
  },
  {
    name: "antiPatterns",
    rule:
      "no anti-patterns — no sleep-based timing, no assertion-free run, no snapshot of " +
      "everything, no test that cannot fail.",
    doctrine:
      "Wait on a condition rather than a clock, assert rather than merely execute, and pin the " +
      "fields that carry the behaviour rather than snapshotting the world. test-vet.md's five " +
      "mock lenses are this criterion's long form.",
  },
];

// The `## ` heading the rendered section carries, and the name a dispatch prompt
// or a pack reader asks for it by.
export const VET_CRITERIA_HEADING = "The §2.10 vet criteria";

export function vetCriterionNames(): string[] {
  return VET_CRITERIA.map((criterion) => criterion.name);
}

// The checklist as one markdown section: the criteria with their rules and their
// doctrine, then the law that makes a verdict on them consequential. Rendered
// into the pack and carried verbatim by both vet prompts.
export function renderVetCriteria(): string {
  const lines: string[] = [
    "## " + VET_CRITERIA_HEADING,
    "",
    "Judge a test on exactly these criteria, in this order, scoring each one `{pass, note}`:",
    "",
  ];
  for (const [index, criterion] of VET_CRITERIA.entries()) {
    lines.push(String(index + 1) + ". `" + criterion.name + "` — " + criterion.rule);
    lines.push("   " + criterion.doctrine);
    lines.push("");
  }
  lines.push(
    "A `pass:false` IS a must-fix. The harness reads the verdicts a critic returns: a criterion " +
      "failed with no `mustFix` entry beside it becomes one naming that criterion, and the test " +
      "goes back to its writer for repair. An EMPTY `mustFix` with every criterion passing is the " +
      "approval; never invent a fix to look thorough, and never ask for a change that only " +
      "restates a criterion.",
  );
  return lines.join("\n");
}

// The verdict shape a receipt carries per criterion. Spelled structurally so this
// module stays a leaf (core/types.ts imports it, not the other way round).
export interface VetVerdictLike {
  pass: boolean;
  note: string;
}

export interface VetReceiptLike {
  verdictsByCriterion: Record<string, VetVerdictLike | undefined>;
  mustFix: readonly string[];
}

// The repair line a failed criterion becomes. It carries the criterion, the rule
// the test must satisfy, and the critic's OWN note — the harness contributes no
// judgement of its own about the test.
export function vetRepairLine(criterion: VetCriterion, note: string): string {
  const trimmed = note.trim();
  return (
    "§2.10 `" +
    criterion.name +
    "` was judged pass:false and no repair was named: rewrite the test so " +
    criterion.rule +
    (trimmed.length > 0 ? " The critic's note: " + trimmed : "")
  );
}

/**
 * The must-fix entries a receipt IMPLIES but did not spell.
 *
 * A critic that named its own repairs is left alone: its non-empty `mustFix`
 * already refuses the advance, and the harness has nothing to add to a judgement
 * the critic wrote out. A critic that named NONE while failing a criterion left a
 * self-contradiction, and each failed criterion becomes one repair line.
 *
 * A criterion with no verdict at all counts as failed, matching the tally the
 * compact return carries — an omitted verdict is not an approval.
 */
export function impliedMustFix(receipt: VetReceiptLike): string[] {
  if (receipt.mustFix.length > 0) return [];
  const implied: string[] = [];
  for (const criterion of VET_CRITERIA) {
    const verdict = receipt.verdictsByCriterion[criterion.name];
    if (verdict !== undefined && verdict.pass) continue;
    implied.push(vetRepairLine(criterion, verdict?.note ?? ""));
  }
  return implied;
}
