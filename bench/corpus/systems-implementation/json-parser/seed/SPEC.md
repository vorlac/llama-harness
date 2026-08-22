# `json-parser` — normative specification

The subject is a JSON parser conforming to RFC 8259, written from scratch, with
a documented canonical serialisation, a documented nesting limit, and errors
that carry a byte offset, a line and a column. RFC 8259 leaves a handful of
things to the implementation. **Every one of them is pinned below.** Two
independent implementations that follow this document must agree, byte for
byte, on every one of the 639 cases the conformance suite holds.

This workspace ships a partial implementation of that parser. `README.md` says
what is here; `NOTES.md` names the requirements from section 15 it does not yet
meet. The conformance suite is not in this workspace and cannot be read from
it: it is run against the finished harness from outside, after the work is
done.

Everything here is normative unless a paragraph is marked *Note*.

---

## 1. Conventions used in this document

- **Byte** means an octet. **Offset** means a zero-based index into the input
  byte string. Lengths, offsets and counts are decimal integers with no leading
  zeros and no sign.
- **LF** is `0x0A`, **CR** is `0x0D`, **TAB** is `0x09`, **SP** is `0x20`.
- `U+XXXX` is a Unicode scalar value. **Scalar value** excludes the surrogate
  range `U+D800`–`U+DFFF`.
- Grammar fragments use ABNF-flavoured regular expressions. They are anchored
  and ASCII-only. Nothing here requires a regex engine, and a parser that uses
  one is unlikely to hit the offsets in section 9.
- "The parser" is the library under `src/`. "The harness" is the thin wrapper
  around it defined in section 3. "The runner" is the conformance runner,
  which drives the harness through that protocol from outside this workspace.

---

## 2. What you build

Two things, in Python:

1. **A parser library**, written from scratch. No third-party JSON library, no
   JSON parser from the language's standard library, no JSON parser hidden
   behind another dependency (a config loader, a serialisation framework, a
   test fixture helper). You may use the standard library for I/O, containers,
   strings, integers and big integers.
2. **A harness** exposing that library through the protocol in section 3,
   reachable as `bash run.sh --harness`.

The parser must produce, for every accepted input, an in-memory value that the
serialiser in sections 6 to 8 turns into the canonical form. A "parser" that
canonicalises by rewriting the input text without building a value will fail
the object cases in section 8.

---

## 3. The harness protocol

This is the only interface the conformance suite uses. It is deliberately
byte-oriented: test inputs include invalid UTF-8, NUL bytes and inputs with no
trailing newline, none of which survive a line-oriented or argv-based channel.

### 3.1 Invocation

```
bash run.sh --harness
```

The process reads requests from **stdin** and writes responses to **stdout**
until stdin reaches end of file. Requests are answered one at a time, in order.
Requests are independent: no state carries from one to the next.

- stdout carries **only** protocol bytes. Every diagnostic, timing, log line or
  progress indicator goes to stderr.
- The process **must flush stdout after every response**. The runner writes one
  request and then blocks waiting for its response; a harness that buffers its
  output will deadlock and score zero.
- stdin and stdout are binary streams. On platforms with a text mode, put both
  in binary mode.

### 3.2 Request frame

```
CASE <id> <length>\n
<length bytes, exactly>\n
```

- `CASE` is literal ASCII. Fields are separated by exactly one SP.
- `<id>` matches `[A-Za-z0-9._:~-]+` and is at most 80 bytes.
- `<length>` is decimal, no leading zeros (except the single digit `0`), no
  sign. It may be `0`.
- Exactly `<length>` bytes of payload follow the header LF. The payload is the
  JSON document under test and may contain any byte value, including LF and
  NUL. **Do not treat the payload as text and do not stop at a newline.**
- Exactly one LF follows the payload. It is a frame terminator, not part of the
  document.
- The largest payload the suite sends is 1048578 bytes: a 1 MiB string literal
  plus its two quotes, one of the indeterminate inputs of section 11. A harness
  that refuses payloads above 16 MiB is conforming.

### 3.3 Response frames

Exactly one response per request, in request order.

Accepted input:

```
OK <id> <length>\n
<length bytes of canonical form>\n
```

Rejected input:

```
ERR <id> <code> <offset> <line> <column> <message-length>\n
<message-length bytes of message>\n
```

- `<id>` echoes the request id exactly.
- `<length>` is the byte length of the canonical form (sections 6 to 8). The
  canonical form is always printable ASCII (`0x20`–`0x7E`) and contains no LF.
