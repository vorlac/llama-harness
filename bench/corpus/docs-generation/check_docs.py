#!/usr/bin/env python3
"""Mechanical checker for docs-generation tasks.

This is the half of docs-generation scoring that does not need a judge. It reads
a generated markdown document plus the checkout it claims to describe, and
answers questions that have exactly one right answer:

  * do the file:line citations in the document point at real lines of real files?
  * are the required sections present?
  * is the document inside its word budget?
  * are the mermaid blocks well formed?
  * does the document mention paths that do not exist in the checkout?

Everything subjective (is the prose any good, is the architecture description
correct) is left to the judge pass described in the category prompts. See
CONVENTIONS.md sections 9 and 11 for how this script is wired into scoring; the
matching task registry entries name it in their "verify" field.

Usage
-----
    python3 docs-generation/check_docs.py --doc <path-to-markdown> \
                                          --checkout <path-to-target-checkout> \
                                          [--min-words N] [--max-words N] \
                                          [--require-section NAME]... \
                                          [--min-mermaid N] \
                                          [--json]

The per-task flags are recorded in each task's registry entry under "verify_args"
(docs-generation/tasks/<task-id>/task.json), so the scorer never has to hardcode
word budgets or section names.

Exit status
-----------
    0   every hard check passed
    1   at least one hard check failed
    2   the invocation itself was bad (missing doc, missing checkout, bad flags)

Hard checks (they decide the exit status):
    * zero invalid citations
    * every --require-section heading present
    * word count within [--min-words, --max-words] when those are given
    * every mermaid fence opened, closed, and non-empty
    * at least --min-mermaid mermaid blocks when that flag is given

Warnings (reported, never fatal):
    * path-looking tokens in inline code spans that do not exist in the checkout
    * a missing "Open questions" section - the category rewards admitted
      uncertainty, but its absence is not a mechanical failure
    * a document with no citations at all
    * citation ranges spanning more than 60 lines, which the task prompts forbid
      but which are still verifiable references

Python 3.9+, standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

# --------------------------------------------------------------------------
# Citation grammar
# --------------------------------------------------------------------------
#
# A citation is a parenthesised reference to a source location:
#
#     (src/net/server.c:412)          single line
#     (src/net/server.c:412-458)      inclusive line range
#     (`src/net/server.c`:412)        backticks around the path are tolerated
#     (Cargo.toml:17)                 extension-bearing file at the repo root
#     (UNLICENSE:3)                   extensionless file, accepted only if it exists
#
# The task prompts publish this citation regex:
#
#     \(([A-Za-z0-9._+\-/]+):(\d+)(?:-(\d+))?\)
#
# The patterns here accept exactly that language, plus two tolerances that cost
# nothing (an optional backtick around the path, and the GitHub-style "L" prefix
# on line numbers). What keeps ordinary parenthesised prose out is a combination
# of the grammar and a predicate:
#
#   1. The path may not contain whitespace. That alone kills almost all prose,
#      because English inside parentheses has spaces: "(see chapter 3: page 12)"
#      and "(the ratio is 3:1 here)" both fail here.
#
#   2. What survives is filtered by looks_like_path() below. A token is treated
#      as a citation path when it contains a "/" separator, or ends in a
#      letter-led extension (".c", ".rs", ".toml"), or - the extensionless case
#      such as "Makefile" or "UNLICENSE" - names a file that actually exists in
#      the checkout. That last clause is what stops "(step:3)", "(note:12)" and
#      "(v2:99)" from being counted as broken citations: nothing named "step"
#      exists, so the parenthesis is prose, not a failed reference. Bare version
#      numbers such as "(1.2.3)" have no colon-and-line at all and never match.
#
# The line spec must be digits, optionally a second digit run after a hyphen.
# Anything else after the colon is *not* a citation but is very likely a
# malformed one, so a second, looser "candidate" pattern below catches those and
# reports them as unparseable rather than silently ignoring them.

# The path charset published in the prompts. Classification of what counts as a
# path happens in looks_like_path(), not in the regex.
_PATH = r"[A-Za-z0-9._+\-/]+"

# A path that is self-evidently a path, needing no filesystem lookup: it has a
# slash, or it ends in a letter-led extension of 1-10 characters.
SELF_EVIDENT_PATH_RE = re.compile(
    r"^(?:[^/]*/.*|[A-Za-z0-9_+\-.]+\.[A-Za-z][A-Za-z0-9_+\-]{0,9})$"
)

CITATION_RE = re.compile(
    r"""
    \(                              # opening paren
    \s*`?                           # optional backtick around the path
    (?P<path>""" + _PATH + r""")
    `?                              # optional closing backtick on the path
    :                               # the colon that separates path from lines
    L?                              # tolerate the GitHub-style "L" prefix
    (?P<start>\d{1,9})
    (?:
        \s*-\s*                     # range separator
        L?
        (?P<end>\d{1,9})
    )?
    \s*`?\s*
    \)                              # closing paren
    """,
    re.VERBOSE,
)

# Looser pattern: a parenthesised token whose left half is a real-looking path
# followed by a colon, but whose right half is not a clean line spec. Used only
# to report "unparseable" citations - i.e. the model tried to cite and got the
# syntax wrong, which is a different failure from citing a line that does not
# exist.
CANDIDATE_RE = re.compile(
    r"""
    \(
    \s*`?
    (?P<path>""" + _PATH + r""")
    `?
    :
    (?P<spec>[^()\n]{0,40})
    \)
    """,
    re.VERBOSE,
)


def looks_like_path(path, checkout):
    """True when `path` should be read as a citation path rather than prose.

    See the citation-grammar comment above. `checkout` is consulted only for the
    extensionless case, so that real files like "Makefile" or "UNLICENSE" can be
    cited while prose such as "(step:3)" is left alone.
    """
    if not path or path.endswith("/"):
        return False
    if SELF_EVIDENT_PATH_RE.match(path):
        return True
    return checkout.exists(path)

# A path-looking token as it appears inside an inline code span, optionally
# carrying a trailing ":123" or ":12-30" that is stripped before the existence
# test.
CODE_PATH_RE = re.compile(
    r"^(?P<path>" + _PATH + r")(?::L?\d{1,9}(?:-L?\d{1,9})?)?$"
)

# Fabricated-path detection is a warning, so it is tuned for few false alarms:
# a code span counts as a path only if it contains a directory separator or ends
# in one of these extensions. Dotted identifiers that are not paths (`self.app`,
# `foo.bar`) therefore do not raise warnings, and neither do extensionless names
# like `Makefile`, which are indistinguishable from ordinary words.
SOURCE_EXTENSIONS = {
    "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "rs", "go", "py", "pyi", "rb",
    "java", "cs", "kt", "swift", "zig", "js", "jsx", "ts", "tsx", "mjs", "cjs",
    "lua", "pl", "php", "scala", "clj", "ex", "exs", "erl", "hs", "ml", "m",
    "proto", "sql", "sh", "bash", "zsh", "fish", "ps1", "bat", "mk", "cmake",
    "toml", "json", "yaml", "yml", "ini", "cfg", "conf", "properties", "lock",
    "md", "rst", "txt", "html", "htm", "css", "scss", "xml", "csv", "tsv",
    "gradle", "bzl", "nix", "dockerfile", "service", "rules", "am", "ac", "in",
}

INLINE_CODE_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)")

ATX_HEADING_RE = re.compile(r"^ {0,3}(#{1,6})\s+(?P<text>.*?)\s*#*\s*$")
SETEXT_UNDERLINE_RE = re.compile(r"^ {0,3}(=+|-{2,})\s*$")
FENCE_RE = re.compile(r"^(?P<indent> {0,3})(?P<fence>`{3,}|~{3,})\s*(?P<info>.*?)\s*$")

