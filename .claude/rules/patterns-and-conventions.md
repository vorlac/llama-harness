# Patterns and Conventions Reference

Standard patterns and conventions used throughout llama-harness, aligned with modern C++ best practices and the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines).

The repository holds two bodies of source under different rules: C++23 under `router/`, `dashboard/` and `tools/`, and TypeScript under `conductor/`. Where a rule applies to only one of them, this document says so. For the commands that check these rules mechanically, see [verification-commands.md](verification-commands.md).

---

## No Backwards Compatibility

**MANDATORY:** This codebase does not maintain backwards compatibility. When code is refactored, moved, or replaced:

1. **Delete all old code** — No legacy wrappers, re-exports, or compatibility shims
2. **Update all call sites** — Every reference must point to the new location
3. **Remove unused files** — Files that only exist to re-export moved code must be deleted
4. **No transition periods** — Changes are atomic; old and new never coexist

This is why no module under `conductor/` exists solely to re-export another module's symbols: a barrel is exactly the shim the rule forbids. Import the defining module directly. (`conductor/plugin/index.ts` is an entry point, not a barrel — it exports one plugin factory, which is what the opencode loader requires.)

### Prohibited Patterns

```cpp
// PROHIBITED: Re-export wrapper for moved code
#include "router/config.hpp"
namespace old_location {
    using conductor::router::RouterConfig;  // NO! Delete this file entirely
}

// PROHIBITED: Legacy aliases
using OldName = NewName;  // NO! Update all call sites instead
```

```ts
// PROHIBITED: barrel that re-exports a moved module
export { decide } from "./decide.ts";  // NO! Import ./decide.ts at the call site
```

---

## C++ Layout and Naming

The repository root is the only user-code include root. Every in-workspace header is included by its full path from the root, so an include names where the header actually lives no matter which file includes it:

```cpp
#include "router/config.hpp"
#include "dashboard/ledger_view.hpp"
```

The router is header-only apart from `router/main.cpp`, so both `llama-router` and `router-tests` pick up the same definitions without a translation unit of their own. Its symbols live in `namespace conductor::router` and the dashboard's in `namespace conductor::dashboard`, each with implementation helpers under a nested `namespace detail`. `tools/membench` is deliberately outside that tree and uses its own `namespace membench`.

| Kind | Convention | Example |
|------|------------|---------|
| Type | `PascalCase` | `RouterConfig`, `AdmissionController`, `SchemaObservation` |
| Function | `lowerCamelCase` | `parseRouterConfig`, `computeTaskQueueThreads` |
| `Router` / `AdmissionController` observer, and the schema-observer and version free functions | `snake_case` | `listen_port`, `schema_missing_count`, `inflight_count`, `observe_request`, `router_version` |
| Every other function, pure or not | `lowerCamelCase` | `parseCli`, `parseRouterConfig`, `nextRead`, `maxDistinctInflightModels`, `parseLedgerLine` |
| Private data member | trailing underscore | `inflight_`, `maxQueued_`, `field_` |
| Compile-time constant | `k` prefix | `kRouterVersion`, `kRelayTimeoutSeconds` |

Formatting is not a matter of taste here: `.clang-format` is the definition, and configuring CMake with `AUTOFORMAT_SRC_ON_CONFIGURE=ON` (the default) rewrites the sources in place.

---

## Common Modernization Patterns

### Pattern 1: Primitive Sprawl → Structured Types

Config is parsed once into nested value structs rather than passed around as loose fields.

```cpp
// BEFORE
void configure(const std::string& listen_host, int listen_port,
               const std::string& upstream_host, int upstream_port);

// AFTER  (router/config.hpp)
struct Endpoint {
    std::string host;
    int port{};
};

struct RouterConfig {
    Endpoint listen;
    Endpoint upstream;
    Admission admission;
    // ...
};
```

### Pattern 2: Raw Pointer + Length → std::span

```cpp
// BEFORE
CliParse parseCli(const char** argv, int argc);

// AFTER  (router/cli.hpp)
[[nodiscard]] CliParse parseCli(std::span<const std::string_view> args);
```

### Pattern 3: Output Parameters → Return Values

A parse returns one value carrying every outcome, so no caller can read a half-filled output.

```cpp
// BEFORE
bool parse(std::span<const std::string_view> args, CliOptions* out, std::string* error);

// AFTER  (router/cli.hpp)
struct CliParse {
    std::optional<CliOptions> options;  // engaged iff the parse succeeded
    std::string error;                  // empty on success
    std::string usage;                  // non-empty on every refusal and on --help
};
```

### Pattern 4: Free Functions Over Class Hierarchies

The C++ tree declares no virtual functions of its own, and inherits only where a third-party interface requires it: `ConfigError` extends `std::runtime_error` (router/config.hpp:99), and `detail::FirstViolation` implements json-schema-validator's one virtual `error()` callback (router/config.hpp:203). Behaviour that can be expressed as a pure function of its arguments is one — `observe_request`, `nextRead`, `maxDistinctInflightModels`, `parseCli` — which is what makes it reachable from `router-tests` without a socket, a clock or a config file. State that genuinely needs a lifetime gets a plain class (`AdmissionController`, `MetricsLedger`, `Router`).

