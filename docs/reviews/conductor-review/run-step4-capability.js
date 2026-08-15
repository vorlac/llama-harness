export const meta = {
  name: 'conductor-review-step4-capability',
  description: 'Step 4: the capability review and the consolidated provisional plan',
  phases: [
    { title: 'Capability lenses', detail: 'missing mechanisms, doctrine efficacy' },
    { title: 'Consolidate', detail: 'unified register, clusters, dependency order, open decisions' },
  ],
}

const REPO = '/Users/sal/development/vorlac/llama-harness'
const DIR = `${REPO}/docs/reviews/conductor-review`
const BATCH = 2 // small on purpose: a rate-limit kill takes few agents
const PARTS = `${DIR}/parts-capability`

const COMMON = [
  'You are working on step 4 of a five-step review of the "conductor" codebase.',
  `Working directory: ${REPO}. All paths are relative to it.`,
  '',
  'READ THESE FIRST, IN FULL:',
  '  1. docs/reviews/conductor-review/1-briefing.md            — orientation, rules, the P1-P13',
  '     taxonomy, method, exhaustiveness doctrine, known-open.',
  '  2. docs/reviews/conductor-review/4-capability.md          — the full step-4 charter.',
  '  3. docs/reviews/conductor-review/findings-enforcement.md  — step 2 output.',
  '  4. docs/reviews/conductor-review/findings-macro.md        — step 3 output.',
  '',
  'Steps 2 and 3 are your evidence base and your raw material. Each left CROSS-LENS POINTERS',
  'addressed to you; those are leads you are expected to WORK, not optional reading.',
  '',
  '**THE GROUNDING RULE, which is what keeps this review from becoming a wish list:** every GAP must',
  'trace to a specific ISSUE, MACRO, correction, or observed behaviour. The form that works is "the',
  'harness cannot re-derive X (ISSUE-NNN), so a model can assert X freely, so here is the mechanism',
  'that would let it re-derive X." The form that does not is "it would be good if the system also',
  'did Y." Anything ungrounded is marked SPECULATIVE and ranks below every grounded entry.',
  '',
  '## WRITE YOUR SKELETON FIRST — this is not optional and not a formality',
  '',
  'Within your FIRST FEW TOOL CALLS, before any deep reading, create your output file containing a',
  'title, your scope, the date, and empty section headers. Then APPEND to it continuously as you',
  'work — every finding the moment you have it, not at the end.',
  '',
  'Why: this review may hit an account rate limit at any moment and be killed mid-flight. An agent',
  'that reads for twenty-five minutes and then dies having written nothing has burned those tokens',
  'for nothing. **Treat your output file as the deliverable and your context as scratch.**',
  'NON-NEGOTIABLES: never touch .data/ or .out/; never git commit/push/reset/clean; never',
  '`git checkout <file>`. Report, do not fix. Kill anything you spawn.',
  '',
  'There is NO token budget and NO time limit. Do not summarise to save space. Findings are the',
  'product; the format serves them (briefing §5.1). WRITE INCREMENTALLY.',
].join('\n')

