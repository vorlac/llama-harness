// Task 1.2 — tests for core/shell-parse.ts (plan lines 2085-2099).
// Expected export surface:
//   shellTokens(command: string): string[]
//   splitOnOperators(tokens: string[]): string[][]
//   isGitCommand(seg: string[]): boolean
//   gitSubcommand(seg: string[]): string | null
//   globMatch(pattern: string, path: string): boolean
//   scopesIntersect(globsA: string[], globsB: string[]): boolean
// Git-policy context (plan lines 1362-1385): the bash gate matches PARSED TOKENS from a
// quote-aware split — never substring regex — so these tables pin command-position
// detection and the false-positive guards (verb words inside paths must not match).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  shellTokens,
  splitOnOperators,
  isGitCommand,
  gitSubcommand,
  globMatch,
  scopesIntersect,
} from "../core/shell-parse.ts";

describe("shellTokens", () => {
  test("[1.2-tokens] splits plain words on whitespace", () => {
    assert.deepEqual(shellTokens("git status"), ["git", "status"]);
  });

  type TokenCase = { name: string; command: string; expected: string[] };

  const operatorRunCases: TokenCase[] = [
    { name: "&& run is one standalone token", command: "a && b", expected: ["a", "&&", "b"] },
    { name: "|| run glued to words still splits", command: "a||b", expected: ["a", "||", "b"] },
    { name: "single pipe is standalone", command: "a | b", expected: ["a", "|", "b"] },
    { name: "semicolon with spaces is standalone", command: "a ; b", expected: ["a", ";", "b"] },
    { name: "output redirect glued to words splits", command: "a>out", expected: ["a", ">", "out"] },
    { name: "input redirect is standalone", command: "a < in", expected: ["a", "<", "in"] },
    { name: "parens split off the words they hug", command: "(a)", expected: ["(", "a", ")"] },
    {
      name: "mixed operator run >& emits as a single run token",
      command: "a 2>&1",
      expected: ["a", "2", ">&", "1"],
    },
  ];
  for (const c of operatorRunCases) {
    test(`[1.2-tokens] operator runs: ${c.name}`, () => {
      assert.deepEqual(shellTokens(c.command), c.expected);
    });
  }

  test("[1.2-glued] glued metachars split: 'a.cpp;git' -> a.cpp / ; / git", () => {
    assert.deepEqual(shellTokens("a.cpp;git"), ["a.cpp", ";", "git"]);
  });

  test("[1.2-quoted] double-quoted spaces preserved as one token (quotes stripped)", () => {
    assert.deepEqual(shellTokens('git commit -m "two words"'), [
      "git",
      "commit",
      "-m",
      "two words",
    ]);
  });

  test("[1.2-quoted] single-quoted spaces preserved as one token (quotes stripped)", () => {
    assert.deepEqual(shellTokens("echo 'a b c'"), ["echo", "a b c"]);
  });

  test("[1.2-tokens] metachars inside double quotes are not operators", () => {
    assert.deepEqual(shellTokens('echo "a;b"'), ["echo", "a;b"]);
  });

  test("[1.2-tokens] metachars inside single quotes are not operators", () => {
    assert.deepEqual(shellTokens("echo 'x && y'"), ["echo", "x && y"]);
  });

  test("[1.2-tokens] backslash-escaped space joins one token", () => {
    assert.deepEqual(shellTokens("printf a\\ b"), ["printf", "a b"]);
  });

  test("[1.2-tokens] backslash-escaped metachar is not an operator", () => {
    assert.deepEqual(shellTokens("echo a\\;b"), ["echo", "a;b"]);
  });

  test("[1.2-newline] newline emits as a standalone token", () => {
    assert.deepEqual(shellTokens("git status\ngit log"), [
      "git",
      "status",
      "\n",
      "git",
      "log",
    ]);
  });
});

