# Conductor Review — findings index

The full-system adversarial review of the conductor harness. The campaign that produced these
documents has run; what is kept here is its **output**, not its method.

`docs/build/HANDOFF.md` names the three merged registers below as the evidence authority, and
`docs/build/fix-campaign-plan.md` resolves its `ISSUE-`, `MACRO-` and `GAP-` ids against them.

## The registers — start here

| Document | Holds |
|---|---|
| [findings-enforcement.md](findings-enforcement.md) | `ISSUE-001`…`ISSUE-142` — enforcement and subsystem defects, with reproductions and mutation transcripts |
| [findings-macro.md](findings-macro.md) | `MACRO-001`…`MACRO-034` — layering, navigability, process and forward-fitness |
| [findings-capability.md](findings-capability.md) | `GAP-001`…`GAP-048` — missing mechanisms and doctrine efficacy |

## Decisions

| Document | Holds |
|---|---|
| [step5-decisions.md](step5-decisions.md) | The governing design premise — trust lives in the harness, not the orchestrator — and the D-numbered decisions the correction campaign executes against |
| [step5-preflight-review.md](step5-preflight-review.md) | The corrections applied in place to the registers before step 5 |

## Supporting evidence

Retained because a register above delegates specific content to it rather than reproducing it:

- [parts/sweep-vocabulary.md](parts/sweep-vocabulary.md) — the complete `V1`–`V35` vocabulary inventory (`findings-enforcement.md` §7 points here)
- [parts/sweep-corrections.md](parts/sweep-corrections.md) — the 92-row correction recurrence table
- [parts-macro/](parts-macro/) — `fitness-forward`, `layering-coherence`, `navigability`, `process-and-docs`
- [parts-capability/](parts-capability/) — `missing-mechanisms`, `doctrine-efficacy`

The remaining per-agent subsystem audits were merged into the registers and are not kept; their
findings all resolve by id in the three documents above.
