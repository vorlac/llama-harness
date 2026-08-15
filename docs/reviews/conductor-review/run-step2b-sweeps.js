export const meta = {
  name: 'conductor-review-step2b-sweeps',
  description: 'Step 2b: six cross-cutting enforcement sweeps, in small batches',
  phases: [{ title: 'Cross-cutting sweeps', detail: 'six sweeps, three at a time' }],
}

const REPO = '/Users/sal/development/vorlac/llama-harness'
const PARTS = `${REPO}/docs/reviews/conductor-review/parts`
const BATCH = 3 // small on purpose: a rate-limit kill takes 3 agents, not 6

const COMMON = [
  'You are one reviewer in a multi-agent enforcement review of the "conductor" codebase.',
  `Working directory: ${REPO}. All paths are relative to it.`,
  '',
  'READ THESE FIRST, IN FULL, BEFORE ANYTHING ELSE:',
  '  1. docs/reviews/conductor-review/1-briefing.md    — orientation, environment, traps, rules,',
  '     the P1-P13 defect taxonomy, the method, the exhaustiveness doctrine, known-open.',
  '  2. docs/reviews/conductor-review/2-enforcement.md — the full step-2 charter.',
  '',
  'They govern you completely. This prompt only assigns your SCOPE and tells you where to write.',
  'Where this prompt and those documents disagree, they win.',
  '',
  '## WRITE YOUR SKELETON FIRST — this is not optional and not a formality',
  '',
  'Within your FIRST FEW TOOL CALLS, before any deep reading, create your output file containing:',
  'a title, your scope, the date, and empty section headers. Then APPEND to it continuously as you',
  'work — every finding the moment you have it, not at the end.',
  '',
  'Why: this review may run into an account rate limit at any moment and be killed mid-flight. An',
  'agent that reads for twenty-five minutes and then dies having written nothing has burned those',
  'tokens for nothing. An agent that has been appending loses only its last few minutes. **Treat',
  'your output file as the deliverable and your context as scratch**, not the reverse.',
  '',
  'NON-NEGOTIABLES, repeated because these are the ones that cause damage if missed:',
  '  - NEVER touch .data/ or .out/ (~20 GB, unrecoverable). Never git commit/push/reset/clean.',
  '  - You MAY and SHOULD mutate source to test whether a check can fail. Snapshot with `cp`,',
  '    restore from the snapshot, prove with `cmp`. NEVER `git checkout <file>` — the tree may',
  '    carry uncommitted work.',
  '  - Never invoke `node --test` for a VERDICT (a zero-match glob exits 0 — a vacuous pass).',
  '    Gate through `bash scripts/test-conductor.sh`. Use `node --test --test-reporter=tap <file>`',
  '    only to READ failure messages.',
  '  - Kill anything you spawn. Before finishing:',
  '    ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\\.sleep" | grep -v grep',
  '  - Report, do not fix. You are reviewing.',
  '',
  'There is NO token budget and NO time limit. Read whole files. Repo-wide greps are encouraged.',
  'Do not summarise to save space. Do not stop early because you have "enough". Findings are the',
  'product; the format serves them (briefing §5.1).',
].join('\n')

function part(file, scopeTitle, scopeBody) {
  const ID = file.replace(/\.md$/, '').toUpperCase()
  return [
    COMMON, '',
    `## YOUR SCOPE — ${scopeTitle}`, '', scopeBody, '',
    '## YOUR OUTPUT', '',
    `Write **${PARTS}/${file}** (create the directory if needed). Skeleton first, then append.`,
    '',
    'Sections:',
    `  1. ISSUE entries for your scope, full records per the briefing field list, written`,
    `     explanatorily. Number them \`${ID}-001\`, -002, … so the merge can renumber without`,
    '     collisions.',
    '  2. IDEA entries (briefing §6.2) — anything that would improve things, however small.',
    '  3. CROSS-LENS POINTERS — one line each for anything belonging to the macro or capability',
    '     reviews, or to ANOTHER subsystem than yours. Do not chase them; do not drop them.',
    '  4. Your mutation table — every mutation applied, file, expectation, result, verdict.',
    '  5. Your coverage ledger — every file in your scope: what you did to it, how much you',
    '     covered, what you concluded. "Not examined" is permitted and expected where true.',
    '  6. Cleared areas — what you attacked and could NOT break, with the attacks named.',
    '',
    'Return a SHORT summary only: counts by severity, your file path, and the three findings you',
    'consider most important. The FILE is the deliverable, not your return value.',
  ].join('\n')
}