# The word count the task prompts publish: whitespace-separated tokens remaining
# after every fenced code block (mermaid included) is removed. Reproduced here
# verbatim so the checker and the prompts' run.sh can never disagree.
FENCED_BLOCK_RE = re.compile(r"^```.*?^```", re.S | re.M)

# Longest line span a single citation range is allowed to cover before it is
# reported as too loose to be evidence. Matches the rule in the task prompts.
MAX_CITATION_SPAN = 60

# Directories that are never part of a checkout's source of truth and that make
# the fallback basename index pointlessly large.
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".tox", ".venv", "venv", "target", "build", "dist",
    ".idea", ".vscode", ".cache",
}

MAX_INDEXED_FILES = 200000


# --------------------------------------------------------------------------
# Document structure
# --------------------------------------------------------------------------

class Document:
    """A parsed markdown document: fences, headings, prose."""

    def __init__(self, text):
        self.text = text
        self.lines = text.splitlines()
        self.fenced_blocks = []   # {"info", "start_line", "end_line", "lines", "closed"}
        self.prose_lines = []     # (line_no, line) outside every fence
        self.headings = []        # (line_no, level, raw_text)
        self._parse()

    def _parse(self):
        open_fence = None         # (char, length, indent, info, start_line, body)
        for idx, line in enumerate(self.lines, start=1):
            m = FENCE_RE.match(line)
            if open_fence is not None:
                char, length, _indent, info, start_line, body = open_fence
                # A closing fence uses the same character, is at least as long,
                # and carries no info string.
                if m and m.group("fence")[0] == char and len(m.group("fence")) >= length \
                        and not m.group("info"):
                    self.fenced_blocks.append({
                        "info": info,
                        "start_line": start_line,
                        "end_line": idx,
                        "lines": body,
                        "closed": True,
                    })
                    open_fence = None
                else:
                    body.append(line)
                continue

            if m and m.group("fence"):
                open_fence = (
                    m.group("fence")[0],
                    len(m.group("fence")),
                    m.group("indent"),
                    m.group("info"),
                    idx,
                    [],
                )
                continue

            self.prose_lines.append((idx, line))

        if open_fence is not None:
            char, length, _indent, info, start_line, body = open_fence
            self.fenced_blocks.append({
                "info": info,
                "start_line": start_line,
                "end_line": None,
                "lines": body,
                "closed": False,
            })

        # Headings, from prose lines only.
        prose_index = {ln: text for ln, text in self.prose_lines}
        prose_order = [ln for ln, _ in self.prose_lines]
        for pos, ln in enumerate(prose_order):
            line = prose_index[ln]
            m = ATX_HEADING_RE.match(line)
            if m:
                self.headings.append((ln, len(m.group(1)), m.group("text")))
                continue
            # Setext: a non-empty line followed immediately by === or ---.
            if pos + 1 < len(prose_order) and prose_order[pos + 1] == ln + 1:
                nxt = prose_index[ln + 1]
                if line.strip() and SETEXT_UNDERLINE_RE.match(nxt) and not line.startswith(">"):
                    level = 1 if nxt.strip().startswith("=") else 2
                    self.headings.append((ln, level, line.strip()))

    def inline_code_spans(self):
        """Every inline code span outside a fenced block, as (line_no, content)."""
        spans = []
        for ln, line in self.prose_lines:
            for m in INLINE_CODE_RE.finditer(line):
                spans.append((ln, m.group(2).strip()))
        return spans

    def prose_word_count(self):
        """The word count the task prompts define.

        Whitespace-separated tokens remaining after every fenced code block
        (mermaid diagrams included) is removed. A large embedded diagram must
        not buy a document its way into the word budget, and the definition is
        character-for-character the one the prompts hand the model, so a
        model that counts its own words the prompted way gets the same number.
        """
        return len(FENCED_BLOCK_RE.sub("", self.text).split())

    def total_word_count(self):
        return len(self.text.split())