describe("splitOnOperators", () => {
  test("[1.2-split] a single segment passes through as one string[]", () => {
    assert.deepEqual(splitOnOperators(["git", "status"]), [["git", "status"]]);
  });

  test("[1.2-split] splits at operator tokens and drops the operators", () => {
    assert.deepEqual(
      splitOnOperators(["git", "add", "x", ";", "git", "commit"]),
      [
        ["git", "add", "x"],
        ["git", "commit"],
      ],
    );
  });

  test("[1.2-split] chained && and || yield three segments", () => {
    assert.deepEqual(splitOnOperators(["a", "&&", "b", "||", "c"]), [["a"], ["b"], ["c"]]);
  });

  test("[1.2-split] redirect target becomes its own segment", () => {
    assert.deepEqual(splitOnOperators(["git", "diff", ">", "out.txt"]), [
      ["git", "diff"],
      ["out.txt"],
    ]);
  });

  test("[1.2-split] leading/trailing operators produce no empty segments", () => {
    assert.deepEqual(splitOnOperators(["(", "cd", "x", "&&", "make", ")"]), [
      ["cd", "x"],
      ["make"],
    ]);
  });

  test("[1.2-newline] newline token acts as a command separator", () => {
    assert.deepEqual(splitOnOperators(shellTokens("git status\ngit log")), [
      ["git", "status"],
      ["git", "log"],
    ]);
  });
});

describe("isGitCommand / gitSubcommand", () => {
  test("[1.2-git] git in command position is detected", () => {
    assert.equal(isGitCommand(["git", "status"]), true);
  });

  test("[1.2-git] non-git command is not detected", () => {
    assert.equal(isGitCommand(["ls", "-la"]), false);
  });

  test("[1.2-git] git NOT in command position is not detected (parsed tokens, not substrings)", () => {
    assert.equal(isGitCommand(["echo", "git", "status"]), false);
  });

  test("[1.2-git] a path merely containing 'git' is not detected (no substring matching)", () => {
    assert.equal(isGitCommand(["cat", "tools/git/helper.txt"]), false);
  });

  test("[1.2-git] bare git is a git command with no subcommand", () => {
    assert.equal(isGitCommand(["git"]), true);
    const sub: string | null = gitSubcommand(["git"]);
    assert.equal(sub, null);
  });

  test("[1.2-git] plain subcommand is returned", () => {
    assert.equal(gitSubcommand(["git", "status"]), "status");
  });

  test("[1.2-git] skips -c k=v global option", () => {
    assert.equal(gitSubcommand(["git", "-c", "user.name=x", "commit"]), "commit");
  });

  test("[1.2-git] skips -C dir global option", () => {
    assert.equal(gitSubcommand(["git", "-C", "/repo", "status"]), "status");
  });

  test("[1.2-git] skips --git-dir=<dir> (equals form)", () => {
    assert.equal(gitSubcommand(["git", "--git-dir=/r/.git", "log"]), "log");
  });

  test("[1.2-git] skips --git-dir <dir> (space form)", () => {
    assert.equal(gitSubcommand(["git", "--git-dir", "/r/.git", "log"]), "log");
  });

  test("[1.2-git] skips a run of combined global options", () => {
    assert.equal(
      gitSubcommand(["git", "-C", "/r", "-c", "a=b", "--git-dir=/g", "rev-parse"]),
      "rev-parse",
    );
  });

  test("[1.2-git] verb word inside a path argument does not change the subcommand", () => {
    assert.equal(gitSubcommand(["git", "add", "src/config.ts"]), "add");
  });

  test("[1.2-git] option values after the subcommand do not change it (git log --grep config)", () => {
    assert.equal(gitSubcommand(["git", "log", "--grep", "config"]), "log");
  });

  test("[1.2-git] first subcommand token wins (git stash push -m drop -> stash)", () => {
    assert.equal(gitSubcommand(["git", "stash", "push", "-m", "drop"]), "stash");
  });
});

