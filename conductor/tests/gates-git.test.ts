// Task 5.1 red tests — lives at conductor/tests/gates-git.test.ts.
// Subject: conductor/core/gates-git.ts (MUST NOT exist when this goes red; the
// failure is `Cannot find module '../core/gates-git.ts'` — the missing-subject
// shape, a legal red per §2.6.1, NOT a SyntaxError in this file).
//
// This is the git DENY MATRIX — the single most security-critical gate in the
// harness. A missing allow row only annoys a model (it surfaces a question); a
// missing deny row lets `git apply` write arbitrary files straight around the
// edit-scope gate (§3.5 line 1367-1368). The suite is therefore exhaustive and
// biased toward proving DENY.
//
// Spec (read verbatim, never paraphrased):
//   - plan §3.5 lines 1362-1385 — THE NORMATIVE git deny matrix: the exhaustive
//     read-only allow-list, the explicit deny rows, DEFAULT-DENY for any
//     subcommand not named, and the false-positive guards.
//   - plan Task 5.1 lines 2324-2349 — the interface + the full enumerated row list.
//   - docs/build/specs/task-5.1.assertions.json — the 7 assertion rows
//     (5.1-api, 5.1-matrix, 5.1-false-positives, 5.1-new-denies, 5.1-allows,
//     5.1-default-deny, 5.1-branch-policy) AND the phaseGate1Bindings findings.
//
// Expected export surface (what the implementer of core/gates-git.ts must match):
//
//   type GitAction = "allow" | "deny";
//   interface GitDecision { action: GitAction; reason?: string }
//   function decideGit(
//     command: string,          // the RAW bash command; decideGit tokenizes it
//     sessionRole: string,      // the calling session's role (git policy is
//                               //   role-uniform for model sessions — the handler
//                               //   runs git via execFile and never reaches here)
//     gitMode: GitMode,         // config git.mode: "read-only"|"commit"|"commit-and-push"
//     runActive: boolean,       // a non-terminal run exists (§2.3)
//     branchPolicy: BranchPolicy // config git.branchPolicy: "pin"|"check-only"
//   ): GitDecision;
//
// How it MUST consume the command (phaseGate1Bindings MUST): decideGit tokenizes
// the RAW string with the §1.2 quote-aware splitter, splits on operators/newlines,
// and decides over the FULL parsed token segment — NOT solely gitSubcommand's
// single-word return. Every segment is scanned; ANY denied git segment denies the
// whole command. Detection sees through env-assignment prefixes (`A=b git …`),
// one wrapper (`env`/`command`/`sudo`/`builtin`/`exec`), and path basenames
// (`/usr/bin/git`, `./git`). A deny carries a `reason` naming the violated rule
// and the legal alternative (§3.5 line 1338).
//
// This test intentionally imports ONLY the subject: decideGit tokenizes
// internally, so the raw-command interface needs nothing from core/shell-parse.ts.
// That keeps the red a clean single missing-module failure.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { decideGit } from "../core/gates-git.ts";

// ---------------------------------------------------------------------------
// Local literal types mirroring the §2.1 config (core/types.ts GitMode /
// BranchPolicy). Declared locally — house style (see gates-phase.test.ts) — so
// the ONLY missing module in the red is the subject itself.
// ---------------------------------------------------------------------------

type GitMode = "read-only" | "commit" | "commit-and-push";
type BranchPolicy = "pin" | "check-only";

interface GitCtx {
  role?: string;
  mode?: GitMode;
  runActive?: boolean;
  branchPolicy?: BranchPolicy;
}

// Canonical operating context: a configured repo, a model (implementer)
// session, a live run, default branch policy "pin". Every enumerated row is
// invariant to role/mode (git write denies from every model session regardless,
// because the publish handler never reaches this gate); the branch-movement rows
// are the only ones that read runActive/branchPolicy, and those override below.
const decide = (command: string, ctx: GitCtx = {}) =>
  decideGit(
    command,
    ctx.role ?? "implementer",
    ctx.mode ?? "commit",
    ctx.runActive ?? true,
    ctx.branchPolicy ?? "pin",
  );

// A deny MUST carry a non-empty reason (§3.5: `throw new Error(reason)`), which
// names the violated rule. Returns the decision so callers can further pin the
// reason text where the spec fixes it.
const expectDeny = (command: string, ctx: GitCtx = {}) => {
  const d = decide(command, ctx);
  assert.equal(d.action, "deny", `MUST DENY: ${command}`);
  assert.equal(typeof d.reason, "string", `deny MUST carry a reason: ${command}`);
  assert.ok((d.reason ?? "").length > 0, `deny reason MUST be non-empty: ${command}`);
  return d;
};

const expectAllow = (command: string, ctx: GitCtx = {}) => {
  const d = decide(command, ctx);
  assert.equal(d.action, "allow", `MUST ALLOW: ${command}`);
  return d;
};

// A newline-separated compound (the second §3.5 compound guard). Kept as a
// named constant so the raw newline is unmistakable in the source.
const NEWLINE_COMPOUND = "echo staging\ngit reset --hard";

// ===========================================================================
// [5.1-api] the return contract: {action:"allow"|"deny", reason?}, reason a
// string on every deny.
// ===========================================================================

