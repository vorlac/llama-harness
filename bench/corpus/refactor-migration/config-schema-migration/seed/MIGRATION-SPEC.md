# MIGRATION-SPEC: untyped config bag to declarative schema

This is the specification for the migration. It describes the state the code is
in, the state it has to end up in, the behaviour that must survive unchanged,
and the decisions that are genuinely open. It does not tell you how to organise
your modules, and it deliberately does not resolve the open questions in the
last section - resolving them is the work.

The workspace ships `build.sh`, `run.sh` and `test.sh`; run each one through
`bash`, because the workspace carries no execute bits. This file only covers the
migration itself.

---

## 1. Where the code is now

`relay` is an HTTP ingest daemon: it accepts JSON records over HTTP, transforms
them, batches them, and hands them to a sink. Configuration arrives from four
places and is merged into a single `Record<string, any>` keyed by dotted
strings, which is then passed around - or, for about half the modules, stashed
in a process-global and reached for later.

```
src/config/defaults.ts   partial defaults table, keyed by dotted string
src/config/keys.ts       three drifted key tables + four ad-hoc accessors
src/config/file.ts       JSON file layer, nested or flat, unknown keys dropped
src/config/env.ts        RELAY_* layer, its own settable-key list, legacy aliases
src/config/cli.ts        argv layer, its own settable-key list, legacy flags
src/config/loader.ts     merge + three validation checks
src/config/current.ts    process-global "current config"
```

Twenty-one modules read configuration. They do it in at least six different
ways:

| Idiom | Example |
|---|---|
| accessor with a fallback | `getNum(cfg, "rateLimit.max", 100)` |
| raw index with no fallback at all | `app.config["server.host"]` in `cli/main.ts` |
| raw index with `\|\|` | `Number(cfg["spool.maxBytes"]) \|\| 10485760` |
| raw index with an inline ternary | `cfg["metrics.prefix"] !== undefined ? String(...) : "relay_"` |
| cross-key fallback | `metrics.flushIntervalMs` falls back to `pipeline.flushIntervalMs` |
| process-global reach-in | `const cfg = getCurrentConfig()` inside a decorator |

Consequences you will meet:

- A key can have three different defaults depending on which module reads it.
- A key can have a default in a module that `defaults.ts` makes unreachable.
- A key can be settable from a file but not from the environment, or from the
  environment but not the command line, because the three settable-key tables
  disagree.
- A malformed value usually becomes a fallback silently. Only `server.port`,
  `log.level` and `sink.kind` are checked at all.

---

## 2. Where the code has to end up

**One declarative schema module.** Every configuration key is declared exactly
once, in one place, as data. A declaration carries at minimum: the canonical
dotted key, its type, its default, whether it may be set from the environment
and from the command line, any legacy environment or flag aliases, its
validation constraints, and a one-line description. Nothing outside the schema
module may invent a default for a configuration key.

**A small validator, written here.** No external dependency, no network. It
walks the schema, coerces each layer's raw values to the declared type, applies
the declared constraints, and returns a list of issues. Every issue names the
offending `key` and the `source` the offending value came from (`"cli"`,
`"env"`, `"file"`, `"default"`, `"override"`). The `ConfigIssue` shape in
`src/config/issue.ts` already has those fields; keep them.

**A fully typed, frozen config object.** Loading produces a value whose type
describes the whole configuration - not `Record<string, any>`, not `unknown`,
not an index signature that accepts any string. It is frozen (deeply) before it
is handed out, so no consumer can mutate it. Whether the typed object is nested
(`config.server.port`) or flat-with-typed-fields is your choice; say which you
chose and why in `MIGRATION-NOTES.md`.

**Every consumer switched to typed field access.** After the migration, no
module outside `src/config/` and `src/testsupport/` may index configuration by
string. Grep is the check:

```sh
grep -rn --include='*.ts' -E '\[\s*"(server|auth|rateLimit|cors|pipeline|retry|sink|transform|log|metrics|spool)\.' src \
  | grep -v '^src/config/' | grep -v '^src/testsupport/'
```

That command must print nothing. The same goes for `getStr`, `getNum`,
`getBool`, `getList` and `getCurrentConfig`, which should have no callers left
outside `src/config/` once you are done - if you keep any of them, justify it.

**Precedence stated as data, once.** The order (defaults, file, env, cli,
overrides) must be expressed in one place that the loader reads, not
re-implemented per layer.

### 2.1 Side by side