Keeping the pure half pure is the load-bearing part. The socket is the one thing confined to the adapter layer (`Router`, `main.cpp`). Filesystem and clock access is not: `parseRouterConfig` reads the schema file (router/config.hpp:224), `MetricsLedger` owns the ledger `std::ofstream` (router/metrics.hpp:241) and `AdmissionController::admit` reads `steady_clock` (router/admission.hpp:162) — each sitting with the state it serves, with the pure decision it needs factored out beside it.

### Pattern 5: Closed Vocabularies Over Free Strings (TypeScript)

`conductor/tsconfig.json` sets `erasableSyntaxOnly`, so TypeScript `enum`, `namespace` and constructor parameter properties do not compile. A closed set is an as-const array plus a derived union, which gives one source for both the type and the runtime schema's enum members:

```ts
export const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
```

`conductor/core`, `conductor/adapter` and `conductor/plugin` declare no classes at all: modules export functions, `const` values, `interface`s and `type`s.

---

## Ownership and Resource Management

### Smart Pointer Guidelines

| Pointer Type | Ownership | Use When |
|--------------|-----------|----------|
| `std::unique_ptr<T>` | Exclusive | Default choice for heap allocation |
| `std::shared_ptr<T>` | Shared | Multiple owners truly needed |
| `std::weak_ptr<T>` | Non-owning | Breaking cycles, optional observers |
| `T*` (raw pointer) | Non-owning | Observing, never owning |
| `T&` (reference) | Non-owning | Required access, never null |

`std::shared_ptr` is not a smell in the relay path: an upstream call outlives the handler frame that started it, and the relay state, the httplib client and the ledger guard are all genuinely co-owned by the handler thread and the relay thread.

### RAII Pattern

The router's per-request ledger line is written by a destructor rather than by a return path, so every exit — the buffered return, the streamed completion, the capacity refusal, the 502 — yields exactly one line and none can be forgotten:

```cpp
// router/router.hpp — one guard per request; ~LedgerGuard writes the line.
const auto ledgerGuard = std::make_shared<detail::LedgerGuard>(metrics_);
```

The same shape governs an admission slot: the slot is released when its holder dies, not at a `return` a later edit could route around.

### Non-copyable Types

A type owning a mutex or a counter table deletes copying explicitly rather than relying on the reader to notice:

```cpp
// router/admission.hpp
AdmissionController(const AdmissionController&) = delete;
AdmissionController& operator=(const AdmissionController&) = delete;
```

### Rule of Zero

Prefer types that need no destructor at all: a struct of `std::string`, `std::optional` and `std::vector` members cleans itself up. Write the full set of five only when a resource genuinely demands it.

---

## Function Parameter Guidelines

| Intent | Parameter Type | Example |
|--------|---------------|---------|
| Input (cheap to copy) | `T` (by value) | `void set_port(int port)` |
| Input (expensive) | `const T&` | `SchemaObservation observe_request(const RequestTags& tags, const std::string& body)` |
| Input (move from) | `T&&` | `sendBuffered(httplib::Response&, const std::string& contentType, std::string&& body)` |
| Input/Output | `T&` | `void readUsageFromBody(const std::string& body, RequestRecord& entry)` |
| Output (prefer return) | Return value | `[[nodiscard]] CliParse parseCli(...)` |
| Optional input | `const std::optional<T>&` | `admit(const std::string& model, const std::optional<std::string>& priority, ...)` |

Nothing in this tree takes a `std::unique_ptr` parameter. Where ownership genuinely outlives a frame — the relay state, the httplib client, the ledger guard, the admission slot — it is co-owned via `std::shared_ptr`, as the relay path below shows.

Prefer `std::optional<T>` to a nullable pointer for an absent value. `RequestTags` models all four conductor tags as `std::optional<std::string>`, so "absent" and "empty" are the same thing by construction and no call site has to remember which sentinel means which.

---

## const Correctness

```cpp
// 1. Make member functions const if they don't modify state
[[nodiscard]] int listen_port() const;
[[nodiscard]] std::uint64_t schema_missing_count() const;

// 2. Use const for parameters that shouldn't be modified
SchemaObservation observe_request(const RequestTags& tags, const std::string& body);

// 3. Use constexpr for compile-time constants
inline constexpr int kUpstreamConnectTimeoutSeconds = 5;
```

A `const` observer that takes a lock internally is still `const`: the mutex is the implementation detail, and the caller's contract is that the value does not change under it.

---

## Modern Attributes

### [[nodiscard]]

Used on every function whose return value is the whole point of calling it — parses, observers, verdicts.

```cpp
[[nodiscard]] CliParse parseCli(std::span<const std::string_view> args);
[[nodiscard]] std::size_t maxDistinctInflightModels(int maxInflightPerModel);
[[nodiscard]] const AdmissionController& admission() const;
```

