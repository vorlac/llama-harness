# `etl-pipeline` — data contract

Normative specification for the `etl-pipeline` task. `README.md` beside it
describes the workspace layout and the `build.sh` / `run.sh` / `test.sh`
contract; this document is the data contract and does not restate them.

This document defines **semantics only**. It says nothing about threads,
processes, queues, batching, or memory layout. Any implementation that produces
the bytes defined here, from the inputs defined here, is correct. How it gets
there is what the task measures.

Everything below is normative unless a paragraph is marked *Note*.

---

## 0. Conventions used in this document

- **Byte order** means lexicographic comparison of the raw byte sequences
  (`memcmp` semantics). All strings this pipeline emits are ASCII, so byte order
  and codepoint order coincide.
- **milli-units** means a value scaled by 1000 and held as a signed 64-bit
  integer. `21.750 C` is `21750` milli-C. No stage of this pipeline may use
  binary floating point. Every arithmetic result defined here is exactly
  representable in `int64`, and the ranges are bounded in §5.3 so that no
  intermediate product overflows `int64`.
- `rdiv(n, d)` — integer division rounding half away from zero, defined for
  `d > 0`:

  ```
  rdiv(n, d):
      if n >= 0: return  (( n * 2) + d) / (2 * d)      # truncating division
      else:      return -(((-n * 2) + d) / (2 * d))
  ```

  Worked values: `rdiv(4, 10) = 0`, `rdiv(5, 10) = 1`, `rdiv(-5, 10) = -1`,
  `rdiv(-4, 10) = 0`, `rdiv(15, 10) = 2`.
- **LF** is byte `0x0A`. **TAB** is byte `0x09`. Every file this pipeline reads
  or writes uses LF line terminators only. A CR (`0x0D`) anywhere in an input
  record is an encoding error (§4.1) — CRLF input is rejected, loudly, record by
  record.
- Regular expressions are used only as compact grammar notation. They are
  anchored (`^…$`) and ASCII. An implementation is not required to use a regex
  engine, and generally should not.

---

## 1. Inputs

Two files, both produced by `gen_workload.py` (§9). Both are read-only.

### 1.1 `events.ndjson` — the record stream

A newline-delimited stream of JSON objects. Large: the default workload is over
a million records and a few hundred megabytes.

The file is split into **lines** on LF. The trailing empty segment after the
file's final LF is not a line. Lines are numbered from **1**. The line number is
the record's identity for error reporting and it is the record's position in
**input order**, which several stages below depend on.

#### 1.1.1 The JSON subset

Records are JSON, restricted to the following subset. This restriction exists so
that a hand-written parser and a library parser agree byte for byte on every
input, including malformed ones.

| Construct      | Rule                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top level      | Must be an object. Anything else is `not_object` (§4.3).                                                                                             |
| Whitespace     | Only SPACE (`0x20`) may appear between tokens. It must be accepted and ignored. The generator emits none.                                            |
| Strings        | Double-quoted. The only escape sequences that may appear are `\"` and `\\`. Any other backslash escape (including `\n`, `\uXXXX`) is a syntax error. |
| Numbers        | Integers only: `-?(0                                                                                                                                 | [1-9][0-9]*)`. No `+`, no leading zeros, no fraction, no exponent. All decimal quantities in this format are carried as **strings** (§1.1.3). |
| Literals       | `null`, `true`, `false` must all parse. Their semantics are in §4.4.                                                                                 |
| Duplicate keys | Legal. The **last** occurrence wins.                                                                                                                 |
| Unknown keys   | Legal and ignored. The generator emits an `_ingest` integer key on some records specifically to exercise this.                                       |
| Byte range     | Every byte of a record line must be in `0x20`–`0x7E`. See §4.1.                                                                                      |

*Note:* because the byte range check in §4.1 runs before parsing, a conforming
parser never sees a control byte or a non-ASCII byte and does not need to handle
either.

#### 1.1.2 Record schema

Canonical field order — this is the order the generator emits and the order in
which validation checks are applied (§4.4):

| Field     | Type            | Required | Grammar / domain                      |
| --------- | --------------- | -------- | ------------------------------------- |
| `id`      | string          | yes      | `^E[0-9]{10}$`                        |
| `ts`      | string          | yes      | §1.1.4                                |
| `dev`     | string          | yes      | `^dev-[0-9]{6}$`                      |
| `site`    | string          | no       | `^SITE-[0-9]{2}$`                     |
| `kind`    | string          | yes      | one of `telemetry`, `status`, `audit` |
| `payload` | object          | yes      | shape depends on `kind`, §1.1.5       |
| `tags`    | array of string | no       | at most 8 elements, §1.1.6            |
| `seq`     | integer         | no       | `0 <= seq <= 2147483647`              |

