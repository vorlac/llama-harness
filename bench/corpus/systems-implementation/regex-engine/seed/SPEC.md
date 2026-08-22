# SPEC: `regex-engine` — a linear-time regular expression engine

Version 1.0. This document is the **authoritative** specification for the
`regex-engine` task. Where this document and your memory of PCRE, Python `re`,
JavaScript `RegExp` or POSIX disagree, **this document wins**. Where real-world
implementations differ, this document pins exactly one behaviour and says so
(see §13). Two independent implementations that follow this document must agree
on every one of the 884 conformance cases.

The conformance suite is the grader. It is not in this workspace: it drives
this program from outside, through the line protocol in §3, and compares real
replies. Nothing here is decorative.

---

## 1. Scope

You implement a regular expression engine with a **guaranteed linear-time**
matcher: a Thompson NFA simulation (a Pike VM) or a lazily built DFA on top of
one. Backtracking is not an acceptable strategy, and §11 exists to make that
measurable rather than merely stated.

Required:

- a **parser** for the pattern dialect in §4, producing compile errors with a
  machine-readable code and a position (§7);
- a **compiler** that lowers the parse into an inspectable instruction program
  (§9);
- a **matcher** that finds the leftmost-first match of a pattern in a subject
  and reports **all capture-group spans** (§5), in time linear in the length of
  the subject for a fixed pattern;
- a **scanner** that reports every successive non-overlapping match (§5.7);
- **UTF-8 correctness**: patterns and subjects are UTF-8 text, `.` and classes
  operate on code points, and every offset the harness reports is a code point
  index (§5.1);
- the **harness CLI** in §3, through which all of the above is tested.

Not required and not tested: backreferences, lookaround, named groups, inline
flags, case-insensitive matching, multiline mode, Unicode property classes,
POSIX bracket expressions (`[[:alpha:]]`), possessive quantifiers, atomic
groups, comments, `\A`/`\z`/`\G`, replacement or splitting APIs. Every one of
these is a **compile error** in this dialect; §7 says which.

Third-party regular expression libraries, and any language's built-in regular
expression facility, are forbidden for the engine itself.

---

## 2. What you deliver

| File | Contract |
|---|---|
| `build.sh` | Compile or install. Exit 0. No network. May be a no-op. |
| `run.sh` | Start the harness of §3. Exit 0 at end of input. |
| `test.sh` | The visible check: `reference-io/check_io.py` over every session. |
| `NOTES.md` | Design notes, and what the workspace does not meet. |
| `src/` | The engine. |

The three scripts run with the workspace root as the working directory, start
with `#!/usr/bin/env bash` and `set -euo pipefail`, and must not touch the
network.

Nothing here carries an execute bit: this workspace is seeded from a text
manifest, which carries file contents and not file modes. Every script is
reached through its interpreter - `bash run.sh` and `bash test.sh` rather than
`./run.sh` and `./test.sh` - and the graded run starts the harness the same way.

`run.sh` is invoked with no arguments and no input; reading EOF immediately and
exiting 0 satisfies that. It is invoked by the conformance runner as a
long-lived child process.

---

## 3. Harness contract

The runner starts `bash run.sh` once, writes one request line to its stdin, reads
the reply, and repeats. This section is the entire interface between the runner
and your program. **Any deviation makes the run unscoreable**, so implement this
before you implement the engine and check it against `reference-io/` first.

### 3.1 Invocation and lifecycle

```
bash run.sh
```

- No arguments. No environment variables are set for you.
- The process runs until stdin reaches end of file, then exits with status `0`
  within 5 seconds. It must not require a shutdown command.
- The process must never exit on its own while stdin is open. A compile error is
  a reply (§7), never a reason to terminate.
- **stdout carries replies and nothing else.** Every diagnostic, log line,
  warning and stack trace goes to stderr. The runner echoes stderr with a
  `[harness]` prefix, so you may use it freely.
- **Flush stdout after every reply.** The runner is strictly synchronous: it
  will not send the next request until it has read the current reply. A buffered
  stdout deadlocks the run and every case then fails on its time limit. In
  Python use `flush=True`; in Go `bufio.Writer.Flush`; in C++
  `std::cout << std::flush` or `setvbuf(stdout, NULL, _IONBF, 0)`; in Rust
  `io::stdout().flush()`; in Node set the stream to unbuffered writes.
- Startup has a 20 second budget: the runner sends `PING` first and requires
  `PONG` back within that window.