| Concern | Before | After |
|---|---|---|
| Key inventory | `CONFIG_KEYS`, `ENV_SETTABLE_KEYS`, `CLI_SETTABLE_KEYS`, plus whatever modules actually read | one schema, one entry per key |
| Defaults | `DEFAULTS` for some keys, inline fallbacks for the rest, disagreeing | `default` on the schema entry, exactly one per key |
| Type coercion | `coerceForKey` + four accessors with four rules | declared type per key, one coercion path |
| Env name | `envNameFor()` computed, plus a hand-kept alias map | derived from the schema entry, aliases declared on the entry |
| Flag name | `cliNameFor()` computed, plus `CLI_ALIASES` and `CLI_SHORT` | derived from the schema entry, aliases declared on the entry |
| Validation | three hand-written checks in `loadConfig` | schema-driven, every key checked |
| Error reporting | `ConfigIssue { source, key, message }` for three keys | same shape, every key |
| Consumer access | `getNum(cfg, "rateLimit.max", 100)` | `config.rateLimit.max` (typed `number`) |
| Missing key | `undefined`, silently | impossible: the type has no optional holes |
| Bad value | silently replaced by a fallback | an issue naming key and source |
| Mutability | the bag is mutable | frozen |
| Global access | `getCurrentConfig()` throws if unset | your call - see the open questions |

---

## 3. Behaviour that must not change

The suite in `test/` pins all of this except where an item below says
otherwise. It is not to be edited.

1. **Precedence** is defaults < file < env < cli < overrides.
2. **Falsy values configured explicitly win.** `0`, `false` and `""` set by any
   layer beat a default. `--rate-limit-max=0` means zero, not a hundred.
3. **`sourceOf(key)`** reports which layer supplied the winning value.
4. **Config files may be nested, flat-dotted, or a mix of both.**
5. **A config file may contain keys this version does not know about.** That is
   not an error today (`config/relay.config.json` ships with an
   `experimental.shardCount` key precisely to prove it).
6. **An unrecognised command-line flag does not invalidate the run.**
7. **Legacy environment names still work**: `RELAY_PORT`, `RELAY_HOST`,
   `RELAY_TOKENS`, `RELAY_ENDPOINT`, and `RELAY_DEBUG` - the last of which is
   not a rename: any truthy value sets `log.level` to `debug`.
8. **Legacy flags still work**: `--port`, `--host`, `--log-level`,
   `--batch-size`, `--endpoint`, and the short forms `-p`, `-h`, `-l`, `-o`,
   in both `-p 8080` and `-p8080` spellings.
9. **Boolean flags** accept `--metrics-enabled`, `--metrics-enabled true|false`,
   `--metrics-enabled=true` and `--no-metrics-enabled`.
10. **List values** accept a comma-separated string from env or CLI and a JSON
    array from a file, and end up as `string[]` either way.
11. **Validation reports every failure**, not just the first, each with its
    `key` and its `source`.
12. **Building an app on an invalid config fails with a message naming the
    offending key.** Same for an `http` sink with no `sink.http.endpoint`.
13. **The auth decorator captures its configuration when the route is wrapped**,
    not per request. No test catches a change here - moving the three reads
    inside the returned handler leaves all 76 green - so preserving the timing
    is on you. If you deliberately make it per-request, say so in
    `MIGRATION-NOTES.md`.
14. **The spool scope** creates its directory on entry and removes it on exit
    only if it stayed empty, including when the body throws.
15. **The batcher** flushes at `pipeline.batchSize`, on the interval, and on
    `stop()`; records past `pipeline.maxQueue` are dropped, not buffered.
16. **Defaults that only exist inside a module today and are pinned by tests**:
    `auth.headerName` = `"x-relay-token"`, `cors.origins` = `["*"]`,
    `metrics.prefix` = `"relay_"`. These must end up in the schema with those
    values.
17. **`src/testsupport/harness.ts` keeps its exported signatures.** The tests
    import `loadForTest`, `LoadedConfig` (`ok`, `issues`, `effective`,
    `sourceOf`, `keys`, `raw`), `makeApp`, `TestApp`, `bodyJson`,
    `makeTempDir`, `makeLogger`, `makeMetrics`, `transformRecord`, `runRetry`,
    `makeBatcher`, `makeHttpSink`, `makeFileSink` and `runWithSpool`, and pass
    `HarnessInput` values whose `overrides` are keyed by canonical dotted
    strings. `effective(key)` and `keys()` must keep working over canonical
    dotted keys - implement them by walking the schema, not by keeping an
    untyped bag alive.

---

## 4. Open questions - decide, and write down why

These are not oversights. Each one has more than one defensible answer, and the
code as written does not tell you which was intended. Pick one per item,
implement it, and record the decision and its rationale in
`MIGRATION-NOTES.md`. No test constrains these.

