export const meta = {
  name: 'conductor-review-step3-macro',
  description: 'Step 3: the macro review — shape, organisation, design coherence — then merged',
  phases: [
    { title: 'Macro lenses', detail: 'navigability, layering, build-process, docs' },
    { title: 'Merge', detail: 'one findings-macro.md' },
  ],
}

const REPO = '/Users/sal/development/vorlac/llama-harness'
const DIR = `${REPO}/docs/reviews/conductor-review`
const BATCH = 2 // small on purpose: a rate-limit kill takes few agents
const PARTS = `${DIR}/parts-macro`

const COMMON = [
  'You are one reviewer in the MACRO review of the "conductor" codebase — step 3 of a five-step',
  'process.',
  `Working directory: ${REPO}. All paths are relative to it.`,
  '',
  'READ THESE FIRST, IN FULL:',
  '  1. docs/reviews/conductor-review/1-briefing.md      — orientation, environment, rules, the',
  '     P1-P13 taxonomy, method, exhaustiveness doctrine, known-open.',
  '  2. docs/reviews/conductor-review/3-macro.md         — the full step-3 charter.',
  '  3. docs/reviews/conductor-review/findings-enforcement.md — STEP 2 OUTPUT. This is your evidence',
  '     base. It carries reproduced defects, a mutation table, enumerations, and CROSS-LENS POINTERS',
  '     addressed to you. You argue FROM this, not from taste.',
  '',
  '**The evidence burden here is the highest of the three reviews**, precisely because structural',
  'opinions are the easiest to write persuasively without proof. Every finding needs a measurement,',
  'a pattern cited across at least three corrections, or a step-2 defect whose CAUSE is structural.',
  'A finding with none of those is an OPINION and must be labelled one.',
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
  'There is NO token budget and NO time limit. Read whole files. Do not summarise to save space.',
  'Findings are the product; the format serves them (briefing §5.1). WRITE INCREMENTALLY.',
].join('\n')

function part(file, scopeTitle, scopeBody) {
  return [
    COMMON, '',
    `## YOUR SCOPE — ${scopeTitle}`, '', scopeBody, '',
    '## YOUR OUTPUT', '',
    `Write **${PARTS}/${file}** (create the directory if needed). Use MACRO records per the briefing:`,
    'THE OBSERVATION (numbers where numbers exist) · THE CONSEQUENCE (tied to something that has',
    'actually happened) · WHY IT IS STRUCTURAL NOT LOCAL (if fixing instances would fix it, it is an',
    'ISSUE, not a MACRO) · WHAT A BETTER SHAPE LOOKS LIKE (with migration cost) · PLAN IMPACT ·',
    'WHAT WOULD CHANGE YOUR MIND (if you cannot name it, downgrade to OPINION).',
    `Number them \`${file.replace(/\.md$/, '').toUpperCase()}-001\`… Also include IDEA entries,`,
    'CROSS-LENS POINTERS for the capability review, and a coverage ledger.',
    '',
    'Return a SHORT summary only. The file is the deliverable.',
  ].join('\n')
}