### 3.2 Line framing

- A request is one line terminated by LF (`0x0A`). There is no CR.
- A reply is one or more lines, each terminated by LF. Only `PROGRAM` (§9.4)
  replies with more than one line.
- Request lines are ASCII only, and so are reply lines. A reply containing a
  byte outside `0x20`–`0x7E` fails the case.
- Fields inside a line are separated by exactly **one** space (`0x20`). Never
  split on runs of whitespace: a field is never empty (§3.3), so a doubled space
  in a request is a malformed request, not padding.
- Request lines can be large. The suite sends a line of roughly 40 kB. Do not
  assume a fixed line buffer; read until LF.

### 3.3 Wire strings

Patterns and subjects are arbitrary UTF-8 text, so they are escaped into an
ASCII token before they go on the wire. A **wire string** is decoded as follows,
one byte at a time:

| Input | Meaning |
|---|---|
| `\\` | one byte `0x5C` (backslash) |
| `\xHH` | one byte with that hexadecimal value; `H` is `0-9a-fA-F` |
| any byte `0x21`–`0x7E` other than `\` and `-` | itself |
| a token consisting of exactly one `-` | the empty string |

Consequences, all of which the suite tests:

- Space is never literal in a token; it is always written `\x20`.
- A literal `-` is always written `\x2d`, so a token that is a lone `-` is
  unambiguously the empty string. A token is never zero characters long.
- A newline inside a subject is written `\x0a`.
- Encoding is per **byte**, before UTF-8 decoding: `é` (U+00E9) arrives as
  `\xc3\xa9`. Decode the escapes first, then interpret the bytes as UTF-8.
- The runner always sends lowercase hex; your decoder must also accept
  uppercase.
- Any other escape (`\q`, `\n`, a trailing lone `\`, a truncated `\x4`) makes
  the request malformed: reply `ERROR bad-request -1` (§3.6).
- The decoded bytes are always valid UTF-8. You never have to handle invalid
  UTF-8 in a request.

Replies never contain wire strings: every reply field is a keyword or a decimal
integer, so no escaping is needed on the way out.

### 3.4 Requests

| Request | Fields | Meaning |
|---|---|---|
| `PING` | none | liveness check |
| `MATCH <pattern> <subject>` | 2 wire strings | leftmost-first match anywhere in the subject, with submatches |
| `FIND <pattern> <subject>` | 2 wire strings | every successive non-overlapping match (§5.7), whole-match spans only |
| `COMPILE <pattern>` | 1 wire string | compile only, report the program size |
| `PROGRAM <pattern>` | 1 wire string | compile and dump the program (§9.4) |

Verbs are case sensitive and uppercase. The field count is exact: `MATCH a` and
`MATCH a b c` are both malformed.

### 3.5 Replies

| Reply | Meaning |
|---|---|
| `PONG` | answer to `PING` |
| `MATCH <n> <s0> <e0> <s1> <e1> ...` | a match was found; `n` is the number of spans, which is 1 + the number of capture groups in the pattern; spans follow in group order starting with group 0, the whole match |
| `NOMATCH` | the pattern does not match anywhere in the subject |
| `FIND <k> <s0> <e0> ... ` | `k` successive matches, then `k` whole-match spans; `FIND 0` when there are none |
| `COMPILED <count>` | the pattern compiled to `count` instructions |
| `PROGRAM <count>` | followed by exactly `count` instruction lines (§9.4) |
| `ERROR <code> <pos>` | see §3.6 and §7 |

Rules:

- Offsets are **code point** indices into the subject, half-open: a span
  `s e` covers the code points at indices `s` up to but not including `e`, and
  `s == e` is an empty match at `s`.
- A capture group that did not participate in the match reports `-1 -1`. It is
  never reported as `0 0`.
- `MATCH` reports one span per group **declared in the pattern**, whether or not
  it participated, in the order the groups' opening parentheses appear.
  Non-capturing groups are not counted and never reported.
- Numbers are decimal, without leading `+`, without leading zeros (`0` itself
  excepted), and `-1` is the only negative value ever emitted.
- Exactly one space between fields; no leading or trailing space.

### 3.6 Protocol errors

| Situation | Reply |
|---|---|
| unknown or lowercase verb | `ERROR unknown-command -1` |
| known verb with the wrong number of fields | `ERROR bad-request -1` |
| an empty request line | `ERROR bad-request -1` |
| a field that is not a well-formed wire string (§3.3) | `ERROR bad-request -1` |
| the pattern does not compile | `ERROR <code> <pos>` from §7 |

A line whose first field is not one of the five verbs is `unknown-command`. A
line whose verb is known but whose fields are wrong, and an empty line, are
`bad-request`. Neither ends the process.

---

## 4. Pattern syntax

### 4.1 Grammar

```
alternation := concat ( '|' concat )*
concat      := repeat*
repeat      := atom quantifier?
quantifier  := ( '*' | '+' | '?' | bound ) '?'?
bound       := '{' digits '}' | '{' digits ',' '}' | '{' digits ',' digits '}'
atom        := '(' alternation ')'          # capture group
             | '(?:' alternation ')'        # non-capturing group
             | '[' class ']'
             | '.' | '^' | '$'
             | '\' escape
             | literal