describe("[5.1-api] decideGit return shape", () => {
  test("an allow returns action 'allow'", () => {
    const d = decide("git status");
    assert.equal(d.action, "allow");
    assert.ok(d.action === "allow" || d.action === "deny", "action is the closed union");
  });

  test("a deny returns action 'deny' with a string reason", () => {
    const d = decide("git push");
    assert.equal(d.action, "deny");
    assert.equal(typeof d.reason, "string");
    assert.ok((d.reason ?? "").length > 0, "the reason names the violated rule");
  });
});

// ===========================================================================
// [5.1-false-positives] the verbatim §3.5 guards. Parsed-token matching, NEVER
// substring regex — verb words inside paths/messages must not misfire, and
// message words must not be mistaken for destructive subcommands.
// ===========================================================================

describe("[5.1-false-positives] parsed-token guards (never substring regex)", () => {
  test("git add src/config.ts denies as `add`, reason names conductor_publish (verb-word path)", () => {
    const d = expectDeny("git add src/config.ts");
    assert.match(d.reason ?? "", /conductor_publish/, "staging is conductor_publish's job");
  });

  test("git log --grep config ALLOWS (`config` is --grep's value, not a config write)", () => {
    expectAllow("git log --grep config");
  });

  test("git stash push -m drop denies (staging is publish's; `drop` is -m's value, not a stash action)", () => {
    const d = expectDeny("git stash push -m drop");
    assert.match(d.reason ?? "", /conductor_publish/, "staging is conductor_publish's job");
  });

  test("git stash list ALLOWS (the two-word allow side of stash)", () => {
    expectAllow("git stash list");
  });

  test('git commit -m "fix reset logic" denies WITH the publish reason (not a `reset` false positive)', () => {
    const d = expectDeny('git commit -m "fix reset logic"');
    assert.match(d.reason ?? "", /conductor_publish/, "commit denies as publish, not as destructive `reset`");
  });

  test("echo hi && git reset --hard denies (every operator-split segment is scanned)", () => {
    expectDeny("echo hi && git reset --hard");
  });

  test("newline-separated compound denies (the newline is an operator too)", () => {
    expectDeny(NEWLINE_COMPOUND);
  });

  test("git push origin +main denies (+refspec force push)", () => {
    expectDeny("git push origin +main");
  });

  test("git push origin :main denies (:refspec delete push)", () => {
    expectDeny("git push origin :main");
  });

  test("git restore --staged src/a.ts ALLOWS (index-only restore)", () => {
    expectAllow("git restore --staged src/a.ts");
  });

  test("git restore --staged --worktree src/a.ts denies (--worktree discards the working tree)", () => {
    expectDeny("git restore --staged --worktree src/a.ts");
  });
});

// ===========================================================================
// [5.1-matrix] staging & publishing are conductor_publish's job. §3.5 lines
// 1373-1374: git add/mv/rm/stash push deny (staging), git commit in ANY spelling
// denies (publishing). The reason names conductor_publish — the legal alternative.
// ===========================================================================

describe("[5.1-matrix] staging/publishing deny → reason names conductor_publish", () => {
  const publishRows: Array<{ name: string; cmd: string }> = [
    { name: "git mv", cmd: "git mv old.ts new.ts" },
    { name: "git rm", cmd: "git rm src/x.ts" },
    { name: "git commit -m", cmd: 'git commit -m "wip"' },
    { name: "git commit --amend (a commit spelling)", cmd: "git commit --amend --no-edit" },
  ];
  for (const row of publishRows) {
    test(`${row.name} denies, reason names conductor_publish`, () => {
      const d = expectDeny(row.cmd);
      assert.match(d.reason ?? "", /conductor_publish/, `${row.cmd} names the legal alternative`);
    });
  }

  test("git push (plain) denies (handler-only, mode-gated — never from a model session)", () => {
    expectDeny("git push");
  });
});

// ===========================================================================
// [5.1-new-denies] the destructive / history-mutating / network-mutating rows
// and the write-paths-around-the-edit-gate rows (§3.5 line 1376-1377). One test
// per §3.5 row. `git apply` is the single most important row in the whole gate.
// ===========================================================================

describe("[5.1-new-denies] destructive / write-around-gate subcommands deny", () => {
  test("git apply patch.diff denies — THE most important row (writes files around the edit gate)", () => {
    expectDeny("git apply patch.diff");
  });

  const denyRows: Array<{ name: string; cmd: string }> = [
    { name: "reset", cmd: "git reset --hard" },
    { name: "rebase", cmd: "git rebase main" },
    { name: "filter-branch", cmd: "git filter-branch --tree-filter true HEAD" },
    { name: "filter-repo", cmd: "git filter-repo --path src" },
    { name: "clean", cmd: "git clean -fd" },
    { name: "merge", cmd: "git merge feature" },
    { name: "cherry-pick", cmd: "git cherry-pick abc1234" },
    { name: "revert", cmd: "git revert HEAD" },
    { name: "am", cmd: "git am patch.mbox" },
    { name: "update-ref", cmd: "git update-ref refs/heads/main HEAD" },
    { name: "symbolic-ref", cmd: "git symbolic-ref HEAD refs/heads/x" },
    { name: "sparse-checkout set", cmd: "git sparse-checkout set src" },
    { name: "submodule update", cmd: "git submodule update" },
    { name: "bisect start", cmd: "git bisect start" },
    { name: "gc --prune=now", cmd: "git gc --prune=now" },
    { name: "prune", cmd: "git prune" },
    { name: "reflog expire", cmd: "git reflog expire --all" },
    { name: "notes", cmd: "git notes add -m note HEAD" },
    { name: "replace", cmd: "git replace a b" },
    { name: "fetch", cmd: "git fetch" },
    { name: "pull", cmd: "git pull" },
    { name: "remote set-url", cmd: "git remote set-url origin git@x:y.git" },
    { name: "tag -d", cmd: "git tag -d v1" },
    { name: "config <k> <v>", cmd: "git config user.email x" },
    { name: "worktree add", cmd: "git worktree add /tmp/x" },
  ];
  for (const row of denyRows) {
    test(`git ${row.name} denies`, () => {
      expectDeny(row.cmd);
    });
  }
});