#### 1.1.3 Decimal strings

Quantities that are not whole numbers are carried as strings with a fixed scale
of three fractional digits:

```
^-?(0|[1-9][0-9]{0,6})\.[0-9]{3}$
```

The value is read as milli-units: `"21.750"` is `21750`, `"-0.125"` is `-125`,
`"-0.000"` is `0`. The grammar admits magnitudes up to `9999999.999`; §4.4
rejects anything whose magnitude exceeds `1000000.000` before conversion.

#### 1.1.4 Timestamps

```
^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}(Z|[+-][0-9]{2}:[0-9]{2})$
```

with, additionally, all of:

- month `01`–`12`; day valid for that month in the **proleptic Gregorian**
  calendar (leap year iff divisible by 4 and not by 100, or divisible by 400);
- hour `00`–`23`, minute `00`–`59`, second `00`–`59` (no leap second `60`);
- offset hour `00`–`23`, offset minute `00`–`59`, and total offset magnitude
  `<= 14:00`;
- `T` and `Z` uppercase only.

Anything failing any of the above is `bad_timestamp`. There are no leap seconds
anywhere in this pipeline: one day is exactly 86 400 000 milliseconds.

Examples: `2024-03-05T14:22:31.250+02:00`, `2024-03-05T12:22:31.250Z`,
`2024-03-04T23:52:31.250-13:30`.

#### 1.1.5 Payload shapes

Canonical subfield order is the order listed. Subfields not listed are ignored.

`kind = "telemetry"`

| Subfield  | Type    | Required | Domain                                                          |
| --------- | ------- | -------- | --------------------------------------------------------------- |
| `metric`  | string  | yes      | one of `temperature`, `pressure`, `humidity`, `flow`, `voltage` |
| `value`   | string  | yes      | decimal string, §1.1.3                                          |
| `unit`    | string  | yes      | an accepted unit **for that metric**, §5.2                      |
| `quality` | integer | no       | `0 <= quality <= 100`; absent means `100`                       |

`kind = "status"`

| Subfield | Type    | Required | Domain                                                |
| -------- | ------- | -------- | ----------------------------------------------------- |
| `state`  | string  | yes      | one of `online`, `offline`, `degraded`, `maintenance` |
| `code`   | integer | no       | `0 <= code <= 65535`                                  |

`kind = "audit"`

| Subfield | Type   | Required | Domain                                       |
| -------- | ------ | -------- | -------------------------------------------- |
| `actor`  | string | yes      | 1–48 bytes, all in `0x20`–`0x7E`             |
| `action` | string | yes      | one of `login`, `logout`, `config`, `reboot` |

*Note:* `status` and `audit` records are dropped at the filter stage (§5.6) and
never reach the aggregates. They are **not** exempt from validation: a malformed
`audit` record must still appear in the rejects file with the correct reason. An
implementation that skips validation for non-telemetry records produces the
wrong rejects file and fails correctness.

#### 1.1.6 Tags

`tags` is an array of at most 8 strings. Each element is canonicalised (§5.4)
and the canonical form must match `^[a-z0-9_.:-]{1,32}$`.

#### 1.1.7 Example records

Well-formed:

```
{"id":"E0000000001","ts":"2024-03-05T00:00:00.480+02:00","dev":"dev-002911","kind":"telemetry","payload":{"metric":"pressure","value":"101.325","unit":"kPa","quality":97},"tags":["Indoor "," CALIBRATED","indoor"]}
{"id":"E0000000002","ts":"2024-03-04T22:01:13.004Z","dev":"dev-000017","site":"SITE-03","kind":"telemetry","payload":{"metric":"temperature","value":"71.600","unit":"F"},"tags":["outdoor"],"seq":41,"_ingest":9}
{"id":"E0000000003","ts":"2024-03-05T00:00:02.115-05:00","dev":"dev-003480","kind":"status","payload":{"state":"degraded","code":17}}
{"id":"E0000000004","ts":"2024-03-05T00:00:02.900Z","dev":"dev-001204","kind":"audit","payload":{"actor":"svc-rotator","action":"config"},"tags":[]}
```

Malformed (one per line, with the reason each produces):

```
{"id":"E0000000005","ts":"2024-03-05T00:00:03.001Z","dev":"dev-000  -> bad_json (truncated)
{"id":"E0000000006","ts":"2024-02-30T00:00:03.500Z",...}          -> bad_timestamp (Feb 30)
{"id":"E0000000007",...,"payload":{"metric":"torque",...}}        -> unknown_metric
{"id":"E0000000008",...,"payload":{"metric":"flow","value":"1.000","unit":"psi"}}  -> unknown_unit
{"id":"E0000000009",...,"seq":"41"}                               -> bad_type (/seq)
                                                                   -> empty_line
```