def normalise_heading(text):
    """Lowercase, strip markdown emphasis/links/numbering, collapse whitespace."""
    t = text.strip()
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)     # [label](href) -> label
    t = re.sub(r"[*_~]", "", t)
    t = re.sub(r"^\s*\d+(\.\d+)*[.)]?\s+", "", t)      # "3." / "3.1)" prefixes
    t = re.sub(r"\s+", " ", t)
    t = t.strip().strip(":.-").strip().lower()
    return t


# --------------------------------------------------------------------------
# Checkout access
# --------------------------------------------------------------------------

class Checkout:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self._line_cache = {}
        self._basename_index = None

    def resolve(self, rel):
        """Return (abs_path, reason). reason is None when the file exists."""
        if not rel:
            return None, "empty path"
        if rel.startswith("/"):
            return None, "absolute path (citations must be relative to the checkout root)"
        norm = os.path.normpath(rel)
        if norm == ".." or norm.startswith(".." + os.sep):
            return None, "path escapes the checkout root"
        full = os.path.join(self.root, norm)
        if os.path.isdir(full):
            return None, "path is a directory, not a file"
        if not os.path.isfile(full):
            return None, "missing file"
        return full, None

    def line_count(self, full):
        if full in self._line_cache:
            return self._line_cache[full]
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            self._line_cache[full] = None
            return None
        if not data:
            n = 0
        else:
            n = data.count(b"\n")
            if not data.endswith(b"\n"):
                n += 1
        self._line_cache[full] = n
        return n

    def basename_index(self):
        """basename -> list of repo-relative paths, built once, on demand."""
        if self._basename_index is not None:
            return self._basename_index
        index = {}
        seen = 0
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                seen += 1
                if seen > MAX_INDEXED_FILES:
                    break
                rel = os.path.relpath(os.path.join(dirpath, name), self.root)
                index.setdefault(name, []).append(rel)
            if seen > MAX_INDEXED_FILES:
                break
        self._basename_index = index
        return index

    def suggest(self, rel):
        """Best-effort 'did you mean' for a missing path, or None."""
        base = os.path.basename(rel)
        if not base:
            return None
        hits = self.basename_index().get(base, [])
        if not hits:
            return None
        if len(hits) == 1:
            return hits[0]
        return "%s (and %d other locations)" % (hits[0], len(hits) - 1)

    def exists(self, rel):
        """True when `rel` names an existing regular file in the checkout."""
        full, reason = self.resolve(rel)
        return reason is None and full is not None

    def exists_any(self, rel):
        """True when `rel` names an existing file *or* directory."""
        if not rel or rel.startswith("/"):
            return False
        norm = os.path.normpath(rel)
        if norm == ".." or norm.startswith(".." + os.sep):
            return False
        return os.path.exists(os.path.join(self.root, norm))


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

