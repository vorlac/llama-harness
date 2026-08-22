#!/usr/bin/env bash
#
# fetch_docs_targets.sh - clone the docs-generation target codebases at their
# pinned commits.
#
# Target source is never vendored into this repository. This script reads
# docs-generation/targets/targets.json and materialises each entry under
# docs-generation/targets/checkouts/<slug>/ at the exact pinned sha, so every
# run of a docs-generation task reads byte-identical source. See
# CONVENTIONS.md section 10 (task material is read-only) and
# docs-generation/README.md.
#
# Usage:
#   tools/fetch_docs_targets.sh                 fetch every target
#   tools/fetch_docs_targets.sh --only <slug>   fetch one target
#   tools/fetch_docs_targets.sh --list          print the target table and exit
#   tools/fetch_docs_targets.sh --verify        check existing checkouts, fetch nothing
#   tools/fetch_docs_targets.sh --force         re-create checkouts that are wrong or dirty
#
# Requirements: bash, git, python3. No jq. Portable to macOS (bash 3.2) and Linux.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TARGETS_JSON="$REPO_ROOT/docs-generation/targets/targets.json"
CHECKOUT_ROOT="$REPO_ROOT/docs-generation/targets/checkouts"

# Never let git stop to ask for credentials in a batch run.
export GIT_TERMINAL_PROMPT=0

ONLY=""
MODE="fetch"
FORCE=0

usage() {
  # Print the leading comment block (everything after the shebang up to the
  # first non-comment line), with the leading "# " stripped.
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

die() {
  printf 'fetch_docs_targets: %s\n' "$*" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      [ $# -ge 2 ] || die "--only requires a slug"
      ONLY="$2"
      shift 2
      ;;
    --only=*)
      ONLY="${1#--only=}"
      shift
      ;;
    --list)
      MODE="list"
      shift
      ;;
    --verify)
      MODE="verify"
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (try --help)"
      ;;
  esac
done

command -v git >/dev/null 2>&1 || die "git not found on PATH"
command -v python3 >/dev/null 2>&1 || die "python3 not found on PATH"
[ -f "$TARGETS_JSON" ] || die "manifest not found: $TARGETS_JSON"

# ---------------------------------------------------------------------------
# Manifest reading. python3 emits one tab-separated record per target:
#   slug \t url \t ref \t sha \t language \t license \t approx_loc \t why
# ---------------------------------------------------------------------------
read_targets() {
  python3 - "$TARGETS_JSON" "$ONLY" <<'PY'
import json
import re
import sys

path, only = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
except (OSError, ValueError) as exc:
    sys.stderr.write("fetch_docs_targets: cannot read manifest: %s\n" % exc)
    raise SystemExit(2)

targets = doc.get("targets")
if not isinstance(targets, list) or not targets:
    sys.stderr.write("fetch_docs_targets: manifest has no 'targets' array\n")
    raise SystemExit(2)

sha_re = re.compile(r"^[0-9a-f]{40}$")
rows, seen = [], set()
for entry in targets:
    missing = [k for k in ("slug", "url", "ref", "sha", "language", "license")
               if not entry.get(k)]
    if missing:
        sys.stderr.write("fetch_docs_targets: target %r missing keys: %s\n"
                         % (entry.get("slug", "<unnamed>"), ", ".join(missing)))
        raise SystemExit(2)
    slug = entry["slug"]
    if slug in seen:
        sys.stderr.write("fetch_docs_targets: duplicate slug %r\n" % slug)
        raise SystemExit(2)
    seen.add(slug)
    if not sha_re.match(entry["sha"]):
        sys.stderr.write("fetch_docs_targets: target %r has a sha that is not "
                         "40 lowercase hex characters: %r\n" % (slug, entry["sha"]))
        raise SystemExit(2)
    if only and slug != only:
        continue
    rows.append("\t".join([
        slug,
        entry["url"],
        entry["ref"],
        entry["sha"],
        entry["language"],
        entry["license"],
        str(entry.get("approx_loc", 0)),
        " ".join(str(entry.get("why", "")).split()),
    ]))

if only and not rows:
    sys.stderr.write("fetch_docs_targets: no target with slug %r. Known slugs: %s\n"
                     % (only, ", ".join(sorted(seen))))
    raise SystemExit(2)

sys.stdout.write("\n".join(rows) + "\n")
PY
}

