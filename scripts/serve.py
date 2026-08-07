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
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
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


def resolve_port(host: str, wanted: int, interactive: bool) -> int:
    if port_is_free(host, wanted):
        return wanted
    info(yellow("port %d is already in use" % wanted))
    for candidate in range(wanted + 1, wanted + 40):
        if port_is_free(host, candidate):
            if not interactive:
                info("  using %d instead" % candidate)
                return candidate
            raw = prompt("Port to use instead", str(candidate))
            return int(raw) if raw.isdigit() else candidate
    raise SystemExit(fm.red("error: ") + "no free port near %d" % wanted)


def write_session_opencode_config(model_id: str, host: str, port: int) -> Path:
    """A session-scoped opencode config defaulting to the served model.

    Written beside - never over - the main opencode.json, so switching models
    for one session cannot corrupt the checked-in-style config.
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

    provider = (config.get("provider") or {}).get(fm.PROVIDER_ID)
    if isinstance(provider, dict):
        options = provider.setdefault("options", {})
        if isinstance(options, dict):
            options["baseURL"] = "http://%s:%d/v1" % (host, port)

    models = (provider or {}).get("models") or {}
    if model_id in models:
        config["model"] = "%s/%s" % (fm.PROVIDER_ID, model_id)
        config["small_model"] = "%s/%s" % (fm.PROVIDER_ID, model_id)
    # No metadata key here: opencode rejects configs with unrecognized keys.
    fm.write_json(SESSION_OPENCODE, config)
    return SESSION_OPENCODE


def build_server_command(
    model_id: str, host: str, port: int, models_max: int, ctx: Optional[int]
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
    if ctx:
        cmd += ["--ctx-size", str(ctx)]
    return cmd


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
            time.sleep(0.5)
    return False


def make_rcfile(
    model_id: str, config_path: Path, host: str, port: int, server_pid: int, log_path: Path
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

export OPENCODE_CONFIG=%(config)s
export LLAMA_HARNESS_MODEL=%(model)s
export LLAMA_HARNESS_URL=http://%(host)s:%(port)d
export LLAMA_HARNESS_SERVER_PID=%(pid)d

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
            "config": _shquote(str(config_path)),
            "model": model_id,
            "host": host,
            "port": port,
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
    model, manifest = choose_model(
        entries,
        args.model or (saved.get("model") if not args.fresh else None),
    )

    host = args.host or str(saved.get("host") or fm.DEFAULT_HOST)
    wanted_port = args.port or int(saved.get("port") or fm.DEFAULT_PORT)
    port = resolve_port(host, wanted_port, interactive and not args.port)
    models_max = args.models_max or int(saved.get("models_max") or 1)
    ctx = args.ctx or (int(saved["ctx"]) if saved.get("ctx") else None)

    save_session(
        {
            "model": model.id,
            "host": host,
            "port": port,
            "models_max": models_max,
            "ctx": ctx,
        }
    )

    config_path = write_session_opencode_config(model.id, host, port)

    if args.print_env:
        print("OPENCODE_CONFIG=%s" % config_path)
        print("LLAMA_HARNESS_MODEL=%s" % model.id)
        print("LLAMA_HARNESS_URL=http://%s:%d" % (host, port))
        return 0

    cmd = build_server_command(model.id, host, port, models_max, ctx)

    if args.no_shell:
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
    bash = shutil.which("bash") or "/bin/bash"
    rc = make_rcfile(model.id, config_path, host, port, proc.pid, log_path)
    # exec replaces this process but keeps the pid, so the shell we become is
    # both the server's parent and the pid the watchdog waits on.
    start_watchdog(os.getpid(), proc.pid)
    os.execv(bash, [bash, "--rcfile", str(rc), "-i"])
    return 0  # unreachable


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