def check_citations(doc, checkout):
    """Return (total, valid, invalid_records, long_ranges)."""
    valid = 0
    invalid = []
    long_ranges = []
    matched_spans = []

    for m in CITATION_RE.finditer(doc.text):
        path = m.group("path")
        if not looks_like_path(path, checkout):
            continue
        matched_spans.append((m.start(), m.end()))
        start = int(m.group("start"))
        end = int(m.group("end")) if m.group("end") else start
        line_no = doc.text.count("\n", 0, m.start()) + 1
        citation = m.group(0)

        full, reason = checkout.resolve(path)
        if reason is not None:
            record = {
                "citation": citation,
                "path": path,
                "start": start,
                "end": end,
                "doc_line": line_no,
                "reason": reason,
            }
            if reason == "missing file":
                hint = checkout.suggest(path)
                if hint:
                    record["reason"] = "missing file (a file of that name exists at %s)" % hint
            invalid.append(record)
            continue

        if start < 1 or end < start:
            invalid.append({
                "citation": citation,
                "path": path,
                "start": start,
                "end": end,
                "doc_line": line_no,
                "reason": "invalid line range (start must be >= 1 and <= end)",
            })
            continue

        n_lines = checkout.line_count(full)
        if n_lines is None:
            invalid.append({
                "citation": citation,
                "path": path,
                "start": start,
                "end": end,
                "doc_line": line_no,
                "reason": "file could not be read",
            })
            continue

        if end > n_lines:
            invalid.append({
                "citation": citation,
                "path": path,
                "start": start,
                "end": end,
                "doc_line": line_no,
                "reason": "line out of range (file has %d lines)" % n_lines,
            })
            continue

        valid += 1
        if end - start + 1 > MAX_CITATION_SPAN:
            long_ranges.append({
                "citation": citation,
                "doc_line": line_no,
                "span": end - start + 1,
            })

    # Malformed near-misses: a real-looking path plus a colon, but a line spec
    # the strict pattern rejected. Reported as unparseable citations.
    for m in CANDIDATE_RE.finditer(doc.text):
        if any(s <= m.start() and m.end() <= e for s, e in matched_spans):
            continue
        if not looks_like_path(m.group("path"), checkout):
            continue
        spec = m.group("spec").strip().strip("`").strip()
        if not spec:
            continue
        if not re.search(r"\d", spec):
            # No digits at all: not an attempted line reference, skip it.
            continue
        line_no = doc.text.count("\n", 0, m.start()) + 1
        invalid.append({
            "citation": m.group(0),
            "path": m.group("path"),
            "start": None,
            "end": None,
            "doc_line": line_no,
            "reason": "unparseable line spec %r (expected :LINE or :START-END)" % spec,
        })

    invalid.sort(key=lambda r: r["doc_line"])
    return valid + len(invalid), valid, invalid, long_ranges