# Read the manifest once, up front, into a temp file. Doing this inside the
# read loops would hide a manifest error behind a command substitution and the
# script would exit 0 with nothing done.
TARGETS_TSV="$(mktemp "${TMPDIR:-/tmp}/fetch_docs_targets.XXXXXX")"
cleanup() { rm -f "$TARGETS_TSV"; }
trap cleanup EXIT
read_targets > "$TARGETS_TSV"

# Current HEAD sha of a checkout, or the empty string if it is not a git repo.
head_sha() {
  git -C "$1" rev-parse HEAD 2>/dev/null || true
}

status_of() {
  # $1 slug, $2 sha -> one word: absent | ok | mismatch | broken
  local dir="$CHECKOUT_ROOT/$1"
  local have
  if [ ! -d "$dir" ]; then
    printf 'absent'
    return 0
  fi
  if [ ! -d "$dir/.git" ]; then
    printf 'broken'
    return 0
  fi
  have="$(head_sha "$dir")"
  if [ -z "$have" ]; then
    printf 'broken'
  elif [ "$have" = "$2" ]; then
    printf 'ok'
  else
    printf 'mismatch'
  fi
}

# ---------------------------------------------------------------------------
# --list
# ---------------------------------------------------------------------------
cmd_list() {
  printf '%-10s %-8s %-16s %10s %-10s %-9s %s\n' \
    SLUG LANGUAGE LICENSE APPROX_LOC REF SHA LOCAL
  printf '%-10s %-8s %-16s %10s %-10s %-9s %s\n' \
    "----------" "--------" "----------------" "----------" "----------" "---------" "-----"
  local slug url ref sha language license loc why st
  while IFS="$(printf '\t')" read -r slug url ref sha language license loc why; do
    [ -n "$slug" ] || continue
    st="$(status_of "$slug" "$sha")"
    printf '%-10s %-8s %-16s %10s %-10s %-9s %s\n' \
      "$slug" "$language" "$license" "$loc" "$ref" "$(printf '%.9s' "$sha")" "$st"
  done < "$TARGETS_TSV"
  printf '\ncheckout root: %s\nmanifest:      %s\n' "$CHECKOUT_ROOT" "$TARGETS_JSON"
}

# ---------------------------------------------------------------------------
# --verify
# ---------------------------------------------------------------------------
cmd_verify() {
  local rc=0
  local slug url ref sha language license loc why st have
  while IFS="$(printf '\t')" read -r slug url ref sha language license loc why; do
    [ -n "$slug" ] || continue
    st="$(status_of "$slug" "$sha")"
    case "$st" in
      ok)
        printf '[%-8s] ok           at %s\n' "$slug" "$sha"
        ;;
      absent)
        printf '[%-8s] MISSING      no checkout at %s\n' "$slug" "$CHECKOUT_ROOT/$slug"
        rc=1
        ;;
      broken)
        printf '[%-8s] BROKEN       %s exists but is not a usable git checkout\n' \
          "$slug" "$CHECKOUT_ROOT/$slug"
        rc=1
        ;;
      mismatch)
        have="$(head_sha "$CHECKOUT_ROOT/$slug")"
        printf '[%-8s] MISMATCH     want %s, have %s\n' "$slug" "$sha" "$have"
        rc=1
        ;;
    esac
  done < "$TARGETS_TSV"
  if [ "$rc" -ne 0 ]; then
    printf '\nverify failed. Re-run tools/fetch_docs_targets.sh (add --force to replace a bad checkout).\n' >&2
  else
    printf '\nall checkouts are at their pinned shas.\n'
  fi
  return "$rc"
}

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