1. **`retry.maxAttempts` has no entry in `defaults.ts`.** `pipeline/retry.ts`
   falls back to `5`; `pipeline/sinks/httpSink.ts` falls back to `4`;
   `config/legacy-0.2.config.json` ships `4`. One number goes in the schema.
2. **`server.maxBodyBytes` has no entry in `defaults.ts` either.**
   `middleware/bodyLimit.ts` uses `1048576`; `server/httpServer.ts` uses
   `2097152` for its socket-level read cap. Are these one key or two?
3. **Unreachable module fallbacks.** `defaults.ts` supplies `log.level`
   (`"info"`), `pipeline.batchSize` (`50`), `pipeline.flushIntervalMs` (`1000`),
   `sink.http.timeoutMs` (`5000`) and `transform.redactKeys`
   (`["password","token"]`), while the modules that read them carry different
   fallbacks (`"warn"`, `100`, `250`, `30000`, `["password"]`) that can never
   fire. Does the schema record the value that is in force today, or the value
   the module author wrote?
4. **`metrics.flushIntervalMs` falls back to `pipeline.flushIntervalMs`**
   before falling back to `5000`. Is a cross-key default part of the schema, a
   derived value computed after loading, or a mistake to drop?
5. **`||` versus an explicit `undefined` check.** `storage/spool.ts` resolves
   `spool.maxBytes` with `||`, so a configured `0` silently becomes
   `10485760`. `sinks/httpSink.ts` does the same to `sink.http.timeoutMs`.
   `sinks/fileSink.ts` instead tests `!== undefined` for
   `sink.file.rotateBytes`, so an explicit `0` survives there and means "never
   rotate". (No module uses `??`; the undefined checks are spelled out.) Does
   `0` mean "unlimited", "immediate", or "invalid" for each of these keys?
6. **Keys that cannot be set from every source.** `cors.origins` is settable
   only from a file; `transform.redactKeys` from a file or the CLI but not the
   environment; `spool.maxBytes` from a file or the CLI but not the
   environment; `metrics.prefix` from a file or the environment but not the
   CLI. Deliberate, or drift? If you make everything uniformly settable, say so
   and say what could break.
7. **Unknown keys in a config file** are collected and ignored. Warn? Reject?
   Keep ignoring? Requirement 5 in section 3 constrains the answer for
   `experimental.*` only.
8. **`retry.jitter`, `pipeline.maxQueue`, `server.shutdownGraceMs`,
   `sink.file.rotateBytes` and `auth.headerName`** have exactly one source of
   truth today - the module that reads them. Confirm each value as you lift it
   into the schema; note any you believe is wrong, and do not silently change
   it.
9. **The process-global config.** `config/current.ts` is read by
   `middleware/auth.ts`, `observability/logger.ts`,
   `observability/metrics.ts` and `storage/spool.ts`. Keep it (typed), or pass
   the typed config explicitly everywhere and delete it? Either is defensible;
   the wiring order in `src/app.ts` is the constraint.
10. **`auth.required` defaults to `true` while `auth.tokens` defaults to
    `[]`,** so the default configuration refuses every ingest request. Is that
    a safe default or a broken one? If you change it, you are changing
    behaviour - justify it and check the tests still pass.
11. **The empty-string special case in `env.ts`**: an empty `RELAY_SERVER_PORT`
    or `RELAY_RATE_LIMIT_MAX` is treated as unset, but an empty
    `RELAY_SINK_FILE_PATH` is a real empty string. Generalise by type, keep as
    a per-key rule, or drop? Section 3 item 2 pins the string case.
12. **Where validation of `sink.http.endpoint` belongs.** Today the http sink
    throws at construction. Load-time validation would catch it earlier but
    makes the rule conditional on another key's value.

---

## 5. Constraints on how you build it

- **No dependencies and no network.** `package.json` has none and must keep
  having none. The validator is yours to write.
- **Erasable TypeScript only.** The code is run by Node's built-in type
  stripping, so no `enum`, no `namespace`, no parameter properties
  (`constructor(private x: T)`), no decorators, no `declare`-less ambient
  syntax. Use `const` objects and union types instead of enums. If Node fails
  to strip it, `build.sh` and `test.sh` both fail.
- **Imports carry the `.ts` extension.** That is required by the type stripper
  and by the `tsconfig.json` in place.
- **`types/node-builtins.d.ts` stands in for `@types/node`** so `tsc` needs no
  `node_modules`. It is loose on purpose. Do not weaken a configuration type by
  editing it.
- **`build.sh` type-checks when a TypeScript compiler is present** and degrades
  to a parse check with a `TYPE CHECK SKIPPED` note on stderr when it is not.
  Keep that behaviour: a missing compiler must not fail the build, and a type
  error must.