def check_fabricated_paths(doc, checkout):
    """Path-looking tokens in inline code spans that do not exist. Warnings only."""
    seen = {}
    for ln, content in doc.inline_code_spans():
        token = content.strip()
        if not token or " " in token or len(token) < 3:
            continue
        if "://" in token or token.startswith("-") or token.startswith("$"):
            continue
        if any(ch in token for ch in "*?~<>|\"'"):
            continue
        if token.startswith("/"):
            continue
        m = CODE_PATH_RE.match(token)
        if not m:
            continue
        path = m.group("path")
        if "/" not in path:
            ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
            if ext not in SOURCE_EXTENSIONS:
                continue
        if path.endswith("/"):
            path = path[:-1]
        if checkout.exists_any(path):
            continue
        if path in seen:
            continue
        seen[path] = ln
    return [{"path": p, "doc_line": ln} for p, ln in sorted(seen.items(), key=lambda kv: kv[1])]


def check_sections(doc, required):
    normalised = [normalise_heading(h[2]) for h in doc.headings]
    missing = []
    for want in required:
        needle = normalise_heading(want)
        if not any(needle == h or needle in h for h in normalised):
            missing.append(want)
    return missing


def check_mermaid(doc):
    """Return (count, problems)."""
    problems = []
    count = 0
    for block in doc.fenced_blocks:
        info = (block["info"] or "").strip().lower()
        if not info.split(" ")[0] == "mermaid":
            continue
        count += 1
        if not block["closed"]:
            problems.append({
                "start_line": block["start_line"],
                "reason": "mermaid fence opened at line %d is never closed" % block["start_line"],
            })
            continue
        if not any(l.strip() for l in block["lines"]):
            problems.append({
                "start_line": block["start_line"],
                "reason": "mermaid block at line %d is empty" % block["start_line"],
            })
    return count, problems