- `<code>` is one of the fourteen codes in section 9.1, spelled exactly.
- `<offset>`, `<line>`, `<column>` are defined in section 9.3. `offset` is
  zero-based; `line` and `column` are one-based, so both are always ≥ 1.
- `<message-length>` is the byte length of the human-readable message. The
  message must be non-empty, valid UTF-8, and must not contain LF. Its wording
  is free: nothing compares it, but an empty message fails the case.
- Exactly one LF follows each payload.

### 3.4 Exit codes

| Code          | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| 0             | stdin reached EOF and every request received a response                   |
| 2             | a malformed request frame (bad header, short payload, missing terminator) |
| Anything else | a defect; the runner reports the run as crashed                           |

A rejected document is **not** an error of the harness. The harness answers
`ERR` and carries on. The process exits non-zero only when the *protocol* is
broken.

### 3.5 Worked exchange

Request bytes (`·` marks the LF that terminates each line, shown only here):

```
CASE ex-01 17·
{"b":1,"a":[1,2]}·
CASE ex-05 4·
[1,]·
```

Response bytes:

```
OK ex-01 17·
{"a":[1,2],"b":1}·
ERR ex-05 E_UNEXPECTED_BYTE 3 1 4 24·
unexpected ']' after ','·
```

`reference-io/` holds this exchange and sixteen more as ready-to-pipe files.
See section 12.

---

## 4. `run.sh` command line

`run.sh` is invoked with the workspace root as the working directory. Nothing
here carries an execute bit, so it is reached as `bash run.sh` rather than
`./run.sh`, and that is the command the conformance runner is given.

| Invocation              | Behaviour                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash run.sh --harness` | Protocol mode, section 3. Exit 0 at EOF.                                                                                                                                    |
| `bash run.sh <path>`    | Parse the file at `<path>`. On accept, write the canonical form followed by one LF to stdout and exit 0. On reject, write nothing to stdout, one line to stderr, and exit 1. |
| `bash run.sh`           | Exactly as `bash run.sh sample.json`.                                                                                                                                       |
| Anything else           | Usage message on stderr, exit 2.                                                                                                                                            |

`run.sh` must never read stdin unless `--harness` was given.

The stderr line for a rejected file is:

```
error: <CODE> at byte <offset>, line <line>, column <column>: <message>
```

`sample.json` ships in the workspace. Its canonical form is exactly:

```
{"limits":{"codes":14,"depth":512},"missing":null,"name":"json-parser","numbers":[0,-0,1.5,1e400,0.0000001],"ok":true,"text":"caf\u00e9 / ok\t!","unicode":"\ud83d\ude00"}
```

---

## 5. Input pipeline

A document is processed in five stages, in this order. **The order is
normative**: it decides which error a document with several faults reports.

| Stage | Check                                                    | Code on failure  |
| ----- | -------------------------------------------------------- | ---------------- |
| 1     | The whole input is well-formed UTF-8 (section 5.1)       | `E_INVALID_UTF8` |
| 2     | The input does not begin with a UTF-8 BOM (section 5.2)  | `E_BOM`          |
| 3     | The input is not empty or whitespace-only (section 5.3)  | `E_EMPTY`        |
| 4     | The input parses as one JSON value (sections 6 to 8, 10) | various          |
| 5     | Only whitespace follows that value (section 5.4)         | `E_TRAILING`     |

*Note:* stage 1 is a whole-input scan and it precedes parsing, so a document
with a syntax error at byte 3 and an invalid UTF-8 byte at byte 40 reports
`E_INVALID_UTF8` at byte 40. This is a deliberate choice that removes an
otherwise unresolvable ambiguity; it means a conforming implementation cannot
be a pure streaming parser. Two cases in the suite's `utf8` group pin it.

### 5.1 UTF-8 well-formedness

The input must be well-formed UTF-8 as defined by the Unicode standard, i.e.
match this byte grammar end to end:

| Lead      | Continuations                 | Encodes           |
| --------- | ----------------------------- | ----------------- |
| `00`–`7F` | —                             | U+0000–U+007F     |
| `C2`–`DF` | one `80`–`BF`                 | U+0080–U+07FF     |
| `E0`      | `A0`–`BF`, then `80`–`BF`     | U+0800–U+0FFF     |
| `E1`–`EC` | two `80`–`BF`                 | U+1000–U+CFFF     |
| `ED`      | `80`–`9F`, then `80`–`BF`     | U+D000–U+D7FF     |
| `EE`–`EF` | two `80`–`BF`                 | U+E000–U+FFFF     |
| `F0`      | `90`–`BF`, then two `80`–`BF` | U+10000–U+3FFFF   |
| `F1`–`F3` | three `80`–`BF`               | U+40000–U+FFFFF   |
| `F4`      | `80`–`8F`, then two `80`–`BF` | U+100000–U+10FFFF |

Everything else is ill-formed: bytes `C0`, `C1`, `F5`–`FF`, stray continuation
bytes, overlong encodings, encodings of surrogates (`ED A0 80`), encodings
above U+10FFFF, and truncated sequences at end of input.

The reported offset is the offset of the **first byte of the ill-formed
sequence** — the lead byte, or the stray continuation byte itself.

*Note:* CESU-8 (a surrogate pair encoded as two three-byte sequences) is
ill-formed here, because each half is an encoded surrogate.

### 5.2 Byte order mark

**Decision:** a UTF-8 BOM (`EF BB BF`) at offset 0 is **rejected** with
`E_BOM` at offset 0, line 1, column 1. RFC 8259 permits either behaviour; this
task pins rejection.

Anywhere else, those bytes are simply U+FEFF: legal inside a string, and
`E_UNEXPECTED_BYTE` where a value or structural character was expected.

### 5.3 Whitespace and empty input

Whitespace is exactly four bytes: SP, TAB, LF, CR. It is permitted before the
document, after the document, and between any two tokens. Nothing else is
whitespace — not vertical tab (`0x0B`), not form feed (`0x0C`), not NBSP
(U+00A0), not U+2028, not U+3000.

An input that is empty, or contains only whitespace, is rejected with
`E_EMPTY` at offset = input length.

Comments do not exist. `//`, `/* */` and `#` are `E_UNEXPECTED_BYTE`.