// ===========================================================================
// [5.1-allows] the EXHAUSTIVE read-only allow-list (§3.5 line 1372). One test
// per row. Anything here that also has a two-word discriminator is re-pinned in
// the phaseGate section below.
// ===========================================================================

describe("[5.1-allows] the read-only allow-list allows", () => {
  const allowRows: Array<{ name: string; cmd: string }> = [
    { name: "status", cmd: "git status" },
    { name: "log", cmd: "git log --oneline -n 5" },
    { name: "diff", cmd: "git diff" },
    { name: "show", cmd: "git show HEAD" },
    { name: "branch (bare list form)", cmd: "git branch" },
    { name: "branch --list (explicit list form)", cmd: "git branch --list feat/*" },
    { name: "ls-files", cmd: "git ls-files" },
    { name: "ls-tree", cmd: "git ls-tree HEAD" },
    { name: "rev-parse", cmd: "git rev-parse HEAD" },
    { name: "rev-list --count", cmd: "git rev-list --count HEAD" },
    { name: "cat-file -p", cmd: "git cat-file -p HEAD" },
    { name: "blame", cmd: "git blame src/a.ts" },
    { name: "shortlog", cmd: "git shortlog" },
    { name: "describe", cmd: "git describe" },
    { name: "grep", cmd: "git grep TODO" },
    { name: "stash list", cmd: "git stash list" },
    { name: "worktree list", cmd: "git worktree list" },
    { name: "remote -v", cmd: "git remote -v" },
    { name: "config --get", cmd: "git config --get user.name" },
    { name: "config --list", cmd: "git config --list" },
    { name: "reflog show", cmd: "git reflog show" },
  ];
  for (const row of allowRows) {
    test(`git ${row.name} allows`, () => {
      expectAllow(row.cmd);
    });
  }
});

// ===========================================================================
// [5.1-default-deny] the rule that makes the table's completeness a non-issue:
// ANY subcommand not on the read-only allow-list or an explicit row denies by
// DEFAULT, with the reason NAMING the subcommand (so the model can surface it).
// ===========================================================================

describe("[5.1-default-deny] unknown subcommands default-deny, reason names the subcommand", () => {
  test("git frobnicate denies by default, reason names `frobnicate`", () => {
    const d = expectDeny("git frobnicate");
    assert.match(d.reason ?? "", /frobnicate/, "the reason names the unrecognized subcommand");
  });

  test("git obliterate . denies by default, reason names `obliterate` (default-deny is general)", () => {
    const d = expectDeny("git obliterate .");
    assert.match(d.reason ?? "", /obliterate/, "the reason names the unrecognized subcommand");
  });
});

// ===========================================================================
// [5.1-branch-policy] branch movement (`switch <br>`, `checkout <br>`,
// `checkout -b`) denies while a run is non-terminal under branchPolicy "pin"
// (the default), allows under "check-only", allows under "pin" with no active
// run (§3.5 line 1380). The force-create forms (`switch -C`, `checkout -B`) and
// the worktree-discarding forms are UNCONDITIONAL denies (§3.5 line 1378) — they
// ignore branch policy entirely.
// ===========================================================================

describe("[5.1-branch-policy] branch movement is policy-gated; discard forms are not", () => {
  test("git switch feature denies under pin + run active (the default posture)", () => {
    expectDeny("git switch feature", { branchPolicy: "pin", runActive: true });
  });

  test("git switch feature ALLOWS under check-only (publish's HEAD check catches it instead)", () => {
    expectAllow("git switch feature", { branchPolicy: "check-only", runActive: true });
  });

  test("git switch feature ALLOWS under pin with NO active run", () => {
    expectAllow("git switch feature", { branchPolicy: "pin", runActive: false });
  });

  test("git checkout feature denies under pin + run active (branch movement, same as switch)", () => {
    expectDeny("git checkout feature", { branchPolicy: "pin", runActive: true });
  });

  test("git checkout feature ALLOWS under check-only", () => {
    expectAllow("git checkout feature", { branchPolicy: "check-only", runActive: true });
  });

  test("git checkout feature ALLOWS under pin with NO active run", () => {
    expectAllow("git checkout feature", { branchPolicy: "pin", runActive: false });
  });

  test("git checkout -b feature denies under pin + run active (branch movement creates a ref)", () => {
    expectDeny("git checkout -b feature", { branchPolicy: "pin", runActive: true });
  });

  // Force-create and worktree-discard forms deny even under the MOST permissive
  // policy (check-only) and with NO active run — proving they are unconditional,
  // never branch-policy-gated.
  const unconditionalDiscards: Array<{ name: string; cmd: string }> = [
    { name: "switch -C (force-create)", cmd: "git switch -C feature" },
    { name: "checkout -B (force-create)", cmd: "git checkout -B feature" },
    { name: "checkout -- <path> (discards worktree file)", cmd: "git checkout -- src/a.ts" },
    { name: "checkout . (discards all worktree changes)", cmd: "git checkout ." },
    { name: "checkout <ref> <path> (multi-operand, discards worktree file)", cmd: "git checkout HEAD src/a.ts" },
    { name: "restore <path> without --staged (discards worktree file)", cmd: "git restore src/a.ts" },
  ];
  for (const row of unconditionalDiscards) {
    test(`git ${row.name} denies UNCONDITIONALLY (check-only + no active run)`, () => {
      expectDeny(row.cmd, { branchPolicy: "check-only", runActive: false });
    });
  }
});

