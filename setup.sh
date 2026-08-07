#!/usr/bin/env bash
#
# Interactive setup for llama-harness.
#
#   ./setup.sh                       guided install
#   ./setup.sh --yes                 accept every step (unattended)
#   ./setup.sh --models a,b,c        preselect models, still confirms
#   ./setup.sh --no-benchmark        skip the optional benchmark
#   ./setup.sh --dry-run             show the plan, change nothing
#
# Can also be run before the repo exists - it will offer to clone it:
#   curl -fsSL https://raw.githubusercontent.com/vorlac/llama-harness/main/setup.sh | bash
#
# Deliberately bash-only. Everything it starts runs in bash regardless of your
# login shell, so behaviour is identical from fish, zsh or bash.
set -uo pipefail

REPO_URL_SSH="git@github.com:vorlac/llama-harness.git"
REPO_URL_HTTPS="https://github.com/vorlac/llama-harness.git"
REPO_NAME="llama-harness"

ASSUME_YES=0
DRY_RUN=0
RUN_BENCHMARK=""
PRESELECTED_MODELS=""

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""
  C_BLUE=""; C_CYAN=""
fi

# Current terminal width, re-read each call so a resize takes effect on the
# next line rather than the next run.
term_cols() {
  local cols
  cols="${COLUMNS:-}"
  [[ -z "$cols" ]] && cols="$(tput cols 2>/dev/null || echo 100)"
  [[ "$cols" =~ ^[0-9]+$ ]] || cols=100
  (( cols < 40 )) && cols=40
  printf '%s' "$cols"
}

# Strip ANSI colour using only parameter expansion - no subprocess, and works
# on the bash 3.2 that macOS ships. (BSD sed cannot match the escape byte
# portably, which is why this is hand-rolled.)
strip_ansi() {
  local in="$1" out="" rest
  while [[ "$in" == *$'\033['* ]]; do
    out+="${in%%$'\033['*}"
    rest="${in#*$'\033['}"
    rest="${rest#*m}"
    in="$rest"
  done
  printf '%s' "$out$in"
}

