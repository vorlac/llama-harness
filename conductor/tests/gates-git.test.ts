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