const LENSES = [
  ['navigability.md', 'Organisation, judged by the system\'s own standard',
   'This project\'s thesis is that small, context-limited models can do good work here. So the\n' +
   'codebase must be NAVIGABLE by them, and that is measurable — so measure it.\n\n' +
   'Verify and extend these starting facts: conductor/adapter/tools.ts is ~9,253 lines;\n' +
   'conductor/tests/e2e.test.ts ~4,317; conductor/plugin/index.ts ~1,427; the immutable plan 3,399.\n' +
   'Every agent brief written during the build campaign carried an explicit "NEVER read this file\n' +
   'whole", and agents routinely had to be handed exact line ranges before they could begin.\n\n' +
   'Then answer WITH NUMBERS: can a 32k-context model do a task in this repo without being told\n' +
   'where to look? Pick several representative tasks — add a tool, change a gate arm, add an\n' +
   'assertion row, fix a handler bug — and determine what it would have to read to do each safely.\n' +
   'Count the tokens. Is there a discoverable path from "I need to change X" to the file owning X,\n' +
   'or does it require a repo-wide grep a context-limited model cannot afford? What does the current\n' +
   'decomposition COST — in tokens per task, in defects traceable to someone not having read enough\n' +
   '(step 2 findings and CORRECTIONS.md are evidence)? If tools.ts should be split, say along which\n' +
   'seams, what it would cost, and what would break. A proposal without a migration cost is not\n' +
   'actionable.'],

  ['layering-coherence.md', 'Layering, responsibility, and design coherence',
   'Is the G3 pure-core / thin-adapter split actually holding? Check dependency directions. Has any\n' +
   'core/ module grown I/O, a clock or network awareness? Has adapter/ accumulated decision logic\n' +
   'that belongs in core?\n\n' +
   'Where does responsibility for ONE concern live? The gate regime spans core/gates-*.ts,\n' +
   'adapter/tools.ts and plugin/index.ts — clean seam or smear? Several corrections are exactly "two\n' +
   'layers each believed the other owned this"; find them, count them, and say whether the boundary\n' +
   'or the discipline is at fault. Is the composition root the right size, and does it do only\n' +
   'composition? Do the parts share one philosophy, or are there competing ones (detection-over-\n' +
   'prevention in some places, prevention in others — principled or accidental)? Are there concepts\n' +
   'existing twice under different names at the DESIGN level (two mechanisms doing one job) rather\n' +
   'than the string level? Is the role decomposition right — 7 roles, 9 doctrine packs? Is the\n' +
   'run/item FSM pair the right abstraction, or does it force awkward states? Look at every recorded\n' +
   'deviation mentioning a state "settled but not finished"; C-084\'s wedge is one, find the rest.'],

  ['process-and-docs.md', 'The build process as a designed thing, plus documentation and operator experience',
   'The task gates (M1-M9), phase gates, blind lens fan-out and skeptic ladder are machinery that\n' +
   'produced this codebase. Step 2 audited whether they WORK; you ask whether they are WELL DESIGNED.\n\n' +
   '**CLUSTER ALL 92 CORRECTIONS BY ROOT CAUSE. This analysis is a required deliverable in itself.**\n' +
   'What do the biggest clusters say about where the DESIGN — not the implementation — is weak?\n' +
   'Which clusters would a different structure have prevented entirely? Given the machinery produced\n' +
   'a confirmed false negative and then sealed it (P10), what would you change about the gate regime?\n' +
   'Is the assertion-row mechanism working as intended — rows have been found unreachable,\n' +
   'self-contradictory and named-but-unproven; sound concept with poor discipline, or wrong concept?\n' +
   'Is the correction ledger itself navigable at 92 entries in one file?\n\n' +
   'Then documentation and operator experience: are conductor/docs/OPERATIONS.md and HONEST-LIMITS.md\n' +
   'accurate TODAY (phase 15 exists because they drifted once; ops-docs.test.ts now binds 25 rows —\n' +
   'does it bind enough)? Comment honesty: do comments describe what the code does or what someone\n' +
   'hoped? When a run goes wrong, what does a human SEE, and how long to find the cause? Which\n' +
   'failures leave nothing but an error-level journal line nobody reads?'],

  ['fitness-forward.md', 'Fitness for what comes next',
   'Two live tasks remain (13.2, 14.2) and THE SYSTEM HAS NEVER RUN AGAINST A REAL MODEL END TO END.\n' +
   'Read the design and say where you expect it to break on first contact, and why. Be specific —\n' +
   'name the file and the assumption.\n\n' +
   'What happens at 2x the tasks, 2x the tools, a second router backend? Which structures scale and\n' +
   'which are already at their limit? Does adding a tool, a role or a gate require touching one place\n' +
   'or five — measure it by tracing an actual addition. What would a second contributor, or a second\n' +
   'orchestrating agent, need that does not exist? Is the system\'s own growth sustainable?\n\n' +
   'Ground every claim in the step-2 findings or the correction record where you can; this lens is\n' +
   'the most speculative of the four and needs the most anchoring.'],
]

phase('Macro lenses')
const results = []
for (let i = 0; i < LENSES.length; i += BATCH) {
  const batch = LENSES.slice(i, i + BATCH)
  const res = await parallel(batch.map(([f, t, b]) => () =>
    agent(part(f, t, b), { label: `macro:${f.replace(/\.md$/, '')}`, phase: 'Macro lenses' })))
  results.push(...res)
  log(`batch ${Math.floor(i / BATCH) + 1}: ${res.filter(Boolean).length}/${batch.length} complete — parts on disk`)
}
log(`macro lenses complete: ${results.filter(Boolean).length}/${LENSES.length}`)

phase('Merge')
const merged = await agent([
  COMMON, '',
  '## YOUR SCOPE — assemble one macro findings document from four parts',
  '',
  `Read every file in ${PARTS}/ in full, plus findings-enforcement.md.`,
  '',
  '**Reconciliation, not concatenation.** Dedupe overlapping structural claims; reconcile severity',
  'and confidence to ONE standard; renumber into a single `MACRO-NNN` sequence with a mapping table',
  'from part-local ids; promote/demote between MACRO, ISSUE (send to the enforcement register as a',
  'pointer) and IDEA; resolve factual contradictions by checking yourself and recording which side',
  'was right.',
  '',
  '**Downgrade ruthlessly.** This is the review most prone to confident, unevidenced assertion. Any',
  'entry whose OBSERVATION carries no measurement, no cited pattern across >=3 corrections, and no',
  'step-2 defect as its cause must be labelled OPINION and ranked last. Say in MERGE NOTES how many',
  'you downgraded — that number is itself a useful signal about this review\'s rigour.',
  '',
  '## YOUR OUTPUT',
  '',
  `Write **${DIR}/findings-macro.md** with the structure 3-macro.md §Output specifies: executive`,
  'verdict, the MACRO register, the correction clustering (all 92), the navigability measurement,',
  'the IDEA register, CROSS-LENS POINTERS for the capability review, disposition of every pointer',
  'step 2 left for you, the coverage ledger, and cleared areas.',
  '',
  'Add **MERGE NOTES**: what you deduped, what you downgraded and why, contradictions resolved, and',
  'what the four lenses did NOT cover between them.',
  '',
  `Leave ${PARTS}/ in place as the audit trail. Return a short summary only.`,
].join('\n'), { label: 'merge:findings-macro', phase: 'Merge' })

log(merged ? 'MERGE COMPLETE -> docs/reviews/conductor-review/findings-macro.md' : 'MERGE RETURNED NOTHING')

return { lenses: results.filter(Boolean).length, merged: merged !== null, output: `${DIR}/findings-macro.md` }