### 1.2 `devices.tsv` — the lookup table

TAB-separated, LF-terminated, with a header line. Sorted by `device_id` in byte
order. A few thousand rows; small enough to hold entirely in memory, and it must
be loaded exactly once.

```
device_id	site_id	region	calibration_milli	active
dev-000000	SITE-04	eu-west	-125	1
dev-000001	SITE-11	us-east	0	1
dev-000002	SITE-04	ap-south	340	0
```

| Column              | Grammar                                  |
| ------------------- | ---------------------------------------- |
| `device_id`         | `^dev-[0-9]{6}$`, unique across the file |
| `site_id`           | `^SITE-[0-9]{2}$`                        |
| `region`            | `^[a-z]{2}-[a-z]+$`                      |
| `calibration_milli` | `^-?(0                                   | [1-9][0-9]*)$`, magnitude `<= 1000000` |
| `active`            | `0` or `1`                               |

A malformed or unreadable lookup table is a fatal startup error: exit code 4
(§7.2). It is never a per-record reject.

---

## 2. Outputs

Three files, written into the output directory given on the command line (§7.1).
The directory is created if it does not exist. Any pre-existing file of the same
name is truncated.

| File          | Format          | Contents                                     |
| ------------- | --------------- | -------------------------------------------- |
| `windows.csv` | CSV, header, LF | the windowed aggregates — the primary output |
| `rejects.tsv` | TSV, header, LF | one row per rejected input line              |
| `summary.txt` | `key=value`, LF | run counters                                 |

Rules common to all three:

- LF terminators only. Every line, including the last, ends with exactly one LF.
  No file ends with a blank line, and no file contains a CR.
- Fields never contain a comma, TAB, quote, CR or LF. Consequently **no quoting
  or escaping is ever emitted in `windows.csv`**, and the only escaping in
  `rejects.tsv` is the byte escaping of §2.2.1. A writer that emits CSV quotes
  produces a byte mismatch and fails.
- The byte content of all three files is a pure function of the two inputs. It
  does not depend on the worker count, on scheduling, on iteration order of any
  hash container, or on the machine. This is the determinism requirement, and it
  is what makes the correctness check possible at all. See §6.

### 2.1 `windows.csv`

Header line, verbatim:

```
device_id,site_id,region,metric,window_start,count,sum_milli,min_milli,max_milli,mean_milli,max_abs_delta_milli,first_ts,last_ts,tags
```

One row per aggregation group (§5.8). Columns:

| #   | Column                | Content                                                                                                                                 |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `device_id`           | the record's `dev`                                                                                                                      |
| 2   | `site_id`             | `site_id` from the lookup table                                                                                                         |
| 3   | `region`              | `region` from the lookup table                                                                                                          |
| 4   | `metric`              | canonical metric name                                                                                                                   |
| 5   | `window_start`        | window start as a normalised UTC timestamp (§5.3), always `.000Z`                                                                       |
| 6   | `count`               | number of records in the group, `>= 1`                                                                                                  |
| 7   | `sum_milli`           | sum of canonical values                                                                                                                 |
| 8   | `min_milli`           | minimum canonical value                                                                                                                 |
| 9   | `max_milli`           | maximum canonical value                                                                                                                 |
| 10  | `mean_milli`          | `rdiv(sum_milli, count)`                                                                                                                |
| 11  | `max_abs_delta_milli` | maximum `abs(delta)` over records in the group that have a delta (§5.7); **empty string** if no record in the group has one             |
| 12  | `first_ts`            | normalised UTC timestamp of the **first record of the group in input order**                                                            |
| 13  | `last_ts`             | normalised UTC timestamp of the **last record of the group in input order**                                                             |
| 14  | `tags`                | union of the canonical tags of the group's records, sorted ascending in byte order, joined with `;`; empty string if the union is empty |

Integers are written in base 10 with no padding, no separators, and a leading
`-` only when negative. `count` and `max_abs_delta_milli` are never negative.

*Note:* columns 12 and 13 are ordered by **arrival**, not by event time. The
workload deliberately contains out-of-order arrivals, so `first_ts` is routinely
greater than `last_ts`. This is intentional: it is what forces a parallel
implementation to preserve input order rather than merge on timestamp.

#### 2.1.1 Row order — the total ordering rule

Rows are sorted ascending by, in order of significance:

1. `device_id`, byte order;
2. `metric`, byte order;
3. `window_start_ms`, numerically (equivalently `window_start`, byte order,
   since all window starts are the same width and in the same century).

`(device_id, metric, window_start_ms)` is the aggregation key, so this is a
**total** order: no two rows can compare equal. The output is therefore fully
determined regardless of how the work was partitioned across workers, which is
exactly the property the task is built around.