literal     := any code point except  \ . [ ] ( ) { } * + ? | ^ $
```

A `concat` may be empty, so `a|`, `|a`, `()` and the empty pattern are all
legal and all match the empty string.

A trailing `?` on a quantifier makes it **lazy** (§5.3). A second quantifier
directly after a quantifier is an error (§7): `a**`, `a*+`, `a???` and `a{2}{3}`
are all `nothing-to-repeat`.

`^`, `$`, `\b` and `\B` are zero-width assertions and are **not atoms**: they
cannot be quantified. `^*` is `nothing-to-repeat`.

### 4.2 Metacharacters

Outside a character class the metacharacters are:

```
\  .  [  ]  (  )  {  }  *  +  ?  |  ^  $
```

Every one of them must be escaped with `\` to be matched literally. This
includes `]` and `}`: unlike Python and Go, this dialect does **not** treat a
stray `]` or `}` as a literal. An unescaped `]` outside a class is
`unexpected-bracket`; an unescaped `}` outside a bound, or a `{` that does not
begin a well-formed bound, is `bad-repeat`.

Every other code point is a literal, including space, tab, `/`, `#`, `-`, `<`,
`>`, `"` and every non-ASCII code point.

### 4.3 Escapes

Legal escapes, both inside and outside a character class unless noted:

| Escape | Meaning |
|---|---|
| `\\ \. \[ \] \( \) \{ \} \* \+ \? \| \^ \$ \- \/` | that literal code point |
| `\n` | U+000A |
| `\t` | U+0009 |
| `\r` | U+000D |
| `\f` | U+000C |
| `\v` | U+000B |
| `\0` | U+0000 |
| `\xHH` | the code point U+00HH; exactly two hex digits, either case |
| `\d` `\D` `\w` `\W` `\s` `\S` | the shorthand classes of §6.2 |
| `\b` `\B` | word boundary assertions (§6.3); **outside a class only** |

Anything else after a backslash is `bad-escape`, positioned at the backslash.
That includes `\a`, `\e`, `\A`, `\z`, `\Z`, `\G`, `\p{...}`, `\Q` and
every backreference `\1` … `\9`. A pattern that ends with a backslash is
`trailing-backslash`.

`\b` inside a class is `bad-escape` — it is not a backspace here.

### 4.4 Character classes

```
'[' '^'? item+ ']'
item := code point | escape | range
range := (code point | single-code-point escape) '-' (code point | single-code-point escape)
```

- A leading `^` negates the class. It is a literal anywhere else: `[a^]` and
  `[^^]` both contain `^`.
- Inside a class the only metacharacters are `\`, `]` and `-`. `[`, `(`, `)`,
  `{`, `}`, `*`, `+`, `?`, `|`, `^` (after the first position) and `.` are
  literals; `[.]` matches a full stop and nothing else.
- `]` must always be escaped inside a class. `[]]` is **not** a class containing
  `]`; it is `empty-class`. A class must have at least one item, so `[]` and
  `[^]` are `empty-class` too.
- `-` is a literal at the start of a class, at the end of a class, and after a
  completed range: `[-a]`, `[a-]` and `[a-c-e]` are all legal, and the last one
  is `a`, `b`, `c`, `-`, `e`.
- A range's endpoints are compared as code point values. `[z-a]` is
  `class-range-out-of-order`, positioned at the `-`. A single-code-point range
  such as `[b-b]` is legal.
- A shorthand class (`\d`, `\w`, `\s`, …) may be an item but never a range
  endpoint: `[a-\d]` is `bad-escape`.
- A negated class matches **any code point not in the set**, including U+000A.
  `[^a]` matches a newline; `.` does not.
- Ranges may overlap and repeat; duplicates are harmless. §9.2 requires the
  compiler to normalise them.

### 4.5 Repetition

| Form | Meaning |
|---|---|
| `x*` | zero or more, greedy |
| `x+` | one or more, greedy |
| `x?` | zero or one, greedy |
| `x{m}` | exactly `m` |
| `x{m,}` | `m` or more, greedy |
| `x{m,n}` | between `m` and `n` inclusive, greedy |
| `x*?` `x+?` `x??` `x{m,}?` `x{m,n}?` `x{m}?` | the same, lazy |

- `m` and `n` are decimal, may have leading zeros, and must satisfy
  `m <= n <= 1000` and `m <= 1000`. `{2,1}` is `bad-repeat`; `{1001}` is
  `repeat-too-large`.
- `{m}` and `{m}?` behave identically: an exact count offers no choice.
- `x{0}` matches the empty string and consumes nothing, but its capture groups
  still exist and report `-1 -1` (§5.4).
- There is no whitespace tolerance inside a bound: `{2, 3}` is `bad-repeat`.

### 4.6 Groups

- `( ... )` is a capture group. Groups are numbered from 1 in the order of their
  opening parentheses, so in `((a)(b))` the outer group is 1, `(a)` is 2 and
  `(b)` is 3. Group 0 is always the whole match.
- `(?: ... )` groups without capturing.
- `(?` followed by anything other than `:` is `unsupported-group`, positioned at
  the `(`. That covers `(?i)`, `(?P<n>x)`, `(?=x)`, `(?!x)`, `(?<=x)`, `(?#c)`
  and a bare `(?`.
- Nesting is unlimited in principle; the suite goes 15 deep.

---

## 5. Match semantics

### 5.1 Subjects, offsets and code points

The subject is a sequence of Unicode code points obtained by decoding the wire
string as UTF-8. Every offset in every reply is an index into **that sequence**,
not into the bytes. For the subject `héllo` the code point at index 1 is `é` and
the whole subject spans `0 5`, whatever your internal representation is.

`.`, a character class and a literal each consume exactly one code point.

### 5.2 Leftmost-first

`MATCH` reports the match that starts at the **smallest** possible offset. Among
the matches that start there, it reports the one the pattern's **preference
order** (§5.3) selects — not the longest. This is Perl-style leftmost-first
("leftmost-biased"), the same semantics Go's `regexp` gives by default, and it
is **not** POSIX leftmost-longest.

The observable consequence, tested directly:

```
MATCH a|ab   ab     ->  MATCH 1 0 1     (not 0 2)
MATCH ab|a   ab     ->  MATCH 1 0 2
```

A linear-time matcher gets this by carrying threads in priority order and, once
a match is recorded, discarding every lower-priority thread; leftmost-ness comes
from not adding a new start thread once any thread has matched.

### 5.3 Preference order

Preference is defined structurally:

- **Alternation** prefers the leftmost branch that can lead to a match:
  `a|b|c` tries `a`, then `b`, then `c`.
- **Greedy** `*`, `+`, `?`, `{m,n}` prefer to take one more iteration before
  trying to leave the loop.
- **Lazy** `*?`, `+?`, `??`, `{m,n}?` prefer to leave the loop before trying one
  more iteration.
- Preference composes left to right through concatenation: the leftmost
  construct's preference dominates. `(a+?)(a*)` on `aaa` yields group 1 = `0 1`
  and group 2 = `1 3`.

Preference never changes *whether* a match exists, only which one is reported.

### 5.4 Capture semantics

- A group reports the span of its **last completed iteration**. `(a)*` on `aaa`
  reports group 1 as `2 3`, not `0 3` and not `0 1`.
- A group inside a branch that was not taken, or inside a repetition that ran
  zero times, reports `-1 -1`. It is never reported as an empty span at 0.
- A group that matched the empty string reports that empty span, e.g. `(a?)` on
  `b` reports `0 0`, which is different from `-1 -1`.
- Nested groups report independently: `(a(b)?)+` on `aba` reports
  group 1 = `2 3` (the last iteration, `a`) and group 2 = `1 2` (set during the
  first iteration and never cleared).
- Capture writes belong to the thread that made them. Two threads exploring
  different branches must not see each other's captures — the usual failure mode
  of a naive Pike VM that shares one capture array.

### 5.5 Assertions

| Assertion | True when |
|---|---|
| `^` | the current position is 0 |
| `$` | the current position is the number of code points in the subject |
| `\b` | exactly one of the code point before and the code point after the position is an ASCII word character (§6.1) |
| `\B` | `\b` is false at this position |

`^` and `$` are **absolute**: they refer to the whole subject and never to a
line. `a$` does not match `a\n`. There is no multiline mode.

Positions before the start and past the end count as "not a word character", so
`\b` is true at offset 0 of `abc` and at offset 3, and `\B` is true at offset 0
of the empty subject (there is no boundary there).

Assertions are evaluated against the **whole subject** even when the scan of
§5.7 has advanced past the start: in `FIND ^a aaa` only the match at offset 0 is
reported, and `\b` at offset 3 of `ab cd` looks at the space before it.

### 5.6 Repetitions that can match empty — pinned

A repetition never performs an iteration that consumes no input. Concretely, the
matcher discards a thread that reaches an instruction it has **already reached
at the current input position**; this is the duplicate check every NFA
simulation needs anyway, and it terminates empty loops as a side effect.

The observable consequences are pinned here because backtracking engines
commonly differ:

| Pattern | Subject | Result |
|---|---|---|
| `(a*)*` | `aa` | `MATCH 2 0 2 0 2` — group 1 keeps `0 2`; there is no trailing empty iteration that would reset it to `2 2` |
| `(a\|)*` | `aa` | `MATCH 2 0 2 1 2` |
| `(\|a)*` | `aa` | `MATCH 2 0 0 0 0` — the empty branch is preferred, so the loop stops immediately |
| `()*` | `x` | `MATCH 2 0 0 0 0` |

The `empty-repeat` group of the suite is 20 cases of exactly this kind; the
four rows above are the ones that name the rule most directly.

### 5.7 The `FIND` scan

```
pos = 0
while pos <= length(subject):
    m = leftmost-first match with start offset >= pos     # the MATCH of §5.2,
                                                          # searched from pos
    if there is none: stop
    report m
    pos = (m.end > m.start) ? m.end : m.start + 1
```

- Searching from `pos` does not slice the subject: assertions still see the
  whole text (§5.5).
- An empty match is reported, then the scan advances by one code point.
- An empty match immediately after a non-empty one **is** reported:
  `FIND a* aab` yields `0 2`, `2 2`, `3 3` — three matches.
- `FIND` reports whole-match spans only. Capture groups are not reported.

---

## 6. Character semantics

### 6.1 Word characters

An ASCII word character is `[0-9A-Za-z_]`. Nothing else is, in this dialect: `é`
is not a word character, and neither is any other non-ASCII code point.

### 6.2 Shorthand classes

| Escape | Set |
|---|---|
| `\d` | `0-9` |
| `\D` | any code point not in `\d` |
| `\w` | `0-9A-Za-z_` |
| `\W` | any code point not in `\w` |
| `\s` | U+0009, U+000A, U+000B, U+000C, U+000D, U+0020 |
| `\S` | any code point not in `\s` |

All six are **ASCII-only**, deliberately: `\w` does not match `é` and `\d` does
not match `٣`. The negated forms match any non-ASCII code point, since a
non-ASCII code point is not in the positive set.

### 6.3 Dot

`.` matches any single code point except U+000A. It is not affected by any flag,
because there are no flags.

---

## 7. Compile errors

A pattern that does not compile produces `ERROR <code> <pos>` in reply to
`MATCH`, `FIND`, `COMPILE` and `PROGRAM` alike.

`pos` is the **0-based code point index into the pattern** of the offending
construct, as defined per code below, or `-1` when the error is not tied to a
position. Code point, not byte: in `é\y` the error is at 1.

When more than one construct is defective, the reported error is the one a
**single left-to-right parse** reaches first. `[z-a` is
`class-range-out-of-order` at 2, not `unterminated-class` at 0, because the
parser meets the bad range before it runs out of input. `(*` is
`nothing-to-repeat` at 1 for the same reason.

| Code | Raised when | `pos` |
|---|---|---|
| `trailing-backslash` | the pattern ends with a lone `\` | the backslash |
| `bad-escape` | an escape that §4.3 does not define; `\b`/`\B` inside a class; a malformed `\xHH`; a shorthand class as a range endpoint | the backslash |
| `unbalanced-paren` | `(` with no matching `)`, or `)` with no matching `(` | the unmatched parenthesis |
| `unexpected-bracket` | an unescaped `]` outside a class | the `]` |
| `unterminated-class` | `[` with no closing `]` | the `[` |
| `empty-class` | `[]`, `[^]`, or a class whose first item is `]` | the `[` |
| `class-range-out-of-order` | a range whose end is below its start | the `-` |
| `nothing-to-repeat` | a quantifier with no preceding atom: at the start of the pattern, after `(`, after `|`, after an assertion, or directly after another quantifier | the first character of the quantifier |
| `bad-repeat` | a `{` that does not begin a well-formed bound, `{m,n}` with `n < m`, or an unescaped `}` outside a bound | the `{`, or the stray `}` |
| `repeat-too-large` | a bound above the §8 limit | the `{` |
| `unsupported-group` | `(?` not followed by `:` | the `(` |
| `program-too-large` | the compiled program would exceed the §8 limit | `-1` |

Error **codes** are compared exactly; there is no message text in the reply and
none is expected. Write whatever human-readable diagnostic you like to stderr.

---

## 8. Limits

| Limit | Value | On breach |
|---|---|---|
| repetition bound `m` or `n` | 1000 | `repeat-too-large` |
| compiled program size | 100000 instructions | `program-too-large` |

Both are compile-time checks. `(a{100}){100}` is about ten thousand
instructions and must compile; `((a{100}){100}){100}` is about a million and
must be rejected with `program-too-large -1`. Rejecting it *before* allocating a
million instructions is the point of the limit; a compiler that first builds the
program and then measures it is acceptable as long as it does not exhaust
memory.

---

## 9. The compiled program

### 9.1 Why it is required

Compilation to an explicit instruction program is what makes linear-time
matching possible and what the `PROGRAM` request inspects. A lazily built DFA is
an acceptable *matcher*, but it is built from this program and the program must
still be dumpable — and submatch reporting (§5.4) needs the NFA simulation
regardless, since a DFA state cannot carry capture positions.

### 9.2 Instruction set

The dumped program is the **anchored** program for the pattern: it describes
matching that begins at one given position. Unanchored search is the matcher's
job (start a new thread at each successive position until a match is recorded);
it must not appear in the program as a `.*?` prefix.

| Instruction | Arguments | Meaning |
|---|---|---|
| `char <cp>` | one code point in hex | consume exactly this code point |
| `any` | none | consume one code point other than U+000A |
| `class <pol> <lo>-<hi> ...` | polarity `p` or `n`, then one or more ranges | consume one code point that is (`p`) or is not (`n`) inside one of the ranges |
| `split <x> <y>` | two program counters | try `x` first, `y` second; `x` is the higher-priority branch |
| `jmp <x>` | one program counter | continue at `x` |
| `save <slot>` | a slot number | record the current position in capture slot `slot` |
| `assert <kind>` | `bol`, `eol`, `wordb` or `nwordb` | continue only if the assertion of §5.5 holds |
| `match` | none | the whole pattern has matched |

Encoding rules:

- Code points are lowercase hexadecimal with **at least two digits** and no
  leading zeros beyond that: `61`, `0a`, `e9`, `1f600`.
- Class ranges are `<lo>-<hi>` with `lo <= hi`, sorted ascending and
  **normalised**: overlapping and adjacent ranges are merged, so `[a-cb-d]`
  dumps as `class p 61-64` and `[ac-de]` dumps as `class p 61-61 63-65`. A
  negated class keeps the polarity `n` and lists the **positive** ranges;
  `\W` is `class n 30-39 41-5a 5f-5f 61-7a`.
- Capture slots: group `g` uses slots `2g` and `2g+1`. Slots 0 and 1 are the
  whole match and are mandatory — the program must contain `save 0` and
  `save 1`, and `save 0` must be instruction 0.
- A single code point compiles to `char`, never to a one-range `class`. `.`
  compiles to `any`, never to `class n 0a-0a`. Conversely `[^\n]` compiles to
  `class n 0a-0a`, never to `any`.
- Bounded repetition is expanded: with no counter instruction in the set,
  `a{3,5}` contains exactly five `char 61` instructions.

### 9.3 Well-formedness

The runner checks all of this for every `PROGRAM` case:

1. the reply header is `PROGRAM <count>` and exactly `count` lines follow;
2. line `i` begins with the program counter `i`, ascending from 0;
3. every opcode is from §9.2 and its arguments have the right shape;
4. every `split` and `jmp` target is in `0 .. count-1`;
5. instruction 0 is `save 0`, and `save 1` appears somewhere;
6. there is **exactly one** `match` instruction;
7. every `save` slot is at most `2 * groups + 1` for a pattern with that many
   capture groups;
8. class ranges are well formed, sorted, disjoint and merged.

Beyond that, individual cases assert structural facts that any correct
compilation must satisfy: the number of `char` instructions for a bounded
repetition, the exact normalised ranges for a class, the presence of a `split`
for an alternation, the presence of the right `assert`, and generous lower and
upper bounds on the instruction count. The suite never demands a particular
instruction ordering or a particular number of `jmp`s: how you lower the parse
tree is yours.

### 9.4 Dump format

```
PROGRAM 7
0 save 0
1 split 2 4
2 char 61
3 jmp 1
4 char 62
5 save 1
6 match
```

That is one acceptable compilation of `a*b`. `reference-io/05-program.out` has
five more. `COMPILE <pattern>` reports the same count as `PROGRAM <pattern>`
would, without the instruction lines.

---

## 10. Complexity requirements

For a pattern compiling to `m` instructions and a subject of `n` code points:

- `MATCH` and `FIND` must run in `O(n * m)` time and `O(m)` working memory
  (a Pike VM carrying capture slots uses `O(m * k)` for `k` groups, which is
  fine).
- The unanchored search must be a **single pass**. Restarting the simulation at
  every start offset is `O(n^2 * m)` and will not finish inside the time limits:
  the suite matches `a$` against 40000 code points for exactly this reason.
- No input may cause exponential or super-linear-in-`n` behaviour. There is no
  input in the suite for which the answer is "this pattern is inherently slow";
  every case is trivial for a correct simulation.

## 11. The catastrophic-backtracking guard

The `pathological` group is the reason this task exists in the form it does.
Each case pairs a nested-quantifier pattern with a long subject that forces a
backtracking matcher through an exponential number of paths, and gives the case
a hard wall-clock limit that a backtracking matcher cannot meet on any machine:

| Pattern | Subject | Backtracking cost |
|---|---|---|
| `(a+)+b` | 200 `a` | ~2^200 paths |
| `(a*)*b` | 200 `a` | exponential |
| `(x+x+)+y` | 160 `x` | exponential |
| `(a{1,10}){1,10}b` | 150 `a` | exponential |
| `a?` × 60 then `a` × 60 | 59 `a` | ~2^60 paths |

Every one of these is a few thousand steps for an NFA simulation and answers in
under a millisecond. The runner enforces the limit per case: a reply that
arrives late fails the case, and the runner then kills and restarts the harness
so the rest of the suite still runs. A harness restart is reported in the
summary.

Several further cases in the same group are throughput floors rather than
exponential traps: subjects of 10000 to 40000 code points with an 8 second limit
each, one of them paired with a small control at the same limit. They are
comfortably met by a straightforward implementation in any of the target
languages, including an interpreted one; they are not met by an implementation
that is accidentally quadratic.

## 12. How to implement this (pointers, not a design)

Read Russ Cox's "Regular Expression Matching Can Be Simple And Fast" and its
sequel on submatch extraction; Thompson's 1968 CACM paper is the original.
The shape of the standard solution:

1. Parse to a tree, then compile the tree to the instruction program of §9.2.
2. Simulate the program over the subject with a **thread list**: at each input
   position, a set of program counters, each carrying its capture slots,
   maintained in priority order with a "already added at this position" guard.
   That guard is what makes the simulation linear and what §5.6 pins.
3. `split` forks a thread (higher-priority target first), `save` writes a slot in
   the current thread's capture array, `match` records the current thread's
   captures as the best match so far and cuts off every lower-priority thread.
4. For unanchored search, add a new lowest-priority thread starting at the
   current position on every step, and stop adding once a match has been
   recorded.
5. Copy-on-write or reference-counted capture arrays keep step 3 from being
   `O(m * k)` per step; correctness first, then that.

A lazily built DFA is a legitimate accelerator for the "does it match" half but
cannot produce submatches on its own. Nothing in the suite requires one.

---

## 13. Pinned decisions

Where implementations in the wild differ, this dialect chooses:

| Question | This dialect |
|---|---|
| Match semantics | leftmost-first (Perl/RE2 default), not POSIX leftmost-longest |
| `$` | end of subject only; does not match before a trailing newline |
| `^` | start of subject only; no multiline mode |
| `\w \d \s \b` | ASCII only |
| `.` | any code point except U+000A |
| `[^a]` | matches U+000A |
| `]` outside a class | `unexpected-bracket`, not a literal |
| `}` outside a bound | `bad-repeat`, not a literal |
| `{` that is not a bound | `bad-repeat`, not a literal |
| `[]]` | `empty-class`, not a class containing `]` |
| `[\b]` | `bad-escape`, not a backspace |
| `\B` on the empty subject | matches at 0 |
| repetition of an assertion (`^*`) | `nothing-to-repeat` |
| `x{m}?` | identical to `x{m}` |
| a group in a zero-iteration repetition | `-1 -1` |
| a repeated group | the span of its last completed iteration |
| an empty iteration at the end of a loop | never happens (§5.6) |
| an empty match adjacent to a previous match in `FIND` | reported |
| error position units | code points, 0-based |
| the empty wire token | written `-` |

---

## 14. The conformance suite

### 14.1 Where it is

The runner and its 884 cases are **not in this workspace**. They are
materialized outside it, after this process has exited, and they drive
`bash run.sh` through the protocol of §3 from there. There is no case file here
to read, and reading one would be a failed run rather than a clever one.

What is here is `reference-io/` (§15) and the visible check `bash test.sh`,
which runs it.

### 14.2 How it is run

The runner starts the harness once, sends one request line at a time, compares
each reply against the case data, and enforces a per-case wall clock. A reply
that arrives late fails its case, and the runner then kills and restarts the
harness so the rest of the suite still runs. A harness restart is reported in
the summary.

Exit status is 0 if and only if the final line is `RESULT PASS` - that is, only
when all 884 cases pass.

### 14.3 Output

```
GROUP             CASES   PASS   FAIL
alternation          35     35      0
...
TOTAL               884    884      0
PASS RATE 100.00%
RESULT PASS
```

Failures print the request, the expected reply and the actual one before that
table.

### 14.4 The groups

| Group | Cases | What it covers |
|---|---|---|
| `literals` | 108 | literal code points, escaped metacharacters, span reporting |
| `dot` | 35 | `.` and its interaction with quantifiers |
| `anchors` | 50 | `^`, `$`, `\b`, `\B` |
| `classes` | 59 | class members, ranges, negation, the literal roles of `-`, `^`, `[` |
| `escapes` | 36 | shorthand classes, control escapes, `\xHH` |
| `quantifiers` | 95 | greedy and lazy `*`, `+`, `?` |
| `bounded` | 98 | `{m}`, `{m,}`, `{m,n}`, greedy and lazy |
| `alternation` | 35 | branch preference order |
| `captures` | 50 | numbering, nesting, non-participating groups, repeated groups |
| `empty-repeat` | 20 | the pinned empty-iteration rule of §5.6 |
| `unicode` | 53 | code point offsets, multibyte `.`, non-ASCII ranges |
| `findall` | 44 | the `FIND` scan rule of §5.7 |
| `errors` | 105 | every code in §7, at the right position |
| `program` | 44 | the compiled program of §9 |
| `pathological` | 23 | the backtracking guard and the throughput floors |
| `protocol` | 29 | the harness contract of §3 |
| **total** | **884** | |

### 14.5 What a failure prints

A failing case prints the request, the expected reply, the reply the harness
gave, and the case's own `note`, which usually names the rule it is testing.
That output is the only view of the case data anybody gets.

---

## 15. Reference I/O

`reference-io/*.in` are request scripts and `*.out` are the exact replies your
harness must produce. Check your plumbing before running the suite:

```sh
bash run.sh < reference-io/01-plumbing.in | diff -u reference-io/01-plumbing.out -
```

`bash test.sh` runs every session at once through `reference-io/check_io.py`.

| File | Covers |
|---|---|
| `01-plumbing` | framing, escaping, the `-` convention, protocol errors |
| `02-submatch` | capture reporting, including `-1 -1` |
| `03-find` | the scan rule, empty matches, assertions during a scan |
| `04-errors` | compile diagnostics and their positions |
| `05-program` | five program dumps — **illustrative**: the runner checks the structure of §9.3, not this exact text, so a different but well-formed compilation is fine |
| `06-unicode` | code point offsets over multibyte text |

Every file except `05-program` is exact and diffs clean against a correct
implementation.