describe("globMatch", () => {
  type GlobCase = { name: string; pattern: string; path: string; expected: boolean };

  const globCases: GlobCase[] = [
    { name: "dir/** matches a direct child", pattern: "src/**", path: "src/a.ts", expected: true },
    { name: "** crosses / (deep child)", pattern: "src/**", path: "src/a/b/c.ts", expected: true },
    { name: "dir/** matches dir itself", pattern: "src/**", path: "src", expected: true },
    {
      name: "boundary: src/** does NOT match src2/a.ts",
      pattern: "src/**",
      path: "src2/a.ts",
      expected: false,
    },
    { name: "dir/* matches a direct child", pattern: "src/*", path: "src/a.ts", expected: true },
    {
      name: "* does not cross / (dir/* misses deep child)",
      pattern: "src/*",
      path: "src/a/b.ts",
      expected: false,
    },
    { name: "*.ts matches a root file", pattern: "*.ts", path: "a.ts", expected: true },
    {
      name: "* does not cross / (*.ts misses nested file)",
      pattern: "*.ts",
      path: "src/a.ts",
      expected: false,
    },
    {
      name: "{a,b} alternation: first branch",
      pattern: "src/*.{ts,tsx}",
      path: "src/a.ts",
      expected: true,
    },
    {
      name: "{a,b} alternation: second branch",
      pattern: "src/*.{ts,tsx}",
      path: "src/a.tsx",
      expected: true,
    },
    {
      name: "{a,b} alternation: non-member rejected",
      pattern: "src/*.{ts,tsx}",
      path: "src/a.js",
      expected: false,
    },
    {
      name: "{a,b} alternation over path heads",
      pattern: "{src,docs}/**",
      path: "docs/plan.md",
      expected: true,
    },
    { name: "**/ crosses many segments", pattern: "**/*.ts", path: "a/b/c.ts", expected: true },
    { name: "**/ matches zero segments", pattern: "**/*.ts", path: "c.ts", expected: true },
    { name: "literal pattern matches itself", pattern: "src/a.ts", path: "src/a.ts", expected: true },
    {
      name: "dot in pattern is literal, not regex-any",
      pattern: "src/a.ts",
      path: "src/axts",
      expected: false,
    },
    { name: "* within a segment", pattern: "src/a*", path: "src/abc", expected: true },
    { name: "different head rejected", pattern: "src/**", path: "docs/a.ts", expected: false },
  ];
  for (const c of globCases) {
    test(`[1.2-glob] ${c.name}`, () => {
      assert.equal(globMatch(c.pattern, c.path), c.expected);
    });
  }
});