const SWEEPS = [
  ['sweep-vocabulary.md', 'Vocabulary inventory (P3)',
   'Build the FULL inventory: every closed enum, role name, tool name, journal event, stop kind,\n' +
   'anomaly kind, failure class, filename, path, glob, schema key and env var in the repo. For each:\n' +
   'name the file that OWNS it, list every other site, and say whether the other sites DERIVE it or\n' +
   'RESTATE it. Flag every restatement without a drift guard EVEN WHERE THE COPIES CURRENTLY AGREE —\n' +
   'that is the defect, not the disagreement. C-082, C-083, C-086 and C-081 are four instances that\n' +
   'each reached production; assume there are more.'],

  ['sweep-corrections.md', 'The 92-correction recurrence sweep',
   'Read docs/build/CORRECTIONS.md in full — all 92 entries. For EACH, extract the defect CLASS and\n' +
   'ask: does that class exist elsewhere in the repo, unfixed? This is mechanical and historically\n' +
   'the highest-yield sweep available, because the corrections are a map of how this system fails.\n' +
   'Produce a table: correction, class, where else you looked, what you found. Then re-open every\n' +
   'REFUTED finding in docs/build/GATES.json and artifacts/phase-gates-12-13-15-findings.md and ask\n' +
   'whether the evidence that settled it actually discriminates (P10 — one such refutation was a\n' +
   'confirmed false negative, then sealed with a do-not-re-litigate note).'],

  ['sweep-rows-and-tests.md', 'Assertion rows, test quality, reachability (P8, P12, P13)',
   'Every row in docs/build/specs/*.assertions.json against the tests that claim to prove it. Which\n' +
   'rows are named by a test title? Of those, which are actually PROVEN by that test\'s assertions —\n' +
   'read the row text and the assertions side by side. Which rows are unreachable or\n' +
   'self-contradictory? Then P12: enumerate every branch in the codebase requiring an unusual\n' +
   'precondition (a failure, cap, timeout, retry, degraded mode, second attempt, crash) and find the\n' +
   'test that reaches it; report every one with none. Phase 13 is known 22/42 named with four proven\n' +
   'by nothing — treat that as a floor and check every other spec file.'],

  ['sweep-gate-mutation.md', 'The verification audit — can every check fail? (Part B)',
   'THE HIGHEST-YIELD TASK IN THE REVIEW. For every gate, scanner, guard, source-audit test and\n' +
   'acceptance meter: mutate what it checks and confirm it goes red. If nothing goes red it is\n' +
   'decorative — that is a finding. Targets: scripts/test-conductor.sh, scripts/conductor-gate.sh\n' +
   '(M5), all 21 rows of scripts/verify-acceptance.sh (mutate each row\'s subject individually),\n' +
   'legaltools-callsites.test.ts, journal-vocab.test.ts, tool-binding.test.ts, composition.test.ts,\n' +
   'g5-artifact-check.ts, and every *-vocab / *-callsites / *-binding source audit. ALSO re-derive\n' +
   'the build\'s own claims: pick several tasks from docs/build/STATE.json, apply each recorded\n' +
   '`revertAssertion`, and confirm the suite goes red exactly as claimed — a revertAssertion that\n' +
   'does not produce its claimed red means the RECORDED EVIDENCE IS WRONG, which is serious.\n' +
   'For every mutation that DOES go red, note WHICH assertion caught it (P6).'],

  ['sweep-honesty.md', 'Build-record honesty and artifact audit (P9)',
   'Cross-check docs/build/STATE.json, GATES.json and CORRECTIONS.md against the actual tree. Do the\n' +
   'recorded commitShas exist and contain what is claimed? Is every COMMITTED/PASS true? Are\n' +
   'deferred and live-manual items disclosed honestly? Hunt specifically for FABRICATED EVIDENCE —\n' +
   'the build\'s stated worst failure. Examine every artifact under docs/build/artifacts/ for the\n' +
   'two-identical-arms shape (C-089: a recorded equivalence proof whose arms were the same command\n' +
   'run twice, differing only by a variable no source file reads). Verify the 17/21 acceptance claim\n' +
   'yourself by running scripts/verify-acceptance.sh.'],

  ['sweep-adversary.md', 'Simulate the lazy model (Part F)',
   'Be the adversary. With conductor/doctrine/*.md as your only instructions, try to: reach PUBLISHED\n' +
   'with the least real work; make a review finding disappear rather than fixing it; satisfy an\n' +
   'acceptance row\'s letter while violating its intent; produce a plausible artifact for a step you\n' +
   'did not perform; get a test to pass without the behaviour it names; spend the override budget to\n' +
   'route around a gate. Record what you got away with, step by step, with file:line. Then answer the\n' +
   'charter\'s central question explicitly: if a competent-but-lazy local model ran inside this\n' +
   'harness today, at which specific points could it produce plausible-looking but unverified work\n' +
   'the harness would accept as real?'],
]

phase('Cross-cutting sweeps')
const done = []
for (let i = 0; i < SWEEPS.length; i += BATCH) {
  const batch = SWEEPS.slice(i, i + BATCH)
  const res = await parallel(batch.map(([f, t, b]) => () =>
    agent(part(f, t, b), { label: `sweep:${f.replace(/\.md$/, '')}`, phase: 'Cross-cutting sweeps' })))
  done.push(...res)
  log(`batch ${Math.floor(i / BATCH) + 1}: ${res.filter(Boolean).length}/${batch.length} complete — parts written to disk`)
}

log(`STEP 2b COMPLETE: ${done.filter(Boolean).length}/${SWEEPS.length} sweeps in ${PARTS}/`)
log('NEXT: run-step2c-composition-merge.js')
return { sweeps: done.filter(Boolean).length, of: SWEEPS.length, parts: PARTS }