// ===========================================================================
// phaseGate1Bindings (confirmed Phase-1 security findings). The deny matrix MUST
// be decided over the FULL parsed token segment, NOT solely gitSubcommand's
// single-word return. Each two-word discriminator is pinned on BOTH sides.
// ===========================================================================

describe("[5.1-phasegate] two-word discriminators — decided over full tokens, not one word", () => {
  // The REQUIRED false-ALLOW trap: keying the decision on gitSubcommand alone
  // ("branch", on the read-only allow-list) would ALLOW a branch deletion. It
  // MUST deny — this is the dangerous false-allow the gate exists to prevent.
  test("git branch -D x MUST DENY even though `branch` is on the read-only allow-list", () => {
    expectDeny("git branch -D x");
  });

  const discriminatorPairs: Array<{ pair: string; allow: string; denies: string[] }> = [
    {
      pair: "stash: list vs push/drop/clear",
      allow: "git stash list",
      denies: ["git stash push", "git stash drop", "git stash clear"],
    },
    {
      pair: "worktree: list vs add/remove",
      allow: "git worktree list",
      denies: ["git worktree add /tmp/x", "git worktree remove /tmp/x"],
    },
    {
      pair: "remote: -v vs add/set-url/remove",
      allow: "git remote -v",
      denies: [
        "git remote add origin git@x:y.git",
        "git remote set-url origin git@x:y.git",
        "git remote remove origin",
      ],
    },
    {
      pair: "config: --get/--list vs <k> <v>/--unset",
      allow: "git config --get user.name",
      denies: ["git config user.email x", "git config --unset user.email"],
    },
    {
      pair: "reflog: show vs expire",
      allow: "git reflog show",
      denies: ["git reflog expire --all"],
    },
    {
      pair: "branch: list vs -d/-D/-M",
      allow: "git branch",
      denies: ["git branch -d old", "git branch -D old", "git branch -M main"],
    },
    {
      pair: "checkout: <branch> vs -- / . / multi-operand / -b",
      // NB: the plain <branch> allow side is only true when policy permits, so it
      // is pinned under check-only; the deny forms are unconditional / movement.
      allow: "git checkout feature",
      denies: ["git checkout -- src/a.ts", "git checkout .", "git checkout HEAD src/a.ts"],
    },
    {
      pair: "restore: --staged vs --staged --worktree",
      allow: "git restore --staged src/a.ts",
      denies: ["git restore --staged --worktree src/a.ts"],
    },
  ];

  for (const group of discriminatorPairs) {
    test(`${group.pair} → allow side allows`, () => {
      // The checkout <branch> allow requires a permissive policy; every other
      // allow side is context-free.
      expectAllow(group.allow, { branchPolicy: "check-only", runActive: false });
    });
    for (const denyCmd of group.denies) {
      test(`${group.pair} → deny side: ${denyCmd}`, () => {
        expectDeny(denyCmd);
      });
    }
  }
});

// ===========================================================================
// [5.1-git-detection] the git-detection hardening: env-assignment prefixes,
// one command wrapper, and path basenames are all seen through, so these are all
// git-WRITE commands that MUST be detected and DENIED. (Backtick-substitution and
// alias-injection residuals are documented in honest-limits-pending.md, G7, not
// asserted as caught.)
// ===========================================================================

describe("[5.1-git-detection] env/wrapper/path spellings of git writes are detected + denied", () => {
  const spellings: Array<{ name: string; cmd: string }> = [
    { name: "env-assignment prefix: A=b git push", cmd: "A=b git push" },
    { name: "env wrapper: env git push", cmd: "env git push" },
    { name: "command wrapper (behind it: apply!): command git apply x", cmd: "command git apply x" },
    { name: "sudo wrapper: sudo git push", cmd: "sudo git push" },
    { name: "absolute path basename: /usr/bin/git push", cmd: "/usr/bin/git push" },
    { name: "relative path basename: ./git push", cmd: "./git push" },
    { name: "value-flag global: git --namespace foo push", cmd: "git --namespace foo push" },
    { name: "value-flag global: git --work-tree /x rm", cmd: "git --work-tree /x rm" },
  ];
  for (const row of spellings) {
    test(`${row.name} denies`, () => {
      expectDeny(row.cmd);
    });
  }
});