# Truncate to the terminal width with an ellipsis, measuring visible width only.
# Colour is preserved when the line fits and dropped when it is cut, so a
# truncated line can never leave styling bleeding into the rest of the terminal.
fit() {
  local text="$1" cols plain
  cols="$(term_cols)"
  plain="$(strip_ansi "$text")"
  if (( ${#plain} <= cols )); then
    printf '%s' "$text"
  else
    printf '%s…' "${plain:0:cols-1}"
  fi
}

# Wrap a sub-item to the terminal width, indenting continuation lines to `hang`
# columns so a long item still reads as one item instead of a ragged block that
# restarts at column zero. Colour is discounted from the measured width.
#
# Only prose goes through here. Tabular lines (`ok`, the model chooser) keep
# truncating, because reflowing them would collapse the very column alignment
# that makes them scannable.
wrap_item() {
  local hang="$1" text="$2" cols plain pad indent line word plain_word
  cols="$(term_cols)"
  plain="$(strip_ansi "$text")"

  # Fits already: emit untouched, preserving colour and internal spacing.
  if (( ${#plain} <= cols )); then
    printf '%s\n' "$text"
    return
  fi

  printf -v pad '%*s' "$hang" ''
  indent="${text%%[! ]*}"

  # Word splitting below is unquoted on purpose; disable globbing first so a
  # message containing * or ? cannot expand against the working directory.
  local reset_glob=0
  [[ $- == *f* ]] || { set -f; reset_glob=1; }

  local length=0 started=0
  line=""
  for word in $text; do
    if [[ "$word" == *$'\033'* ]]; then
      plain_word="$(strip_ansi "$word")"
    else
      plain_word="$word"
    fi

    if (( started == 0 )); then
      line="$indent$word"
      length=$(( ${#indent} + ${#plain_word} ))
      started=1
    elif (( length + 1 + ${#plain_word} > cols )); then
      printf '%s\n' "$line"
      line="$pad$word"
      length=$(( hang + ${#plain_word} ))
    else
      line="$line $word"
      length=$(( length + 1 + ${#plain_word} ))
    fi
  done

  (( reset_glob )) && set +f
  [[ -n "$line" ]] && printf '%s\n' "$line"
  return 0
}

msg()  { printf '%s::%s %s%s%s\n' "$C_BLUE$C_BOLD" "$C_RESET$C_BOLD" "$*" "" "$C_RESET"; }
info() { wrap_item 2 "  $*"; }
warn() { wrap_item 9 "${C_YELLOW}warning:${C_RESET} $*" >&2; }
err()  { printf '%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

# A "label: value" sub-item whose continuation lines should line up under the
# value. `col` is the visible column the value starts at, indent included.
info_at() { local col="$1"; shift; wrap_item "$col" "  $*"; }

# Braces are required: bash would otherwise parse `$C_GREEN✓` as the variable
# name "C_GREEN<utf8 bytes>" and, under `set -u`, error on every call.
ok()   { printf '%s\n' "$(fit "  ${C_GREEN}✓${C_RESET} $*")"; }
die()  { err "$*"; exit 1; }

# Is a terminal actually available to prompt on? Checked once: without this,
# a piped or CI run silently takes the default for every question.
if { exec 3</dev/tty; } 2>/dev/null; then
  exec 3<&-
  HAVE_TTY=1
else
  HAVE_TTY=0
fi

# Read a line from the terminal, falling back to stdin, then to a default.
ask() {
  local prompt_text="$1" default="${2:-}" reply=""
  if [[ $HAVE_TTY -eq 1 ]]; then
    read -r -p "$prompt_text" reply </dev/tty || reply=""
  elif [[ ! -t 0 ]]; then
    # No terminal at all - do not block, use the default.
    printf '%s%s\n' "$prompt_text" "${default:-}"
    printf '%s' "$default"; return 0
  else
    read -r -p "$prompt_text" reply || reply=""
  fi
  printf '%s' "${reply:-$default}"
}

# Ask a yes/no question, honouring --yes.
confirm() {
  local question="$1" default="${2:-Y}"
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  local hint="[Y/n]"; [[ "$default" == "N" ]] && hint="[y/N]"
  local reply
  reply="$(ask "$(printf '%s::%s %s %s ' "$C_BLUE$C_BOLD" "$C_RESET$C_BOLD" "$question$C_RESET" "$hint")" "$default")"
  [[ "$reply" =~ ^[Yy] ]]
}

# Per-item approval, pacman style: yes / no / all / quit.
APPROVE_ALL=0
approve_item() {
  local what="$1"
  if [[ $ASSUME_YES -eq 1 || $APPROVE_ALL -eq 1 ]]; then return 0; fi
  local reply
  reply="$(ask "$(printf '  %s::%s install %s? [Y/n/a=all/q=quit] ' \
    "$C_BLUE" "$C_RESET" "$C_CYAN$what$C_RESET")" "y")"
  case "${reply:-y}" in
    [Aa]*) APPROVE_ALL=1; return 0 ;;
    [Qq]*) die "aborted by user" ;;
    [Nn]*) return 1 ;;
    *)     return 0 ;;
  esac
}

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  %s[dry-run]%s %s\n' "$C_DIM" "$C_RESET" "$*"
    return 0
  fi
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)        ASSUME_YES=1 ;;
    --dry-run)       DRY_RUN=1 ;;
    --models)        PRESELECTED_MODELS="${2:-}"; shift ;;
    --models=*)      PRESELECTED_MODELS="${1#*=}" ;;
    --benchmark)     RUN_BENCHMARK=1 ;;
    --no-benchmark)  RUN_BENCHMARK=0 ;;
    -h|--help)       sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

find_repo_root() {
  local dir="${BASH_SOURCE[0]}"
  dir="$(cd "$(dirname "$dir")" 2>/dev/null && pwd)" || return 1
  # Walk up looking for the marker files this repo is known by.
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/scripts/fetch_models.py" && -f "$dir/CMakeLists.txt" ]]; then
      printf '%s' "$dir"; return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

REPO_ROOT="$(find_repo_root || true)"

if [[ -z "$REPO_ROOT" ]]; then
  msg "llama-harness is not checked out here"
  command -v git >/dev/null 2>&1 || die "git is required to clone the repository"
  target="$PWD/$REPO_NAME"
  info "clone target: $target"
  if [[ -e "$target" ]]; then
    die "$target already exists - cd into it and re-run ./setup.sh"
  fi
  confirm "Clone $REPO_URL_HTTPS into $target?" || die "nothing to do"
  # SSH first (matches the maintainer's remote), fall back to HTTPS.
  if ! run git clone --recurse-submodules "$REPO_URL_SSH" "$target" 2>/dev/null; then
    info "ssh clone failed, falling back to https"
    run git clone --recurse-submodules "$REPO_URL_HTTPS" "$target" \
      || die "clone failed"
  fi
  REPO_ROOT="$target"
  ok "cloned into $REPO_ROOT"
fi

cd "$REPO_ROOT" || die "cannot cd into $REPO_ROOT"
printf '%s%s%s\n' "$C_BOLD" "llama-harness setup" "$C_RESET"
info "repository: $REPO_ROOT"
printf '\n'

OS="$(uname -s)"
PKG_MGR=""
case "$OS" in
  Darwin) command -v brew >/dev/null 2>&1 && PKG_MGR="brew" ;;
  Linux)
    for candidate in apt-get dnf pacman zypper; do
      command -v "$candidate" >/dev/null 2>&1 && { PKG_MGR="$candidate"; break; }
    done ;;
esac

# name|command|why|optional
DEPS=(
  "git|git|clone the repo and track the llama.cpp submodule|0"
  "cmake|cmake|build llama.cpp|0"
  "ninja|ninja|build llama.cpp|0"
  "python3|python3|run the harness scripts|0"
  "curl|curl|download models|0"
  "opencode|opencode|the coding agent this harness serves models to|1"
  "rich|__python_rich|nicer benchmark tables and live progress|1"
)

pkg_name_for() {
  # Translate a generic name into this package manager's name.
  local dep="$1"
  case "$PKG_MGR:$dep" in
    apt-get:python3) echo "python3" ;;
    apt-get:ninja)   echo "ninja-build" ;;
    dnf:ninja)       echo "ninja-build" ;;
    *)               echo "$dep" ;;
  esac
}

install_pkg() {
  local dep="$1" pkg
  pkg="$(pkg_name_for "$dep")"
  if [[ "$dep" == "opencode" ]]; then
    install_opencode; return $?
  fi
  if [[ "$dep" == "rich" ]]; then
    # --user keeps it out of the system site-packages macOS manages.
    run python3 -m pip install --user --quiet rich; return $?
  fi
  case "$PKG_MGR" in
    brew)    run brew install "$pkg" ;;
    apt-get) run sudo apt-get install -y "$pkg" ;;
    dnf)     run sudo dnf install -y "$pkg" ;;
    pacman)  run sudo pacman -S --needed --noconfirm "$pkg" ;;
    zypper)  run sudo zypper install -y "$pkg" ;;
    *)       warn "no package manager detected - install '$dep' manually"; return 1 ;;
  esac
}

