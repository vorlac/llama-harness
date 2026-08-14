"""Pure wiring functions shared by serve.py and fetch_models.py (plan:2866-2889).

Everything the conductor needs in order to launch llama-router, generate its
config, derive one slot count for both sides of the concurrency contract and
merge the conductor opencode fragment lives here rather than inside serve.py,
so it can be exercised without starting a server, opening a socket or spawning
a process. Nothing in this module performs a filesystem write; the two I/O
seams it does have - process spawn and health probe - are injectable.

This module must never import fetch_models: fetch_models imports THIS module,
and a cycle breaks `fetch_models.py config`. The two constants that would
otherwise be shared (PROVIDER_ID, the default llama-server port) are therefore
restated below and checked by the unittest against the configs both sides emit.

Runs on the pinned interpreter, /usr/bin/python3 3.9.6: deferred annotations,
typing.Optional/Dict/List, no 3.10+ syntax.
"""

from __future__ import annotations

import copy
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, NamedTuple, Optional, Sequence, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

# The opencode provider block both configs key their baseURL off. Restated
# rather than imported, to keep fetch_models -> conductor_wiring acyclic.
PROVIDER_ID = "llamacpp"
OPENAI_PATH = "/v1"

HARNESS_ROOT_TOKEN = "${LLAMA_HARNESS_ROOT}"
FRAGMENT_RELPATH = "conductor/opencode-fragment.json"

ROUTER_CONFIG_RELPATH = ".data/configs/conductor-router.json"
ROUTER_SCHEMA_RELPATH = "router/tests/schemas/RouterConfig.schema.json"
ROUTER_LEDGER_RELPATH = ".data/router/metrics.jsonl"
ROUTER_LOG_RELPATH = ".data/configs/router.log"

ROUTER_BINARY_NAME = "llama-router"
ROUTER_BINARY_ENV = "LLAMA_ROUTER"
# Most preferred first. CMakePresets.json puts the binary in
# .out/build/<preset>/; .data/tools/ is where a hand-installed copy lands.
ROUTER_BINARY_RELPATHS = (
    ".out/build/clang-relwdebinfo/llama-router",
    ".out/build/clang-release/llama-router",
    ".out/build/clang-debug/llama-router",
    ".data/tools/llama-router",
)

DEFAULT_LISTEN_HOST = "127.0.0.1"
DEFAULT_LISTEN_PORT = 8088
ROUTER_HEALTH_PATH = "/conductor/health"
ROUTER_READY_TIMEOUT_S = 30.0

# plan:580-590 (§2.1). maxReaders has no source at serve time - the target
# repo's .conductor/config.json is not chosen yet - so this module owns the
# default as ONE literal. Task 12.2 writes .conductor/config.json and must use
# the same number, or the two defaults drift with nothing to catch it.
DEFAULT_MAX_READERS = 6
SUB_SESSION_TIMEOUT_MS = 900000

# plan:639-669 (§2.2), the hand-editable half of the generated router config.
ROUTER_CONFIG_VERSION = 1
ROUTER_MAX_QUEUED = 64
ROUTER_QUEUE_TIMEOUT_MS = 600000
ROUTER_AFFINITY_HEADER = "X-Conductor-Group"
ROUTER_SCHEMA_HEADER = "X-Conductor-Schema"
ROUTER_LOG_LEVEL = "info"

# Only these paths are refreshed from the current run; every other key in an
# existing conductor-router.json is a hand edit and survives regeneration.
ROUTER_MACHINE_KEYS = (
    ("version",),
    ("listen", "host"),
    ("listen", "port"),
    ("upstream", "host"),
    ("upstream", "port"),
    ("admission", "maxInflightPerModel"),
    ("metrics", "ledgerPath"),
)

# router/UPSTREAM_CONTRACT.md, Task 12.1 item 6: --ctx-size is llama-server's
# TOTAL context, divided among slots. Measured on qwen3.6-27b / llama-server
# 10298: `--ctx-size 8192 --parallel 6` served n_ctx_slot = 1536, and
# `--ctx-size 49152 --parallel 6` served the intended 8192. The recorded
# per-slot window is what the derivation multiplies back up.
PER_SLOT_CONTEXT_TOKENS = 8192