### 5.4 Trailing content

After the single top-level value, only whitespace may follow. The first
non-whitespace byte after it is `E_TRAILING`, reported at that byte's offset.
Any top-level value is legal, including a scalar: `true`, `1`, `"x"` are
complete documents.

---

## 6. Numbers

### 6.1 Grammar

```
number = [ "-" ] int [ frac ] [ exp ]
int    = "0" / ( %x31-39 *DIGIT )
frac   = "." 1*DIGIT
exp    = ( "e" / "E" ) [ "+" / "-" ] 1*DIGIT
```

No leading `+`. No leading zeros in `int` (`01` is invalid, `0.1` and `-0` are
valid). A `.` must be followed by at least one digit. An `e` must be followed
by at least one digit, optionally after a sign. Leading zeros **are** allowed
in the exponent: `1e00`, `1e007` and `1e0000000000000000000000005` are all
valid. `Infinity`, `-Infinity`, `NaN`, `0x10`, `1_000` and `.5` are not
numbers.

### 6.2 The numeric run — how a bad number is located

A number token begins where a value is expected and the next byte is `-` or a
digit. From there the parser takes the **maximal run** of bytes drawn from the
set

```
0 1 2 3 4 5 6 7 8 9 + - . e E
```

and that whole run must be a number per section 6.1. This rule exists so that
every implementation reports the same offset for every malformed number.

Let *R* be the run and *start* its offset. Then:

- If *R* is a complete number, the token is that number. Parsing continues at
  the byte after the run.
- Otherwise, let *k* be the smallest index such that `R[0..k]` is not a prefix
  of any valid number. If such a *k* exists, the error is `E_BAD_NUMBER` at
  offset `start + k`.
- Otherwise *R* is a proper prefix of a valid number (`1.`, `1e`, `-`). The
  offending position is the byte just past the run. If that position is end of
  input, the error is `E_UNEXPECTED_EOF` at offset = input length; otherwise it
  is `E_BAD_NUMBER` at that offset.

Worked examples:

