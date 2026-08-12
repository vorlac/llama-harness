# HONEST-LIMITS accumulator (folded into conductor/docs/HONEST-LIMITS.md at Task 15.1)

Running list of known detection gaps and documented bypasses discovered during the
build, per G7 (detection over prevention, honestly documented). Task 15.1 must copy
§9 verbatim AND append these build-discovered items.

## Git-command detection gaps (Phase 1 gate, shell-parse primitives)

The git gate matches parsed tokens from a quote-aware split. Even after the Phase-1
hardening (gitSubcommand fails safe on unrecognized global flags; isGitCommand skips
env-assignment prefixes and env/command/sudo wrappers and resolves path basenames),
these residual bypasses remain and are DOCUMENTED, not prevented:

- **Backtick command substitution** — `` `git push` `` is not tokenized as a
  substitution boundary (only `$(...)` is, because `(` is in the operator set
  `;&|<>()`; backtick is not). A git write inside backticks is not seen as its own
  segment. Mitigation posture: models are instructed to the legal path; the harness
  gates tool calls, and a human at a raw terminal is ungated anyway (G7).
- **Alias injection** — `git -c alias.x='!git push' x` faithfully parses subcommand
  `x` (the plan mandates skipping `-c k=v`), then git runs the aliased `push`. Spec-level
  hole; the `-c` skip is required by plan line 2089.
- **Non-enumerated separate-value globals** beyond the handled set now DENY (fail-safe),
  which over-denies some legitimate reads (e.g. `git --work-tree /x status`) — the safe
  direction; the model can `conductor_surface` if genuinely needed.

## Freshness

- `verifyFreshFor` now treats a non-finite/undefined `startedMs` or any non-finite
  staged mtime as NOT fresh (fail-safe against the H4 stale-reads-fresh chain). The
  deeper guard — rejecting evidence records missing per-kind required fields
  (startedMs/head/green/scopes on a verify record) — is a Task 6.1 obligation
  (adapter/evidence.ts validates per-kind shape when reading), since the §2 merged-union
  schema intentionally leaves per-kind shape to the writer.

## classifyFailure causality (Task 6.1 rule-data obligation)

- Classification is text-only (the pinned pure signature carries no per-line causality),
  so a genuine unrelated crash whose text merely CONTAINS an assertion token, or an
  in-scope missing-module line co-occurring with an unrelated error, can be
  mis-binned. The conservative default is "error"; the residual over-permissive cases
  are bounded by the QUALITY of Task 6.1's runnerRules regex data (specific
  assertionPatterns, anchored unresolvedPatterns). Task 6.1 must ship tight,
  anchored rule data and test against real runner output (RUNNER-DISCOVERY.md).

## Update (Phase 5 gate, C-022)

The git gate now DENIES (fail-safe) any bash command whose command-word token carries an
unresolved shell-expansion sigil (backtick, `$'`, `$"`, `${`, `$(`, `$VAR`). So the earlier
"backtick substitution" and "alias injection" bypasses are now closed in the DENY direction
(they surface a question instead of executing). ANSI-C `$'literal'` and locale `$"literal"`
are additionally decoded by the tokenizer. Residual: this over-blocks a legitimate
`$VAR command` in a gated session (it surfaces rather than runs) — acceptable per G7. The
edit-scope write-shape detector remains an enumerated set (redirects incl. `>|`, tee, sed
-i, mv/cp, rm, perl -pi, dd of=, gawk -i inplace, ex/ed); a sufficiently obscure in-place
writer not on the list would classify as a read — documented G7 limit, disclosed here.