const LENSES = [
  ['missing-mechanisms.md', 'What mechanism does not exist that would raise the floor on a lazy model',
   'Work from evidence, in this order:\n\n' +
   '1. **Every ACCEPTED-ON-TRUST row in step 2\'s enforcement table.** For each, ask whether\n' +
   '   re-derivation is absent because it is IMPOSSIBLE or because NOBODY BUILT IT. Only the second\n' +
   '   is a GAP — and these are the highest-value entries in this review.\n' +
   '2. **Detection that could become prevention.** G7 is "detection over prevention", honestly\n' +
   '   disclosed. For each disclosed detection-only gap, ask whether prevention is now CHEAP given\n' +
   '   what has since been built — the composition root, the live gate snapshot and the marker\n' +
   '   enumeration make several things trivial that were expensive in the original design.\n' +
   '3. **Failures a human never sees.** Any failure whose only trace is an error-level journal line\n' +
   '   is a failure nobody notices. Every terminal state should hand a human an artifact. One such\n' +
   '   wedge was found and fixed (C-085); step 2\'s composition pass should have found more.\n' +
   '4. **Dumb mechanical cross-checks.** The highest-value additions in this build\'s history were\n' +
   '   boring: a control suite proving the fixture discriminates, an execution witness proving a\n' +
   '   test really ran, a two-way field-set comparison proving two spellings agree, a counter on the\n' +
   '   router\'s own ledger proving it was contacted. Where else is a boring cross-check available\n' +
   '   and absent?\n' +
   '5. **Self-diagnosis.** When a run goes wrong, how long does a human take to find out why? What\n' +
   '   is not recorded that must be reconstructed by hand?\n' +
   '6. **Advisory that could be structural.** The plan\'s best ideas make the wrong thing IMPOSSIBLE\n' +
   '   rather than forbidden — item FSM ordering, handler-run evidence, the single-writer rule.\n' +
   '   Where does the system still rely on a rule the model is ASKED to follow?\n\n' +
   'STRUCTURAL OR ADVISORY? is the field that matters most in each record.'],

  ['doctrine-efficacy.md', 'Will a 32k-context weak-instruction model actually follow these packs?',
   'Read all nine packs in conductor/doctrine/ (core, debug, decompose, plan, receive-review, review,\n' +
   'skeptic, tdd, test-vet) as if you WERE that model. Judge each individually and say so per pack:\n\n' +
   '  - Length: how many tokens, and what fraction of a 32k window does the pack plus its role\n' +
   '    context consume? What gets truncated first?\n' +
   '  - Which single instruction would the model drop first under context pressure, and what breaks\n' +
   '    when it does?\n' +
   '  - Which instructions are ABSTRACT where they could be PROCEDURAL? "Be rigorous" is unusable;\n' +
   '    "before claiming green, run X and paste the trailer" is followable.\n' +
   '  - Are any two packs contradictory, or does one assume something another forbids?\n' +
   '  - Is there a situation the model will CERTAINLY hit with no doctrine covering it? A missing\n' +
   '    pack is a GAP.\n' +
   '  - Does the pack tell the model what to do when it is STUCK, or only what to do when it works?\n\n' +
   'Ground your judgement in the build record where possible: are there corrections traceable to a\n' +
   'model not following doctrine it was given? Those are the empirical evidence for this lens.'],
]

phase('Capability lenses')
const results = []
for (let i = 0; i < LENSES.length; i += BATCH) {
  const batch = LENSES.slice(i, i + BATCH)
  const res = await parallel(batch.map(([f, t, b]) => () => agent([
    COMMON, '', `## YOUR SCOPE — ${t}`, '', b, '',
    '## YOUR OUTPUT', '',
    `Write **${PARTS}/${f}** (create the directory if needed). Skeleton first, then append.`,
    'Use GAP records per the briefing. Number them',
    `\`${f.replace(/\.md$/, '').toUpperCase()}-001\`… Include IDEA entries and a coverage ledger.`,
    'Return a SHORT summary only.',
  ].join('\n'), { label: `capability:${f.replace(/\.md$/, '')}`, phase: 'Capability lenses' })))
  results.push(...res)
  log(`batch ${Math.floor(i / BATCH) + 1}: ${res.filter(Boolean).length}/${batch.length} complete — parts on disk`)
}
log(`capability lenses complete: ${results.filter(Boolean).length}/${LENSES.length}`)