describe("scopesIntersect", () => {
  type IntersectCase = { name: string; a: string[]; b: string[]; expected: boolean };

  const intersectCases: IntersectCase[] = [
    {
      name: "real overlap: glob head prefixes a literal path -> TRUE",
      a: ["src/**"],
      b: ["src/core/parse.ts"],
      expected: true,
    },
    {
      name: "identical globs -> TRUE",
      a: ["conductor/**"],
      b: ["conductor/**"],
      expected: true,
    },
    {
      name: "literal glob is a head-prefix of the other -> TRUE",
      a: ["src"],
      b: ["src/deep/**"],
      expected: true,
    },
    {
      name: "conservative over-approximation asserted TRUE by design: same head, disjoint extensions (*.ts vs *.md) — false positive only serializes",
      a: ["src/*.ts"],
      b: ["src/*.md"],
      expected: true,
    },
    {
      name: "conservative over-approximation asserted TRUE by design: wildcard-headed glob (empty literal head) intersects everything",
      a: ["**/*.ts"],
      b: ["docs/readme.md"],
      expected: true,
    },
    {
      name: "clearly disjoint heads (src vs docs) -> FALSE",
      a: ["src/**"],
      b: ["docs/**"],
      expected: false,
    },
    {
      name: "clearly disjoint sibling heads (conductor/core vs conductor/tests) -> FALSE",
      a: ["conductor/core/**"],
      b: ["conductor/tests/**"],
      expected: false,
    },
    {
      name: "any overlapping pair across the lists suffices -> TRUE",
      a: ["docs/**", "src/**"],
      b: ["src/x.ts"],
      expected: true,
    },
    {
      name: "[S-1] case-insensitive filesystem (darwin): Src/** intersects src/** — a false positive only serializes, but MISSING a real dir collision lets two writers corrupt the same dir -> TRUE",
      a: ["Src/**"],
      b: ["src/**"],
      expected: true,
    },
    {
      name: "[S-1 control] case-folding must not merge distinct dirs: Src/** vs docs/** -> FALSE",
      a: ["Src/**"],
      b: ["docs/**"],
      expected: false,
    },
  ];
  for (const c of intersectCases) {
    test(`[1.2-intersect] ${c.name}`, () => {
      assert.equal(scopesIntersect(c.a, c.b), c.expected);
      assert.equal(
        scopesIntersect(c.b, c.a),
        c.expected,
        "scopesIntersect must be symmetric",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// [F1] globMatch consecutive-** liveness (DoS). A run of ** must collapse to a
// single ** (and matchSegments must be memoized) so a degenerate LLM-emitted
// glob cannot wedge the edit-scope gate, which runs globMatch on EVERY check.
// **/** matches exactly what ** matches, so the collapse is semantics-neutral;
// the bug is exponential C(stars+segments, stars) backtracking, so the failing
// assertion is a wall-clock bound and the collapse cases pin that semantics
// survive.
// ---------------------------------------------------------------------------
describe("[F1] globMatch consecutive-** liveness", () => {
  test("[1.2-glob-dos] a degenerate all-** pattern returns false without exponential backtracking", () => {
    const pattern = Array.from({ length: 14 }, () => "**").join("/") + "/zz";
    const deepPath = Array.from({ length: 18 }, () => "a").join("/");
    const startNs = process.hrtime.bigint();
    const result = globMatch(pattern, deepPath);
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    assert.equal(result, false, "the trailing literal 'zz' cannot match any 'a' segment");
    assert.ok(
      elapsedMs < 1000,
      `globMatch must not backtrack exponentially on a run of ** (took ${elapsedMs.toFixed(1)}ms)`,
    );
  });

  test("[1.2-glob-dos] the prescribed degenerate pattern still returns false", () => {
    assert.equal(
      globMatch("**/**/**/**/**/**/**/**/**/**/**/**/zz", "a/a/a/a/a/a/a/a/a/a/a/a/a/a/a/a"),
      false,
    );
  });

  test("[1.2-glob-dos] collapsing a ** run preserves matching semantics", () => {
    assert.equal(globMatch("**/**/x.ts", "a/b/x.ts"), true);
    assert.equal(globMatch("src/**/**", "src/a/b"), true);
    assert.equal(globMatch("src/**/**", "src"), true);
    assert.equal(globMatch("**/**/*.ts", "c.ts"), true);
  });
});

// ---------------------------------------------------------------------------
// [F2] gitSubcommand must FAIL SAFE on an unrecognized value-taking global.
// The old skip-one-token logic surfaced the flag's VALUE as the subcommand; an
// adversary who picks an allow-listed value ("log") hides the real write verb
// ("apply") from the Task 5.1 gate. Return the unrecognized flag itself so the
// gate default-denies (it is on no allow-list).
// ---------------------------------------------------------------------------
describe("[F2] gitSubcommand fails safe on an unrecognized global option", () => {
  test("[1.2-git] an unrecognized value-taking global does NOT surface its value as the subcommand", () => {
    const sub = gitSubcommand(["git", "--namespace", "log", "apply"]);
    assert.notEqual(sub, "log", "must not surface an allow-listed value as the subcommand");
    assert.equal(sub, "--namespace", "an unrecognized global option is returned verbatim (deny-forcing)");
  });

  test("[1.2-git] a second unrecognized global (--work-tree) is also deny-forcing", () => {
    const sub = gitSubcommand(["git", "--work-tree", "status", "push"]);
    assert.notEqual(sub, "status");
    assert.equal(sub, "--work-tree");
  });
});

// ---------------------------------------------------------------------------
// [F3] git detection must see through leading env-assignments, one wrapper
// (env/command/sudo/builtin/exec), and an absolute/relative path (basename
// resolution). Otherwise `A=b git push`, `env git push`, `sudo git push`, and
// `/usr/bin/git push` all evade the git gate entirely. isGitCommand and
// gitSubcommand share one command-word finder so they agree.
// ---------------------------------------------------------------------------
describe("[F3] git detection sees through env-assignments, wrappers, and paths", () => {
  type GitDetectCase = { name: string; seg: string[]; sub: string };
  const detectCases: GitDetectCase[] = [
    { name: "leading NAME=value env-assignment", seg: ["A=b", "git", "push"], sub: "push" },
    { name: "env wrapper", seg: ["env", "git", "push"], sub: "push" },
    { name: "command wrapper", seg: ["command", "git", "apply", "x"], sub: "apply" },
    { name: "sudo wrapper", seg: ["sudo", "git", "push"], sub: "push" },
    { name: "absolute git path resolves by basename", seg: ["/usr/bin/git", "push"], sub: "push" },
  ];
  for (const c of detectCases) {
    test(`[1.2-git] isGitCommand + subcommand through ${c.name}`, () => {
      assert.equal(isGitCommand(c.seg), true, `${c.name} must read as a git command`);
      assert.equal(gitSubcommand(c.seg), c.sub, `${c.name} must expose the real subcommand`);
    });
  }

  test("[1.2-git] false-positive guards still hold after the widening", () => {
    assert.equal(isGitCommand(["echo", "git", "status"]), false, "git not in command position");
    assert.equal(isGitCommand(["cat", "tools/git/helper.txt"]), false, "no substring matching");
    assert.equal(gitSubcommand(["git", "log", "--grep", "git"]), "log", "message word unchanged");
  });
});