| Input   | Run     | Error               | Offset |
| ------- | ------- | ------------------- | ------ |
| `01`    | `01`    | `E_BAD_NUMBER`      | 1      |
| `-01`   | `-01`   | `E_BAD_NUMBER`      | 2      |
| `1..1`  | `1..1`  | `E_BAD_NUMBER`      | 2      |
| `0.1.2` | `0.1.2` | `E_BAD_NUMBER`      | 3      |
| `1e1e1` | `1e1e1` | `E_BAD_NUMBER`      | 3      |
| `1e+-2` | `1e+-2` | `E_BAD_NUMBER`      | 3      |
| `--1`   | `--1`   | `E_BAD_NUMBER`      | 1      |
| `[1.]`  | `1.`    | `E_BAD_NUMBER`      | 3      |
| `[-]`   | `-`     | `E_BAD_NUMBER`      | 2      |
| `1.`    | `1.`    | `E_UNEXPECTED_EOF`  | 2      |
| `1e`    | `1e`    | `E_UNEXPECTED_EOF`  | 2      |
| `-`     | `-`     | `E_UNEXPECTED_EOF`  | 1      |
| `0x1`   | `0`     | `E_TRAILING`        | 1      |
| `1 2`   | `1`     | `E_TRAILING`        | 2      |
| `[0x1]` | `0`     | `E_UNEXPECTED_BYTE` | 2      |
| `+1`    | —       | `E_UNEXPECTED_BYTE` | 0      |
| `.5`    | —       | `E_UNEXPECTED_BYTE` | 0      |

*Note:* `x` is not in the run character set, so `0x1` is the complete number
`0` followed by trailing junk. That is why it is `E_TRAILING` at the top level
and `E_UNEXPECTED_BYTE` inside an array. This is the intended reading.

### 6.3 Numeric value model

**Decision:** a number is carried as an **exact decimal**, not as a binary
float. Concretely, it is a triple (sign, digit string, decimal exponent) with
no precision loss and no overflow to infinity. `1e400`, `1e-400`,
`5e-324` and a forty-digit integer all round-trip exactly.

An implementation is free to *also* compute a `double` for its own users, but
the canonical form is defined on the exact decimal. Implementations that parse
into a `double` and print it back fail a large block of the suite's
`numbers-accept` group — that block is there precisely to catch it.

The exponent must be handled as at least a signed 64-bit integer. Exponents
outside that range are indeterminate (section 11).

### 6.4 Canonical number form

Given the lexeme, compute:

1. `neg` = the lexeme starts with `-`.
2. `mant` = the digits before `e`/`E`, `exp` = the integer after it (`0` when
   absent; a leading `+` and leading zeros are consumed here).
3. Split `mant` at `.` into `ip` and `fp` (`fp` empty when there is no `.`).
4. `D` = `ip` concatenated with `fp`; `E` = `exp - len(fp)`.
5. Strip leading zeros from `D`. If `D` is now empty, the value is zero: emit
   `-0` if `neg`, else `0`. Stop.
6. Strip trailing zeros from `D`, adding one to `E` for each zero stripped.
7. Let `n = len(D)` and `adj = E + n - 1` (the exponent of the leading digit).
8. Emit, with a leading `-` if `neg`:
   - if `E >= 0` and `adj <= 20`: `D` followed by `E` zeros;
   - else if `E < 0` and `adj >= -7`:
     - if `adj >= 0`: `D[0..adj]` `.` `D[adj+1..]`
     - else: `0.` then `-adj-1` zeros then `D`;
   - else: `D[0]`, then `.` and `D[1..]` when `n > 1`, then `e`, then `adj` as
     a decimal integer with a `-` when negative and no `+` when positive.

The result matches `-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?|-?[1-9](\.[0-9]*[1-9])?e-?[1-9][0-9]*`
in every case, and it re-parses to the same value: canonicalisation is
idempotent, and the runner checks that by feeding every canonical form back in.

| Input                                       | Canonical                                     | Why                                     |
| ------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| `0`                                         | `0`                                           |                                         |
| `-0`                                        | `-0`                                          | the sign of zero is preserved           |
| `-0.0e-0`                                   | `-0`                                          |                                         |
| `1.0`                                       | `1`                                           | trailing fraction zeros dropped         |
| `1.00`                                      | `1`                                           |                                         |
| `100.0`                                     | `100`                                         |                                         |
| `0.1`                                       | `0.1`                                         |                                         |
| `0.5`                                       | `0.5`                                         |                                         |
| `123.456`                                   | `123.456`                                     |                                         |
| `1e2`                                       | `100`                                         |                                         |
| `1E+2`                                      | `100`                                         |                                         |
| `1e00`                                      | `1`                                           | leading zeros in the exponent are legal |
| `1e007`                                     | `10000000`                                    |                                         |
| `1e0000000000000000000000005`               | `100000`                                      |                                         |
| `1e20`                                      | `100000000000000000000`                       | `adj = 20`, still plain                 |
| `1e21`                                      | `1e21`                                        | `adj = 21`, scientific                  |
| `1e22`                                      | `1e22`                                        |                                         |
| `1e-6`                                      | `0.000001`                                    |                                         |
| `1e-7`                                      | `0.0000001`                                   | `adj = -7`, still plain                 |
| `1e-8`                                      | `1e-8`                                        | `adj = -8`, scientific                  |
| `1e400`                                     | `1e400`                                       | no overflow to infinity                 |
| `1e-400`                                    | `1e-400`                                      | no underflow to zero                    |
| `5e-324`                                    | `5e-324`                                      |                                         |
| `2.5e-324`                                  | `2.5e-324`                                    |                                         |
| `1e-999999`                                 | `1e-999999`                                   |                                         |
| `9007199254740993`                          | `9007199254740993`                            | 2^53+1, exact                           |
| `0.30000000000000004`                       | `0.30000000000000004`                         |                                         |
| `1.7976931348623157e308`                    | `1.7976931348623157e308`                      |                                         |
| `1234567890123456789012345678901234567890`  | `1.23456789012345678901234567890123456789e39` | 40 digits, exact                        |
| `12345678901234567890.12345678901234567890` | `12345678901234567890.1234567890123456789`    |                                         |

