export const meta = {
  name: 'conductor-review-step2-enforcement',
  description: 'Step 2: the enforcement & correctness review, fanned out by subsystem then merged',
  phases: [
    { title: 'Subsystem audits', detail: 'nine parallel enforcement + mutation audits' },
    { title: 'Cross-cutting sweeps', detail: 'vocabulary, corrections, rows, gates, meta, adversary' },
    { title: 'Composition', detail: 'P7 hunt across subsystem boundaries' },
    { title: 'Merge', detail: 'one findings-enforcement.md' },
  ],
}

const REPO = '/Users/sal/development/vorlac/llama-harness'
const DIR = `${REPO}/docs/reviews/conductor-review`
const PARTS = `${DIR}/parts`

// Every agent reads the briefing and the step-2 prompt from disk rather than having them inlined,
// so those documents stay the single source (P3) and edits to them take effect without touching
// this script.
const COMMON = [
  'You are one reviewer in a multi-agent enforcement review of the "conductor" codebase.',
  `Working directory: ${REPO}. All paths are relative to it.`,
  '',
  'READ THESE FIRST, IN FULL, BEFORE ANYTHING ELSE:',
  '  1. docs/reviews/conductor-review/1-briefing.md   — orientation, environment, traps, rules,',
  '     the P1-P13 defect taxonomy, the method, the exhaustiveness doctrine, known-open.',
  '  2. docs/reviews/conductor-review/2-enforcement.md — the full step-2 charter.',
  '',
  'They govern you completely. This prompt only assigns your SCOPE within them and tells you where',
  'to write. Where this prompt and those documents disagree, they win.',
  '',
  'NON-NEGOTIABLES, repeated because they are the ones that cause damage if missed:',
  '  - NEVER touch .data/ or .out/ (~20 GB, unrecoverable). Never git commit/push/reset/clean.',
  '  - You MAY and SHOULD mutate source to test whether a check can fail. Snapshot with `cp`,',
  '    restore from the snapshot, prove with `cmp`. NEVER `git checkout <file>` — the tree may',
  '    carry uncommitted work.',
  '  - Never invoke `node --test` for a VERDICT (a zero-match glob exits 0 — a vacuous pass).',
  '    Gate through `bash scripts/test-conductor.sh`. You may use `node --test --test-reporter=tap',
  '    <file>` to READ failure messages.',
  '  - Kill anything you spawn. Before finishing:',
  '    ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\\.sleep" | grep -v grep',
  '  - Report, do not fix. You are reviewing.',
  '',
  'There is NO token budget and NO time limit. Read whole files. Repo-wide greps are encouraged.',
  'Do not summarise to save space. Do not stop early because you have "enough". Findings are the',
  'product; the format serves them (briefing §5.1).',
  '',
  'WRITE INCREMENTALLY. Append to your output file as you go, not in one pass at the end, so your',
  'work survives running out of context. If you run low, keep writing findings — never compress.',
].join('\n')