// ===========================================================================
// [5.1-wrapper-flags] a wrapper WITH ITS OWN FLAGS must not hide a git write.
// The Phase-1 unwrap only skipped a BARE wrapper word, so `sudo -u bob git push`
// read its command word as `-u`/`bob` — isGitCommand returned false and the write
// was ALLOWED. The fix skips the wrapper's own options (and a value-taking flag's
// value) before taking the command word, so the git invocation behind the flags is
// detected. Crucially the command word must be found CORRECTLY, not blanket-denied:
// `sudo -u bob git status` still ALLOWS (status is read-only) — proving the fix
// identifies `git status`, not that every wrapped command denies.
// ===========================================================================

describe("[5.1-wrapper-flags] a wrapper with its own flags never hides a git write", () => {
  const denies: Array<{ name: string; cmd: string }> = [
    { name: "sudo -u bob git push (value-flag -u consumes bob)", cmd: "sudo -u bob git push" },
    { name: "env -i git push (non-value flag -i)", cmd: "env -i git push" },
    { name: "command -p git commit -m x (command flag -p)", cmd: "command -p git commit -m x" },
    { name: "sudo -u bob git apply patch.diff (write-around-gate behind flags)", cmd: "sudo -u bob git apply patch.diff" },
    { name: "env FOO=bar git push (env NAME=value assignment then git)", cmd: "env FOO=bar git push" },
    { name: "sudo --user=bob git rm x (self-contained --flag=value)", cmd: "sudo --user=bob git rm x" },
  ];
  for (const row of denies) {
    test(`${row.name} denies`, () => {
      expectDeny(row.cmd);
    });
  }

  // The proof the command word is found CORRECTLY (not blanket-denied): a
  // read-only git command behind a flagged wrapper still ALLOWS, exactly as it
  // would bare. If the fix merely denied everything behind a flagged wrapper,
  // these would wrongly deny.
  test("sudo -u bob git status ALLOWS (read-only git found behind the wrapper's flags — not blanket-denied)", () => {
    expectAllow("sudo -u bob git status");
  });

  test("env -i git log ALLOWS (read-only git behind an env flag)", () => {
    expectAllow("env -i git log");
  });

  test("sudo -u bob ls ALLOWS (a non-git command behind a flagged wrapper is not gated as git)", () => {
    expectAllow("sudo -u bob ls");
  });

  // Fail-safe: a wrapper whose own options consume the whole segment leaves the
  // real command word unknowable statically — DENY rather than treat as non-git.
  test("sudo -u bob (wrapper + options, no command word left) denies fail-safe", () => {
    const d = expectDeny("sudo -u bob");
    assert.match(d.reason ?? "", /unresolvable|expansion/i);
  });

  // Controls that MUST stay correct after the widening: the BARE-wrapper denies
  // and the env-assignment/path spellings are unchanged.
  test("control: bare sudo git push still denies", () => {
    expectDeny("sudo git push");
  });
  test("control: bare env git push still denies", () => {
    expectDeny("env git push");
  });
  test("control: A=b git push still denies", () => {
    expectDeny("A=b git push");
  });
  test("control: /usr/bin/git push still denies", () => {
    expectDeny("/usr/bin/git push");
  });
});

// ===========================================================================
// Non-git guards: a substring "git" that is NOT in command position must NOT be
// gated as git (proving the "NEVER substring regex" rule the OTHER direction —
// no false DENY), and per-segment scanning must let an allowed read through in a
// compound while still denying a write segment elsewhere.
// ===========================================================================

describe("[5.1-non-git-guards] substring `git` off command position never false-denies", () => {
  test("echo git status ALLOWS (git is an echo argument, not the command word)", () => {
    expectAllow("echo git status");
  });

  test("cat tools/git/helper.txt ALLOWS (git is a path segment, not the command word)", () => {
    expectAllow("cat tools/git/helper.txt");
  });

  test("grep push src/x.ts ALLOWS (no git command at all)", () => {
    expectAllow("grep push src/x.ts");
  });

  test("git status && echo done ALLOWS (a read-only git segment in a compound stays allowed)", () => {
    expectAllow("git status && echo done");
  });

  test("git log && git push DENIES (per-segment: an allowed read does not rescue a later write)", () => {
    expectDeny("git log && git push");
  });
});

// ===========================================================================
// [5.1-unresolvable-command-word] a command word whose real value is produced
// by shell expansion the static parser cannot evaluate — an ANSI-C `$'…'`
// escape residual (`$'\x67it'` → git only after the shell decodes it), a
// variable (`$x`), a backtick command substitution, or a `${…}` brace splice
// glued into the word — smuggles a git write past command-word detection. Every
// such segment DENIES fail-safe, with the reason naming the unresolvable
// expansion. The sigil must be checked in COMMAND POSITION only: `echo $HOME`
// carries the sigil in an operand, not the command word, so it still allows.
// ===========================================================================