Example rows:

```
dev-000000,SITE-04,eu-west,flow,2024-03-05T00:05:00.000Z,7,283412,39104,41220,40487,1806,2024-03-05T00:07:41.220Z,2024-03-05T00:09:58.004Z,calibrated;indoor
dev-000000,SITE-04,eu-west,flow,2024-03-05T00:10:00.000Z,1,40551,40551,40551,40551,,2024-03-05T00:11:02.750Z,2024-03-05T00:11:02.750Z,
```

### 2.2 `rejects.tsv`

Header line, verbatim:

```
line_no	reason	field	detail	raw_prefix
```

One row per rejected input line. **Exactly one** — a line that fails several
checks is reported against the first one that fires, in the order of §4. Rows
are sorted ascending by `line_no`, which is a total order because a line yields
at most one reject.

| Column       | Content                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `line_no`    | 1-based line number in `events.ndjson`                                                                            |
| `reason`     | a code from §3                                                                                                    |
| `field`      | JSON-pointer-style path to the offending field (`/payload/value`, `/tags/2`), or `-` when no single field applies |
| `detail`     | the exact string defined for that reason in §3; `-` when the reason defines no detail                             |
| `raw_prefix` | the first **80 bytes** of the raw line (excluding its LF terminator), byte-escaped per §2.2.1                     |

Truncation to 80 bytes happens **before** escaping, so an escaped prefix may be
longer than 80 characters.

#### 2.2.1 Byte escaping

`esc(bytes)` maps a byte sequence to a printable ASCII string, byte by byte:

| Input byte                          | Output                                        |
| ----------------------------------- | --------------------------------------------- |
| `\` (`0x5C`)                        | `\\`                                          |
| TAB (`0x09`)                        | `\t`                                          |
| LF (`0x0A`)                         | `\n`                                          |
| CR (`0x0D`)                         | `\r`                                          |
| any other byte `< 0x20` or `> 0x7E` | `\x` followed by two **lowercase** hex digits |
| anything else                       | the byte itself                               |

Applied to `raw_prefix` and to every `<esc>` placeholder in §3. Where a §3
detail says `<esc>`, the source string is truncated to its first **32 bytes**
before escaping.

### 2.3 `summary.txt`

`key=value` lines, no spaces, in exactly this order. All values are
non-negative decimal integers except `sum_milli_total`, which may be negative.

```
input_lines=<number of lines in events.ndjson>
rejected_total=<sum of the 20 rejected_* counters>
rejected_bad_encoding=<n>
rejected_empty_line=<n>
rejected_bad_json=<n>
rejected_not_object=<n>
rejected_missing_field=<n>
rejected_bad_type=<n>
rejected_bad_id=<n>
rejected_bad_timestamp=<n>
rejected_timestamp_out_of_range=<n>
rejected_unknown_kind=<n>
rejected_bad_payload=<n>
rejected_unknown_metric=<n>
rejected_unknown_unit=<n>
rejected_bad_value=<n>
rejected_value_out_of_range=<n>
rejected_bad_quality=<n>
rejected_bad_tag=<n>
rejected_duplicate_id=<n>
rejected_unknown_device=<n>
rejected_site_mismatch=<n>
dropped_inactive=<n>
dropped_non_telemetry=<n>
dropped_low_quality=<n>
aggregated_records=<n>
window_rows=<data rows in windows.csv, excluding the header>
distinct_devices=<distinct device_id values in windows.csv>
sum_milli_total=<sum of column sum_milli over all rows of windows.csv>
```

Two invariants the verifier checks:

```
input_lines = rejected_total + dropped_inactive + dropped_non_telemetry
            + dropped_low_quality + aggregated_records