function part(file, scopeTitle, scopeBody) {
  return [
    COMMON,
    '',
    `## YOUR SCOPE — ${scopeTitle}`,
    '',
    scopeBody,
    '',
    '## YOUR OUTPUT',
    '',
    `Write **${PARTS}/${file}**. Create the directory if needed. This is the only file you may`,
    'create outside scratch.',
    '',
    'Structure it as:',
    '  1. ISSUE entries for your scope, full records per the briefing field list, written',
    '     explanatorily. Number them with YOUR OWN prefix so the merge can renumber without',
    `     collisions: use \`${file.replace(/\.md$/, '').toUpperCase()}-001\`, -002, …`,
    '  2. IDEA entries (briefing §6.2) — anything that would improve things, however small.',
    '  3. CROSS-LENS POINTERS — one line each for anything belonging to the macro or capability',
    '     reviews, or to ANOTHER subsystem than yours. Do not chase them; do not drop them.',
    '  4. Your mutation table — every mutation you applied, file, expectation, result, verdict.',
    '  5. Your coverage ledger — every file in your scope: what you did to it, how much you',
    '     covered, what you concluded. "Not examined" is permitted and expected where true.',
    '  6. Cleared areas — what you attacked and could NOT break, with the attacks named.',
    '',
    'Return a SHORT summary only: counts by severity, your file path, and the three findings you',
    'consider most important. The file is the deliverable, not your return value.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Phase 1 — subsystem audits. Boundaries chosen so every production file has exactly one owner.
// ---------------------------------------------------------------------------
const SUBSYSTEMS = [
  ['gates-security.md', 'The gate regime and security',
   'conductor/core/gates-git.ts, gates-edit.ts, gates-phase.ts, shell-parse.ts, and every call site\n' +
   'that reaches them. Attack the tokenizer: wrappers (env, sudo, bash -c), quoting ($\'…\', backticks,\n' +
   '${}), redirects (>, >|, tee, sed -i, perl -pi, dd of=), traversal (..), alias injection (git -c).\n' +
   'Try to get a destructive git command or an out-of-scope edit past the gate. Verify the DENY set\n' +
   'and the documented residuals (G7), and hunt for an UNDOCUMENTED bypass. Cover step-2 Part A\'s\n' +
   'gate-snapshot item and Part C\'s security item in full.'],

  ['state-crash.md', 'State store, evidence, quarantine, crash-safety',
   'conductor/adapter/state.ts, journal.ts, evidence.ts, quarantine.ts, gitio.ts. Torn writes, the\n' +
   'advisory lock (dead-pid, over-age, TOCTOU), atomic tmp+rename, cross-filesystem EXDEV, crash-safe\n' +
   'quarantine replay, no-clobber restore, out-of-repo isolation, the verify marker lifecycle.\n' +
   'SIMULATE CRASHES rather than reasoning about them — kill a write between tmp and rename in a\n' +
   'scratch harness and see whether the next read heals or corrupts. Also: can an evidence record be\n' +
   'forged, reused, or attributed to the wrong item/run/tree? Does anything check freshness?'],

  ['fanout-concurrency.md', 'Fan-out, continuation, router client, concurrency',
   'conductor/adapter/fanout.ts, continuation.ts, router-client.ts. The concurrency cap, the wave\n' +
   'barrier, the per-job watchdog (does it bound session.create AND the prompt?), watchdog-vs-\n' +
   'completion double-resolve, the freeze-hold (can a held write-capable job double-dispatch or\n' +
   'strand?), the failover latch, the §3.7 idle engine and its stop paths. Run the fan-out tests\n' +
   '10-20x as a flake sweep. Hunt leaks: fds, child processes, unbounded in-memory growth.'],

  ['tools-handlers-a.md', 'The handler layer, first half',
   'conductor/adapter/tools.ts — the INTAKE through GREEN half: classify, decompose, plan,\n' +
   'plan_review, dispatch_wave, submit_test, vet_test, mark_green, and the shared helpers they use.\n' +
   'tools.ts is 9,253 lines and is split across two reviewers; read YOUR half in full and skim the\n' +
   'other for context. For every handler: does it re-derive what the model claims, or accept it?\n' +
   'This is the heart of step-2 Part A.'],

  ['tools-handlers-b.md', 'The handler layer, second half',
   'conductor/adapter/tools.ts — VALIDATE through close: validate, item_review, publish, report,\n' +
   'the meta tools (surface, answer, defer, decide, queue_amend, inline_claim, override, status,\n' +
   'forget_stale), setup, and the wave driver. Same question: re-derived or accepted? Include the\n' +
   'override budget (§3.6) — can a model spend its way around a gate, and does exhaustion truly\n' +
   'stop the run rather than converting into another override?'],

  ['composition-injection.md', 'The composition root, injection, doctrine delivery',
   'conductor/plugin/index.ts, adapter/inject.ts, adapter/chat-message.ts, and conductor/doctrine/*.\n' +
   'Every one of the 7 roles must receive its §4.1 pack EVERY request (§6.4/G9). Apply P6: verify\n' +
   'the doctrine ARRIVES at the sub-session, not merely that a guard refuses when it is absent.\n' +
   'Verify the per-call gate snapshot derivation (fileScope/testScope/verifyInFlightTree) for every\n' +
   'role and both tree modes, and that every failure path derives NO scope rather than a permissive\n' +
   'default.'],

  ['core-logic.md', 'The pure core',
   'conductor/core/ — fsm-run.ts, fsm-item.ts, planning.ts, schedule.ts, decide.ts, verdict.ts,\n' +
   'stops.ts, types.ts, queue-amend.ts, tool-bindings.ts, journal-events.ts, commit-message.ts and\n' +
   'any sibling. Verify G3 (pure: no I/O, no clock, no network), the FSM transition tables, the\n' +
   'closed vocabularies against §2, legalTools derivation, the decision precedence ladder. Attack\n' +
   'RED-before-GREEN specifically: construct a path to GREEN without a genuine harness-observed RED.'],

  ['cpp-router.md', 'The C++ llama-router',
   'router/ — main.cpp, router.hpp, admission.hpp, affinity.hpp, config.hpp, metrics.hpp, cli.hpp,\n' +
   'schema-observer.hpp, and router/tests/. Build it and run ctest per the briefing. Read it against\n' +
   'plan §4.4: proxy pass-through VERBATIM including SSE, admission (cap -> queue -> 503 envelope),\n' +
   'schema OBSERVATION never enforcement (never a 400 the direct path would not return — the G5\n' +
   'fail-soft direction), the metrics ledger. This subsystem has had the LEAST review attention of\n' +
   'anything in the repo; assume nothing has been checked.'],

  ['scripts-python.md', 'EVERY file under scripts/',
   'ALL of scripts/ — you own the directory, not a list. Named because they matter most: serve.py,\n' +
   'conductor_wiring.py, fetch_models.py, conductor_bench.py, and the python tests. But also\n' +
   'bench_presets.py, benchmark.py, hostinfo.py, models_catalog.py, ui.py, watch-agents.sh and\n' +
   'anything else present — run `git ls-files scripts/` and account for every entry. The supervisor\n' +
   'and its restart policy, port resolution, session wiring, the router config writer, --print-env,\n' +
   'the orphan window between readiness and watchdog. C-087 and C-090 fixed defects here recently —\n' +
   'check whether the same CLASSES recur in the files those corrections did NOT touch. Audit\n' +
   'test-conductor.sh, conductor-gate.sh and verify-acceptance.sh as SUBJECTS (their own\n' +
   'correctness); their mutation-audit belongs to the cross-cutting pass.'],

  ['adapter-remainder-tools.md', 'The rest of adapter/, and conductor/tools/',
   'The adapter modules no other reviewer owns — run `git ls-files conductor/adapter/` and take\n' +
   'everything not claimed by the state, fan-out, handler or composition scopes. At minimum:\n' +
   'config-io.ts, questions.ts, worktrees.ts. PLUS all of conductor/tools/ — export-schemas.ts,\n' +
   'g5-equivalence.ts, g5-artifact-check.ts, replay.ts.\n' +
   'These are the least-examined files in the TypeScript tree precisely because they are nobody\'s\n' +
   'headline: config loading and its defaults, the §2.11 question ledger, the §4.2 worktree\n' +
   'lifecycle, the schema exporter the gate depends on, the journal replay tool, and the G5\n' +
   'equivalence driver (which is itself recent — C-089 — and has had one review at most).\n' +
   'Ask of each: what does it claim, what re-derives that claim, and what happens when it fails?'],
]

// ---------------------------------------------------------------------------
// Phase 2 — cross-cutting sweeps. These span subsystems and cannot be assigned to one owner.
// ---------------------------------------------------------------------------
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
   'confirmed false negative that was then sealed with a do-not-re-litigate note).'],

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
   'does not produce its claimed red means the recorded evidence is wrong, which is serious.\n' +
   'For every mutation that DOES go red, note WHICH assertion caught it (P6).'],

  ['sweep-honesty.md', 'Build-record honesty and artifact audit (P9)',
   'Cross-check docs/build/STATE.json, GATES.json and CORRECTIONS.md against the actual tree. Do the\n' +
   'recorded commitShas exist and contain what is claimed? Is every COMMITTED/PASS true? Are\n' +
   'deferred and live-manual items disclosed honestly? Hunt specifically for FABRICATED EVIDENCE —\n' +
   'the build\'s stated worst failure. Examine every artifact under docs/build/artifacts/ for the\n' +
   'two-identical-arms shape (C-089: a recorded equivalence proof whose arms were the same command\n' +
   'run twice, differing only by a variable no source file reads). Verify the 17/21 acceptance\n' +
   'claim yourself by running scripts/verify-acceptance.sh.'],

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

