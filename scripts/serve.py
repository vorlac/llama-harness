#!/usr/bin/env python3
"""Serve a local model and drop into a shell that opencode is already wired to.

    scripts/serve.py                 # pick a model, then land in a ready shell
    scripts/serve.py ornith-35b      # skip the picker
    scripts/serve.py --fresh         # ignore saved settings, ask everything
    scripts/serve.py --no-shell      # just run the server in the foreground

What the default path does
--------------------------
1. Asks which installed model to serve (numbered list) unless one was named.
2. Reuses your last settings - port, context, host - unless ``--fresh``.
3. Starts ``llama-server`` in the background.
4. Writes a session opencode config whose default model is the one you picked.
5. Execs an **interactive bash subshell** with ``OPENCODE_CONFIG`` exported.

So the whole workflow is::

    scripts/serve.py
    cd ~/some/project
    opencode

Everything is bash regardless of your login shell, so behaviour is identical
from fish, zsh or bash. The server is a child of that subshell and a trap kills
it on exit, so closing the terminal - or typing ``exit`` - stops both the model
and anything still talking to it. Nothing is left running in the background.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conductor_wiring as cw  # noqa: E402
import fetch_models as fm  # noqa: E402

REPO_ROOT = fm.REPO_ROOT
SESSION_FILE = fm.CONFIGS_DIR / "serve-session.json"
SESSION_OPENCODE = fm.CONFIGS_DIR / "opencode.session.json"


def bold(t):
    return fm.bold(t)


def dim(t):
    return fm.dim(t)


def cyan(t):
    return fm.cyan(t)


def green(t):
    return fm.green(t)


def yellow(t):
    return fm.yellow(t)


def info(msg: str = "") -> None:
    print(msg, flush=True)


def load_session(fresh: bool) -> Dict[str, object]:
    """Previous choices, so a repeat run is a single keypress.

    ``--fresh`` deliberately ignores this file rather than deleting it, so a
    one-off experiment never destroys a working setup.
    """
    if fresh or not SESSION_FILE.is_file():
        return {}
    try:
        data = json.loads(SESSION_FILE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_session(settings: Dict[str, object]) -> None:
    payload = dict(settings)
    payload["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload["_comment"] = (
        "Written by scripts/serve.py. These values are reused on the next run; "
        "pass --fresh to ignore them."
    )
    fm.write_json(SESSION_FILE, payload)


def installed(chat_only: bool = True) -> List[Tuple[object, Dict[str, object]]]:
    """Installed models, chat-capable ones by default.

    Embedding and reranker models are still served by the router (they are in
    llama-models.ini), but opencode cannot use one as its agent model, so
    offering them in the picker would just produce a broken session.
    """
    entries = fm.installed_models()
    if not chat_only:
        return entries
    return [
        (model, man)
        for model, man in entries
        if not getattr(model, "embedding", False) and not getattr(model, "reranker", False)
    ]


def prompt(question: str, default: Optional[str] = None) -> str:
    suffix = " [%s]" % default if default else ""
    try:
        answer = input("%s%s: " % (question, suffix)).strip()
    except EOFError:
        answer = ""
    return answer or (default or "")


def choose_model(entries, preferred: Optional[str]) -> Tuple[object, Dict[str, object]]:
    """Numbered picker over everything installed."""
    if preferred:
        for model, man in entries:
            if model.id == preferred:
                return model, man
        info(yellow("warning: ") + "%r is not installed; pick from the list" % preferred)

    if len(entries) == 1:
        model, man = entries[0]
        info("Only one model installed: %s" % cyan(model.id))
        return model, man

    info(bold("Installed models"))
    for index, (model, man) in enumerate(entries, 1):
        size = int(man.get("total_bytes") or 0) / fm.GB
        tags = []
        if man.get("mmproj"):
            tags.append("vision")
        if getattr(model, "reasoning", False):
            tags.append("reasoning")
        info(
            "  %2d) %-22s %-11s %6.1f GB  %-9s %s"
            % (
                index,
                cyan(model.id),
                man.get("quant", "?"),
                size,
                model.category,
                dim(",".join(tags)),
            )
        )
    info("")

    while True:
        raw = prompt("Select a model by number", "1")
        if raw.isdigit() and 1 <= int(raw) <= len(entries):
            return entries[int(raw) - 1]
        # Accept an id as well - faster once you know the names.
        for model, man in entries:
            if model.id == raw:
                return model, man
        info(yellow("  enter 1-%d, or a model id" % len(entries)))


def port_is_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def resolve_port(host: str, wanted: int, interactive: bool, avoid: Sequence[int] = ()) -> int:
    """A free port, never one this run has already handed to another process.

    port_is_free only asks whether a port can be bound at this instant, and the router's
    port is chosen before llama-server has been started, so without ``avoid`` the
    same free port is handed out twice and the generated router config proxies to
    its own listen address.
    """
    taken = {int(port) for port in avoid}
    if wanted not in taken and port_is_free(host, wanted):
        return wanted
    info(yellow("port %d is already in use" % wanted))
    for candidate in range(wanted + 1, wanted + 40):
        if candidate not in taken and port_is_free(host, candidate):
            if not interactive:
                info("  using %d instead" % candidate)
                return candidate
            raw = prompt("Port to use instead", str(candidate))
            return int(raw) if raw.isdigit() else candidate
    raise SystemExit(fm.red("error: ") + "no free port near %d" % wanted)


def resolve_router_port(host: str, wanted: int, server_port: int) -> int:
    """The router's listen port, which can never be llama-server's own.

    llama-server has not been started at the point this runs, so its port is still free
    and a stateless resolve_port hands the same number out twice - producing a
    router configured to proxy to its own listen address, after which one of the
    two processes dies on a bind failure that names nothing about the real cause.
    """
    return resolve_port(host, wanted, False, avoid=(server_port,))


def port_is_listening(host: str, port: int, timeout: float = 0.35) -> bool:
    """Whether anything ANSWERS on this port, asked without binding it.

    port_is_free asks the opposite question by binding, which is the one thing a
    report about a running session must not do.
    """
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def reported_port(host: str, wanted: int) -> Tuple[int, Optional[str]]:
    """--print-env's port answer, with a notice when nothing is there.

    resolve_port BINDS, and hands back a DIFFERENT port when the wanted one is
    busy. For a run about to start llama-server that is right; for --print-env it
    inverts the flag's one job, because a busy configured port is the signal that
    the session being reported is running on it. save_session records the port a
    run resolved to, so the saved number is the live one - this only verifies it,
    and says so on stderr when the answer is no.
    """
    if port_is_listening(host, wanted):
        return int(wanted), None
    return int(wanted), (
        "nothing is listening on %s:%d, so no session appears to be running there; "
        "the printed URL names where a serve.py run will put one." % (host, int(wanted))
    )


def reported_model(entries, preferred: Optional[str]) -> Tuple[object, Dict[str, object]]:
    """--print-env's model: the one already chosen, never a picker.

    choose_model writes its list with info() - to stdout - and blocks on a
    prompt when nothing is preselected. Inside `eval "$(serve.py --print-env)"`
    the first lands in the caller's eval and the second is an invisible hang, so
    --print-env reports the model the session was started with or says why it
    cannot.
    """
    for model, man in entries:
        if model.id == preferred:
            return model, man
    if not preferred and len(entries) == 1:
        return entries[0]
    if not preferred:
        raise SystemExit(
            fm.red("error: ") + "--print-env has no model to report: no model was named and "
            "%s records none. Start a session first, or pass the model id." % SESSION_FILE
        )
    raise SystemExit(
        fm.red("error: ") + "--print-env cannot report %r: it is not installed." % preferred
    )


def write_session_opencode_config(model_id: str, base_url: str) -> Path:
    """A session-scoped opencode config defaulting to the served model.

    Written beside - never over - the main opencode.json, so switching models
    for one session cannot corrupt the checked-in-style config. ``base_url`` is
    the routing decision already made: the router origin when the router is up,
    the llama-server origin otherwise, so this function never has to guess.
    """
    base_path = fm.CONFIGS_DIR / "opencode.json"
    config: Dict[str, object] = {}
    if base_path.is_file():
        try:
            config = json.loads(base_path.read_text())
        except (OSError, ValueError):
            config = {}
    if not config:
        raise SystemExit(
            fm.red("error: ") + "no opencode config yet - run: scripts/fetch_models.py config"
        )

    config = cw.apply_conductor_wiring(config, base_url, root=REPO_ROOT)

    provider = (config.get("provider") or {}).get(fm.PROVIDER_ID)
    models = (provider or {}).get("models") or {}
    if model_id in models:
        config["model"] = "%s/%s" % (fm.PROVIDER_ID, model_id)
        config["small_model"] = "%s/%s" % (fm.PROVIDER_ID, model_id)
    # No metadata key here: opencode rejects configs with unrecognized keys.
    fm.write_json(SESSION_OPENCODE, config)
    return SESSION_OPENCODE


def build_server_command(
    model_id: str, host: str, port: int, models_max: int, ctx: Optional[int], slots: int
) -> List[str]:
    server = fm.tool_path("llama-server")
    preset = fm.CONFIGS_DIR / "llama-models.ini"
    if not preset.is_file():
        raise SystemExit(
            fm.red("error: ") + "no model preset - run: scripts/fetch_models.py config"
        )
    cmd = [
        str(server),
        "--models-preset",
        str(preset),
        "--models-max",
        str(models_max),
        "--models-autoload",
        "--host",
        host,
        "--port",
        str(port),
        "--jinja",
    ]
    # --ctx-size is llama-server's TOTAL context, divided among slots, so the
    # configured per-slot window and the slot count are ONE derivation
    # (router/UPSTREAM_CONTRACT.md F3). Emitted here and nowhere else: llama-server
    # honours the last --ctx-size it is handed, so a second one discards an intent.
    cmd += cw.parallel_server_args(slots, ctx)
    return cmd


def write_router_config(
    path: Path,
    listen_host: str,
    listen_port: int,
    upstream_host: str,
    upstream_port: int,
    slots: int,
    fresh: bool,
) -> Path:
    """Refresh the machine-derived keys of the hand-editable router config."""
    existing: Optional[Dict[str, object]] = None
    if path.is_file() and not fresh:
        try:
            loaded = json.loads(path.read_text())
            existing = loaded if isinstance(loaded, dict) else None
        except (OSError, ValueError):
            existing = None
    generated = cw.generate_router_config(
        listen_host, listen_port, upstream_host, upstream_port, slots, root=REPO_ROOT
    )
    fm.write_json(path, cw.merge_router_config(existing, generated, fresh=fresh))
    return path


def wait_until_ready(host: str, port: int, proc: subprocess.Popen, timeout: int = 600) -> bool:
    import urllib.request

    base = "http://%s:%d/health" % (host, port)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(base, timeout=3) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        # A non-200 answer (the server is up but not serving yet) falls through
        # here just like a refused connection; both back off before the next poll
        # so a slow-starting server is polled, not busy-spun to the deadline.
        time.sleep(0.5)
    return False


def make_rcfile(
    model_id: str, env: Dict[str, str], server_pid: int, log_path: Path
) -> Path:
    """Bash rcfile for the session subshell.

    The trap is the whole point: it fires on normal exit, on Ctrl-D, and on the
    SIGHUP a closing terminal sends, so the model never outlives the shell that
    started it.
    """
    rc = fm.CONFIGS_DIR / "session.bashrc"
    rc.write_text(
        """# Generated by scripts/serve.py - sourced by the session subshell.

