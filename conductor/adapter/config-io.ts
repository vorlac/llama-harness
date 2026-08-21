// conductor/adapter/config-io.ts — the §2.1 `.conductor/config.json` reader
// (task-let 5.4a). core/types.ts:134's comment was the only mention of that file
// anywhere in the product; this module is its reader, and the ONE place the path
// is spelled, so the plugin and Task 12.2's setup writer cannot disagree about
// where the config lives.
//
// An ADAPTER (G14): it reads the filesystem, so it lives outside the pure core.
// It uses only cross-runtime built-ins (node:fs, node:path) plus the core schema
// validator, so it runs under both the opencode runtime and Node type-stripping.
//
// Two rules shape every branch below:
//
//   1. AN ABSENT CONFIG IS NOT AN ERROR. A repo conductor has never been set up
//      in is the ordinary first-run case (§3.2): the loader reports
//      repoConfigured:false, which is the flag core/gates-phase.ts legalTools
//      already takes, and under which only conductor_setup and conductor_status
//      are legal in every state.
//
//   2. A MALFORMED CONFIG IS ALWAYS LOUD. The loader never falls back to the
//      default on a file it could not read: a repo whose config pins
//      git.mode "read-only" silently becoming the default's mode — or, worse, a
//      permissive one — is a security downgrade the human never asked for. Both
//      failure arms throw, naming the file and (for a schema failure) carrying
//      the validator's own error text, so the human can fix the file rather than
//      discover the downgrade later.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { DEFAULT_LEVEL } from "../core/journal-events.ts";
import { validate } from "../core/types.ts";
import type { Config } from "../core/types.ts";

// §2.1's location, as ONE literal.
export function configPath(root: string): string {
  return path.join(root, ".conductor", "config.json");
}

export interface LoadedConfig {
  config: Config; // the §2.1 config in force
  repoConfigured: boolean; // false iff no config file exists (§3.2 first run)
}

// ---------------------------------------------------------------------------
// The default config (the product's first)
// ---------------------------------------------------------------------------

// CROSS-TASK OBLIGATION. scripts/conductor_wiring.py owns the §12.1 fan-out
// defaults as one literal each, and serve.py derives llama-server's --parallel
// from DEFAULT_MAX_READERS; a second spelling here that drifted would make the
// fan-out serialize upstream while both tasks' tests stayed green. These two
// constants are that module's numbers, and conductor/tests/composition.test.ts
// reads conductor_wiring.py at test time and asserts the equality, so a drift is
// caught rather than assumed away.
const DEFAULT_MAX_READERS = 6;
const SUB_SESSION_TIMEOUT_MS = 900000;

// Freeze a value and everything reachable from it, so the exported default
// cannot be rewritten for every later caller by one consumer's stray mutation.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

// The config in force when a repo has none. Every value is the plan's §2.1
// example EXCEPT five, each of which the plan either forbids defaulting or would
// make PERMISSIVE if copied verbatim. A default is what an UNCONFIGURED repo
// gets, so it fails toward "conductor can do less", never "conductor may do
// more" — and it is reachable only until conductor_setup runs, because
// legalTools with repoConfigured=false leaves just setup and status legal:
//
//   git.mode "read-only"          the mode is asked on first run in a repo and
//                                 NEVER defaulted; assuming "commit" would let
//                                 an unconfigured repo be committed to.
//   verify.scopes {}              conductor does not invent a test command for a
//                                 repo it has not been set up in.
//   verify.requiredScopes []      an entry naming a scope absent from the (empty)
//                                 scope map is an incoherent default.
//   verify.behavioralPaths ["**"] a wrong value here is the difference between an
//                                 enforced TDD law and an optional one. [] would
//                                 make behavioral:false legal for ALL code; ["**"]
//                                 makes every path owe verification until setup
//                                 narrows it, which is the safe direction.
//   models.default ""             G13 validates the model against the live
//                                 /v1/models list; naming one nobody chose would
//                                 point a run at weights the user never picked.
//
// logging.level is core/journal-events.ts DEFAULT_LEVEL rather than a second
// spelling of the §7.1 default, for the same single-source reason as the two
// parallel numbers above.
export const DEFAULT_CONFIG: Config = deepFreeze<Config>({
  version: 1,
  verify: { scopes: {}, behavioralPaths: ["**"], requiredScopes: [] },
  format: { rules: [] },
  git: { mode: "read-only", branchPolicy: "pin", preexistingDirty: "refuse" },
  workflow: {
    trivialMaxFiles: 2,
    planReviewers: 4,
    planReviewMaxRounds: 3,
    itemReviewers: 6,
    skepticsPerFinding: 2,
    reviewMaxRounds: 3,
    vetCritics: 3,
    vetMaxRounds: 3,
    testRepairAttempts: 3,
    debugFixCap: 3,
    maxOverridesPerItem: 1,
    maxOverridesPerRun: 2,
  },
  parallel: {
    writes: "off",
    maxImplementers: 2,
    maxReaders: DEFAULT_MAX_READERS,
    subSessionTimeoutMs: SUB_SESSION_TIMEOUT_MS,
  },
  toolSurface: { classifyBuiltins: true },
  models: { default: "", roles: {} },
  ponytail: "full",
  retention: { keepRuns: 20, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
  logging: { level: DEFAULT_LEVEL, components: {} },
});

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Read <root>/.conductor/config.json. Synchronous, like every other conductor
// store read. `root` is the ALREADY realpath'd workspace root — the §0.2 wire
// contract makes canonicalizing the directory the CALLER's job, so this module
// resolves nothing and a caller that skipped it cannot be papered over here.
export function loadConfig(root: string): LoadedConfig {
  const file = configPath(root);
  if (!existsSync(file)) {
    // Rule 1: an unconfigured repo is the first-run case, not a failure. The
    // returned config is a deep copy, so a caller mutating what it was handed
    // cannot rewrite the default for the next caller.
    return { config: structuredClone(DEFAULT_CONFIG), repoConfigured: false };
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`config-io: cannot read the conductor config at ${file}: ${messageOf(err)}`);
  }
  // BOM-tolerant, like every other §2 read: conductor writes none, but an editor may.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `config-io: the conductor config at ${file} is not valid JSON: ${messageOf(err)} — ` +
        "fix the file; a malformed config is never silently replaced by the default, because a " +
        "repo whose git.mode reverts under it is a security downgrade nobody asked for",
    );
  }

  // The COMMITTED validator, not a hand-rolled field check: the §2.1 schema sets
  // additionalProperties:false at every level, so `gitMode` typed for `git.mode`
  // is refused here and would be waved through by a loader that only inspected
  // the fields it knew about.
  const result = validate("Config", parsed);
  if (!result.ok) {
    throw new Error(
      `config-io: the conductor config at ${file} is not a valid §2.1 Config: ` +
        result.errors.join("; "),
    );
  }

  return { config: parsed as Config, repoConfigured: true };
}
