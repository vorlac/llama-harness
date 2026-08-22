# `json-parser` reference I/O

Seventeen fully worked exchanges for the harness protocol in `../SPEC.md`
section 3. They cover the framing plus one example of each of the seven error
classes that are easiest to get subtly wrong, and a failure here is a plumbing
bug rather than a parser bug. They are the visible check: passing all seventeen
does not mean the parser conforms, and the graded suite is elsewhere.

```
session-01.request       232 bytes, 10 exchanges, all ASCII
session-01.transcript    the expected normalised responses
session-02.request.b64   644 bytes,  7 exchanges, raw bytes and a 513-deep input
session-02.transcript    the expected normalised responses
check_io.py              feeds a session in, renders the transcript, diffs it
```

Session 02 carries bytes that are not text - an invalid UTF-8 byte, a NUL
inside a string payload - so it is stored base64-encoded and decoded on the way
in. The bytes the harness sees are exactly the 644 the table below describes.

## Running it

```sh
python3 reference-io/check_io.py --cwd . -- bash run.sh --harness
python3 reference-io/check_io.py --session reference-io/session-01.request \
    --print --cwd . -- bash run.sh --harness
```

Exit codes: `0` both matched, `1` a transcript differed, `2` usage error.

## The transcript format

`check_io.py` normalises each response to one line:

```
OK <id> <canonical form>
ERR <id> <code> <offset> <line> <column> msg=nonempty
```

and appends `END responses=<n> exit=<status>`. Message length and message text
are dropped because SPEC.md leaves their content free; **everything else is
compared exactly**, including the echoed case id, the canonical bytes, the
offset triple, the response count and the process exit status. The message is
still checked for being non-empty and free of LF.

## session-01 — framing, canonical forms, common errors

| Request         | Payload                 | Expected response                                                                  |
| --------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `CASE ex-01 17` | `{"b":1,"a":[1,2]}`     | `OK ex-01 {"a":[1,2],"b":1}` — keys sorted                                         |
| `CASE ex-02 21` | `  [1.50, -0, 1e400]  ` | `OK ex-02 [1.5,-0,1e400]` — trailing fraction zero dropped, `-0` kept, no overflow |
| `CASE ex-03 17` | `"caf\u00E9 \/ ok"`     | `OK ex-03 "caf\u00e9 / ok"` — hex lowercased, `\/` unescaped                       |
| `CASE ex-04 4`  | `true`                  | `OK ex-04 true` — a scalar is a whole document                                     |
| `CASE ex-05 4`  | `[1,]`                  | `ERR ex-05 E_UNEXPECTED_BYTE 3 1 4` — the `]` after the comma                      |
| `CASE ex-06 7`  | `{"a" 1}`               | `ERR ex-06 E_UNEXPECTED_BYTE 5 1 6` — a `:` was required                           |
| `CASE ex-07 0`  | (empty)                 | `ERR ex-07 E_EMPTY 0 1 1` — zero-length payloads are legal requests                |
| `CASE ex-08 12` | `{\n "n": 01\n}`        | `ERR ex-08 E_BAD_NUMBER 9 2 8` — leading zero, second line, column 8               |
| `CASE ex-09 4`  | `[1e]`                  | `ERR ex-09 E_BAD_NUMBER 3 1 4` — the run `1e` stops at `]`                         |
| `CASE ex-10 2`  | `1e`                    | `ERR ex-10 E_UNEXPECTED_EOF 2 1 3` — the same run, but at end of input             |

`ex-09` and `ex-10` are the pair that pins SPEC.md section 9.2: the same
malformed number reports two different codes depending on whether the offending
position is a byte or end of input.

The first exchange, byte for byte (`·` stands in for the LF that terminates
each line; the file contains no other whitespace between frames):

```
request   CASE ex-01 17·{"b":1,"a":[1,2]}·
response  OK ex-01 17·{"a":[1,2],"b":1}·
```

and one rejection, with a message of the implementation's own choosing (here 24
bytes long):

```
request   CASE ex-05 4·[1,]·
response  ERR ex-05 E_UNEXPECTED_BYTE 3 1 4 24·unexpected ']' after ','·
```

## session-02 — raw bytes, Unicode, depth

| Request          | Payload (hex where not printable) | Expected response                                            |
| ---------------- | --------------------------------- | ------------------------------------------------------------ |
| `CASE ex-11 4`   | `22 C3 A9 22`                     | `OK ex-11 "\u00e9"` — raw UTF-8 in, escape out               |
| `CASE ex-12 6`   | `22 F0 9F 98 80 22`               | `OK ex-12 "\ud83d\ude00"` — surrogate pair maths             |
| `CASE ex-13 3`   | `22 FF 22`                        | `ERR ex-13 E_INVALID_UTF8 1 1 2`                             |
| `CASE ex-14 5`   | `EF BB BF 5B 5D`                  | `ERR ex-14 E_BOM 0 1 1` — a leading BOM is rejected          |
| `CASE ex-15 5`   | `22 61 00 62 22`                  | `ERR ex-15 E_CONTROL_CHAR 2 1 3` — raw NUL inside a string   |
| `CASE ex-16 8`   | `"\ud800"`                        | `ERR ex-16 E_LONE_SURROGATE 1 1 2` — offset of the backslash |
| `CASE ex-17 513` | 513 × `[`                         | `ERR ex-17 E_DEPTH_LIMIT 512 1 513` — the 513th bracket      |

`ex-15` is the case that exposes a text-mode or line-oriented reader: the NUL is
inside the payload and the payload length is the only thing that delimits it.
`ex-17` is deliberately one bracket past the limit, so the reported offset says
whether the check runs before or after the depth increment.

## What a failure here means

| Symptom                                                      | Almost always                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `could not start harness`                                    | `run.sh` is missing or does not accept `--harness`                                                |
| `protocol error: ... header must be OK or ERR`               | something is being written to stdout that is not a response — a log line, a prompt, a debug print |
| `payload for ... is not followed by LF`                      | the trailing frame LF is missing after the payload                                                |
| `harness did not finish within 60.0s`                        | the harness waits for more input after EOF, or reads a fixed number of requests                   |
| Everything matches except `END ... exit=N`                   | the process exits non-zero after a clean EOF; a rejected document is not a harness error          |
| These sessions pass but the graded suite times out on case one | stdout is flushed only at exit. `check_io.py` batches the whole session, the runner does not.   |