describe("[5.1-unresolvable-command-word] shell expansion in command position denies fail-safe", () => {
  const denies: Array<{ name: string; cmd: string }> = [
    { name: "ANSI-C escape residual: $'\\x67it' push", cmd: "$'\\x67it' push" },
    { name: "variable in command position: x=git; $x push", cmd: "x=git; $x push" },
    { name: "backtick command substitution: `git push`", cmd: "`git push`" },
    { name: "brace splice glued into the word: g${e}it push", cmd: "g${e}it push" },
  ];
  for (const row of denies) {
    test(`${row.name} denies, reason names the unresolvable expansion`, () => {
      const d = expectDeny(row.cmd);
      assert.match(
        d.reason ?? "",
        /unresolvable|expansion/i,
        `${row.cmd}: the reason names the unresolvable command-word expansion`,
      );
    });
  }

  test("control: echo $HOME ALLOWS (the sigil is in an operand, not the command word)", () => {
    expectAllow("echo $HOME");
  });

  test("control: git status ALLOWS (a clean command word carries no expansion)", () => {
    expectAllow("git status");
  });
});

// ===========================================================================
// [5.1-checkout-switch-discard] `-f`/`--force`/`--discard-changes` on
// checkout/switch discard tracked working-tree changes — UNCONDITIONAL denies
// like `switch -C`/`checkout -B`. They must ignore branchPolicy entirely and
// deny even under the most permissive posture (check-only, no active run).
// ===========================================================================

describe("[5.1-checkout-switch-discard] force/discard-changes forms deny unconditionally", () => {
  const discards: Array<{ name: string; cmd: string }> = [
    { name: "checkout -f", cmd: "git checkout -f" },
    { name: "checkout --force", cmd: "git checkout --force" },
    { name: "switch -f", cmd: "git switch -f main" },
    { name: "switch --force", cmd: "git switch --force main" },
    { name: "switch --discard-changes", cmd: "git switch --discard-changes main" },
  ];
  for (const row of discards) {
    test(`git ${row.name} denies UNCONDITIONALLY (check-only + no active run)`, () => {
      expectDeny(row.cmd, { branchPolicy: "check-only", runActive: false });
    });
  }

  test("control: git switch feature (no discard flag) still ALLOWS under check-only", () => {
    expectAllow("git switch feature", { branchPolicy: "check-only", runActive: false });
  });
});

// ===========================================================================
// [5.1-config-exec] ISSUE-015 — `git -c <key>=<command>` runs ARBITRARY COMMANDS
// behind a clean `git` command word and a read-only subcommand. `gitSubcommand`
// skips `-c k=v` (plan line 2089 mandates the skip), lands on `log`/`diff`, and
// the read-only allow-list allows — then git executes the configured pager,
// external diff, editor, credential helper, hook, or alias. The sigil-deny never
// engages because the command word is the literal `git`. Every row here is a real
// arbitrary-command-execution route the gate MUST deny; the controls prove the
// deny is keyed on the EXEC-capable key, not on `-c` itself.
// ===========================================================================

describe("[5.1-config-exec] -c config keys whose value git EXECUTES deny", () => {
  const execRows: Array<{ name: string; cmd: string }> = [
    { name: "core.pager (the reported repro)", cmd: "git -c core.pager=touch\\ pwned log" },
    { name: "diff.external", cmd: "git -c diff.external=id diff" },
    { name: "core.pager behind a decoy inert -c", cmd: "git -c pager.log=false -c core.pager=id log" },
    { name: "sequence.editor", cmd: "git -c sequence.editor=id log" },
    { name: "uploadpack.packObjectsHook", cmd: "git -c uploadpack.packObjectsHook=id log" },
    { name: "core.editor", cmd: "git -c core.editor=id log" },
    { name: "core.sshCommand", cmd: "git -c core.sshCommand=id log" },
    { name: "core.hooksPath", cmd: "git -c core.hooksPath=/tmp/evil log" },
    { name: "credential.helper", cmd: "git -c credential.helper='!sh -c id' log" },
    { name: "alias.x (the route the disclosure claimed closed)", cmd: "git -c alias.x='!git push' log" },
    { name: "diff.<driver>.command", cmd: "git -c diff.mine.command=id diff" },
    { name: "diff.<driver>.textconv", cmd: "git -c diff.mine.textconv=id log" },
    { name: "filter.<f>.clean", cmd: "git -c filter.f.clean=id log" },
    { name: "filter.<f>.smudge", cmd: "git -c filter.f.smudge=id log" },
    { name: "merge.<d>.driver", cmd: "git -c merge.d.driver=id log" },
    { name: "difftool.<t>.cmd", cmd: "git -c difftool.t.cmd=id diff" },
    { name: "gpg.program", cmd: "git -c gpg.program=id log" },
    { name: "remote.<r>.uploadpack", cmd: "git -c remote.origin.uploadpack=id log" },
    { name: "trailer.<t>.command", cmd: "git -c trailer.sign.command=id log" },
    { name: "key case is not a bypass (CORE.PAGER)", cmd: "git -c CORE.Pager=id log" },
  ];
  for (const row of execRows) {
    test(`git -c ${row.name} denies (config-driven arbitrary execution)`, () => {
      expectDeny(row.cmd);
    });
  }

  // The deny is keyed on the exec-capable KEY. An inert `-c` still allows, so the
  // fix is not "deny every -c" wearing a security costume.
  const inertRows: Array<{ name: string; cmd: string }> = [
    { name: "user.name", cmd: "git -c user.name=x log" },
    { name: "color.ui", cmd: "git -c color.ui=never log" },
    { name: "diff.algorithm", cmd: "git -c diff.algorithm=histogram diff" },
    { name: "core.fileMode", cmd: "git -c core.fileMode=false status" },
  ];
  for (const row of inertRows) {
    test(`control: git -c ${row.name} still ALLOWS (an inert config key is not execution)`, () => {
      expectAllow(row.cmd);
    });
  }

  test("control: git -C /repo status still ALLOWS (-C is a directory, not config)", () => {
    expectAllow("git -C /repo status");
  });

  test("control: git --git-dir=/r/.git log still ALLOWS", () => {
    expectAllow("git --git-dir=/r/.git log");
  });

  test("git --exec-path=/tmp/evil log denies (git would dispatch its subcommand binary from there)", () => {
    expectDeny("git --exec-path=/tmp/evil log");
  });
});