rejected_total = number of data rows in rejects.tsv
```

---

## 3. Reject reasons

The complete, closed enumeration. The order here is the order used in
`summary.txt`; it is **not** the precedence order, which is the stage order
of §4.

| Code                     | Raised at  | `field`                                     | `detail`                                                                                                  |
| ------------------------ | ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bad_encoding`           | §4.1       | `-`                                         | `byte=0xHH offset=N` — first offending byte, lowercase hex, 0-based byte offset in the raw line           |
| `empty_line`             | §4.2       | `-`                                         | `-`                                                                                                       |
| `bad_json`               | §4.3       | `-`                                         | `-`                                                                                                       |
| `not_object`             | §4.3       | `-`                                         | `-`                                                                                                       |
| `missing_field`          | §4.4       | path                                        | `-`                                                                                                       |
| `bad_type`               | §4.4       | path                                        | `expected=<t> actual=<t>` where `<t>` is one of `string`, `integer`, `object`, `array`, `boolean`, `null` |
| `bad_id`                 | §4.4       | `/id`, `/dev` or `/site`                    | `-`                                                                                                       |
| `bad_timestamp`          | §4.4       | `/ts`                                       | `-`                                                                                                       |
| `timestamp_out_of_range` | §4.5       | `/ts`                                       | `-`                                                                                                       |
| `unknown_kind`           | §4.4       | `/kind`                                     | `value=<esc>`                                                                                             |
| `bad_payload`            | §4.4       | subfield path                               | `value=<esc>`                                                                                             |
| `unknown_metric`         | §4.4       | `/payload/metric`                           | `value=<esc>`                                                                                             |
| `unknown_unit`           | §4.4       | `/payload/unit`                             | `value=<esc>`                                                                                             |
| `bad_value`              | §4.4       | `/payload/value`                            | `-`                                                                                                       |
| `value_out_of_range`     | §4.4, §4.7 | `/payload/value`, `/payload/code` or `/seq` | `value=<esc>` for the decimal string; `value=<n>` for an integer field                                    |
| `bad_quality`            | §4.4       | `/payload/quality`                          | `value=<n>`                                                                                               |
| `bad_tag`                | §4.4       | `/tags` or `/tags/<i>`                      | `count=<n>` when the array is too long; otherwise `value=<esc>` of the **raw** element                    |
| `duplicate_id`           | §4.6       | `/id`                                       | `first_line=<n>` — the line number of the first record that claimed this id                               |
| `unknown_device`         | §4.7       | `/dev`                                      | `value=<esc>`                                                                                             |
| `site_mismatch`          | §4.7       | `/site`                                     | `record=<esc> lookup=<esc>`                                                                               |

`bad_type`'s `actual=null` never occurs in practice: a `null` in a required
field is `missing_field` and a `null` in an optional field means absent (§4.4).
The token is defined for completeness.

---

## 4. Per-record processing — rejection order

Stages run in the order given. **The first check that fails determines the
reject reason, and processing of that line stops.** Within a stage, checks run in
the order written. This ordering is the whole of the precedence rule; there is no
other tie-break.

### 4.1 Encoding check

Scan the raw line. If any byte is outside `0x20`–`0x7E`, reject `bad_encoding`
naming the **first** such byte and its 0-based offset.

### 4.2 Emptiness check

If the line has length 0, or consists entirely of SPACE bytes, reject
`empty_line`.

### 4.3 Parse

Parse the line as the JSON subset of §1.1.1. Any syntax error is `bad_json`. If
the top-level value parses but is not an object, reject `not_object`.

*Note:* `bad_json` deliberately carries no offset in `detail`. Different parser
designs stop at different byte positions on the same malformed input, and the
output must not depend on the parser.

### 4.4 Validate

Absent, or present with the literal value `null`:

- a **required** field is `missing_field`;
- an **optional** field is treated as absent, and its checks are skipped.

`true` or `false` in any field is `bad_type` with `actual=boolean`.

Checks, in this exact order:

1. `id` — `missing_field` / `bad_type` `expected=string` / `bad_id`.
2. `ts` — `missing_field` / `bad_type` `expected=string` / `bad_timestamp`
   (grammar **and** calendar validity, §1.1.4).
3. `dev` — `missing_field` / `bad_type` `expected=string` / `bad_id`.
4. `site` — if present: `bad_type` `expected=string` / `bad_id`.
5. `kind` — `missing_field` / `bad_type` `expected=string` / `unknown_kind`.
6. `payload` — `missing_field` / `bad_type` `expected=object`.
7. Payload subfields, by `kind`:
   - `telemetry`:
     1. `metric` — `missing_field` / `bad_type` `expected=string` /
        `unknown_metric`.
     2. `value` — `missing_field` / `bad_type` `expected=string` / `bad_value`
        (grammar, §1.1.3) / `value_out_of_range` when
        `abs(milli) > 1000000000`.
     3. `unit` — `missing_field` / `bad_type` `expected=string` /
        `unknown_unit` when the unit is not accepted **for this metric** (§5.2).
     4. `quality` — if present: `bad_type` `expected=integer` / `bad_quality`
        when outside `0..100`.
   - `status`:
     1. `state` — `missing_field` / `bad_type` `expected=string` /
        `bad_payload`.
     2. `code` — if present: `bad_type` `expected=integer` /
        `value_out_of_range` when outside `0..65535`.
   - `audit`:
     1. `actor` — `missing_field` / `bad_type` `expected=string` /
        `bad_payload` when the length is outside `1..48`.
     2. `action` — `missing_field` / `bad_type` `expected=string` /
        `bad_payload`.