# Inherit the user's normal bash setup first so the shell still feels familiar.
if [ -f /etc/bashrc ]; then . /etc/bashrc; fi
if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi

%(exports)s
__llama_harness_cleanup() {
  if kill -0 %(pid)d 2>/dev/null; then
    printf '\\n\\033[2mstopping %(model)s (pid %(pid)d)...\\033[0m\\n'
    kill %(pid)d 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 %(pid)d 2>/dev/null || break
      sleep 0.5
    done
    kill -9 %(pid)d 2>/dev/null
  fi
}
trap __llama_harness_cleanup EXIT HUP INT TERM

llama_status() {
  curl -s "$LLAMA_HARNESS_URL/v1/models" | python3 -m json.tool 2>/dev/null \\
    || echo "server not responding at $LLAMA_HARNESS_URL"
}
llama_log() { tail -f %(log)s; }

PS1='\\[\\033[36m\\](%(model)s)\\[\\033[0m\\] \\w $ '

printf '\\033[1m%%s\\033[0m\\n' "model served: %(model)s"
printf '  %%s\\n' "endpoint     : $LLAMA_HARNESS_URL"
printf '  %%s\\n' "opencode cfg : $OPENCODE_CONFIG"
printf '\\n'
printf '\\033[2m%%s\\033[0m\\n' "cd into any workspace and run: opencode"
printf '\\033[2m%%s\\033[0m\\n' "llama_status / llama_log to inspect; exit to stop the model"
printf '\\n'
"""
        % {
            "exports": cw.rcfile_export_block(env),
            "model": model_id,
            "pid": server_pid,
            "log": _shquote(str(log_path)),
        }
    )
    return rc


def _shquote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


_WATCHDOG = """
import os, signal, sys, time
shell_pid, server_pid = int(sys.argv[1]), int(sys.argv[2])
while True:
    time.sleep(1.0)
    try:
        os.kill(shell_pid, 0)
    except OSError:
        break