// ===========================================================================
// [5.1-config-exec-env] The same execution class through the ENVIRONMENT rather
// than `-c`: an env-assignment prefix is SEEN THROUGH by command-word detection
// (so the segment reads as git) but its VALUE was never adjudicated, and
// `GIT_PAGER=<cmd> git log` executes exactly what `-c core.pager=<cmd>` does.
// ===========================================================================

describe("[5.1-config-exec-env] exec-capable env prefixes on a git segment deny", () => {
  const envRows: Array<{ name: string; cmd: string }> = [
    { name: "GIT_PAGER", cmd: "GIT_PAGER=id git log" },
    { name: "GIT_EXTERNAL_DIFF", cmd: "GIT_EXTERNAL_DIFF=id git diff" },
    { name: "GIT_SSH_COMMAND", cmd: "GIT_SSH_COMMAND=id git log" },
    { name: "GIT_EDITOR", cmd: "GIT_EDITOR=id git log" },
    { name: "GIT_SEQUENCE_EDITOR", cmd: "GIT_SEQUENCE_EDITOR=id git log" },
    { name: "GIT_ASKPASS", cmd: "GIT_ASKPASS=id git log" },
    { name: "GIT_EXEC_PATH", cmd: "GIT_EXEC_PATH=/tmp/evil git log" },
    { name: "GIT_CONFIG_PARAMETERS", cmd: "GIT_CONFIG_PARAMETERS='core.pager=id' git log" },
    { name: "GIT_CONFIG_KEY_0 (numbered config injection)", cmd: "GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=id GIT_CONFIG_COUNT=1 git log" },
    { name: "GIT_CONFIG_GLOBAL", cmd: "GIT_CONFIG_GLOBAL=/tmp/evil.cfg git log" },
    { name: "PAGER (git falls back to it)", cmd: "PAGER=id git log" },
    { name: "GIT_PAGER behind the env wrapper", cmd: "env GIT_PAGER=id git log" },
  ];
  for (const row of envRows) {
    test(`${row.name} denies (environment-driven arbitrary execution)`, () => {
      expectDeny(row.cmd);
    });
  }

  test("control: A=b git status still ALLOWS (an ordinary env prefix is not execution)", () => {
    expectAllow("A=b git status");
  });

  test("control: GIT_PAGER=id ls ALLOWS (no git segment at all)", () => {
    expectAllow("GIT_PAGER=id ls");
  });
});

// ===========================================================================
// [5.1-dashed-plumbing] ISSUE-019 — git's own dashed dispatch form. `git apply`
// IS `git-apply`, and where git-core sits on PATH the hyphenated binary writes
// exactly what the denied spaced form writes. Basename equality against "git"
// never saw it.
// ===========================================================================

describe("[5.1-dashed-plumbing] git-<subcommand> binaries are detected as git", () => {
  const denies: Array<{ name: string; cmd: string }> = [
    { name: "git-apply p.diff (writes files around the edit gate)", cmd: "git-apply p.diff" },
    { name: "git-push", cmd: "git-push" },
    { name: "git-reset --hard", cmd: "git-reset --hard" },
    { name: "git-commit -m x", cmd: "git-commit -m x" },
    { name: "git-add src/a.ts", cmd: "git-add src/a.ts" },
    { name: "git-branch -D old (operands still decide the discriminated form)", cmd: "git-branch -D old" },
    { name: "absolute path: /usr/libexec/git-core/git-apply p.diff", cmd: "/usr/libexec/git-core/git-apply p.diff" },
    { name: "behind a wrapper: sudo git-push", cmd: "sudo git-push" },
    { name: "in a compound: git log && git-apply p.diff", cmd: "git log && git-apply p.diff" },
  ];
  for (const row of denies) {
    test(`${row.name} denies`, () => {
      expectDeny(row.cmd);
    });
  }

  test("git-status ALLOWS (the dashed form maps to the read-only subcommand, not a blanket deny)", () => {
    expectAllow("git-status");
  });

  test("control: digit-apply p.diff ALLOWS (a basename merely ENDING in git- is not git)", () => {
    expectAllow("digit-apply p.diff");
  });
});

// ===========================================================================
// [5.1-branch-list-only] ISSUE-020 — the `branch` allow arm admitted everything
// that was not on a hand-list of mutating flags, so bare branch CREATION (a ref
// write) allowed and the `=`-glued `--set-upstream-to=x` slipped past the exact
// token comparison. Only the LIST forms are read-only.
// ===========================================================================