def has_open_questions(doc):
    for _ln, _level, text in doc.headings:
        if "open question" in normalise_heading(text):
            return True
    return False


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def build_report(args):
    with open(args.doc, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    doc = Document(text)
    checkout = Checkout(args.checkout)

    total, valid, invalid, long_ranges = check_citations(doc, checkout)
    rate = round(100.0 * valid / total, 2) if total else 0.0

    missing_sections = check_sections(doc, args.require_section)
    words = doc.prose_word_count()
    mermaid_count, mermaid_problems = check_mermaid(doc)
    fabricated = check_fabricated_paths(doc, checkout)

    warnings = []
    for f in fabricated:
        warnings.append(
            "fabricated path: `%s` (doc line %d) does not exist in the checkout"
            % (f["path"], f["doc_line"])
        )
    for r in long_ranges:
        warnings.append(
            "loose citation range: %s (doc line %d) spans %d lines, more than the %d-line maximum"
            % (r["citation"], r["doc_line"], r["span"], MAX_CITATION_SPAN)
        )
    if not has_open_questions(doc):
        warnings.append('no "Open questions" section - admitted uncertainty is rewarded by this category')
    if total == 0:
        warnings.append("no citations found in the document")

    failures = []
    if invalid:
        failures.append("%d invalid citation(s)" % len(invalid))
    if missing_sections:
        failures.append("%d required section(s) missing: %s"
                        % (len(missing_sections), ", ".join(missing_sections)))
    if args.min_words is not None and words < args.min_words:
        failures.append("word count %d is below the minimum %d" % (words, args.min_words))
    if args.max_words is not None and words > args.max_words:
        failures.append("word count %d is above the maximum %d" % (words, args.max_words))
    for p in mermaid_problems:
        failures.append(p["reason"])
    if args.min_mermaid is not None and mermaid_count < args.min_mermaid:
        failures.append("%d mermaid block(s), fewer than the required %d"
                        % (mermaid_count, args.min_mermaid))

    report = {
        "doc": os.path.abspath(args.doc),
        "checkout": checkout.root,
        "citations": {
            "total": total,
            "valid": valid,
            "invalid": len(invalid),
            "rate": rate,
        },
        "invalid_citations": invalid,
        "sections": {
            "required": list(args.require_section),
            "missing": missing_sections,
        },
        "words": words,
        "words_total": doc.total_word_count(),
        "word_range": {"min": args.min_words, "max": args.max_words},
        "mermaid_blocks": mermaid_count,
        "mermaid_required": args.min_mermaid,
        "mermaid_problems": mermaid_problems,
        "loose_citation_ranges": long_ranges,
        "fabricated_paths": fabricated,
        "open_questions_section": has_open_questions(doc),
        "warnings": warnings,
        "failures": failures,
        "passed": not failures,
    }
    return report


def print_human(report):
    out = sys.stdout.write
    out("doc:      %s\n" % report["doc"])
    out("checkout: %s\n" % report["checkout"])
    out("\n")

    c = report["citations"]
    out("citations: %d total, %d valid, %d invalid, validity rate %.2f%%\n"
        % (c["total"], c["valid"], c["invalid"], c["rate"]))
    if report["invalid_citations"]:
        out("\ninvalid citations:\n")
        for rec in report["invalid_citations"]:
            out("  doc line %-5d %-40s %s\n"
                % (rec["doc_line"], rec["citation"], rec["reason"]))

    out("\nsections: %d required, %d missing\n"
        % (len(report["sections"]["required"]), len(report["sections"]["missing"])))
    for name in report["sections"]["missing"]:
        out("  missing: %s\n" % name)

    rng = report["word_range"]
    bounds = "%s..%s" % (
        rng["min"] if rng["min"] is not None else "-",
        rng["max"] if rng["max"] is not None else "-",
    )
    out("\nwords: %d outside fenced blocks (%d including them), allowed range %s\n"
        % (report["words"], report["words_total"], bounds))

    out("mermaid blocks: %d%s\n"
        % (report["mermaid_blocks"],
           "" if report["mermaid_required"] is None
           else " (minimum %d)" % report["mermaid_required"]))
    for p in report["mermaid_problems"]:
        out("  %s\n" % p["reason"])

    out('open questions section: %s\n' % ("yes" if report["open_questions_section"] else "no"))

    if report["warnings"]:
        out("\nwarnings (%d):\n" % len(report["warnings"]))
        for w in report["warnings"]:
            out("  %s\n" % w)

    out("\n")
    if report["passed"]:
        out("PASS\n")
    else:
        out("FAIL\n")
        for f in report["failures"]:
            out("  %s\n" % f)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="check_docs.py",
        description="Mechanical checks for docs-generation output: citation validity, "
                    "structure, word budget, mermaid blocks. See CONVENTIONS.md.",
    )
    parser.add_argument("--doc", required=True, help="path to the generated markdown document")
    parser.add_argument("--checkout", required=True,
                        help="path to the target checkout the document describes")
    parser.add_argument("--min-words", type=int, default=None,
                        help="minimum word count (whitespace-separated tokens outside "
                             "fenced code blocks)")
    parser.add_argument("--max-words", type=int, default=None,
                        help="maximum word count, same definition as --min-words")
    parser.add_argument("--require-section", action="append", default=[], metavar="NAME",
                        help="heading that must be present; repeatable, case-insensitive, "
                             "matched at any heading level")
    parser.add_argument("--min-mermaid", type=int, default=None, metavar="N",
                        help="minimum number of well-formed mermaid blocks")
    parser.add_argument("--json", action="store_true",
                        help="print one machine-readable JSON object instead of a report")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.doc):
        sys.stderr.write("check_docs.py: no such document: %s\n" % args.doc)
        return 2
    if not os.path.isdir(args.checkout):
        sys.stderr.write("check_docs.py: no such checkout directory: %s\n" % args.checkout)
        return 2
    if args.min_words is not None and args.max_words is not None \
            and args.min_words > args.max_words:
        sys.stderr.write("check_docs.py: --min-words must not exceed --max-words\n")
        return 2

    report = build_report(args)

    if args.json:
        sys.stdout.write(json.dumps(report, indent=2, sort_keys=False) + "\n")
    else:
        print_human(report)

    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