phase('Consolidate')
const consolidated = await agent([
  COMMON, '',
  '## YOUR SCOPE — the capability register AND the consolidated plan',
  '',
  `Read every file in ${PARTS}/, plus findings-enforcement.md and findings-macro.md, in full.`,
  '',
  'You have two jobs.',
  '',
  '### Job 1 — assemble the GAP register',
  'Merge the capability lenses: dedupe, reconcile severity and confidence to one standard, renumber',
  'into a single `GAP-NNN` sequence with a mapping table. **Enforce the grounding rule ruthlessly** —',
  'any GAP not tracing to a specific ISSUE, MACRO, correction or observed behaviour is marked',
  'SPECULATIVE and ranked below every grounded entry. Report how many you marked; that number is a',
  'signal about this review\'s discipline.',
  '',
  '### Job 2 — the consolidated plan',
  '',
  '**2a. Merge all three registers.** Dedupe across ISSUE/MACRO/GAP — the same defect may appear in',
  'two under different lenses; keep the strongest evidence and note both origins. Disposition EVERY',
  'cross-lens pointer from steps 2 and 3: became ISSUE-NNN / became GAP-NNN / investigated and',
  'cleared / still open and why. Reclassify freely (an IDEA that is a defect becomes an ISSUE; a',
  'MACRO that is one local bug becomes an ISSUE). Produce ONE unified table: id, title, type,',
  'severity, subsystem, effort, depends-on, blocks, one-line summary.',
  '',
  '**2b. Structure it.** Identify SYSTEMIC CLUSTERS — groups sharing one root cause where a single',
  'structural change closes several. **These are the highest-value items in the entire output**; step',
  '2\'s "WHY NOTHING CAUGHT IT" fields and step 3\'s correction clustering are where you find them.',
  'Build the dependency graph: what must land before what, which clusters are independent enough to',
  'run in parallel, which chains are serial. Separate out REQUIRES-A-LIVE-MODEL (cannot be scheduled',
  'freely) and BLOCKED-ON-A-DECISION (anything needing a plan amendment, schema change, or',
  'closed-vocabulary change — those are the owner\'s calls, not work items).',
  '',
  '**2c. The provisional plan.** Produce an ORDERED plan so the follow-up session has something to',
  'react to rather than a blank page. Order by the one criterion that is objective — **what would a',
  'lazy model exploit first** — then by dependency, then by cost. State the reasoning for each',
  'position briefly. Mark it clearly PROVISIONAL: it is a draft to be argued with.',
  '',
  '**2d. The decisions you did NOT make.** As important as the plan. List every choice you',
  'deliberately left open, each with its options, the tradeoff, and what evidence bears on it. At',
  'minimum: which findings are acceptable to leave unfixed and at what cost; which structural changes',
  'are worth their migration cost; anything requiring a plan amendment; any place two findings',
  'suggest CONFLICTING fixes; and how much of this to do at all. **DO NOT ANSWER THESE.** A follow-up',
  'interactive session (step 5) works through them with the repo owner, and that session will',
  're-order your provisional plan. Your job is to make the decisions visible and well-framed.',
  '',
  '## YOUR OUTPUT',
  '',
  `Write **${DIR}/findings-capability.md** with the structure 4-capability.md §Output specifies:`,
  'executive verdict, the GAP register, the doctrine assessment (all nine packs individually), the',
  'IDEA register, the unified register, systemic clusters, the dependency graph, the PROVISIONAL',
  'ordered plan, the open decisions, pointer disposition, coverage ledger, cleared areas.',
  '',
  'Add **MERGE NOTES** including how many GAPs you marked SPECULATIVE and what the three reviews did',
  'not cover between them.',
  '',
  `Leave ${PARTS}/ in place. Return a short summary: GAP count, total unified register size, the`,
  'systemic clusters you identified, and the top three items on the provisional plan.',
].join('\n'), { label: 'consolidate:findings-capability', phase: 'Consolidate' })

log(consolidated ? 'CONSOLIDATION COMPLETE -> docs/reviews/conductor-review/findings-capability.md' : 'RETURNED NOTHING')

return { lenses: results.filter(Boolean).length, consolidated: consolidated !== null, output: `${DIR}/findings-capability.md` }