8. `tags` — if present: `bad_type` `expected=array`; then `bad_tag` with
   `count=<n>` when the array has more than 8 elements; then, for each element
   in index order, `bad_type` `expected=string` at `/tags/<i>`, then `bad_tag`
   at `/tags/<i>` when the element's canonical form (§5.4) does not match
   `^[a-z0-9_.:-]{1,32}$`.
9. `seq` — if present: `bad_type` `expected=integer` / `value_out_of_range`
   when outside `0..2147483647`.

### 4.5 Normalise

Convert `ts` to UTC (§5.3). If the resulting epoch milliseconds are `< 0` or
`>= 4102444800000` (which is `2100-01-01T00:00:00.000Z`), reject
`timestamp_out_of_range`.

Also performed here, and never rejecting: tag canonicalisation (§5.4) and
string canonicalisation (§5.5).

### 4.6 Deduplicate

Maintain the set of `id` values of every record that has reached this stage,
with the line number of the first. If this record's `id` is already present,
reject `duplicate_id` with `first_line=` that line number. Otherwise record this
line as the first for that id and continue.

Records rejected before this stage never enter the set. **First occurrence in
input order wins.** This stage is order-dependent by construction.

### 4.7 Enrich

1. Look up `dev` in the devices table. Absent — reject `unknown_device`.
2. If the record carried a `site` field and it differs from the table's
   `site_id`, reject `site_mismatch`.
3. `telemetry` only: convert the value to the metric's canonical unit (§5.2),
   then add the device's `calibration_milli`. If the result's magnitude exceeds
   `2000000000`, reject `value_out_of_range` at `/payload/value` with
   `value=<esc>` of the record's raw decimal string.

Records surviving all of §4 carry: normalised UTC timestamp and epoch
milliseconds, canonical tags, `site_id`, `region`, `active`, and — for telemetry
— the canonical calibrated value in milli-units.

---

## 5. Transformation semantics

### 5.1 Stage list

| #   | Stage                       | Order-dependent?                   | Relative cost |
| --- | --------------------------- | ---------------------------------- | ------------- |
| 1   | Read and split lines        | streaming                          | high          |
| 2   | Encoding + emptiness scan   | no                                 | low           |
| 3   | Parse (§4.3)                | no                                 | **highest**   |
| 4   | Validate (§4.4)             | no                                 | medium        |
| 5   | Normalise (§4.5, §5.3–§5.5) | no                                 | medium        |
| 6   | Deduplicate (§4.6)          | **yes, globally**                  | low           |
| 7   | Enrich (§4.7, §5.2)         | no                                 | low           |
| 8   | Filter (§5.6)               | no                                 | very low      |
| 9   | Delta (§5.7)                | **yes, per `(device_id, metric)`** | low           |
| 10  | Aggregate (§5.8)            | no (mergeable)                     | medium        |
| 11  | Sort and emit (§2)          | n/a                                | medium        |

*Note, non-normative but load-bearing for the task:* these costs are markedly
unequal — parse alone is a large fraction of the total, and stages 6 through 9
are individually trivial. Splitting workers evenly across stages is therefore
provably a poor partitioning. Two stages are order-dependent, and they are
order-dependent in different ways: stage 6 needs a single global view, stage 9
needs only per-key ordering. A design that serialises everything because two
stages have ordering constraints leaves most of the available parallelism on
the table.

### 5.2 Unit conversion

`v` is the value in milli-units of the **source** unit; the result is in
milli-units of the metric's canonical unit. All integer arithmetic; `rdiv` is
from §0.

| Metric        | Canonical | Unit   | Conversion                   |
| ------------- | --------- | ------ | ---------------------------- |
| `temperature` | `C`       | `C`    | `v`                          |
|               |           | `F`    | `rdiv((v - 32000) * 5, 9)`   |
|               |           | `K`    | `v - 273150`                 |
| `pressure`    | `kPa`     | `kPa`  | `v`                          |
|               |           | `Pa`   | `rdiv(v, 1000)`              |
|               |           | `bar`  | `v * 100`                    |
|               |           | `psi`  | `rdiv(v * 6894757, 1000000)` |
| `humidity`    | `pct`     | `pct`  | `v`                          |
|               |           | `frac` | `v * 100`                    |
| `flow`        | `lpm`     | `lpm`  | `v`                          |
|               |           | `lps`  | `v * 60`                     |
|               |           | `gpm`  | `rdiv(v * 3785412, 1000000)` |
| `voltage`     | `V`       | `V`    | `v`                          |
|               |           | `mV`   | `rdiv(v, 1000)`              |
|               |           | `kV`   | `v * 1000`                   |

Any `(metric, unit)` pair not in this table is `unknown_unit`. Unit names are
matched **case-sensitively and exactly**: `c` is not `C`, `KPA` is not `kPa`.