# Fetch the pinned sha into an already-initialised repo at $1.
#   $1 dir, $2 url, $3 ref, $4 sha, $5 slug
# Strategy: shallow fetch of the raw sha (needs uploadpack.allowReachableSHA1InWant
# or similar on the server). Some servers refuse that; fall back to a shallow
# fetch of the branch and deepen until the pinned commit is present.
fetch_pinned() {
  local dir="$1" url="$2" ref="$3" sha="$4" slug="$5"
  local depth

  if git -C "$dir" fetch --depth 1 --quiet origin "$sha" 2>/dev/null; then
    git -C "$dir" checkout --quiet --detach FETCH_HEAD
    return 0
  fi

  printf '[%-8s] note         server refused a shallow fetch of the raw sha; falling back to a shallow fetch of %s plus deepening\n' \
    "$slug" "$ref"

  git -C "$dir" fetch --depth 1 --quiet origin "+refs/heads/$ref:refs/remotes/origin/$ref" \
    || die "$slug: could not fetch branch '$ref' from $url"

  depth=1
  while ! git -C "$dir" cat-file -e "${sha}^{commit}" 2>/dev/null; do
    if [ "$depth" -ge 8192 ]; then
      printf '[%-8s] note         deepened to %s commits without finding the pinned sha; fetching full history\n' \
        "$slug" "$depth"
      git -C "$dir" fetch --unshallow --quiet origin "+refs/heads/$ref:refs/remotes/origin/$ref" \
        || die "$slug: could not unshallow $url"
      if git -C "$dir" cat-file -e "${sha}^{commit}" 2>/dev/null; then
        break
      fi
      die "$slug: pinned sha $sha is not reachable from refs/heads/$ref in $url (was it force-pushed or garbage collected?)"
    fi
    depth=$((depth * 8))
    printf '[%-8s] note         deepening to %s commits\n' "$slug" "$depth"
    git -C "$dir" fetch --depth "$depth" --quiet origin "+refs/heads/$ref:refs/remotes/origin/$ref" \
      || die "$slug: deepening fetch to depth $depth failed for $url"
  done

  git -C "$dir" checkout --quiet --detach "$sha"
}

fetch_one() {
  local slug="$1" url="$2" ref="$3" sha="$4"
  local dir="$CHECKOUT_ROOT/$slug"
  local st have

  st="$(status_of "$slug" "$sha")"
  case "$st" in
    ok)
      printf '[%-8s] up-to-date   already at %s, skipped\n' "$slug" "$sha"
      return 0
      ;;
    broken)
      if [ "$FORCE" -eq 1 ]; then
        printf '[%-8s] replacing    %s is not a usable git checkout, removing it (--force)\n' "$slug" "$dir"
        rm -rf "$dir"
      else
        printf '[%-8s] ERROR        %s exists but is not a usable git checkout; re-run with --force to replace it\n' \
          "$slug" "$dir" >&2
        return 1
      fi
      ;;
    mismatch)
      have="$(head_sha "$dir")"
      if [ "$FORCE" -eq 1 ]; then
        printf '[%-8s] replacing    at %s, want %s, removing it (--force)\n' "$slug" "$have" "$sha"
        rm -rf "$dir"
      else
        printf '[%-8s] re-fetching  at %s, want %s\n' "$slug" "$have" "$sha"
        if fetch_pinned "$dir" "$url" "$ref" "$sha" "$slug"; then
          printf '[%-8s] fetched      now at %s (%s)\n' "$slug" "$sha" "$dir"
          return 0
        fi
        return 1
      fi
      ;;
  esac

  mkdir -p "$dir"
  git -C "$dir" init --quiet
  git -C "$dir" config advice.detachedHead false
  git -C "$dir" remote add origin "$url"
  printf '[%-8s] fetching     %s at %s\n' "$slug" "$url" "$sha"
  if ! fetch_pinned "$dir" "$url" "$ref" "$sha" "$slug"; then
    return 1
  fi

  have="$(head_sha "$dir")"
  if [ "$have" != "$sha" ]; then
    printf '[%-8s] ERROR        checkout landed on %s, expected %s\n' "$slug" "$have" "$sha" >&2
    return 1
  fi
  printf '[%-8s] fetched      %s -> %s\n' "$slug" "$sha" "$dir"
}

cmd_fetch() {
  local rc=0 count=0 failed=0
  local slug url ref sha language license loc why
  mkdir -p "$CHECKOUT_ROOT"
  while IFS="$(printf '\t')" read -r slug url ref sha language license loc why; do
    [ -n "$slug" ] || continue
    count=$((count + 1))
    if ! fetch_one "$slug" "$url" "$ref" "$sha"; then
      failed=$((failed + 1))
      rc=1
    fi
  done < "$TARGETS_TSV"
  printf '\n%s target(s) processed, %s failed. Checkouts live under %s and are git-ignored.\n' \
    "$count" "$failed" "$CHECKOUT_ROOT"
  return "$rc"
}

case "$MODE" in
  list)   cmd_list ;;
  verify) cmd_verify ;;
  fetch)  cmd_fetch ;;
esac
