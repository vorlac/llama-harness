# Phase 11 gate — red-team-by-data probe (schema observer)

Plan §7.2 mandates this probe for Phase 11: "a lens returns only {candidates:[…]} — ≥10
malformed requests for 11.6. **You** execute all of them against the exported pure function
and compare to expected verdicts. An admitted input is a **mechanically confirmed** finding."

Executed by the orchestrator on 2026-08-14 against the COMMITTED `observe_request`
(router/schema-observer.hpp), via a standalone harness compiled outside the build tree.

## The rule being tested

The router OBSERVES and never ENFORCES. It must never fail a request the direct path would
have served. So for every one of these, the correct verdict is PROXY (recording
`schemaMissing` where no schema is declared) — never a rejection, never a throw.

```
candidate                                | tagged | missing | hasSchema | threw?
------------------------------------------------------------------------------------------------
tagged, valid json_schema                | yes    | no      | yes      | no
tagged, NO schema at all                 | yes    | yes     | no       | no
untagged, no schema                      | no     | no      | no       | no
tagged, body is not JSON                 | yes    | yes     | no       | no
tagged, body is empty                    | yes    | yes     | no       | no
tagged, JSON but not an object           | yes    | yes     | no       | no
tagged, response_format null             | yes    | yes     | no       | no
tagged, json_schema no schema            | yes    | yes     | no       | no
tagged, empty schema object              | yes    | yes     | no       | no
tagged, duplicate keys                   | yes    | yes     | no       | no
tagged, top-level json_schema            | yes    | no      | yes      | no
tagged, grammar only                     | yes    | no      | no       | no
schemaHeader unknown value               | no     | no      | no       | no
schemaHeader empty string                | no     | no      | no       | no
tagged, deeply nested schema             | yes    | no      | yes      | no
tagged, schema is a string               | yes    | yes     | no       | no
tagged, response_format array            | yes    | yes     | no       | no
tagged, model is an array                | yes    | no      | yes      | no
tagged, truncated JSON                   | yes    | yes     | no       | no
tagged, json_object not schema           | yes    | yes     | no       | no
```

## Verdict: PASS, mechanically

20 hostile shapes — not JSON at all, empty, a bare array, truncated mid-key, duplicate keys,
`response_format` null / array / with a string schema, an empty schema object, a model field
that is an array, an unknown and an empty tag header, grammar-only, and a deeply nested
schema. **Nothing threw. Nothing was rejected.**

Every malformed body resolves to `tagged=yes, schemaMissing=yes, hasSchema=no`, which is the
11.6 bullet's requirement in so many words: a tagged request without an extractable schema is
proxied unchanged and COUNTED, not refused.

Three results worth naming because they are easy to get wrong and are right here:

- **grammar-only** is `tagged, NOT missing, no declared schema` — GBNF is a real declaration
  the JSON validator simply cannot check, so calling it "missing" would be a lie and
  rejecting it would fail a request llama-server serves natively.
- **an unknown or empty `X-Conductor-Schema` value** is observed UNTAGGED rather than
  half-tagged. Under `rejectOnMissing:true` the narrow reading is the only G5-safe one.
- **a top-level `json_schema`** (arm c) is recognised, so the observer is not keyed solely to
  the OpenAI `response_format` spelling.

## What this probe does NOT cover, stated so the PASS is not read too widely

It exercises the pure `observe_request` seam, not the HTTP path. It therefore says nothing
about the opt-in `rejectOnMissing:true` 400 envelope, about header-vs-body tag precedence as
wired in the handler, or about what happens to these bodies once they reach a real upstream.
Those are the lens reviewers' territory, not this probe's.