describe("[5.1-branch-list-only] only list forms of git branch allow", () => {
  const denies: Array<{ name: string; cmd: string }> = [
    { name: "bare creation: git branch newbranch", cmd: "git branch newbranch" },
    { name: "creation from a start point: git branch feature main", cmd: "git branch feature main" },
    { name: "=-glued upstream: --set-upstream-to=origin/x", cmd: "git branch --set-upstream-to=origin/x" },
    { name: "space upstream: --set-upstream-to origin/x", cmd: "git branch --set-upstream-to origin/x" },
    { name: "-u origin/x main", cmd: "git branch -u origin/x main" },
    { name: "--unset-upstream", cmd: "git branch --unset-upstream" },
    { name: "--track feat origin/main", cmd: "git branch --track feat origin/main" },
    { name: "--edit-description", cmd: "git branch --edit-description" },
    { name: "-d old", cmd: "git branch -d old" },
    { name: "-D old", cmd: "git branch -D old" },
    { name: "-M main", cmd: "git branch -M main" },
    { name: "-c old copy", cmd: "git branch -c old copy" },
    { name: "-f feature main", cmd: "git branch -f feature main" },
  ];
  for (const row of denies) {
    test(`${row.name} denies (a ref write is not a list form)`, () => {
      expectDeny(row.cmd);
    });
  }

  const allows: Array<{ name: string; cmd: string }> = [
    { name: "bare list", cmd: "git branch" },
    { name: "--list with a pattern", cmd: "git branch --list feat/*" },
    { name: "-a", cmd: "git branch -a" },
    { name: "-r", cmd: "git branch -r" },
    { name: "-v", cmd: "git branch -v" },
    { name: "-vv", cmd: "git branch -vv" },
    { name: "--all --verbose", cmd: "git branch --all --verbose" },
    { name: "--show-current", cmd: "git branch --show-current" },
    { name: "--contains HEAD (value-taking list filter)", cmd: "git branch --contains HEAD" },
    { name: "--merged main (value-taking list filter)", cmd: "git branch --merged main" },
    { name: "--points-at HEAD", cmd: "git branch --points-at HEAD" },
    { name: "--sort=-committerdate", cmd: "git branch --sort=-committerdate" },
    { name: "--format with a glued value", cmd: "git branch --format=%(refname)" },
  ];
  for (const row of allows) {
    test(`control: git branch ${row.name} still ALLOWS (a read-only list form)`, () => {
      expectAllow(row.cmd);
    });
  }

  // Phase IV residual (P5): `-l` was treated as the pattern-taking `--list`, so a
  // positional beside it read as a match pattern and allowed. `-l` means
  // `--create-reflog` on git < 2.28, where `git branch -l topic` CREATES `topic` —
  // a ref write, admitted by a gate that had decided the operand was a pattern.
  // The gate cannot see which git is on the other side of the call, so the
  // spelling that means two things in two versions is read as the writing one.
  const ambiguousShortList: Array<{ name: string; cmd: string }> = [
    { name: "-l with a positional: git branch -l topic", cmd: "git branch -l topic" },
    { name: "-l with a glob-looking positional", cmd: "git branch -l feat/*" },
    { name: "-l after a list flag", cmd: "git branch -a -l topic" },
  ];
  for (const row of ambiguousShortList) {
    test(`${row.name} denies — on git < 2.28 the same spelling CREATES the branch (--create-reflog)`, () => {
      expectDeny(row.cmd);
    });
  }

  test("control: the unambiguous spellings are unaffected — `git branch --list topic` allows and bare `git branch -l` allows", () => {
    expectAllow("git branch --list topic");
    expectAllow("git branch --list feat/*");
    // A bare `-l` writes nothing under either reading: `--create-reflog` needs a
    // branch name to create a reflog for, and `--list` without a pattern lists.
    expectAllow("git branch -l");
  });
});

// ===========================================================================
// [5.1-checkout-patch] ISSUE-021 — `git checkout -p` / `--patch` discards
// working-tree hunks and moves no HEAD, so publish's HEAD check cannot see the
// loss. It belongs with the other unconditional worktree-discard forms, not on
// the policy-gated movement path where `check-only` allowed it. The sibling
// `git restore -p` already denies.
// ===========================================================================

describe("[5.1-checkout-patch] checkout -p/--patch denies unconditionally", () => {
  const discards: Array<{ name: string; cmd: string }> = [
    { name: "checkout -p", cmd: "git checkout -p" },
    { name: "checkout --patch", cmd: "git checkout --patch" },
    { name: "checkout -p <path>", cmd: "git checkout -p src/a.ts" },
    { name: "checkout --patch HEAD", cmd: "git checkout --patch HEAD" },
    { name: "checkout -p behind the dashed form", cmd: "git-checkout -p" },
  ];
  for (const row of discards) {
    test(`git ${row.name} denies under the MOST permissive posture (check-only, no active run)`, () => {
      expectDeny(row.cmd, { branchPolicy: "check-only", runActive: false });
    });
  }

  test("control: git restore -p denies too (the sibling this row was measured against)", () => {
    expectDeny("git restore -p src/a.ts", { branchPolicy: "check-only", runActive: false });
  });

  test("control: git checkout feature still ALLOWS under check-only (movement, not a discard)", () => {
    expectAllow("git checkout feature", { branchPolicy: "check-only", runActive: false });
  });
});