# Supervisor restart policy. Named so a drift is a test failure rather than a
# behaviour change nobody notices.
BACKOFF_BASE_MS = 500
BACKOFF_FACTOR = 2
BACKOFF_CAP_MS = 30000
HEALTHY_RUN_SECONDS = 60
ROUTER_TERM_GRACE_S = 10.0

# C-041: llama-router exits 0 clean / 2 usage / 3 ConfigError / 4 bind failure.
# A config the router cannot parse will not parse on retry, so 2, 3 and 4 must
# never be restarted - the loop would spin forever over the one message that
# names the broken flag, field or address.
FATAL_EXIT_REASONS = {
    2: "llama-router rejected its command line (exit 2); its stderr names the offending flag",
    3: "llama-router could not parse its config (exit 3); its stderr carries the offending field",
    4: "llama-router could not bind its listen address (exit 4); its stderr carries host:port",
}
FATAL_EXIT_CODES = tuple(sorted(FATAL_EXIT_REASONS))

FILE_REFERENCE_RE = re.compile(r"\{file:([^}]+)\}")


class WiringError(Exception):
    """A wiring fault that must stop generation instead of shipping a bad config."""


class Preflight(NamedTuple):
    """The router launch decision: one of launch / direct / refuse."""

    action: str
    router_enabled: bool
    notice: str = ""
    error: str = ""
    schema: str = ""


class Routing(NamedTuple):
    """Where the session's provider actually points, once readiness is known."""

    router_enabled: bool
    base_url: str
    notice: Optional[str] = None


class RestartVerdict(NamedTuple):
    restart: bool
    fatal: bool
    message: str


def openai_base_url(host: str, port: int) -> str:
    return "http://%s:%d%s" % (host, int(port), OPENAI_PATH)


def origin_of(base_url: str) -> str:
    """The scheme://host:port half of an OpenAI base URL."""
    if base_url.endswith(OPENAI_PATH):
        return base_url[: -len(OPENAI_PATH)]
    return base_url


def derive_slots(max_readers: Any) -> int:
    """The ONE number both --parallel and admission.maxInflightPerModel use.

    slots == maxInflightPerModel == max(1, maxReaders). Equality satisfies
    §2.2's "MUST be <= llama-server's slot count" with zero drift. A zero or
    negative maxReaders floors to one slot rather than asking llama-server for
    no slots or telling the router to admit nothing.
    """
    if isinstance(max_readers, bool) or not isinstance(max_readers, int):
        raise WiringError(
            "maxReaders must be an integer, got %r (%s)" % (max_readers, type(max_readers).__name__)
        )
    return max_readers if max_readers > 1 else 1


def parallel_server_args(slots: Any) -> List[str]:
    """The llama-server arguments the derived slot count adds.

    Two-valued because --ctx-size is the TOTAL context llama-server divides
    among its slots, not the per-slot window (router/UPSTREAM_CONTRACT.md,
    finding F3). Appending a bare `--parallel N` to the existing command cuts
    every sub-session's window by a factor of N, and llama-server reports it as
    a rounding notice rather than a warning. At one slot there is nothing to
    divide, so the argv is the identity case: `--parallel 1` and nothing else.
    """
    count = derive_slots(slots)
    args = ["--parallel", str(count)]
    if count > 1:
        args += ["--ctx-size", str(PER_SLOT_CONTEXT_TOKENS * count)]
    return args