---

## 7. Strings

### 7.1 Grammar

A string is `"` … `"`. Between the quotes:

- Any byte sequence encoding a scalar value except `"` (`0x22`), `\` (`0x5C`),
  and the C0 controls `U+0000`–`U+001F`.
- `U+007F` (DEL) is **allowed unescaped**. It is not a C0 control.
- An unescaped byte below `0x20` is `E_CONTROL_CHAR`, reported at that byte.
  This includes a raw TAB, a raw LF and a raw CR inside a string.
- Escapes: exactly `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, and
  `\uXXXX` with four hexadecimal digits in either case.

Anything else after a backslash is `E_BAD_STRING_ESCAPE`, reported at the
offset of the byte **after** the backslash (`\v`, `\'`, `\x41`, `\U0041`, and a
backslash followed by a space).

A `\u` not followed by four hexadecimal digits is `E_BAD_UNICODE_ESCAPE`,
reported at the offset of the first byte that is not a hexadecimal digit — the
closing quote, a `{`, a `g`, whatever it is. If the input ends first, the rule
in section 9.2 makes it `E_UNEXPECTED_EOF`.

### 7.2 Surrogates

**Decision:** lone surrogates are **rejected**.

- `\uD800`–`\uDBFF` (high) must be immediately followed by a `\uDC00`–`\uDFFF`
  escape (low). The pair denotes one scalar value above U+FFFF.
- A high surrogate followed by anything else — a different escape, a raw
  character, the closing quote, end of input — is `E_LONE_SURROGATE`.
- A low surrogate that is not preceded by a high surrogate escape is
  `E_LONE_SURROGATE`.
- The reported offset is the offset of the **backslash of the first offending
  escape**.

Encoded surrogates in the raw bytes (`ED A0 80`) never get this far: they are
ill-formed UTF-8 and fail at stage 1.

### 7.3 Canonical string form

The canonical form of a string is **printable ASCII only**, so that expected
values can be stored as plain text and compared byte for byte across
languages. Emit `"`, then for each scalar value of the decoded string:

| Scalar                     | Output                                        |
| -------------------------- | --------------------------------------------- |
| `U+0022`                   | `\"`                                          |
| `U+005C`                   | `\\`                                          |
| `U+0008`                   | `\b`                                          |
| `U+000C`                   | `\f`                                          |
| `U+000A`                   | `\n`                                          |
| `U+000D`                   | `\r`                                          |
| `U+0009`                   | `\t`                                          |
| other `U+0020`–`U+007E`    | the byte itself                               |
| everything else in the BMP | `\uXXXX`, four **lowercase** hex digits       |
| above `U+FFFF`             | the surrogate pair, `\uXXXX\uXXXX`, lowercase |

then `"`. Note the consequences:

- `/` is **not** escaped: `"\/"` canonicalises to `"/"`.
- `U+007F` **is** escaped, as `\u007f`, even though it is legal raw.
- Uppercase escapes normalise: `"\u00E9"` and the raw two bytes `C3 A9` both
  canonicalise to `"\u00e9"`.
- `"\uD83D\uDE00"` and the raw four bytes `F0 9F 98 80` both canonicalise to
  `"\ud83d\ude00"`.

---

## 8. Objects, arrays and the canonical document

### 8.1 Structure

```
array  = "[" [ value *( "," value ) ] "]"
object = "{" [ member *( "," member ) ] "}"
member = string ":" value
```

Whitespace may surround every token. A trailing comma is invalid. A missing
comma is invalid. A key must be a string: `{a:1}` and `{1:2}` are
`E_UNEXPECTED_BYTE` at the offending byte.

