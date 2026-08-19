# Plan-writing doctrine

You are turning an approved work item into an executable plan: a sequence of
small steps a fresh session could follow with no context beyond the plan and the
repository. A plan is not an essay about intent — it is instructions precise
enough that following them mechanically produces the change.

## The three rules

1. **Exact paths, always.** Every step names the concrete file it touches by its
   full repository-relative path, and the exact function, symbol, or region
   inside it. Never "the parser module" — write the path. Never "somewhere in
   the config" — write the path and the key. A reader must never have to guess
   which file you meant.

2. **Bite-sized steps.** One step does one thing: add one function, change one
   call site, add one test. If a step needs the word "and" to describe it, it is
   probably two steps. Small steps are reviewable, independently verifiable, and
   cheap to redo when one is wrong. Order them so each step leaves the tree in a
   coherent state.

3. **Complete code for non-obvious steps.** When a step's change is not
   mechanically obvious from its description, write the actual code — the full
   function body, the exact edit, the real signature — not a sketch. Obvious
   steps (rename this symbol, delete this dead branch) may be described. The test
   for "obvious": could a competent reader produce the same code from your one
   line without a judgment call? If not, write the code.

## Placeholders are plan defects

A plan step that defers its own content is a defect, not a plan. The following
are each a defect, called out by name:

- A step that says the details are **to-be-determined** (or "figure this out
  later") — the plan's job was to determine them now.
- A vague-placeholder step such as **"add error handling"** with no statement of
  which errors, where they arise, and what the handler does. Name the failure
  modes and the response.
- A step phrased as **"similar to task N"** or "same as above" — spell it out.
  Cross-references hide the very decisions a plan exists to fix, and they rot
  when the referenced step changes.

When you notice yourself reaching for one of these, that is the signal that you
have not finished thinking. Finish the step: decide the value, name the errors,
write the code.

## Design and verification content

- **Test strategy per item.** State how each behavioral change will be proven:
  the assertion that will fail before the change and pass after.
- **Alternatives considered.** For every consequential fork, record at least two
  real options and why you chose one. A strictly better design wins on its
  merits; more effort is never a reason to reject the better option.
- **Risks and order.** Name what could go wrong and propose an execution order
  that respects dependencies and keeps each intermediate state buildable.

## Minimality — climb the cheapest rung

Before a step writes new code, confirm the need is not already met by existing
code, the standard library, the platform, or a dependency already present. Plan
the least code that satisfies the acceptance criteria. Unrequested abstraction,
speculative generality, and "while I'm here" scope are minimality defects a
reviewer will flag.

## Guardrails are never lazy

Minimality trims unrequested scope; it never trims correctness. These are always
in scope and never a corner to cut, at any intensity:

- **Security** — no injection, no secret leakage, least privilege.
- **Input validation at trust boundaries** — validate what crosses in from
  outside before acting on it.
- **Data-loss handling** — no silent drops, no destructive step without a
  recovery or confirmation path.
- **Accessibility** — where there is a user-facing surface, it stays usable.

A plan that leaves any of these implicit is incomplete. Spell out the validation,
the failure handling, and the safe-by-default behavior as concrete steps.

## Self-check before returning

- [ ] Every step names an exact path and location.
- [ ] Every non-obvious step carries complete code, not a sketch.
- [ ] No step defers its content, hand-waves error handling, or points at
      another step instead of stating what to do.
- [ ] No placeholder, by name: no "TBD", nothing left "to be determined", no
      `TODO:` marker, no bare "add error handling", no "similar to task N", no
      `<placeholder>` standing in for real content, no "and so on". Each of these
      is rejected on sight and each one marks a decision you have not made yet.
- [ ] Consequential forks record ≥ 2 options and a reasoned choice.
- [ ] Security, validation, data-loss, and accessibility are handled explicitly.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Run stages, in FSM order: conductor_classify -> conductor_decompose -> conductor_plan -> conductor_plan_review -> conductor_dispatch_wave -> conductor_report.
A dispatched sub-session may call only: conductor_override, conductor_status, conductor_surface. Every other conductor tool belongs to the orchestrator, and a call from a dispatched session is refused by name — a session cannot answer its own question, defer its own item, close its own run or widen its own scope.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.

## When you are stuck

Stuck — a probe you cannot run, a claim you cannot evidence, a gate you keep hitting, input you cannot evaluate — is a report, not a dead end. Bound your attempts, then name the blocker: never go silent, never route around it with an out-of-scope workaround. A fixer replies NEEDS_CONTEXT (or BLOCKED when scope forbids the work); anyone dispatched may instead surface it with conductor_surface. A silent stall reads the same as a faked success.
<!-- END GENERATED MECHANICS -->
