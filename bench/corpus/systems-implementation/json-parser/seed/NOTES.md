# `json-parser` — implementation notes

## What this workspace is

A partial implementation of `SPEC.md`. The harness protocol is complete, the
grammar is complete for the common path, and numbers are carried as exact
decimals rather than floats. Two requirements from section 15 are not met.

The last graded run of this workspace, against the 639-case conformance suite,
reported:

```
MISMATCH verdict=10 code=13 position=0 canonical=0 protocol=0
SUMMARY total=639 scored=627 passed=604 failed=23 indeterminate=12 crashed=0 timeouts=0 pass_rate=96.33% seconds=0.7
INDETERMINATE 12 case(s): accept=12 (reported, never scored)
```

Every one of the 23 failures is attributable to one of the two unimplemented
requirements below. Nothing crashed and nothing timed out.

## Unimplemented

### R-11 — overlong, surrogate and out-of-range UTF-8

`src/utf8.py:first_ill_formed` classifies a lead byte by range and then
requires the right *number* of continuation bytes in `0x80`–`0xBF`. It does
not apply the per-lead continuation ranges of `SPEC.md` section 5.1, so it
accepts three sequence families the specification calls ill-formed:

- overlong encodings — `E0 80 80`, `F0 80 80 80` and the like, where a scalar
  is spelled with more bytes than it needs;
- encoded surrogates — `ED A0 80` through `ED BF BF`, including CESU-8, where
  a surrogate pair is encoded as two three-byte sequences;
- the lower half of the `E0` and `F0` leads generally.

The one range check that is present is `F4` against `0x90`, because a scalar
above U+10FFFF has no code point to become and the decoder in
`src/utf8.py:scalar_at` could not represent it.

Fixing this means the section 5.1 table, lead by lead. The reported offset must
stay the first byte of the ill-formed sequence.

### R-16 — the maximal numeric run

`src/parser.py:_Reader.read_number` walks the number grammar left to right and
reports at the first byte that does not fit. `SPEC.md` section 6.2 instead
takes the **maximal run** of bytes drawn from `0123456789+-.eE`, requires that
whole run to be a number, and locates the fault at the smallest index whose
prefix is not a prefix of any valid number.

The two rules agree on a run with one fault and disagree on a run with two.
`0.1.2` stops this implementation after `0.1`, so the second `.` is reported as
whatever follows a complete value — `E_TRAILING` at the top level,
`E_UNEXPECTED_BYTE` inside a structure — where the specification wants
`E_BAD_NUMBER` at the same offset. `1e1e1` behaves the same way.

Fixing this means taking the run first and validating it as a unit. The worked
table in section 6.2 is the test list.

## Requirements index