### 8.2 Duplicate keys

**Decision:** duplicate keys are **accepted**, and the **last** occurrence
wins. Keys are compared after unescaping, so `"a"` and `"a"` are the same
key. `{"a":1,"a":2}` canonicalises to `{"a":2}`.

### 8.3 Key order

**Decision:** members are emitted **sorted by Unicode code point** — that is,
lexicographically by the sequence of scalar values of the decoded key, which is
identical to lexicographic order of the keys' UTF-8 bytes.

This is *not* UTF-16 code unit order, and the difference is tested: with
`{"\uffff":1,"\ud83d\ude00":2}` the canonical form is
`{"\uffff":1,"\ud83d\ude00":2}` because U+FFFF < U+1F600, whereas UTF-16 order
would put the emoji first. Sorting the *escaped* text instead of the decoded
key gets this wrong.

Shorter keys sort before longer keys that extend them: `"key"` before
`"key\u0000"`.

### 8.4 Canonical document form

- No whitespace anywhere: `{"a":[1,2],"b":1}`.
- No trailing newline. The `OK` frame's length field delimits it exactly.
  (`run.sh <path>` adds one LF for human consumption; the protocol does not.)
- Numbers per section 6.4, strings per section 7.3, objects per 8.2 and 8.3.
- `true`, `false`, `null` verbatim.
- Canonicalisation is idempotent: feeding a canonical form back in must produce
  the identical bytes. The runner checks this for every accepted case.

---

## 9. Errors

### 9.1 Codes

Exactly these fourteen, spelled exactly like this:

| Code                   | Raised when                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `E_INVALID_UTF8`       | the input is not well-formed UTF-8 (5.1)                                         |
| `E_BOM`                | the input starts with `EF BB BF` (5.2)                                           |
| `E_EMPTY`              | the input is empty or only whitespace (5.3)                                      |
| `E_TRAILING`           | non-whitespace follows the top-level value (5.4)                                 |
| `E_UNEXPECTED_BYTE`    | a byte appears where the grammar does not allow it                               |
| `E_UNEXPECTED_EOF`     | the input ends inside a value or structure (9.2)                                 |
| `E_BAD_NUMBER`         | a numeric run is not a valid number (6.2)                                        |
| `E_BAD_LITERAL`        | a byte inside `true`/`false`/`null` is wrong                                     |
| `E_BAD_STRING_ESCAPE`  | the byte after `\` is not a legal escape (7.1)                                   |
| `E_BAD_UNICODE_ESCAPE` | `\u` is not followed by four hex digits (7.1)                                    |
| `E_LONE_SURROGATE`     | an unpaired surrogate escape (7.2)                                               |
| `E_CONTROL_CHAR`       | an unescaped byte below `0x20` inside a string (7.1)                             |
| `E_DEPTH_LIMIT`        | nesting would exceed the limit (10)                                              |
| `E_RESOURCE`           | an implementation limit was hit; only ever legal on the indeterminate cases (11) |

Only the first error is reported. There is no recovery and no error list.

### 9.2 Precedence

1. Stage order in section 5 decides between stages: UTF-8, then BOM, then
   empty, then parse, then trailing.
2. Within parsing, the error with the **smallest offset** wins — parsing is a
   single left-to-right pass, so this is simply the first error hit.
3. **End of input outranks the construct.** Whenever the offending position is
   end of input, the code is `E_UNEXPECTED_EOF` and the offset is the input
   length, whatever construct was open. `tru`, `"abc`, `[1,`, `{"a":`, `1e`,
   `"\u00` are all `E_UNEXPECTED_EOF`. The one exception is stage 3: an input
   that never started a value at all is `E_EMPTY`.

### 9.3 Offset, line and column

- `offset` — the zero-based index of the offending byte, as fixed by the rule
  for that code (section 9.1 and the sections it points at). For
  `E_UNEXPECTED_EOF` and `E_EMPTY` it is the input length.
- `line` — one plus the number of LF bytes strictly before `offset`. **CR does
  not begin a line.** In `[1,\r]` the `]` is at line 1, column 5.
- `column` — the number of **bytes** from the start of the line to `offset`,
  plus one. Columns count bytes, not characters, not code points: in
  `["é", ]` (where `é` is `C3 A9`) the `]` is at offset 7, line 1, column 8.

The suite's `errors-position` group pins all three across multi-line documents,
CR handling and multi-byte characters.

---

## 10. Nesting depth

**Decision:** the limit is **512**.