### noexcept

Reserved for the places where the guarantee is load-bearing and provable, not applied by habit. `nextRead` in `dashboard/ledger_view.hpp` is `noexcept` because it is the one step of the tail loop that must not throw, and `router/tests/dashboard_test.cpp` pins that with a `static_assert`. Everything else that could carry it does not: no move operation or `swap` is written anywhere in the tree, and the four destructors rely on the implicit `noexcept` rather than restating it.

---

## Error Handling Patterns

There is no `Result<T>` type in this repository. The C++ side uses three mechanisms and nothing else:

| Situation | Mechanism | Example |
|-----------|-----------|---------|
| Invalid configuration | Throw `ConfigError`, caught once in `main` | `parseRouterConfig` throws; `main.cpp` maps it to exit code 3 |
| "Not found" / "No value" | `std::optional<T>` | `RequestTags::role`, `SchemaObservation::schemaConformed` |
| A closed set of outcomes | `enum class` | `AdmissionOutcome::{Admitted, TimedOut, Overflowed}` |
| A compile-time invariant | `static_assert` | `nextRead` is pinned `noexcept` by one |

`ConfigError` carries the offending field alongside the message and guarantees structurally that `what()` contains `field()`, so the operator-facing error names the key that failed:

```cpp
// router/config.hpp
class ConfigError : public std::runtime_error {
public:
    ConfigError(std::string field, const std::string& message);
    [[nodiscard]] const std::string& field() const noexcept;
};
```

Exceptions do not cross into the request path. A request handler that cannot reach the upstream mints an error *response*, never a throw: the router's governing rule is that it never turns a request the direct path would have served into an error.

---

## Comment Standards

### Prohibited Language

- Change words: "changed", "updated", "modified", "fixed", "refactored"
- Temporal: "now", "new", "previously", "old", "formerly"
- Context: "added for", "per request", "by Claude", "AI-generated"

The reason is not style. A comment that narrates an edit is written for a reader who saw the previous version, and every later reader is a reader who did not — so the narration is dead weight at best and a description of code that does not exist at worst. Describe what the code does and why, in the present tense.

`conductor/tests/comment-hygiene.test.ts` mechanizes six of these words — `changed`, `updated`, `fixed`, `now`, `new`, `previously` — over comment text in `conductor/core`, `conductor/adapter` and `conductor/plugin`. It reads comments only, so a call site like `journal.log("item.updated", …)` is untouched, and it excludes backtick-quoted identifiers, because demanding that `` `item.updated` `` be reworded would demand that a comment lie about what it points at. `conductor/adapter/tools.ts` is held to a ratcheting ceiling rather than zero: its hits are spec vocabulary, and the ceiling may fall and may never rise.

The C++ and Python trees follow the same rule but are reviewed by hand.

### Prohibited Comment Patterns

- **`///` and `///<`**: Use `//` for single-line and trailing comments, `/** */` for block documentation.
- **`@brief`**: The first sentence of a block comment is the brief. Do not label it.
- **`@name` groupings**: No Doxygen grouping constructs.

### When to Use Each Format

**Use `//` for:**
- File-head explanations of what a module is and why it exists
- Function and member descriptions
- Trailing clarifications on a struct field

```cpp
// Monotonic count of tagged-and-missing requests since construction, never
// reset. Per Router instance, not process-global.
[[nodiscard]] std::uint64_t schema_missing_count() const;

std::string schemaPath;     // value of the REQUIRED --schema <path>
```

**Use `/** */` for:**
- A class whose contract needs more than a sentence
- A function with several parameters that each need explaining

```cpp
/**
 * Per-model concurrency caps with one priority-ordered wait queue.
 *
 * @param model the request body's `model` field; an absent or unusable one
 *        buckets under the reserved empty-string key.
 * @param priority an empty optional and any unrecognized value both order as
 *        interactive.
 */
```

Both C++ and TypeScript files open with a header comment naming the module, what it is responsible for, and the constraint it is written against. A long header explaining a non-obvious decision is welcome; a comment restating the line below it is not.

---

## Success Criteria

All work must satisfy:

- `bash scripts/test-conductor.sh` prints `GATE PASS`
- `cmake --build .out/build/<preset> --target router-tests` succeeds and `ctest --test-dir .out/build/<preset>` is green
- `bash scripts/conductor-gate.sh` passes over the tracked sources
- Public APIs use typed interfaces — no `void*`, no untyped payloads
- Descriptive names; C++23 and modern TypeScript features where they clarify
- New behaviour arrives with a test that fails without it

Warning flags are per-target rather than global: `tools/membench` compiles with `-Wall -Wcast-align -Wpedantic -Wno-unused-parameter` under Clang/GNU (`/W4` under MSVC), and the router targets set none. Treat a compiler warning as a defect regardless.

---

## References

- [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines)
- [verification-commands.md](verification-commands.md) — the commands that check the rules above
