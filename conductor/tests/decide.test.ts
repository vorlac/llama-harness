// Task 1.5 — tests for conductor/core/decide.ts (plan §6.2 decision protocol, §2.7 record schema).
// This file lives at conductor/tests/decide.test.ts.
//
// Expected export surface of ../core/decide.ts:
//   scoreOptions(options)      -> { winner: string | null, tie: boolean }
//   isHumanTerritory(question) -> boolean
//   requireTwoOptions(record)  -> { ok: boolean, why: string }
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { scoreOptions, isHumanTerritory, requireTwoOptions } from "../core/decide.ts";

// §2.7 score object: the five ladder-5 criteria keys.
type Score = {
  capability: number;
  testability: number;
  movingParts: number;
  validationEarliness: number;
  singleSource: number;
};

type OptionEntry = { name: string; score?: Score };

// §2.7 decisions.jsonl record shape ("derived" | "human"; human ⇒ was asked).
type DecisionRecord = {
  id: string;
  tsIso: string;
  question: string;
  options: OptionEntry[];
  choice: string;
  why: string;
  kind: "derived" | "human";
  appliedWhere: string;
};

const score = (
  capability: number,
  testability: number,
  movingParts: number,
  validationEarliness: number,
  singleSource: number,
): Score => ({ capability, testability, movingParts, validationEarliness, singleSource });

describe("scoreOptions", () => {
  it("declares the strictly greater total the winner (§2.7 example: cpp-httplib 9 vs raw sockets 5)", () => {
    const result = scoreOptions([
      { name: "cpp-httplib", score: score(2, 2, 2, 1, 2) }, // total 9
      { name: "raw sockets", score: score(1, 1, 0, 1, 2) }, // total 5
    ]);
    assert.equal(result.winner, "cpp-httplib");
    assert.equal(result.tie, false);
  });

  it("sums all five §2.7 keys — the higher total beats winning more individual criteria", () => {
    const result = scoreOptions([
      { name: "broad", score: score(2, 2, 2, 1, 2) }, // total 9, ahead on four keys
      { name: "spiky", score: score(0, 0, 0, 10, 0) }, // total 10, ahead on one key
    ]);
    assert.equal(result.winner, "spiky");
    assert.equal(result.tie, false);
  });

  it("reports a tie with no winner when totals are equal", () => {
    const result = scoreOptions([
      { name: "alpha", score: score(2, 1, 1, 1, 1) }, // total 6
      { name: "beta", score: score(1, 2, 1, 1, 1) }, // total 6
    ]);
    assert.equal(result.tie, true);
    assert.equal(result.winner, null);
  });

  it("picks the strict maximum among three options", () => {
    const result = scoreOptions([
      { name: "low", score: score(1, 1, 1, 1, 1) }, // total 5
      { name: "top", score: score(2, 2, 2, 2, 1) }, // total 9
      { name: "mid", score: score(2, 1, 2, 1, 1) }, // total 7
    ]);
    assert.equal(result.winner, "top");
    assert.equal(result.tie, false);
  });

  it("ties when the top total is shared, even though a third option trails", () => {
    const result = scoreOptions([
      { name: "first", score: score(2, 2, 1, 1, 1) }, // total 7
      { name: "second", score: score(1, 1, 2, 2, 1) }, // total 7
      { name: "trailer", score: score(1, 0, 1, 0, 1) }, // total 3
    ]);
    assert.equal(result.tie, true);
    assert.equal(result.winner, null);
  });
});

describe("isHumanTerritory", () => {
  // §6.2 human territory (the only legal asks): taste/aesthetics; money/paid services;
  // irreversible/publish/delete; secrets/credentials. Derivable technical questions are
  // machine territory — never asked.
  const cases: ReadonlyArray<readonly [question: string, expected: boolean]> = [
    // taste / aesthetics -> true
    ["Which color scheme looks better for the dashboard?", true],
    ["Do you prefer the serif or the sans-serif font for the report headings?", true],
    // money / paid services -> true
    ["Should we buy the paid tier of the logging service?", true],
    ["Is it OK to spend money on a larger cloud instance for CI?", true],
    // irreversible / publish / delete -> true
    ["delete the production data", true],
    ["Should I publish this package to the public npm registry?", true],
    // irreversible force-push (flag spellings) -> true (H-1)
    ["Is it OK to push --force to origin/main?", true],
    ["Can I git push -f to overwrite the shared branch after the bad merge?", true],
    // paid recurring price -> true (H-2)
    ["Should we use the $20/month plan for the API?", true],
    // benign per-second throughput question -> false (control: not paid, no month)
    ["how many requests per second can we handle?", false],
    // secrets / credentials -> true
    ["Which value should go in the AWS_SECRET_ACCESS_KEY credential?", true],
    // "delete" inside a file path is not a delete action -> false
    ["should src/delete-user.ts export a default?", false],
    // derivable technical questions -> false
    ["What does scoreOptions return when two totals are equal?", false],
    ["Should the parser use recursion or iteration for nested blocks?", false],
    ["Does tsc --strict pass on the current branch?", false],
    ["Is port 8080 already bound by the router process?", false],
    ["How many retries does the health check perform before failing?", false],
    // ISSUE-070: ordinary software vocabulary is NOT human territory. Bare topic
    // nouns ("subscription", "publish", "secrets") and a bare destructive verb
    // stalled a run on questions the model owns, which is a liveness tax paid on
    // every §6.2 classification. Each row below is a question a machine derives.
    ["Should the subscription handler use a bounded queue for the pub/sub topic?", false],
    ["Does the publisher retry when the broker rejects a published event?", false],
    ["Where should the secrets schema live: core/types.ts or its own module?", false],
    ["Should the reducer delete the stale cache entry or mark it expired?", false],
    ["Should the fixture erase the scratch directory between cases?", false],
    // ISSUE-070's other half: the conservative direction is preserved for the
    // real categories — recurring spend, credential handling, irreversible loss,
    // external distribution.
    ["Should we cancel the hosted-metrics subscription to cut spend?", true],
    ["Is it OK to wipe the customer database before the reimport?", true],
    ["Should I paste the client secret into the config file?", true],
    ["Should we publish the release to the npm registry?", true],
    ["Should we erase the nightly backups older than a year?", true],
  ];

  for (const [question, expected] of cases) {
    it(`classifies ${JSON.stringify(question)} as ${expected ? "human" : "machine"} territory`, () => {
      assert.equal(isHumanTerritory(question), expected);
    });
  }
});