Depth is the number of currently open arrays and objects. A scalar at the top
level has depth 0; `[1]` reaches depth 1; 512 nested arrays are accepted; the
513th opening bracket is rejected with `E_DEPTH_LIMIT` **at the offset of that
opening bracket**.

The parser must fail gracefully: no stack overflow, no crash, no unbounded
memory. The suite's `depth` group sends 100000 unclosed `[` and 100000 unclosed
`{"a":` members, and the harness must answer `E_DEPTH_LIMIT` — at offset 512
for the arrays, at offset 2560 for the objects, in both cases the offset of the
513th opening bracket — and then keep serving the remaining cases in the same
process. (A run of bare `{` bytes is not nested objects: a member must start
with a string key, so `{{` is `E_UNEXPECTED_BYTE` at offset 1. Object nesting
needs the key and colon.) A recursive-descent parser must check the limit
*before* recursing; the practical alternatives are an explicit stack or a depth
counter.

The same limit applies to serialisation: canonicalising a 512-deep value must
not overflow the stack either.

---

## 11. Indeterminate cases

The suite's `indeterminate` group holds twelve inputs where this specification
deliberately declines to pin behaviour: 100000-digit numbers, a 1 MiB string
literal, exponents that do not fit in a signed 64-bit integer, 100001-element
arrays, 50001 duplicate keys in one object. They correspond to the `i_` family
in the classic JSON test suites.

For these inputs, **any** of the following is conforming:

- accept, and return a canonical form;
- reject with `E_RESOURCE`;
- reject with any other code from section 9.1.

The runner executes them, prints what happened on the `INDETERMINATE` line, and
never counts them as passed or failed. They exist so a run reports its own
limits instead of hiding them. What is *not* acceptable is a crash, a hang, or
a protocol violation: those are scored, because they end the run.

---

## 12. The conformance suite

### 12.1 Where it is

The suite is a Python 3 runner plus 639 cases in 14 groups. **It is not in this
workspace.** It is run from outside, against the finished harness, through the
protocol in section 3 and nothing else — so the only way to raise the score is
to make the parser right, and there is no case file to read, embed or hash.

What this workspace does hold is the plumbing check:

```
reference-io/check_io.py            feeds a session in and diffs the transcript
reference-io/session-*.request      byte-exact request streams
reference-io/session-*.request.b64  the same, base64-encoded for raw bytes
reference-io/session-*.transcript   expected normalised transcripts
```

### 12.2 Case file format

Each file is a JSON object with `group`, `description` and `cases`. Each case
has an `id`, a human `note`, an `expect` of `accept`, `reject` or
`indeterminate`, and **exactly one** input field:

| Field          | Meaning                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `input`        | a JSON string; the input bytes are its UTF-8 encoding                                                                                     |
| `input_b64`    | base64; the input bytes are what it decodes to (used when the bytes are not valid UTF-8)                                                  |
| `input_repeat` | `{prefix, unit, count, suffix}`; the input bytes are the UTF-8 encoding of `prefix + unit*count + suffix` (used for the very large cases) |

`accept` cases carry `canonical`, the exact expected canonical form. `reject`
cases carry `code`, `offset`, `line` and `column`, all of which are compared.

### 12.3 Running it

The runner is given `bash run.sh --harness` and this workspace as its working
directory. It starts the harness once, sends every selected case, and for every
accepted case with an expected canonical form also sends that canonical form
back through to check idempotence. Group names are the case file stems.

Runner exit codes: `0` all scored cases passed, `1` at least one failed, `2`
usage or data error, `3` the harness crashed, hung or broke the protocol.

The last line of output is the one to quote:

```
SUMMARY total=639 scored=627 passed=627 failed=0 indeterminate=12 crashed=0 timeouts=0 pass_rate=100.00% seconds=3.2
```

`pass_rate` is `passed / scored`, where `scored` excludes the indeterminate
cases. That number is the task's headline metric.

`--ignore-codes` and `--ignore-positions` exist for diagnosis while you are
converging. They are **not** the graded mode; the graded run uses the defaults.

### 12.4 `reference-io`

`session-01.request` covers accept, canonical numbers, canonical escapes,
structural errors, empty input, a multi-line offset and an EOF error;
`session-02.request` covers raw UTF-8, invalid UTF-8, a BOM, a raw control
character, a lone surrogate and the depth limit. Pipe one into your harness and
compare, or let the script do it:

```sh
python3 reference-io/check_io.py --cwd . -- bash run.sh --harness
python3 reference-io/check_io.py --session reference-io/session-01.request --print \
    --cwd . -- bash run.sh --harness
```