| ID   | Requirement                                                        | Where                                          |
| ---- | ------------------------------------------------------------------ | ---------------------------------------------- |
| R-1  | Parser written from scratch, no JSON library                       | `src/parser.py`, `src/canonical.py`            |
| R-2  | Harness reachable as `bash run.sh --harness`                       | `run.sh`, `src/main.py:main`                   |
| R-3  | Request framing: header, exact-length payload, LF terminator       | `src/main.py:serve`                            |
| R-4  | Binary-safe payloads (NUL, LF, invalid UTF-8, zero length)         | `src/main.py:serve`                            |
| R-5  | `OK` response framing with byte length                             | `src/main.py:respond`                          |
| R-6  | `ERR` response framing with code, offset, line, column, message    | `src/main.py:respond`                          |
| R-7  | stdout flushed per response; diagnostics only on stderr            | `src/main.py:serve`                            |
| R-8  | Harness exit codes                                                 | `src/main.py:serve`                            |
| R-9  | `run.sh` file mode, default mode, usage mode, exit statuses        | `src/main.py:main`, `src/main.py:parse_file`   |
| R-10 | Whole-input UTF-8 validation before parsing                        | `src/parser.py:parse`                          |
| R-11 | Overlong, surrogate, out-of-range and truncated UTF-8 rejected     | **unimplemented** — see above                  |
| R-12 | Leading BOM rejected with `E_BOM`; U+FEFF legal elsewhere          | `src/parser.py:parse`                          |
| R-13 | Exactly four whitespace bytes; `E_EMPTY` for whitespace-only input | `src/parser.py:_Reader.skip_whitespace`        |
| R-14 | Trailing content rejected; top-level scalars accepted              | `src/parser.py:parse`                          |
| R-15 | RFC 8259 number grammar                                            | `src/parser.py:_Reader.read_number`            |
| R-16 | Maximal numeric run and its error offsets                          | **unimplemented** — see above                  |
| R-17 | Exact decimal number model, no float round-trip                    | `src/model.py:Number`                          |
| R-18 | Canonical number form                                              | `src/canonical.py:number_text`                 |
| R-19 | String grammar, escapes, DEL allowed raw                           | `src/parser.py:_Reader.read_string`            |
| R-20 | Raw control characters rejected                                    | `src/parser.py:_Reader.read_string`            |
| R-21 | `\u` escape validation                                             | `src/parser.py:_Reader.read_hex4`              |
| R-22 | Surrogate pairing; lone surrogates rejected                        | `src/parser.py:_Reader.read_escape`            |
| R-23 | Canonical string escaping, ASCII-only, lowercase hex               | `src/canonical.py:string_text`                 |
| R-24 | Array and object grammar                                           | `src/parser.py:_Reader.read_array`, `read_object` |
| R-25 | Duplicate keys accepted, last wins, compared after unescaping      | `src/parser.py:_Reader.read_object`            |
| R-26 | Members sorted by code point                                       | `src/canonical.py:_emit`                       |
| R-27 | Canonical document form, no whitespace, idempotent                 | `src/canonical.py:canonical`                   |
| R-28 | The fourteen error codes                                           | `src/errors.py:CODES`                          |
| R-29 | Error precedence, including EOF outranking the construct           | `src/parser.py:_Reader.eof`                    |
| R-30 | Byte offset, LF-only line counting, byte columns                   | `src/errors.py:locate`                         |
| R-31 | Depth limit 512, error at the offending bracket                    | `src/parser.py:_Reader.read_array`, `read_object` |
| R-32 | Graceful failure on 100000-deep input; process survives            | `src/parser.py:DEPTH_LIMIT`                    |
| R-33 | Indeterminate inputs neither crash nor hang                        | `src/parser.py`, `src/canonical.py`            |
| R-34 | `test.sh` runs `check_io.py` and gates on it                       | `test.sh`                                      |

## Design decisions

- **Exact decimals, not floats.** A `Number` is a sign, a digit string and a
  decimal exponent. `1e400` has no `double`; `9007199254740993` has no `double`
  distinct from its neighbour; a forty-digit integer loses digits the moment it
  becomes one. `src/canonical.py:number_text` follows section 6.4 step for step
  on that triple, so the canonical form is a function of the value and not of
  how the input spelled it.
- **UTF-8 validation is a separate pass.** Section 5 makes stage 1 a
  whole-input scan that precedes parsing, which is what makes an ill-formed
  byte at offset 40 outrank a syntax error at offset 3. Folding the check into
  string scanning would get that backwards.
- **Depth is a counter checked before descending**, so 100000 opening brackets
  cost 100000 loop iterations and 512 stack frames. `src/main.py` raises the
  interpreter's recursion limit because 512 levels of a recursive-descent
  parser is past its default, not because the parser is unbounded.
- **Lone surrogates in decoded strings.** Because R-11 is unimplemented, an
  encoded surrogate reaches `src/utf8.py:scalar_at` and becomes a surrogate
  code point in a Python `str`. `src/canonical.py:string_text` emits it as
  `\udXXX`. That behaviour is a consequence of the gap, not a decision; it
  disappears when R-11 lands.