install_opencode() {
  # opencode ships through several channels; prefer the platform package.
  if [[ "$PKG_MGR" == "brew" ]]; then
    run brew install opencode && return 0
  fi
  if command -v npm >/dev/null 2>&1; then
    run npm install -g opencode-ai && return 0
  fi
  run bash -c 'curl -fsSL https://opencode.ai/install | bash'
}

msg "Checking dependencies"
MISSING=()
# A python module rather than a binary: probe it by import.
have_dep() {
  local cmd="$1"
  if [[ "$cmd" == __python_* ]]; then
    python3 -c "import ${cmd#__python_}" >/dev/null 2>&1
  else
    command -v "$cmd" >/dev/null 2>&1
  fi
}

for entry in "${DEPS[@]}"; do
  IFS='|' read -r name cmd why optional <<< "$entry"
  if have_dep "$cmd"; then
    if [[ "$cmd" == __python_* ]]; then
      ok "$(printf '%-10s %s' "$name" "${C_DIM}python module${C_RESET}")"
    else
      ok "$(printf '%-10s %s' "$name" "$C_DIM$(command -v "$cmd")$C_RESET")"
    fi
  else
    MISSING+=("$entry")
  fi
done
printf '\n'

if [[ ${#MISSING[@]} -gt 0 ]]; then
  # pacman-style transaction summary, then per-item approval.
  printf '%sPackages (%d)%s\n\n' "$C_BOLD" "${#MISSING[@]}" "$C_RESET"
  printf '  %-12s %-10s %s\n' "NAME" "REQUIRED" "REASON"
  for entry in "${MISSING[@]}"; do
    IFS='|' read -r name cmd why optional <<< "$entry"
    local_req="yes"; [[ "$optional" == "1" ]] && local_req="optional"
    printf '  %-12s %-10s %s\n' "$name" "$local_req" "$why"
  done
  printf '\n'
  if [[ -z "$PKG_MGR" ]]; then
    warn "no supported package manager found; install the above manually"
  else
    info "package manager: $PKG_MGR"
  fi
  printf '\n'

  if confirm "Proceed with installation?"; then
    for entry in "${MISSING[@]}"; do
      IFS='|' read -r name cmd why optional <<< "$entry"
      if approve_item "$name"; then
        if install_pkg "$name"; then
          ok "installed $name"
        else
          if [[ "$optional" == "1" ]]; then
            warn "could not install $name - continuing without it"
          else
            die "failed to install required dependency: $name"
          fi
        fi
      else
        [[ "$optional" == "1" ]] || warn "$name is required; later steps may fail"
      fi
    done
  else
    warn "skipping dependency installation"
  fi
  printf '\n'
fi

command -v python3 >/dev/null 2>&1 || die "python3 is required to continue"

if [[ ! -f extern/llama-cpp/CMakeLists.txt ]]; then
  msg "Fetching the llama.cpp submodule"
  if confirm "Initialize git submodules? (a few hundred MB)"; then
    run git submodule update --init --recursive extern/llama-cpp \
      || die "submodule init failed"
    ok "submodule ready"
  else
    die "llama.cpp is required"
  fi
  printf '\n'
fi

msg "Building llama.cpp tools"
info "compiles llama-server, llama-bench, llama-perplexity and friends"
info "into .data/tools/, pinned to the current submodule commit"
if confirm "Build now?"; then
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[dry-run] python3 scripts/fetch_models.py build"
  else
    python3 scripts/fetch_models.py build || die "build failed"
  fi
else
  warn "skipped - serving and benchmarking will not work until you run:"
  info "  python3 scripts/fetch_models.py build"
fi
printf '\n'

msg "Choosing models"

CATALOG_JSON="$(python3 scripts/fetch_models.py list --json 2>/dev/null)" \
  || die "could not read the model catalog"

# Render a numbered menu grouped by category, annotated with fit and size.
python3 - "$CATALOG_JSON" <<'PYEOF'
import json, os, shutil, sys
COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
COLS = int(os.environ.get("COLUMNS") or shutil.get_terminal_size((100, 24)).columns)
COLS = max(40, COLS)
TITLE_W = max(12, COLS - 62)  # id + size + fit + flags consume the rest
_ANSI = __import__("re").compile(r"\033\[[0-9;]*m")

def out(line=""):
    """Print, truncated to the window. TITLE_W shrinks the elastic column, but
    the fixed columns alone can still exceed a very narrow terminal, so every
    composed line gets a final ANSI-aware trim."""
    line = line.rstrip()  # rows whose trailing column is empty must not pad
    if len(_ANSI.sub("", line)) <= COLS:
        print(line); return
    budget, kept, seen, i, styled = COLS - 1, [], 0, 0, False
    while i < len(line) and seen < budget:
        m = _ANSI.match(line, i)
        if m:
            kept.append(m.group(0)); styled = True; i = m.end(); continue
        kept.append(line[i]); seen += 1; i += 1
    print("".join(kept) + "\u2026" + ("\033[0m" if styled else ""))
def c(code, text):
    return "\033[%sm%s\033[0m" % (code, text) if COLOR else text
data = json.loads(sys.argv[1])
b = data["budget"]
out("  This machine: %.0f GB usable for weights (%s)"
      % (b["vram_budget_gb"], b["source"]))
out("  %.0f GB is comfortable once KV cache is accounted for."
      % b["comfortable_gb"])
out()
n = 0
for cat in data["categories"]:
    models = [m for m in data["models"] if m["category"] == cat["id"]]
    if not models:
        continue
    out("  " + c("1", cat["description"]))
    for m in models:
        n += 1
        # Pad by the visible word and colour afterwards: "%-8s" applied to an
        # already-escaped string pads to the escape bytes, which is why the fit
        # column used to collapse and shove the flags against it.
        fit_word, fit_code = {"ok": ("fits", "32"), "tight": ("tight", "33"),
                              "no": ("too big", "31")}[m["fit"]]
        fit = c(fit_code, fit_word) + " " * (8 - len(fit_word))
        flags = []
        if m["installed"]:
            flags.append(c("32", "installed"))
        if m["experimental"]:
            flags.append(c("33", "experimental"))
        title = m["title"]
        if len(title) > TITLE_W:
            title = title[:TITLE_W - 1] + "\u2026"
        out("   %2d) %s %s %6.1f GB  %s %s"
              % (n, c("36", "%-21s" % m["id"]), "%-*s" % (TITLE_W, title),
                 m["size_gb"], fit, " ".join(flags)))
    print()
PYEOF

info "Enter numbers or ids separated by spaces or commas."
# One item, wrapped under the value: hand-splitting it across three info calls
# left every continuation back at the item indent, so the shortcuts read as
# three separate instructions rather than one list.
info_at 13 "Shortcuts: ${C_CYAN}recommended${C_RESET} (a small starter set), a category name such as ${C_CYAN}coding${C_RESET} / ${C_CYAN}writing${C_RESET} for all of it, or ${C_CYAN}none${C_RESET} to skip."
printf '\n'

SELECTION="$PRESELECTED_MODELS"
if [[ -z "$SELECTION" ]]; then
  if [[ $ASSUME_YES -eq 1 ]]; then
    SELECTION="recommended"
  else
    SELECTION="$(ask "$(printf '%s::%s Models to install: ' "$C_BLUE$C_BOLD" "$C_RESET")" "")"
  fi
fi

MODEL_IDS=""
if [[ -n "$SELECTION" && "$SELECTION" != "none" ]]; then
  MODEL_IDS="$(python3 - "$CATALOG_JSON" "$SELECTION" <<'PYEOF'
import json, sys
data = json.loads(sys.argv[1])
models = data["models"]
raw = sys.argv[2].replace(",", " ").split()
ids, seen = [], set()

def add(mid):
    if mid not in seen:
        seen.add(mid); ids.append(mid)

RECOMMENDED = ("ornith-35b", "qwen3-coder-30b")
for token in raw:
    if token == "recommended":
        # A deliberately small, high-value starter set rather than everything.
        for mid in RECOMMENDED:
            if any(m["id"] == mid for m in models):
                add(mid)
        continue
    if True:
        if token.isdigit():
            index = int(token) - 1
            if 0 <= index < len(models):
                add(models[index]["id"])
            else:
                print("!! no model numbered %s" % token, file=sys.stderr)
        elif any(m["id"] == token for m in models):
            add(token)
        elif any(c["id"] == token for c in data["categories"]):
            # A category name takes the whole category, minus experimental ones.
            for m in models:
                if m["category"] == token and not m["experimental"]:
                    add(m["id"])
        else:
            print("!! unknown model %r" % token, file=sys.stderr)
print(" ".join(ids))
PYEOF
)"
fi

if [[ -z "$MODEL_IDS" ]]; then
  warn "no models selected - skipping download"
else
  # Transaction summary before spending bandwidth.
  msg "Selected models ($(printf '%s\n' $MODEL_IDS | wc -l | tr -d ' '))"
  python3 - "$CATALOG_JSON" "$MODEL_IDS" <<'PYEOF'
import json, sys
data = json.loads(sys.argv[1])
want = [i for i in sys.argv[2].split() if i in {m["id"] for m in data["models"]}]
by_id = {m["id"]: m for m in data["models"]}
rows = [by_id[i] for i in want]
total = sum(m["size_gb"] for m in rows)

# Same vocabulary as the chooser above, and columns sized to the rows actually
# being shown - a fixed width both wastes space and breaks on a long id.
FIT = {"ok": "fits", "tight": "tight", "no": "too big"}
name_w = max([len("NAME")] + [len(m["id"]) for m in rows])
quant_w = max([len("QUANT")] + [len(m["quant"]) for m in rows])

print("  %s  %s  %8s  %s" % ("NAME".ljust(name_w), "QUANT".ljust(quant_w), "SIZE", "FIT"))
for m in rows:
    print("  %s  %s  %5.1f GB  %s"
          % (m["id"].ljust(name_w), m["quant"].ljust(quant_w), m["size_gb"],
             FIT.get(m["fit"], m["fit"])))
print("  %s  %s  %5.1f GB total download" % (" " * name_w, " " * quant_w, total))
PYEOF
  printf '\n'
  if confirm "Download and validate these models?"; then
    for mid in $MODEL_IDS; do
      if approve_item "$mid"; then
        if [[ $DRY_RUN -eq 1 ]]; then
          info "[dry-run] fetch_models.py install $mid"
        else
          python3 scripts/fetch_models.py install "$mid" -y --no-config \
            || warn "install failed for $mid"
        fi
      fi
    done
  else
    warn "skipped model download"
  fi
fi
printf '\n'

msg "Generating configuration"
info "writes .data/configs/{opencode.json,llama-models.ini,benchmark.json}"
if [[ $DRY_RUN -eq 1 ]]; then
  info "[dry-run] fetch_models.py config"
else
  python3 scripts/fetch_models.py config >/dev/null || warn "config generation failed"
  ok "configuration written"
fi
printf '\n'


if [[ -z "$RUN_BENCHMARK" ]]; then
  msg "Optional: benchmark the installed models"
  info "runs curated presets per model and writes .data/benchmark/report.md"
  info "this can take a long time - use --dry-run inside it to see the plan first"
  if confirm "Run the benchmark now?" "N"; then RUN_BENCHMARK=1; else RUN_BENCHMARK=0; fi
  printf '\n'
fi

if [[ "$RUN_BENCHMARK" == "1" ]]; then
  # The selection scopes fetching and config generation, and the benchmark has to
  # inherit it too. benchmark.py defaults to every model it finds under
  # .data/models/, so without this a `--models qwen3.6-27b` run would quietly
  # benchmark every model still on disk from earlier runs.
  BENCH_SCOPE=()
  for mid in $MODEL_IDS; do
    BENCH_SCOPE+=(--model "$mid")
  done

  # No selection keeps the old meaning: benchmark whatever is installed.
  if [[ ${#BENCH_SCOPE[@]} -gt 0 ]]; then
    info "scoped to the selected model(s):$(printf ' %s' $MODEL_IDS)"
  else
    info "no model selection - benchmarking every installed model"
  fi

  # bash 3.2 is still the macOS system bash, and it treats "${a[@]}" on an empty
  # array as an unbound variable under `set -u`, hence the +expansion guard.
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[dry-run] benchmark.py ${BENCH_SCOPE[*]+${BENCH_SCOPE[*]}}"
  else
    python3 scripts/benchmark.py --dry-run ${BENCH_SCOPE[@]+"${BENCH_SCOPE[@]}"}
    if confirm "Proceed with that benchmark plan?"; then
      python3 scripts/benchmark.py ${BENCH_SCOPE[@]+"${BENCH_SCOPE[@]}"} \
        || warn "benchmark exited non-zero"
    fi
  fi
  printf '\n'
fi


msg "Setup complete"
printf '\n'
python3 scripts/fetch_models.py status 2>/dev/null || true
printf '\n'
printf '%sStart working:%s\n\n' "$C_BOLD" "$C_RESET"
info "${C_CYAN}./scripts/serve.py${C_RESET}   pick a model, land in a ready shell"
info "${C_CYAN}cd ~/your/project${C_RESET}"
info "${C_CYAN}opencode${C_RESET}             already pointed at the served model"
printf '\n'
printf '%sType %sexit%s in that shell to stop the model.%s\n' \
  "$C_DIM" "$C_BOLD" "$C_RESET$C_DIM" "$C_RESET"