phase('Subsystem audits')
const subsystemResults = await parallel(
  SUBSYSTEMS.map(([file, title, body]) => () =>
    agent(part(file, title, body), { label: `audit:${file.replace(/\.md$/, '')}`, phase: 'Subsystem audits' })),
)
log(`subsystem audits complete: ${subsystemResults.filter(Boolean).length}/${SUBSYSTEMS.length}`)

phase('Cross-cutting sweeps')
const sweepResults = await parallel(
  SWEEPS.map(([file, title, body]) => () =>
    agent(part(file, title, body), { label: `sweep:${file.replace(/\.md$/, '')}`, phase: 'Cross-cutting sweeps' })),
)
log(`cross-cutting sweeps complete: ${sweepResults.filter(Boolean).length}/${SWEEPS.length}`)

// ---------------------------------------------------------------------------
// Phase 3 — composition. Fan-out's known blind spot: defects that live BETWEEN subsystems.
// ---------------------------------------------------------------------------
phase('Composition')
const composition = await agent([
  COMMON,
  '',
  '## YOUR SCOPE — composition defects across subsystem boundaries (P7)',
  '',
  'Fifteen reviewers have just audited this system, each inside one subsystem. **You hunt what none',
  'of them could see: defects that exist only in the seams between correct components.**',
  '',
  `FIRST read every file in ${PARTS}/ — the subsystem audits and the cross-cutting sweeps. They are`,
  'your map of what each part does and where each reviewer stopped.',
  '',
  'The archetype is C-085, and it is worth understanding before you start. Three rules, each right in',
  'isolation: a blocked dependency is deliberately NOT "stuck" (so conductor_report correctly',
  'refuses) · the dependent is not schedulable (so the gate recommends nothing) · the continuation',
  'engine returns without prompting when nothing is recommended (reasoning soundly that counting a',
  'non-prompt as a futile re-prompt would be a lie). Net effect: a run that CAN NEVER EXIT and CAN',
  'NEVER BE DETECTED — the exact wedge §3.7 exists to end, and the one shape it could not see. No',
  'single-subsystem review would ever have found it.',
  '',
  'Method:',
  '  - For every terminal, exit and escalation path in the system, construct the state where each',
  '    guard says "not mine" and ask who is left holding it. Does the run end with an artifact a',
  '    human receives, or go quiet?',
  '  - For every handoff between two subsystems, ask what each side ASSUMES the other does, and',
  '    whether that assumption is checked anywhere.',
  '  - Look for responsibilities that fall between layers: several corrections are exactly "two',
  '    layers each believed the other owned this".',
  '  - Re-read every CROSS-LENS POINTER the fifteen reviewers left that names another SUBSYSTEM —',
  '    those are seam leads they could not follow.',
  '',
  'Reproduce what you find. A composition defect argued but not demonstrated is a suspicion.',
  '',
  '## YOUR OUTPUT',
  '',
  `Write **${PARTS}/composition.md**, same structure as the other parts, with ids \`COMPOSITION-001\`…`,
  'Return a short summary only.',
].join('\n'), { label: 'composition:P7-seams', phase: 'Composition' })
log(composition ? 'composition pass complete' : 'COMPOSITION PASS RETURNED NOTHING')