def generate_router_config(
    listen_host: str,
    listen_port: int,
    upstream_host: str,
    upstream_port: int,
    slots: int,
    root: Optional[Path] = None,
) -> Dict[str, object]:
    """The §2.2 document (plan:639-669) as a dict. Writes nothing.

    ledgerPath is absolute rather than §2.2's bare relative literal: Task
    11.7's writer creates the parent directory wherever the path points, so a
    router inheriting some other cwd would write an invisible ledger rather
    than fail. The supervisor also launches with cwd at the repo root, so a
    hand-edited relative path lands in the same file.
    """
    base = REPO_ROOT if root is None else Path(root)
    return {
        "version": ROUTER_CONFIG_VERSION,
        "listen": {"host": listen_host, "port": int(listen_port)},
        "upstream": {"host": upstream_host, "port": int(upstream_port)},
        "admission": {
            "maxInflightPerModel": derive_slots(slots),
            "maxQueued": ROUTER_MAX_QUEUED,
            # Strictly below §2.1's subSessionTimeoutMs, so a queue timeout
            # reports as itself instead of racing the sub-session watchdog.
            "queueTimeoutMs": ROUTER_QUEUE_TIMEOUT_MS,
        },
        "priorities": {"interactive": 0, "review": 1, "batch": 2},
        "affinity": {"header": ROUTER_AFFINITY_HEADER, "contiguousDequeue": True},
        "schema": {
            "observeHeader": ROUTER_SCHEMA_HEADER,
            "validateResponses": True,
            # MUST be false in the base build (plan:648-650).
            "rejectOnMissing": False,
        },
        "metrics": {"ledgerPath": str(base / ROUTER_LEDGER_RELPATH)},
        "logging": {"level": ROUTER_LOG_LEVEL},
    }


def merge_router_config(
    existing: Optional[Dict[str, object]],
    generated: Dict[str, object],
    fresh: bool = False,
) -> Dict[str, object]:
    """Refresh the machine-derived keys, keep every hand edit.

    §2.2 calls conductor-router.json "generated by serve.py, hand-editable",
    and Task 11.8 hand-writes that exact path before this ever runs, so
    rewriting it wholesale would destroy another task's file. --fresh drops the
    edits, the same semantics --fresh already has for serve-session.json.
    """
    if fresh or not isinstance(existing, dict) or not existing:
        return copy.deepcopy(generated)

    merged = _deep_merge(copy.deepcopy(generated), existing)
    for path in ROUTER_MACHINE_KEYS:
        _set_path(merged, path, copy.deepcopy(_get_path(generated, path)))
    return merged


def load_fragment(root: Optional[Path] = None) -> Dict[str, object]:
    """conductor/opencode-fragment.json, consumed verbatim.

    The Python side never re-authors a plugin path, an agent definition or a
    tools.task flag; conductor/tests/fragment.test.ts guards the fragment.
    """
    path = (REPO_ROOT if root is None else Path(root)) / FRAGMENT_RELPATH
    try:
        raw = path.read_text()
    except OSError as exc:
        raise WiringError("cannot read the conductor opencode fragment %s: %s" % (path, exc))
    try:
        loaded = json.loads(raw)
    except ValueError as exc:
        raise WiringError("%s is not valid JSON: %s" % (path, exc))
    if not isinstance(loaded, dict):
        raise WiringError("%s must contain a JSON object, got %s" % (path, type(loaded).__name__))
    return loaded


def substitute_harness_root(value: Any, root: Path) -> Any:
    """Replace every ${LLAMA_HARNESS_ROOT} at any depth, in any string.

    A surviving token is fatal rather than cosmetic: opencode scans every
    config string for brace-file references and a dangling one is a hard
    ConfigInvalidError, so no session starts at all.
    """
    text_root = str(root)
    if isinstance(value, dict):
        return dict((key, substitute_harness_root(item, root)) for key, item in value.items())
    if isinstance(value, list):
        return [substitute_harness_root(item, root) for item in value]
    if isinstance(value, str):
        return value.replace(HARNESS_ROOT_TOKEN, text_root)
    return value


def merge_opencode_fragment(
    base: Dict[str, object], fragment: Dict[str, object]
) -> Dict[str, object]:
    """Deep merge with the conductor value winning; arrays replace, never append.

    Dicts recurse so base-only keys survive at every depth. Every non-dict
    value, arrays included, is replaced wholesale: unioning `plugin` would be a
    special case in a function whose predictability is the point. Neither
    argument is modified.
    """
    return _deep_merge(copy.deepcopy(base), fragment)