The `6894757 / 1000000` and `3785412 / 1000000` factors are defined constants of
this specification. Do not substitute a more physically precise value: it would
change the output bytes.

Worked examples:
`71.600 F` → `rdiv((71600 - 32000) * 5, 9)` = `rdiv(198000, 9)` = `22000` (22.000 C).
`14.696 psi` → `rdiv(14696 * 6894757, 1000000)` = `rdiv(101325348872, 1000000)` = `101325` (101.325 kPa).

Bounds: `abs(v) <= 1000000000` after §4.4, so the largest intermediate is
`abs(v) * 6894757 * 2 < 1.4e16`, comfortably inside `int64`.

### 5.3 Timestamp normalisation

1. Parse the wall-clock fields and the offset (§1.1.4).
2. Compute days since the Unix epoch from `(year, month, day)` using the
   proleptic Gregorian calendar.
3. `epoch_ms = days * 86400000 + hh * 3600000 + mm * 60000 + ss * 1000 + mmm`,
   then subtract the offset: `epoch_ms -= sign * (off_hh * 3600000 + off_mm * 60000)`
   where `sign` is `+1` for `+HH:MM` and `-1` for `-HH:MM`; `Z` is offset zero.
4. Apply the range check of §4.5.
5. The **normalised UTC timestamp** is `epoch_ms` rendered back as
   `YYYY-MM-DDTHH:MM:SS.mmmZ`, zero-padded, always three fractional digits,
   always the literal `Z`. The year is always four digits over the permitted
   range.

Windowing: `WINDOW_MS = 300000` (5 minutes), tumbling, aligned to the Unix
epoch. `window_start_ms = (epoch_ms / WINDOW_MS) * WINDOW_MS` with truncating
division; `epoch_ms >= 0` is guaranteed by §4.5, so truncation and floor agree.
`window_start` in the output is `window_start_ms` rendered by rule 5, and always
ends `.000Z`.

`WINDOW_MS` is fixed. It is not configurable and must not be exposed as a flag.

### 5.4 Tag canonicalisation

Per element, in order:

1. Strip leading and trailing SPACE bytes.
2. Replace every run of one or more interior SPACE bytes with a single `_`.
3. Map `A`–`Z` to `a`–`z`. No other case mapping; the input is ASCII.
4. The result must match `^[a-z0-9_.:-]{1,32}$`, else `bad_tag` (§4.4 step 8).

Per record, after all elements are canonicalised: remove duplicates, then sort
ascending in byte order. The record's canonical tag list is that sorted, deduped
sequence. An absent `tags` field and a present-but-empty array both yield the
empty list; they are indistinguishable downstream.

Worked example: `["Indoor "," CALIBRATED","indoor","hall  way"]` →
`["calibrated","hall_way","indoor"]`.

### 5.5 String canonicalisation

`metric`, `unit`, `kind`, `state` and `action` are matched exactly as received —
no case folding, no trimming. Only `tags` is canonicalised. This is deliberate:
`"Temperature"` is `unknown_metric`, not a temperature reading.

### 5.6 Filter

Applied to records surviving §4, in this order. Filtered records are counted,
**not** rejected — they never appear in `rejects.tsv`.

1. `active == 0` in the lookup table → drop, `dropped_inactive`.
2. `kind != "telemetry"` → drop, `dropped_non_telemetry`.
3. `quality < 50` (absent `quality` counts as `100`) → drop,
   `dropped_low_quality`.

Records surviving all three are **accepted records**. `aggregated_records` in
§2.3 counts exactly these.

### 5.7 Delta

Over the accepted records, **in input order**, keyed by
`(device_id, metric)`:

```
delta = value_canon - previous value_canon for the same (device_id, metric)
```

The first accepted record for a key has **no** delta. Every later accepted
record for that key has one, computed against the immediately preceding accepted
record for that key — which may fall in a different window.

Only accepted records participate. A record dropped by §5.6, or rejected in §4,
is invisible here and does not break the chain.

This is the second order-dependent stage. Note what it needs and what it does
not: it requires the accepted records for a given `(device_id, metric)` to be
processed in input order relative to one another. It requires nothing at all
about the relative order of two different keys.

### 5.8 Aggregate

Group the accepted records by `(device_id, metric, window_start_ms)`. Per group:

| Field                 | Definition                                                                             |
| --------------------- | -------------------------------------------------------------------------------------- |
| `count`               | number of records in the group                                                         |
| `sum_milli`           | sum of `value_canon`                                                                   |
| `min_milli`           | minimum `value_canon`                                                                  |
| `max_milli`           | maximum `value_canon`                                                                  |
| `mean_milli`          | `rdiv(sum_milli, count)`, computed once at emit time                                   |
| `max_abs_delta_milli` | maximum of `abs(delta)` over the group's records that have a delta; empty when none do |
| `first_ts`            | normalised UTC timestamp of the group's first record **in input order**                |
| `last_ts`             | normalised UTC timestamp of the group's last record **in input order**                 |
| `tags`                | union of the group's records' canonical tags                                           |