// ---------------------------------------------------------------------------
// Phase 4 — merge. Reconciliation, not concatenation.
// ---------------------------------------------------------------------------
phase('Merge')
const merged = await agent([
  COMMON,
  '',
  '## YOUR SCOPE — assemble one findings document from sixteen parts',
  '',
  `Read EVERY file in ${PARTS}/ in full. Sixteen reviewers produced them: nine subsystem audits, six`,
  'cross-cutting sweeps, and one composition pass.',
  '',
  '**This is reconciliation, not concatenation.** A merge that simply appends the parts has failed.',
  'Specifically:',
  '  - **Dedupe.** The same defect will appear in several parts under different framings — a',
  '    subsystem reviewer and the vocabulary sweep may both have found one drift. Merge them, keep',
  '    the STRONGEST evidence (a reproduction beats a read-verification), and note every origin.',
  '  - **Reconcile severity.** Reviewers graded independently and will disagree. Where two parts',
  '    rate the same defect differently, decide and say why. Apply one consistent standard across',
  '    the whole register.',
  '  - **Renumber** into a single `ISSUE-NNN` sequence, ordered so related issues sit together.',
  '    Keep a mapping table from each part-local id to its final id — later reviews cite these.',
  '  - **Promote and demote.** An IDEA that is really a defect becomes an ISSUE; an ISSUE that is',
  '    really a structural problem becomes a CROSS-LENS POINTER to the macro review.',
  '  - **Resolve contradictions.** Where two parts disagree on a FACT, go and check it yourself,',
  '    and record which was right. Do not paper over it.',
  '',
  '## YOUR OUTPUT',
  '',
  `Write **${DIR}/findings-enforcement.md** — the step-2 deliverable — with the structure the`,
  'charter (2-enforcement.md §Output) specifies: executive verdict, the unified ISSUE register, the',
  'IDEA register, CROSS-LENS POINTERS for the macro and capability reviews, the enforcement table,',
  'the merged mutation table, the enumerations, the adversary log, the honesty audit, the coverage',
  'ledger (union of all sixteen, so gaps between reviewers are VISIBLE), and cleared areas.',
  '',
  'Add a section **MERGE NOTES**: what you deduped, what severities you reconciled and how, what',
  'contradictions you resolved and which side was right, and — importantly — **what the parts did',
  'NOT cover between them.** Seventeen reviewers with assigned scopes will still leave seams; name',
  'them so the macro and capability reviews know where the floor is.',
  '',
  '**MANDATORY COVERAGE ASSERTION — do this mechanically, not by impression.** The scope assignment',
  'in this workflow was written by hand and is therefore exactly the kind of partition that looks',
  'complete and is not (defect pattern P1, the most common in this codebase — one such gap was',
  'already found and patched in this very script before it ran). So verify it:',
  '',
  '  1. Run `git ls-files` and take every production file under conductor/{core,adapter,plugin,',
  '     tools}/, router/ and scripts/ — excluding conductor/tests/.',
  '  2. Union the coverage ledgers from every part file.',
  '  3. **List every production file that appears in NO coverage ledger.** Name them explicitly in',
  '     MERGE NOTES under "UNOWNED FILES".',
  '',
  'An unowned file is not a small bookkeeping matter — it is a region of the system this review did',
  'not look at, and the whole point of the coverage ledger is that such regions are VISIBLE rather',
  'than silently absent. If the list is non-empty, say so plainly at the TOP of the document, in the',
  'executive verdict, so nobody mistakes this review for exhaustive when it is not.',
  '',
  `Leave ${PARTS}/ in place. It is the audit trail for this document.`,
  '',
  'Return a short summary: total issues by severity, how many were duplicates, and the three most',
  'important findings.',
].join('\n'), { label: 'merge:findings-enforcement', phase: 'Merge' })

log(merged ? 'MERGE COMPLETE -> docs/reviews/conductor-review/findings-enforcement.md' : 'MERGE RETURNED NOTHING')

return {
  subsystems: subsystemResults.filter(Boolean).length,
  sweeps: sweepResults.filter(Boolean).length,
  composition: composition !== null,
  merged: merged !== null,
  output: `${DIR}/findings-enforcement.md`,
  parts: PARTS,
}