def apply_conductor_wiring(
    base: Dict[str, object],
    base_url: str,
    root: Optional[Path] = None,
    fragment: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    """The whole opencode-side wiring: merge, substitute, point, pin, verify.

    Idempotent, so the session-time merge over an already fragment-aware base
    config is a no-op, and non-mutating, so the caller's dicts are reusable.
    """
    where = REPO_ROOT if root is None else Path(root)
    raw = load_fragment(where) if fragment is None else fragment
    resolved = substitute_harness_root(raw, where)
    config = merge_opencode_fragment(base, resolved)

    provider = (config.get("provider") or {}).get(PROVIDER_ID)
    if isinstance(provider, dict):
        options = provider.get("options")
        if not isinstance(options, dict):
            options = {}
            provider["options"] = options
        options["baseURL"] = base_url

    # C-012: the wire contract was verified against opencode 1.18.15, so the
    # generated config pins auto-update off and cannot drift under a session.
    config["autoupdate"] = False

    verify_file_references(config, root=where)
    return config


def verify_file_references(config: Dict[str, object], root: Optional[Path] = None) -> None:
    """Fail loudly on a config that names a file opencode will not find.

    wire-notes.md:31: opencode scans every config string for brace-file
    references, and a dangling one makes the config endpoint return 400 so no
    session can start. That presents as opencode being broken rather than as a
    conductor wiring fault, which is why this is checked at generation time.
    """
    where = REPO_ROOT if root is None else Path(root)
    missing: List[str] = []
    for reference in _referenced_paths(config, where):
        if reference not in missing and not Path(reference).is_file():
            missing.append(reference)
    if missing:
        raise WiringError(
            "the generated opencode config references %d file(s) that do not exist:\n  %s"
            % (len(missing), "\n  ".join(missing))
        )


def router_search_paths(root: Path, env: Optional[Dict[str, str]] = None) -> List[str]:
    """Every location find_router_binary looks in, in order, as text."""
    values = dict(os.environ) if env is None else dict(env)
    places: List[str] = []
    override = values.get(ROUTER_BINARY_ENV)
    if override:
        places.append("$%s -> %s" % (ROUTER_BINARY_ENV, override))
    for relpath in ROUTER_BINARY_RELPATHS:
        places.append(str(Path(root) / relpath))
    places.append("%s on $PATH (%s)" % (ROUTER_BINARY_NAME, values.get("PATH", "")))
    return places


def find_router_binary(root: Path, env: Optional[Dict[str, str]] = None) -> Optional[Path]:
    """Locate llama-router over a pinned search order.

    fetch_models.find_tool cannot serve this role: its env branch is
    llama-server only and its own-tools branch looks only in .data/tools, while
    CMake writes the router to .out/build/<preset>/.
    """
    values = dict(os.environ) if env is None else dict(env)

    override = values.get(ROUTER_BINARY_ENV)
    if override:
        candidate = Path(override)
        if _is_executable_file(candidate):
            return candidate

    base = Path(root)
    for relpath in ROUTER_BINARY_RELPATHS:
        candidate = base / relpath
        if _is_executable_file(candidate):
            return candidate

    found = shutil.which(ROUTER_BINARY_NAME, path=values.get("PATH", ""))
    return Path(found) if found else None


def router_preflight(
    flag: Optional[bool],
    binary: Optional[Path],
    schema: Path,
    searched: Optional[Sequence[str]] = None,
    no_shell: bool = False,
) -> Preflight:
    """The --router/--no-router decision over the whole matrix.

    G5 governs the asymmetry: a missing router must never cost the user their
    session, so the auto default falls back to a direct session with a loud
    notice. An explicit --router asked for the thing that cannot be provided,
    so it refuses with a named remedy instead of quietly doing something else.
    """
    if flag is False:
        return Preflight("direct", False)

    if no_shell:
        if flag is True:
            return Preflight(
                "refuse",
                False,
                error=(
                    "--router and --no-shell cannot be combined: --no-shell replaces serve.py "
                    "with llama-server, so no process survives to supervise a router and no "
                    "session shell exists for it to die with."
                ),
            )
        return Preflight(
            "direct",
            False,
            notice=(
                "--no-shell leaves no session shell to supervise a router; "
                "this session talks to llama-server directly."
            ),
        )

    if binary is None:
        places = (
            list(searched)
            if searched is not None
            else [str(REPO_ROOT / relpath) for relpath in ROUTER_BINARY_RELPATHS]
        )
        if flag is True:
            return Preflight(
                "refuse",
                False,
                error=(
                    "--router was requested but no %s binary was found. Searched:\n  %s\n"
                    "Build it with: cmake --build .out/build/clang-relwdebinfo --target %s"
                    % (ROUTER_BINARY_NAME, "\n  ".join(places), ROUTER_BINARY_NAME)
                ),
            )
        return Preflight(
            "direct",
            False,
            notice=(
                "no %s binary found in %d searched location(s); "
                "this session talks to llama-server directly."
                % (ROUTER_BINARY_NAME, len(places))
            ),
        )

    schema_path = Path(schema)
    if not schema_path.is_file():
        # C-041: --schema is required and has no search path, and the exported
        # file is gitignored, so a fresh clone simply does not have one.
        remedy = "node conductor/tools/export-schemas.ts router/tests/schemas"
        if flag is True:
            return Preflight(
                "refuse",
                False,
                error=(
                    "--router was requested but the router schema %s does not exist. "
                    "Generate it with: %s" % (schema_path, remedy)
                ),
            )
        return Preflight(
            "direct",
            False,
            notice=(
                "the router schema %s is missing (generate it with: %s); "
                "this session talks to llama-server directly." % (schema_path, remedy)
            ),
        )

    return Preflight("launch", True, schema=str(schema_path.resolve()))


def router_supervisor_argv(binary: Path, config_path: Path, schema_path: Path) -> List[str]:
    """C-041's CLI contract, inherited rather than guessed."""
    return [str(binary), "--config", str(config_path), "--schema", str(schema_path)]


def restart_delay_ms(consecutive_crashes: int) -> int:
    """Capped exponential backoff, computed without shifting an unbounded int."""
    delay = BACKOFF_BASE_MS
    for _ in range(max(0, int(consecutive_crashes) - 1)):
        if delay >= BACKOFF_CAP_MS:
            break
        delay *= BACKOFF_FACTOR
    return BACKOFF_CAP_MS if delay > BACKOFF_CAP_MS else delay


def backoff_next(consecutive_crashes: int, last_uptime_s: float) -> Tuple[int, int]:
    """(delay for this restart, the crash count to carry forward).

    A run that stayed up HEALTHY_RUN_SECONDS resets the sequence, so a router
    that crashes once a day never inherits yesterday's cap.
    """
    crashes = 0 if last_uptime_s >= HEALTHY_RUN_SECONDS else int(consecutive_crashes)
    crashes += 1
    return restart_delay_ms(crashes), crashes


def router_restart_decision(exit_code: int, stderr_text: str) -> RestartVerdict:
    """Whether a router exit is worth retrying, per C-041's exit codes."""
    tail = stderr_text or ""
    if exit_code == 0:
        return RestartVerdict(False, False, "llama-router exited cleanly (0)")
    if exit_code in FATAL_EXIT_REASONS:
        return RestartVerdict(False, True, "%s\n%s" % (FATAL_EXIT_REASONS[exit_code], tail))
    return RestartVerdict(
        True, False, "llama-router exited %d; restarting after backoff\n%s" % (exit_code, tail)
    )


def wait_for_router_health(
    host: str, port: int, timeout: float = ROUTER_READY_TIMEOUT_S
) -> bool:
    """Poll GET /conductor/health until it answers 200 or the budget runs out.

    urllib raises on a non-2xx status, which is the point: a plain `curl -s`
    exits 0 on the 503 an unready server returns, so a probe written that way
    reports a server that cannot serve (router/UPSTREAM_CONTRACT.md).
    """
    import urllib.request

    url = "http://%s:%d%s" % (host, int(port), ROUTER_HEALTH_PATH)
    deadline = time.time() + timeout
    while True:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        if time.time() >= deadline:
            return False
        time.sleep(0.25)


def finalize_routing(
    decision: Preflight,
    listen_host: str,
    listen_port: int,
    upstream_host: str,
    upstream_port: int,
    probe: Optional[Callable[[str, int], bool]] = None,
) -> Routing:
    """Decide the session's baseURL only once the router is known to answer.

    A session config pointing at a router that never came up 502s from the
    first prompt, which is the half of G5 the plugin's mid-session failover
    structurally cannot cover: it needs a session that started.
    """
    direct = openai_base_url(upstream_host, upstream_port)
    if decision.action != "launch":
        return Routing(False, direct, decision.notice or None)

    check = wait_for_router_health if probe is None else probe
    try:
        healthy = bool(check(listen_host, int(listen_port)))
    except OSError as exc:
        return Routing(
            False,
            direct,
            "llama-router at %s:%d could not be reached (%s); falling back to a direct session."
            % (listen_host, int(listen_port), exc),
        )
    if healthy:
        return Routing(True, openai_base_url(listen_host, listen_port), None)
    return Routing(
        False,
        direct,
        "llama-router at %s:%d did not answer %s within the readiness budget; "
        "falling back to a direct session." % (listen_host, int(listen_port), ROUTER_HEALTH_PATH),
    )


def session_env(
    model_id: str,
    config_path: Path,
    host: str,
    port: int,
    server_pid: Optional[int],
    routing: Routing,
    router_config_path: Optional[Path] = None,
) -> Dict[str, str]:
    """The session's exported variables, rendered once for both consumers.

    Env is the channel because opencode rejects unrecognized config keys
    (serve.py:223) and core Config has no router block, so nothing in the
    committed TS can otherwise learn the router's listen host and port.
    """
    env: Dict[str, str] = {}
    env["OPENCODE_CONFIG"] = str(config_path)
    env["LLAMA_HARNESS_MODEL"] = str(model_id)
    env["LLAMA_HARNESS_URL"] = "http://%s:%d" % (host, int(port))
    if server_pid is not None:
        env["LLAMA_HARNESS_SERVER_PID"] = str(int(server_pid))
    env["LLAMA_HARNESS_ROUTER"] = "1" if routing.router_enabled else "0"
    if routing.router_enabled:
        env["LLAMA_HARNESS_ROUTER_URL"] = origin_of(routing.base_url)
        if router_config_path is not None:
            env["LLAMA_HARNESS_ROUTER_CONFIG"] = str(router_config_path)
    return env


def rcfile_export_block(env: Dict[str, str]) -> str:
    """The bash the session rcfile sources - one export per variable, no more."""
    return "".join("export %s=%s\n" % (name, shell_quote(env[name])) for name in env)


def print_env_lines(env: Dict[str, str]) -> List[str]:
    """The same variables as NAME=value, for --print-env."""
    return ["%s=%s" % (name, env[name]) for name in env]


def shell_quote(value: str) -> str:
    return "'" + str(value).replace("'", "'\\''") + "'"


def _supervisor_source() -> str:
    """The detached supervisor, as source for `python3 -c`.

    It mirrors serve.py's start_watchdog rather than inventing a second
    lifecycle: poll the session shell's pid, then SIGTERM, a bounded grace,
    then SIGKILL. It cannot import this module - it runs in a fresh
    interpreter with the repo root as cwd - so the policy constants are
    formatted in from the definitions above and stay single-sourced.
    """
    return '''
import os, signal, subprocess, sys, time

shell_pid = int(sys.argv[1])
router_argv = sys.argv[2:]
BASE_MS = %(base)d
FACTOR = %(factor)d
CAP_MS = %(cap)d
HEALTHY_S = %(healthy)d
GRACE_S = %(grace).1f
FATAL = %(fatal)r
LOG_RELPATH = %(log)r


def delay_ms(crashes):
    value = BASE_MS
    for _ in range(max(0, crashes - 1)):
        if value >= CAP_MS:
            break
        value *= FACTOR
    return CAP_MS if value > CAP_MS else value


def shell_alive():
    try:
        os.kill(shell_pid, 0)
    except OSError:
        return False
    return True


def open_log():
    path = os.path.join(os.getcwd(), LOG_RELPATH)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return open(path, "a", buffering=1)
    except OSError:
        return None


def stop(proc):
    if proc.poll() is not None:
        return
    try:
        os.kill(proc.pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.time() + GRACE_S
    while time.time() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.25)
    try:
        os.kill(proc.pid, signal.SIGKILL)
    except OSError:
        pass


log = open_log()
sink = log if log is not None else subprocess.DEVNULL
crashes = 0
while shell_alive():
    started = time.time()
    try:
        proc = subprocess.Popen(
            router_argv, stdout=sink, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL
        )
    except OSError as exc:
        if log is not None:
            log.write("supervisor: cannot start llama-router: %%s\\n" %% (exc,))
        break
    while proc.poll() is None and shell_alive():
        time.sleep(0.5)
    if not shell_alive():
        stop(proc)
        break
    code = proc.returncode
    if code == 0 or code in FATAL:
        if log is not None:
            log.write(
                "supervisor: llama-router exited %%d; not restarting "
                "(see the lines above for its own message)\\n" %% (code,)
            )
        break
    uptime = time.time() - started
    if uptime >= HEALTHY_S:
        crashes = 0
    crashes += 1
    if log is not None:
        log.write(
            "supervisor: llama-router exited %%d after %%.1fs; restart %%d in %%dms\\n"
            %% (code, uptime, crashes, delay_ms(crashes))
        )
    time.sleep(delay_ms(crashes) / 1000.0)
''' % {
        "base": BACKOFF_BASE_MS,
        "factor": BACKOFF_FACTOR,
        "cap": BACKOFF_CAP_MS,
        "healthy": HEALTHY_RUN_SECONDS,
        "grace": ROUTER_TERM_GRACE_S,
        "fatal": FATAL_EXIT_CODES,
        "log": ROUTER_LOG_RELPATH,
    }


ROUTER_SUPERVISOR_SOURCE = _supervisor_source()


def start_router_supervisor(
    binary: Path,
    config_path: Path,
    schema_path: Path,
    shell_pid: int,
    root: Path,
    spawn: Optional[Callable[..., Any]] = None,
) -> Any:
    """Launch the detached supervisor. serve.py execs into the shell and cannot supervise.

    cwd is the repo root so a hand-edited relative ledgerPath resolves to the
    same file the generated absolute one names.
    """
    launcher = subprocess.Popen if spawn is None else spawn
    argv = [sys.executable, "-c", ROUTER_SUPERVISOR_SOURCE, str(int(shell_pid))]
    argv += router_supervisor_argv(binary, config_path, schema_path)
    return launcher(
        argv,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        cwd=str(root),
    )


def _is_executable_file(candidate: Path) -> bool:
    return candidate.is_file() and os.access(str(candidate), os.X_OK)


def _deep_merge(target: Dict[str, object], overlay: Dict[str, object]) -> Dict[str, object]:
    """Overlay wins; dicts recurse; every other value, arrays included, replaces."""
    for key in overlay:
        incoming = overlay[key]
        current = target.get(key)
        if isinstance(current, dict) and isinstance(incoming, dict):
            _deep_merge(current, incoming)
        else:
            target[key] = copy.deepcopy(incoming)
    return target


def _get_path(document: Dict[str, object], path: Sequence[str]) -> Any:
    node: Any = document
    for name in path:
        node = node[name]
    return node


def _set_path(document: Dict[str, object], path: Sequence[str], value: Any) -> None:
    node: Any = document
    for name in path[:-1]:
        child = node.get(name)
        if not isinstance(child, dict):
            child = {}
            node[name] = child
        node = child
    node[path[-1]] = value


def _referenced_paths(value: Any, root: Path, key: Optional[str] = None) -> Iterable[str]:
    """Every filesystem path the config asks opencode to open."""
    if isinstance(value, dict):
        for name in value:
            for found in _referenced_paths(value[name], root, name):
                yield found
        return
    if isinstance(value, list):
        for item in value:
            for found in _referenced_paths(item, root, key):
                yield found
        return
    if not isinstance(value, str):
        return
    for reference in FILE_REFERENCE_RE.findall(value):
        yield str(_absolute(reference.strip(), root))
    if key == "plugin" and value.startswith("/"):
        yield str(_absolute(value, root))


def _absolute(reference: str, root: Path) -> Path:
    candidate = Path(reference)
    return candidate if candidate.is_absolute() else Path(root) / candidate
