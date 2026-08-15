export const meta = {
  name: 'conductor-review-step2a-subsystems',
  description: 'Step 2a: ten subsystem enforcement audits, in small batches',
  phases: [{ title: 'Subsystem audits', detail: 'ten audits, three at a time' }],
}

const REPO = '/Users/sal/development/vorlac/llama-harness'
const PARTS = `${REPO}/docs/reviews/conductor-review/parts`
const BATCH = 3 // small on purpose: a rate-limit kill takes 3 agents, not 10

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
   'stops.ts, types.ts, queue-amend.ts, tool-bindings.ts, journal-events.ts, commit-message.ts,\n' +
   'freshness.ts and any sibling; run `git ls-files conductor/core/` and account for every one.\n' +
   'Verify G3 (pure: no I/O, no clock, no network), the FSM transition tables, the closed\n' +
   'vocabularies against §2, legalTools derivation, the decision precedence ladder. Attack\n' +
   'RED-before-GREEN specifically: construct a path to GREEN without a genuine harness-observed RED.'],

  ['cpp-router.md', 'The C++ llama-router',
   'router/ — main.cpp, router.hpp, admission.hpp, affinity.hpp, config.hpp, metrics.hpp, cli.hpp,\n' +
   'schema-observer.hpp, version.hpp, and router/tests/. Build it and run ctest per the briefing.\n' +
   'Read it against plan §4.4: proxy pass-through VERBATIM including SSE, admission (cap -> queue ->\n' +
   '503 envelope), schema OBSERVATION never enforcement (never a 400 the direct path would not\n' +
   'return — the G5 fail-soft direction), the metrics ledger. **This subsystem has had the LEAST\n' +
   'review attention of anything in the repo; assume nothing has been checked.**'],

  ['scripts-python.md', 'EVERY file under scripts/',
   'ALL of scripts/ — you own the directory, not a list. Run `git ls-files scripts/` and account for\n' +
   'every entry. Named because they matter most: serve.py, conductor_wiring.py, fetch_models.py,\n' +
   'conductor_bench.py and the python tests — but also bench_presets.py, benchmark.py, hostinfo.py,\n' +
   'models_catalog.py, ui.py, watch-agents.sh and anything else present. The supervisor and its\n' +
   'restart policy, port resolution, session wiring, the router config writer, --print-env, the\n' +
   'orphan window between readiness and watchdog. C-087 and C-090 fixed defects here recently —\n' +
   'check whether the same CLASSES recur in the files those corrections did NOT touch. Audit\n' +
   'test-conductor.sh, conductor-gate.sh and verify-acceptance.sh as SUBJECTS (their own\n' +
   'correctness); their mutation-audit belongs to the cross-cutting sweep in step 2b.'],

  ['adapter-remainder-tools.md', 'The rest of adapter/, and conductor/tools/',
   'The adapter modules no other reviewer owns — run `git ls-files conductor/adapter/` and take\n' +
   'everything not claimed by the state, fan-out, handler or composition scopes. At minimum:\n' +
   'config-io.ts, questions.ts, worktrees.ts. PLUS all of conductor/tools/ — export-schemas.ts,\n' +
   'g5-equivalence.ts, g5-artifact-check.ts, replay.ts.\n' +
   'These are the least-examined files in the TypeScript tree precisely because they are nobody\'s\n' +
   'headline: config loading and its defaults, the §2.11 question ledger, the §4.2 worktree\n' +
   'lifecycle, the schema exporter the gate depends on, the journal replay tool, and the G5\n' +
   'equivalence driver (itself recent — C-089 — with one review at most).\n' +
   'Ask of each: what does it claim, what re-derives that claim, and what happens when it fails?'],
]

phase('Subsystem audits')
const done = []
for (let i = 0; i < SUBSYSTEMS.length; i += BATCH) {
  const batch = SUBSYSTEMS.slice(i, i + BATCH)
  const res = await parallel(batch.map(([f, t, b]) => () =>
    agent(part(f, t, b), { label: `audit:${f.replace(/\.md$/, '')}`, phase: 'Subsystem audits' })))
  done.push(...res)
  log(`batch ${Math.floor(i / BATCH) + 1}: ${res.filter(Boolean).length}/${batch.length} complete — parts written to disk`)
}

log(`STEP 2a COMPLETE: ${done.filter(Boolean).length}/${SUBSYSTEMS.length} subsystem audits in ${PARTS}/`)
log('NEXT: run-step2b-sweeps.js')
return { audits: done.filter(Boolean).length, of: SUBSYSTEMS.length, parts: PARTS }