try:
    os.kill(server_pid, signal.SIGTERM)
    for _ in range(20):
        time.sleep(0.5)
        os.kill(server_pid, 0)
    os.kill(server_pid, signal.SIGKILL)
except OSError:
    pass
"""


def start_watchdog(shell_pid: int, server_pid: int) -> None:
    """Reap the server if the session shell dies without running its trap.

    The bash EXIT trap is the fast path, but bash defers traps until the current
    foreground command returns - so a terminal closed while `opencode` is running
    can leave the model resident. This detached watcher polls the shell pid and
    cleans up regardless, including after a SIGKILL that no trap could catch.
    """
    try:
        subprocess.Popen(
            [sys.executable, "-c", _WATCHDOG, str(shell_pid), str(server_pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,  # survive the terminal it was launched from
        )
    except OSError as exc:
        info(yellow("warning: ") + "could not start cleanup watchdog: %s" % exc)


def reap_server(proc: subprocess.Popen) -> None:
    """Kill the llama-server this run started, for the window where nothing else can.

    Between wait_until_ready succeeding and start_watchdog, the child has no
    owner: the bash trap does not exist yet, the watchdog is not running, and the
    router supervisor polls this pid but only ever reaps llama-router. An exit
    anywhere in there leaves a 20+GB model and its port held by a process nothing
    is left pointing at, and the next run resolves to the next port and leaks
    another one.
    """
    try:
        if proc.poll() is None:
            proc.kill()
    except OSError:
        return
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="serve.py",
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "The default run leaves you in a bash subshell with opencode already\n"
            "configured. Type 'exit' to stop the model and return to your shell.\n"
        ),
    )
    parser.add_argument(
        "model",
        nargs="?",
        help="model id (skips the picker)",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="ignore saved settings and ask for everything",
    )
    parser.add_argument(
        "--host",
        help="bind host",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="bind port",
    )
    parser.add_argument(
        "--ctx",
        type=int,
        help="override served context size",
    )
    parser.add_argument(
        "--models-max",
        type=int,
        help="models resident at once (default 1)",
    )
    parser.add_argument(
        "--no-shell",
        action="store_true",
        help="run the server in the foreground; do not open a shell",
    )
    parser.add_argument(
        "--router",
        dest="router",
        action="store_true",
        default=None,
        help="launch llama-router and point opencode at it "
        "(the default whenever the binary is present)",
    )
    parser.add_argument(
        "--no-router",
        dest="router",
        action="store_false",
        help="talk to llama-server directly; run the identical workflow without the router",
    )
    parser.add_argument(
        "--router-port",
        type=int,
        help="router listen port (default %d)" % cw.DEFAULT_LISTEN_PORT,
    )
    parser.add_argument(
        "--max-readers",
        type=int,
        help="concurrent sub-sessions to size --parallel and admission from (default %d)"
        % cw.DEFAULT_MAX_READERS,
    )
    parser.add_argument(
        "--print-env",
        action="store_true",
        help="print the session env and exit (for scripting)",
    )
    parser.add_argument(
        "--include-utility",
        action="store_true",
        help="also offer embedding/reranker models (opencode "
        "cannot use these as an agent model)",
    )
    parser.add_argument(
        "--no-build-check",
        action="store_true",
        help="skip verifying tools against the submodule",
    )

    args = parser.parse_args(argv)
    if not args.no_build_check:
        fm.ensure_tools()

    entries = installed(chat_only=not args.include_utility)
    if not entries:
        raise SystemExit(
            fm.red("error: ") + "no chat-capable models installed.\n"
            "Install one with:  scripts/fetch_models.py install ornith-35b\n"
            "Or run the guided setup:  ./setup.sh"
        )

    saved = load_session(args.fresh)
    interactive = sys.stdin.isatty()
    preferred = args.model or (saved.get("model") if not args.fresh else None)
    # --print-env reports a session that already exists, so it takes neither the
    # picker nor a port: both would ask the operator a question from inside the
    # caller's `eval "$(...)"`, where the question is invisible and the answer
    # never comes. Everything it needs is what the last run recorded.
    model, _manifest = (
        reported_model(entries, preferred) if args.print_env else choose_model(entries, preferred)
    )

    host = args.host or str(saved.get("host") or fm.DEFAULT_HOST)
    wanted_port = args.port or int(saved.get("port") or fm.DEFAULT_PORT)
    wanted_router_port = int(args.router_port or saved.get("router_port") or cw.DEFAULT_LISTEN_PORT)

    environ = dict(os.environ)
    decision = cw.router_preflight(
        args.router,
        cw.find_router_binary(REPO_ROOT, environ),
        REPO_ROOT / cw.ROUTER_SCHEMA_RELPATH,
        searched=cw.router_search_paths(REPO_ROOT, environ),
        # --no-shell execs into llama-server, so it leaves no process able to
        # supervise a router. --print-env starts nothing at all and therefore makes
        # no such decision: claiming one here would print a notice about a flag the
        # user never passed and force LLAMA_HARNESS_ROUTER=0 onto a live router session.
        no_shell=args.no_shell,
    )
    if decision.action == "refuse":
        raise SystemExit(fm.red("error: ") + decision.error)
    if decision.notice and not args.print_env:
        info(yellow("notice: ") + decision.notice)

    if args.print_env:
        # --print-env REPORTS the session (its own help: "for scripting"). It starts
        # nothing and writes nothing - not the session opencode config a live session
        # is reading, not the saved settings, and above all not a socket: the port
        # resolution below is skipped entirely, because binding is how a report
        # about a running session turns into a claim about a port nobody is on.
        # Every diagnostic goes to stderr so stdout stays NAME=value for the
        # caller's eval. The router's half needs no separate check - print_env_report
        # asks it for /conductor/health, which is a better answer than a bind.
        live_port, port_notice = reported_port(host, wanted_port)
        out, notices = cw.print_env_report(
            model.id,
            SESSION_OPENCODE,
            host,
            live_port,
            host,
            wanted_router_port,
            fm.CONFIGS_DIR / "conductor-router.json",
            decision,
        )
        if port_notice:
            notices.append(port_notice)
        if not SESSION_OPENCODE.is_file():
            notices.append(
                "no session opencode config at %s yet; OPENCODE_CONFIG names where a "
                "serve.py run will write one. --print-env writes nothing itself, so it "
                "cannot overwrite the config a running session is reading." % SESSION_OPENCODE
            )
        for notice in notices:
            print(yellow("notice: ") + notice, file=sys.stderr, flush=True)
        for line in out:
            print(line)
        return 0

    # Past here the run is going to START something, so the ports are taken
    # rather than reported: resolve_port binds to prove they are free and may ask
    # which one to use instead, both of which only make sense on this side.
    port = resolve_port(host, wanted_port, interactive and not args.port)
    models_max = args.models_max or int(saved.get("models_max") or 1)
    ctx = args.ctx or (int(saved["ctx"]) if saved.get("ctx") else None)
    max_readers = args.max_readers or int(saved.get("max_readers") or cw.DEFAULT_MAX_READERS)
    slots = cw.derive_slots(max_readers)

    router_port = wanted_router_port
    if decision.action == "launch":
        router_port = resolve_router_port(host, router_port, port)

    save_session(
        {
            "model": model.id,
            "host": host,
            "port": port,
            "models_max": models_max,
            "ctx": ctx,
            "max_readers": max_readers,
            "router_port": router_port,
        }
    )

    cmd = build_server_command(model.id, host, port, models_max, ctx, slots)

    if args.no_shell:
        write_session_opencode_config(model.id, cw.openai_base_url(host, port))
        info("%s %s on http://%s:%d" % (bold("serving"), cyan(model.id), host, port))
        os.execv(cmd[0], cmd)
        return 0  # unreachable

    log_path = fm.CONFIGS_DIR / "server.log"
    log_handle = open(log_path, "w")
    info("%s %s %s" % (bold("==>"), "starting", cyan(model.id)))
    proc = subprocess.Popen(
        cmd,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )

    if not wait_until_ready(host, port, proc):
        proc.kill()
        tail = ""
        try:
            tail = "\n".join(log_path.read_text().splitlines()[-15:])
        except OSError:
            pass

        raise SystemExit(fm.red("error: ") + "llama-server failed to start.\n" + tail)

    info("    %s ready on http://%s:%d" % (green("ok"), host, port))

    # llama-server is now up and UNOWNED. The bash trap does not exist yet, the
    # watchdog is not running, and the router supervisor reaps llama-router only -
    # so from here until start_watchdog, this frame is the sole owner of a process
    # holding a 20+GB model and a port. The guard is on the WINDOW rather than on
    # the raise sites inside it, because the window is what the ownership gap is:
    # a step added below inherits the reaping instead of re-opening the leak.
    try:
        router_config_path = fm.CONFIGS_DIR / "conductor-router.json"
        routing = cw.Routing(False, cw.openai_base_url(host, port), None)
        if decision.action == "launch":
            write_router_config(
                router_config_path, host, router_port, host, port, slots, args.fresh
            )
            # exec keeps this pid, so the shell we are about to become is the pid
            # the supervisor polls - the same trick start_watchdog uses.
            supervisor = cw.start_router_supervisor(
                cw.find_router_binary(REPO_ROOT, environ),
                router_config_path,
                Path(decision.schema),
                os.getpid(),
                REPO_ROOT,
            )
            routing = cw.finalize_routing(decision, host, router_port, host, port)
            if routing.router_enabled:
                info("    %s router on http://%s:%d" % (green("ok"), host, router_port))
            else:
                # The supervisor only exits with the session shell, and on this leg that
                # shell is exactly what carries on running - so nothing but this call can
                # stop it restarting a router the session has stopped pointing at.
                cw.stop_router_supervisor(supervisor)
                if routing.notice:
                    info(yellow("notice: ") + routing.notice)

        # Written only once the routing decision is final: a session config aimed
        # at a router that never came up 502s from its first prompt.
        config_path = write_session_opencode_config(model.id, routing.base_url)
        env = cw.session_env(
            model.id,
            config_path,
            host,
            port,
            proc.pid,
            routing,
            router_config_path=router_config_path if routing.router_enabled else None,
        )

        bash = shutil.which("bash") or "/bin/bash"
        rc = make_rcfile(model.id, env, proc.pid, log_path)
        # The handover: past this call the watchdog owns the child, so the guard
        # ends here. A successful session must leave llama-server RUNNING - reaping
        # on the way out of a window that closed would kill the model the session
        # is about to use.
        start_watchdog(os.getpid(), proc.pid)
    except BaseException:
        reap_server(proc)
        raise

    os.execv(bash, [bash, "--rcfile", str(rc), "-i"])
    return 0  # unreachable


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