describe("requireTwoOptions", () => {
  it("rejects a derived record with fewer than two options, naming the two-option rule", () => {
    const record: DecisionRecord = {
      id: "D-0001",
      tsIso: "2026-08-07T12:00:00Z",
      question: "HTTP client for router health: cpp-httplib client vs raw sockets?",
      options: [{ name: "cpp-httplib", score: score(2, 2, 2, 1, 2) }],
      choice: "cpp-httplib",
      why: "only candidate considered",
      kind: "derived",
      appliedWhere: "src/router/router-client note",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, false);
    assert.match(String(result.why), /option/i);
    assert.match(String(result.why), /2|two/i);
  });

  it("rejects a derived record whose options carry no scores", () => {
    const record: DecisionRecord = {
      id: "D-0002",
      tsIso: "2026-08-07T12:01:00Z",
      question: "Config format: JSON vs TOML?",
      options: [{ name: "JSON" }, { name: "TOML" }],
      choice: "JSON",
      why: "unscored gut call",
      kind: "derived",
      appliedWhere: "conductor config loader",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, false);
    assert.match(String(result.why), /score/i);
  });

  it("rejects a derived record where only one of two options is scored", () => {
    const record: DecisionRecord = {
      id: "D-0003",
      tsIso: "2026-08-07T12:02:00Z",
      question: "Retry strategy: exponential backoff vs fixed interval?",
      options: [
        { name: "exponential backoff", score: score(2, 2, 1, 1, 2) },
        { name: "fixed interval" },
      ],
      choice: "exponential backoff",
      why: "second option never scored",
      kind: "derived",
      appliedWhere: "router health polling",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, false);
    assert.match(String(result.why), /score/i);
  });

  it("accepts a derived record with two scored options", () => {
    const record: DecisionRecord = {
      id: "D-0004",
      tsIso: "2026-08-07T12:03:00Z",
      question: "HTTP client for router health: cpp-httplib client vs raw sockets?",
      options: [
        { name: "cpp-httplib", score: score(2, 2, 2, 1, 2) },
        { name: "raw sockets", score: score(1, 1, 0, 1, 2) },
      ],
      choice: "cpp-httplib",
      why: "strict superset on scored criteria; already a dependency",
      kind: "derived",
      appliedWhere: "src/router/router-client note",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, true);
  });

  it("accepts a derived record with more than two scored options (>=2 semantics)", () => {
    const record: DecisionRecord = {
      id: "D-0005",
      tsIso: "2026-08-07T12:04:00Z",
      question: "Process supervision: spawn vs fork vs execa?",
      options: [
        { name: "spawn", score: score(2, 2, 2, 1, 2) },
        { name: "fork", score: score(1, 2, 1, 1, 2) },
        { name: "execa", score: score(2, 2, 1, 1, 1) },
      ],
      choice: "spawn",
      why: "highest total on ladder-5 criteria",
      kind: "derived",
      appliedWhere: "router process manager",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, true);
  });

  it('exempts kind:"human" records — §2.7 permits omitting numeric scores only for human questions', () => {
    const record: DecisionRecord = {
      id: "D-0006",
      tsIso: "2026-08-07T12:05:00Z",
      question: "Which accent color do you prefer for the dashboard theme?",
      options: [{ name: "warm palette" }, { name: "cool palette" }],
      choice: "warm palette",
      why: "user preference (taste has no objective score)",
      kind: "human",
      appliedWhere: "dashboard theme",
    };
    const result = requireTwoOptions(record);
    assert.equal(result.ok, true);
  });
});