`site_id` and `region` are constant within a group (the lookup is keyed by
device) and are taken from the lookup table.

Every one of these is either commutative-associative or a first/last over a
totally ordered sequence, so per-partition partial aggregates can be merged —
provided the merge respects input order for `first_ts` and `last_ts`.

---

## 6. Determinism

For a given `events.ndjson` and `devices.tsv`, the three output files are fixed
byte sequences. In particular they must be identical for `--workers 1`,
`--workers 4`, and `--workers 64`, on any machine, on any run.

The consequences worth stating explicitly, because they are where naive parallel
implementations break:

- Rows in `windows.csv` are emitted in the §2.1.1 order, not in the order groups
  happened to complete.
- Rows in `rejects.tsv` are ordered by `line_no`, not by which worker noticed
  the failure first.
- `first_ts` / `last_ts` follow input order, so a merge of two partial groups
  must know which partition came first in the input.
- Dedup keeps the **first** occurrence by line number, which is not necessarily
  the first one a worker observes.
- Iteration order of hash maps, sets and dictionaries must never reach the
  output unsorted.

---

## 7. Command-line contract

### 7.1 Invocation

The scored surface is `run.sh`, invoked with the workspace root as the
working directory. Nothing here carries an execute bit, so it is invoked
through its interpreter:

```
bash run.sh [EVENTS_PATH] [DEVICES_PATH] [OUT_DIR] [WORKERS]
```

All four are optional and positional. Each falls back to an environment variable
and then to a default:

| Position         | Env var       | Default                                                  |
| ---------------- | ------------- | -------------------------------------------------------- |
| 1 `EVENTS_PATH`  | `ETL_EVENTS`  | `data/main/events.ndjson`                                |
| 2 `DEVICES_PATH` | `ETL_DEVICES` | `data/main/devices.tsv`                                  |
| 3 `OUT_DIR`      | `ETL_OUT`     | `./out`                                                  |
| 4 `WORKERS`      | `ETL_WORKERS` | `0`                                                      |

`WORKERS` is a non-negative integer. `0` means "choose automatically from the
hardware concurrency". Any value `>= 1` is a hard request and must be honoured:
a benchmark that asks for 1 worker must get 1.

The underlying program should also accept the long flags `--events`,
`--devices`, `--out` and `--workers`; `run.sh` remains the normative surface and
is what the benchmark and the scorer call.

`run.sh` must write **nothing to stdout**. Progress, timings and diagnostics go
to stderr, where they are ignored.

### 7.2 Exit codes

| Code | Meaning                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 0    | Success. Outputs written. A non-empty `rejects.tsv` is success — rejects are normal operation, never a failure. |
| 1    | Unexpected internal error.                                                                                      |
| 2    | Usage error: wrong argument count, non-integer or negative worker count.                                        |
| 3    | `EVENTS_PATH` missing or unreadable.                                                                            |
| 4    | `DEVICES_PATH` missing, unreadable, or malformed per §1.2.                                                      |
| 5    | Output directory could not be created, or a write failed.                                                       |

On any non-zero exit the output files are considered undefined.

---

## 8. Verification

```
python3 verify_output.py --events E --devices D --out CANDIDATE_DIR [--reference REF_DIR] [--recompute] [--json]
```

`--recompute` derives the expected `windows.csv`, `rejects.tsv` and
`summary.txt` from the inputs using an independent implementation of this
specification, and compares them byte for byte against the candidate. It is the
authoritative check: correctness never depends on a reference directory being
right.

`--reference` byte-compares against a stored reference. It is fast and is what
`bench.sh` uses on repeat runs. `--ensure-reference DIR` produces that directory
**from the oracle**, regenerating it only when its stored input fingerprint no
longer matches, so the fast path is oracle-derived and stays authoritative.

Both may be given. Exit code is 0 when every requested check passes, 1 on any
mismatch, 2 on usage error. See `verify_output.py --help`.

---

## 9. Workload generation

```
python3 gen_workload.py --out data/main --records 1200000 --seed 20260820
python3 gen_workload.py --out data/small --records 20000 --seed 7 --devices 120
```

Generation is seeded and fully deterministic: the same flags produce
byte-identical files on any machine. `data/` is git-ignored; regenerate rather
than commit. See `gen_workload.py --help` and `README.md` for measured sizes and
timings.

`data/small` exists so `test.sh` can verify correctness in seconds without
touching the benchmark workload.