The transcripts omit the message length and text, which section 3.3 leaves
free, and compare everything else exactly, including the process exit status.
Get these two files passing before you run the full suite.

---

## 13. `test.sh`

The workspace ships a `test.sh` that runs `check_io.py` over both sessions and
exits non-zero if either transcript differs. That is the visible check, and it
is the only check this workspace can run: the conformance suite is elsewhere.
Seventeen exchanges passing say the harness speaks the protocol and the common
path works. They do not say the parser conforms.

You may add checks to `test.sh` — unit tests of your own are welcome — but the
command it ships with must remain and must still gate the exit status.
Weakening it does not raise the score; the score comes from the suite.

---

## 14. Prohibited shortcuts

The following make a run worthless and are scored zero regardless of the
reported pass rate:

- Any third-party or standard-library JSON parser used for the parsing being
  measured, including "just for the hard cases".
- Reading, embedding or hashing the case files, the session files or the
  transcripts, at build time or run time.
- Special-casing an input by its bytes, its length or its case id.
- Weakening or bypassing the visible check in `reference-io/`.
- A harness that answers from a table rather than from the parser.

Implementing the specification is the task. A 70% pass rate from a real parser
is a better result than 100% from a lookup table, and the two are easy to tell
apart.

---

## 15. Requirements index

`NOTES.md` carries one row per requirement below, naming the file and function
that implements it, or the word `unimplemented`. A requirement that stops being
unimplemented moves in that table too: the table is the workspace's own account
of itself, and a row that disagrees with the code is worse than a missing one.

| ID   | Requirement                                                        | Section |
| ---- | ------------------------------------------------------------------ | ------- |
| R-1  | Parser written from scratch, no JSON library                       | 2       |
| R-2  | Harness reachable as `bash run.sh --harness`                       | 3.1     |
| R-3  | Request framing: header, exact-length payload, LF terminator       | 3.2     |
| R-4  | Binary-safe payloads (NUL, LF, invalid UTF-8, zero length)         | 3.2     |
| R-5  | `OK` response framing with byte length                             | 3.3     |
| R-6  | `ERR` response framing with code, offset, line, column, message    | 3.3     |
| R-7  | stdout flushed per response; diagnostics only on stderr            | 3.1     |
| R-8  | Harness exit codes                                                 | 3.4     |
| R-9  | `run.sh` file mode, default mode, usage mode, exit statuses        | 4       |
| R-10 | Whole-input UTF-8 validation before parsing                        | 5.1     |
| R-11 | Overlong, surrogate, out-of-range and truncated UTF-8 rejected     | 5.1     |
| R-12 | Leading BOM rejected with `E_BOM`; U+FEFF legal elsewhere          | 5.2     |
| R-13 | Exactly four whitespace bytes; `E_EMPTY` for whitespace-only input | 5.3     |
| R-14 | Trailing content rejected; top-level scalars accepted              | 5.4     |
| R-15 | RFC 8259 number grammar                                            | 6.1     |
| R-16 | Maximal numeric run and its error offsets                          | 6.2     |
| R-17 | Exact decimal number model, no float round-trip                    | 6.3     |
| R-18 | Canonical number form                                              | 6.4     |
| R-19 | String grammar, escapes, DEL allowed raw                           | 7.1     |
| R-20 | Raw control characters rejected                                    | 7.1     |
| R-21 | `\u` escape validation                                             | 7.1     |
| R-22 | Surrogate pairing; lone surrogates rejected                        | 7.2     |
| R-23 | Canonical string escaping, ASCII-only, lowercase hex               | 7.3     |
| R-24 | Array and object grammar                                           | 8.1     |
| R-25 | Duplicate keys accepted, last wins, compared after unescaping      | 8.2     |
| R-26 | Members sorted by code point                                       | 8.3     |
| R-27 | Canonical document form, no whitespace, idempotent                 | 8.4     |
| R-28 | The fourteen error codes                                           | 9.1     |
| R-29 | Error precedence, including EOF outranking the construct           | 9.2     |
| R-30 | Byte offset, LF-only line counting, byte columns                   | 9.3     |
| R-31 | Depth limit 512, error at the offending bracket                    | 10      |
| R-32 | Graceful failure on 100000-deep input; process survives            | 10      |
| R-33 | Indeterminate inputs neither crash nor hang                        | 11      |
| R-34 | `test.sh` runs `check_io.py` and gates on it                        | 13      |
