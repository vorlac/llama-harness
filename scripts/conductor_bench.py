#!/usr/bin/env python3
"""The Task 14.1 three-arm conductor benchmark driver.

Three arms - plain opencode, opencode carrying the doctrine packs, and opencode
carrying the conductor plugin - run the same ten tasks against the same model
through the same router, three times each: ninety headless runs. This module
owns the manifest, the arm construction, the run plan, one result file per cell,
and the report. The ninety live runs themselves are Task 14.2.

The pure parts (manifest load, arm construction, run plan, ledger window,
scoring, aggregation, report) touch no process and no filesystem, which is what
makes them unit-testable offline. Everything that spawns or writes is a thin
layer over them and is injectable, so the suite drives the driver without ever
starting opencode, llama-server, llama-router or a model.

Scoring is the hidden test command's exit status, passed through. There is no
partial credit and nothing model-graded anywhere in this file.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import conductor_wiring

REPO_ROOT = Path(__file__).resolve().parent.parent

# Beside - never on top of - the model benchmark's own report.md and its
# per-model directories, which are gitignored and unrecoverable.
BENCH_DIR = REPO_ROOT / ".data" / "benchmark"
REPORT_PATH = BENCH_DIR / "conductor-report.md"
RESULTS_DIR = BENCH_DIR / "conductor" / "runs"
WORK_ROOT = BENCH_DIR / "conductor" / "work"

MANIFEST_PATH = REPO_ROOT / "bench" / "conductor-tasks.json"
DOCTRINE_DIR = REPO_ROOT / "conductor" / "doctrine"
FRAGMENT_PATH = REPO_ROOT / "conductor" / "opencode-fragment.json"
ROUTER_CONFIG_PATH = REPO_ROOT / conductor_wiring.ROUTER_CONFIG_RELPATH

DOCTRINE_PROMPT_NAME = "doctrine-prompt.md"
SEED_COMMIT_MESSAGE = "bench seed"

DEFAULT_MODEL = "llamacpp/qwen3.6-27b"
DEFAULT_REPS = 3
DEFAULT_TIMEOUT_SEC = 1800

# The closed arm vocabulary, in the order the run plan interleaves them.
ARMS = ("baseline", "doctrine", "conductor")

# One agent name per arm. baseline and doctrine both use opencode's own primary
# agent; only the doctrine arm's config gives that agent a prompt.
ARM_AGENTS = {
    "baseline": "build",
    "doctrine": "build",
    "conductor": "conductor-orchestrator",
}

EXPECTED_TASK_COUNT = 10
LANGUAGES = ("ts", "python", "cpp")
DIFFICULTIES = ("one-function", "multi-file")

OUTCOMES = ("pass", "fail", "timeout", "harness-error")

# conductor/core/stops.ts STOP_KINDS, verbatim.
STOP_KINDS = ("done", "noop", "blocked", "surfaced", "env", "interrupt")

# core/fsm-run.ts terminal states, which stand in for a stop kind when a run
# ended without writing a stop record.
TERMINAL_RUN_STATES = ("REPORTED", "TRIVIAL_DONE", "ANSWERED")

RESULT_KEYS = (
    "cellId",
    "arm",
    "taskId",
    "rep",
    "startedIso",
    "outcome",
    "passed",
    "exitCode",
    "wallClockMs",
    "tokens",
    "routerErrors",
    "schemaRetries",
    "reviewFindingsUpheld",
    "overridesUsed",
    "stopKind",
    "pluginAbsent",
)
TOKEN_KEYS = ("prompt", "completion", "total", "partial")

TASK_REQUIRED_KEYS = (
    "id",
    "language",
    "difficulty",
    "behavioral",
    "rationale",
    "prompt",
    "seedFiles",
    "hiddenFiles",
    "hiddenTestCommand",
    "repoTestCommand",
    "behavioralPaths",
)

NA = "n/a"
PARTIAL_MARKER = "(partial)"

SECTION_METHOD = "## Method"
SECTION_PER_TASK = "## Per-task pass rates"
SECTION_ARM_TOTALS = "## Arm totals"
SECTION_COST = "## Cost"
SECTION_PROCESS = "## Process metrics"
SECTION_ROUTER_ERRORS = "## Router-error cells"
SECTION_PLUGIN_ABSENT = "## Ungated conductor cells"
SECTION_MISSING = "## Missing cells"

NOISE_NOTE = (
    "At least one arm pair differs on a task while their per-repetition ranges "
    "overlap: those differences are within noise at three repetitions and are "
    "not separable."
)

PROCESS_METRIC_LABELS = (
    "schema retries",
    "review findings upheld",
    "overrides used",
    "stop kind",
)

FILE_REF_RE = re.compile(r"\{file:([^}]+)\}")

DEFAULT_BASE_CONFIG = {
    "$schema": "https://opencode.ai/config.json",
    "provider": {
        "llamacpp": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "llama.cpp (local router)",
            "options": {
                "apiKey": "local",
                "timeout": 1800000,
                "headerTimeout": 600000,
            },
            "models": {},
        }
    },
    "model": DEFAULT_MODEL,
    "small_model": DEFAULT_MODEL,
}


class BenchError(Exception):
    """A benchmark input or invariant the driver refuses to proceed past."""


class Cell(NamedTuple):
    """One (arm, task, repetition) triple: the unit of work and of reporting."""

    arm: str
    task_id: str
    rep: int

    @property
    def cell_id(self) -> str:
        return "%s/%s/r%d" % (self.arm, self.task_id, self.rep)


class Task(NamedTuple):
    """One manifest entry, with the JSON key names mapped onto python ones."""

    id: str
    language: str
    difficulty: str
    behavioral: bool
    rationale: str
    prompt: str
    seed_files: Dict[str, str]
    hidden_files: Dict[str, str]
    hidden_test_command: List[str]
    repo_test_command: List[str]
    behavioral_paths: List[str]
    run_timeout_sec: int


class Manifest(NamedTuple):
    version: int
    selection_criteria: Dict[str, Any]
    defaults: Dict[str, Any]
    tasks: List[Task]


class CommandOutcome(NamedTuple):
    """What a spawned command did, with every failure mode kept distinct."""

    exit_code: Optional[int]
    timed_out: bool
    spawn_error: Optional[str]
    wall_clock_ms: int


class CellInvocation(NamedTuple):
    """Everything a runner needs to execute one cell, and nothing more."""

    cell: Cell
    arm: str
    argv: List[str]
    work_dir: Path
    cell_dir: Path
    env: Dict[str, str]
    timeout_sec: float


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def load_manifest(path: Any) -> Manifest:
    """Parse and fully validate the task manifest at ``path``."""
    manifest_path = Path(path)
    try:
        raw = manifest_path.read_text()
    except OSError as exc:
        raise BenchError("cannot read the task manifest %s: %s" % (manifest_path, exc))
    try:
        document = json.loads(raw)
    except ValueError as exc:
        raise BenchError("%s is not valid JSON: %s" % (manifest_path, exc))
    if not isinstance(document, dict):
        raise BenchError("%s must hold a JSON object" % manifest_path)

    version = document.get("version")
    if version != 1:
        raise BenchError("%s: unsupported manifest version %r" % (manifest_path, version))

    criteria = document.get("selectionCriteria")
    if not isinstance(criteria, dict) or not criteria:
        raise BenchError(
            "%s: selectionCriteria must be a non-empty object stating why these "
            "tasks are the set" % manifest_path
        )

    defaults = document.get("defaults")
    if not isinstance(defaults, dict):
        raise BenchError("%s: defaults must be an object" % manifest_path)
    for key in ("model", "runTimeoutSec"):
        if key not in defaults:
            raise BenchError("%s: defaults is missing %r" % (manifest_path, key))
    default_timeout = defaults["runTimeoutSec"]
    if not isinstance(default_timeout, int) or isinstance(default_timeout, bool):
        raise BenchError("%s: defaults.runTimeoutSec must be an integer" % manifest_path)

    entries = document.get("tasks")
    if not isinstance(entries, list):
        raise BenchError("%s: tasks must be an array" % manifest_path)
    if len(entries) != EXPECTED_TASK_COUNT:
        raise BenchError(
            "%s: the POC set is exactly %d tasks, found %d"
            % (manifest_path, EXPECTED_TASK_COUNT, len(entries))
        )

    tasks: List[Task] = []
    seen: Dict[str, int] = {}
    for index, entry in enumerate(entries):
        task = _parse_task(entry, index, default_timeout)
        if task.id in seen:
            raise BenchError(
                "task %r appears twice (positions %d and %d): task ids must be unique"
                % (task.id, seen[task.id], index)
            )
        seen[task.id] = index
        tasks.append(task)

    return Manifest(
        version=version,
        selection_criteria=criteria,
        defaults=defaults,
        tasks=tasks,
    )


def load_tasks(path: Any) -> List[Task]:
    """The manifest's tasks, in manifest order."""
    return load_manifest(path).tasks


def _parse_task(entry: Any, index: int, default_timeout: int) -> Task:
    """One validated task record; every rejection names the task and the field."""
    if not isinstance(entry, dict):
        raise BenchError("task at position %d is not an object" % index)
    task_id = entry.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise BenchError("task at position %d has no usable id" % index)

    for key in TASK_REQUIRED_KEYS:
        if key not in entry:
            raise BenchError("task %r is missing the required field %r" % (task_id, key))

    language = entry["language"]
    if language not in LANGUAGES:
        raise BenchError(
            "task %r: field 'language' is %r, which is outside %s"
            % (task_id, language, ", ".join(LANGUAGES))
        )
    difficulty = entry["difficulty"]
    if difficulty not in DIFFICULTIES:
        raise BenchError(
            "task %r: field 'difficulty' is %r, which is outside %s"
            % (task_id, difficulty, ", ".join(DIFFICULTIES))
        )
    behavioral = entry["behavioral"]
    if not isinstance(behavioral, bool):
        raise BenchError("task %r: field 'behavioral' must be a boolean" % task_id)

    rationale = entry["rationale"]
    if not isinstance(rationale, str) or not rationale.strip():
        raise BenchError(
            "task %r: field 'rationale' must state why the task is in the set" % task_id
        )
    prompt = entry["prompt"]
    if not isinstance(prompt, str) or not prompt.strip():
        raise BenchError("task %r: field 'prompt' must be non-empty" % task_id)

    seed_files = _parse_file_map(entry["seedFiles"], task_id, "seedFiles")
    hidden_files = _parse_file_map(entry["hiddenFiles"], task_id, "hiddenFiles")
    overlap = sorted(set(seed_files) & set(hidden_files))
    if overlap:
        raise BenchError(
            "task %r: field 'hiddenFiles' overlaps seedFiles at %s - a hidden test "
            "the model can read measures nothing" % (task_id, ", ".join(overlap))
        )

    hidden_command = _parse_command(entry["hiddenTestCommand"], task_id, "hiddenTestCommand")
    repo_command = _parse_command(entry["repoTestCommand"], task_id, "repoTestCommand")

    behavioral_paths = entry["behavioralPaths"]
    if not isinstance(behavioral_paths, list) or not all(
        isinstance(item, str) for item in behavioral_paths
    ):
        raise BenchError("task %r: field 'behavioralPaths' must be a list of globs" % task_id)

    timeout = entry.get("runTimeoutSec", default_timeout)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout <= 0:
        raise BenchError("task %r: field 'runTimeoutSec' must be a positive integer" % task_id)

    return Task(
        id=task_id,
        language=language,
        difficulty=difficulty,
        behavioral=behavioral,
        rationale=rationale,
        prompt=prompt,
        seed_files=seed_files,
        hidden_files=hidden_files,
        hidden_test_command=list(hidden_command),
        repo_test_command=list(repo_command),
        behavioral_paths=list(behavioral_paths),
        run_timeout_sec=timeout,
    )


def _parse_file_map(value: Any, task_id: str, field: str) -> Dict[str, str]:
    """A repo-relative path -> content map that cannot escape the work tree."""
    if not isinstance(value, dict) or not value:
        raise BenchError("task %r: field %r must be a non-empty object" % (task_id, field))
    out: Dict[str, str] = {}
    for relpath in value:
        body = value[relpath]
        if not isinstance(relpath, str) or not relpath.strip():
            raise BenchError("task %r: field %r has an empty path" % (task_id, field))
        if not isinstance(body, str):
            raise BenchError(
                "task %r: field %r path %r must map to file text" % (task_id, field, relpath)
            )
        if os.path.isabs(relpath) or relpath.startswith("/"):
            raise BenchError(
                "task %r: field %r path %r is absolute; paths are repo-relative"
                % (task_id, field, relpath)
            )
        parts = Path(relpath).parts
        if ".." in parts:
            raise BenchError(
                "task %r: field %r path %r escapes the work tree" % (task_id, field, relpath)
            )
        out[relpath] = body
    return out


def _parse_command(value: Any, task_id: str, field: str) -> List[str]:
    """An argv LIST. A shell string here would need shell=True to run at all."""
    if not isinstance(value, list) or not value:
        raise BenchError(
            "task %r: field %r must be a non-empty argv list, not %r"
            % (task_id, field, value)
        )
    for token in value:
        if not isinstance(token, str):
            raise BenchError("task %r: field %r contains a non-string token" % (task_id, field))
    return [str(token) for token in value]


def command_is_spawnable(argv: Sequence[str]) -> bool:
    """Whether argv[0] would resolve, decided without starting anything."""
    if not argv:
        return False
    program = argv[0]
    if not program:
        return False
    if os.path.isabs(program):
        return os.path.isfile(program) and os.access(program, os.X_OK)
    if os.sep in program:
        return os.path.isfile(program) and os.access(program, os.X_OK)
    return shutil.which(program) is not None


def check_commands_spawnable(tasks: Sequence[Task]) -> List[str]:
    """One problem string per unspawnable command, naming task and command."""
    problems: List[str] = []
    for task in tasks:
        for field, argv in (
            ("hiddenTestCommand", task.hidden_test_command),
            ("repoTestCommand", task.repo_test_command),
        ):
            if not command_is_spawnable(argv):
                problems.append(
                    "task %r: %s %r cannot be spawned (argv[0] does not resolve)"
                    % (task.id, field, list(argv))
                )
    return problems


def seeded_paths(task: Task) -> List[str]:
    """Exactly the paths a cell's work tree starts with. Never a hidden path."""
    return sorted(task.seed_files)


# ---------------------------------------------------------------------------
# Arms
# ---------------------------------------------------------------------------


def router_base_url(router_config: Dict[str, Any]) -> str:
    """The router's own listen address in openai-compatible form.

    Never llama-server's upstream port: every arm must be measured through the
    same accounting path, which is the whole reason the router ledger is usable
    as the token source.
    """
    listen = router_config.get("listen")
    if not isinstance(listen, dict):
        raise BenchError("the router config has no listen block")
    host = listen.get("host")
    port = listen.get("port")
    if not isinstance(host, str) or not host:
        raise BenchError("the router config has no listen.host")
    if not isinstance(port, int) or isinstance(port, bool):
        raise BenchError("the router config has no integer listen.port")
    return conductor_wiring.openai_base_url(host, port)


def ledger_path_of(router_config: Dict[str, Any]) -> Path:
    """Where the router writes its per-request ledger."""
    metrics = router_config.get("metrics")
    if not isinstance(metrics, dict) or not isinstance(metrics.get("ledgerPath"), str):
        raise BenchError("the router config has no metrics.ledgerPath")
    return Path(metrics["ledgerPath"])


def build_doctrine_prompt(doctrine_dir: Any) -> str:
    """Every doctrine pack, verbatim, in sorted filename order.

    The roster comes from a directory listing, so a tenth pack joins the
    doctrine arm without a code change here.
    """
    directory = Path(doctrine_dir)
    packs = sorted(directory.glob("*.md"))
    if not packs:
        raise BenchError("no doctrine packs found under %s" % directory)
    chunks: List[str] = []
    for pack in packs:
        chunks.append("# %s\n\n%s\n" % (pack.name, pack.read_text()))
    return "\n".join(chunks)


def write_doctrine_prompt(cell_dir: Any, doctrine_dir: Any) -> Path:
    """Materialize the doctrine arm's single generated prompt file."""
    target = Path(cell_dir) / DOCTRINE_PROMPT_NAME
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(build_doctrine_prompt(doctrine_dir))
    return target


def build_arm_config(
    arm: str,
    model: str,
    router_config: Dict[str, Any],
    cell_dir: Any,
    base_config: Dict[str, Any],
) -> Dict[str, Any]:
    """The opencode config for one arm of one cell.

    The arms differ in exactly one thing: what process the model is running
    inside. Provider, base URL, model selection and every other key are built
    from the same code path so the experiment keeps its control.
    """
    if arm not in ARMS:
        raise BenchError(
            "unknown arm %r: the closed set is %s" % (arm, ", ".join(ARMS))
        )
    config = copy.deepcopy(dict(base_config))

    provider_id, _, model_name = model.partition("/")
    if not provider_id or not model_name:
        raise BenchError("model %r must be spelled '<provider>/<model>'" % model)
    providers = config.get("provider")
    if not isinstance(providers, dict) or not isinstance(providers.get(provider_id), dict):
        raise BenchError("the base opencode config has no provider %r" % provider_id)
    provider = providers[provider_id]

    options = provider.get("options")
    if not isinstance(options, dict):
        options = {}
        provider["options"] = options
    options["baseURL"] = router_base_url(router_config)

    models = provider.get("models")
    if isinstance(models, dict):
        provider["models"] = {model_name: copy.deepcopy(models.get(model_name) or {})}
    else:
        provider["models"] = [model_name]

    config["model"] = model
    config["small_model"] = model

    # C-012: the wire contract was verified against one opencode version, so a
    # ninety-run overnight may not update itself out from under the experiment.
    config["autoupdate"] = False

    if arm == "doctrine":
        prompt_path = Path(cell_dir) / DOCTRINE_PROMPT_NAME
        config["agent"] = {ARM_AGENTS["doctrine"]: {"prompt": "{file:%s}" % prompt_path}}
    elif arm == "conductor":
        fragment = conductor_wiring.substitute_harness_root(
            conductor_wiring.load_fragment(REPO_ROOT), REPO_ROOT
        )
        config = conductor_wiring.merge_opencode_fragment(config, fragment)

    return config


def build_opencode_argv(arm: str, model: str, work_dir: Any, prompt: str) -> List[str]:
    """The headless opencode invocation for one cell.

    Identical across arms except for the agent name, and the prompt is the
    trailing argument, so the model-facing surface is one string this driver
    took straight from the manifest.
    """
    if arm not in ARMS:
        raise BenchError("unknown arm %r: the closed set is %s" % (arm, ", ".join(ARMS)))
    if not os.path.isabs(str(work_dir)):
        raise BenchError(
            "the cell work tree %r must be absolute: opencode is launched with it "
            "as cwd and a relative path would resolve against the driver's own"
            % str(work_dir)
        )
    return [
        "opencode",
        "run",
        "--model",
        model,
        "--agent",
        ARM_AGENTS[arm],
        prompt,
    ]


def build_cell_env(cell_dir: Any, config_path: Any) -> Dict[str, str]:
    """The hermetic environment one cell runs in.

    Config, config home and test home are the verified triple; the state, data
    and cache homes are here so one cell's stale-red registry, quarantine and
    worktrees cannot reach the next cell's. Nothing is inherited from the user's
    own environment, so a developer's opencode state cannot enter a measurement.
    """
    cell = Path(cell_dir)
    home = cell / "home"
    return {
        "OPENCODE_CONFIG": str(Path(config_path)),
        "OPENCODE_TEST_HOME": str(home),
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / "config"),
        "XDG_STATE_HOME": str(home / "state"),
        "XDG_DATA_HOME": str(home / "data"),
        "XDG_CACHE_HOME": str(home / "cache"),
    }


def file_refs(config: Any) -> List[str]:
    """Every {file:...} path anywhere in a config, deduplicated, in order."""
    refs: List[str] = []
    for found in FILE_REF_RE.findall(json.dumps(config)):
        reference = found.strip()
        if reference not in refs:
            refs.append(reference)
    return refs


def validate_config_file_refs(config: Dict[str, Any]) -> None:
    """Refuse a config opencode would reject wholesale.

    opencode scans every config string for brace-file references and a dangling
    one is a hard config error, so the session never starts at all - which would
    silently kill every remaining cell of that arm.
    """
    missing: List[str] = []
    for reference in file_refs(config):
        if not os.path.isabs(reference) or not Path(reference).is_file():
            if reference not in missing:
                missing.append(reference)
    plugins = config.get("plugin")
    if isinstance(plugins, list):
        for entry in plugins:
            if not isinstance(entry, str):
                continue
            if not os.path.isabs(entry) or not Path(entry).is_file():
                if entry not in missing:
                    missing.append(entry)
    if missing:
        raise BenchError(
            "the generated opencode config names %d path(s) that do not exist: %s"
            % (len(missing), ", ".join(missing))
        )


# ---------------------------------------------------------------------------
# Run plan and cells
# ---------------------------------------------------------------------------


def build_run_plan(
    tasks: Sequence[Task], arms: Sequence[str] = ARMS, reps: int = DEFAULT_REPS
) -> List[Cell]:
    """Every cell, repetition-major and arm-interleaved.

    Truncating the plan at any prefix leaves the arms balanced to within one
    cell, so an overnight that dies half way through is still comparable.
    """
    if reps < 1:
        raise BenchError("reps must be at least 1, got %r" % reps)
    for arm in arms:
        if arm not in ARMS:
            raise BenchError("unknown arm %r: the closed set is %s" % (arm, ", ".join(ARMS)))
    plan: List[Cell] = []
    for rep in range(1, reps + 1):
        for task in tasks:
            for arm in arms:
                plan.append(Cell(arm, task.id, rep))
    return plan


def cell_dir_for(work_root: Any, cell: Cell) -> Path:
    """One directory per cell, shared by no other cell."""
    return Path(work_root) / cell.arm / cell.task_id / ("r%d" % cell.rep)


def materialize_files(root: Any, files: Dict[str, str]) -> List[Path]:
    """Write a path -> content map under root, creating parents."""
    base = Path(root)
    written: List[Path] = []
    for relpath in sorted(files):
        target = base / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(files[relpath])
        written.append(target)
    return written


def default_git_runner(argv: Sequence[str], cwd: Any) -> None:
    """Run one git command in a work tree, with no user config in scope."""
    env = dict(os.environ)
    env.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_SYSTEM": os.devnull,
            "GIT_AUTHOR_NAME": "conductor bench",
            "GIT_AUTHOR_EMAIL": "bench@localhost",
            "GIT_COMMITTER_NAME": "conductor bench",
            "GIT_COMMITTER_EMAIL": "bench@localhost",
        }
    )
    completed = subprocess.run(
        list(argv),
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        raise BenchError(
            "%s failed in %s: %s"
            % (" ".join(argv), cwd, completed.stderr.decode("utf-8", "replace").strip())
        )


def seed_cell(
    cell_dir: Any,
    task: Task,
    git_runner: Optional[Callable[[Sequence[str], Any], None]] = None,
    extra_files: Optional[Dict[str, str]] = None,
) -> Path:
    """A fresh work tree for one cell: seed files only, one clean commit.

    The tree is re-created rather than cleaned, so repetition two can never
    inherit repetition one's edits, and the single initial commit gives
    conductor the startHead and clean status it expects.
    """
    work = Path(cell_dir) / "repo"
    if work.exists():
        shutil.rmtree(str(work))
    work.mkdir(parents=True)
    materialize_files(work, task.seed_files)
    if extra_files:
        materialize_files(work, extra_files)
    runner = default_git_runner if git_runner is None else git_runner
    runner(["git", "init", "--quiet"], work)
    runner(["git", "add", "--force", "--all"], work)
    runner(["git", "commit", "--quiet", "--no-gpg-sign", "-m", SEED_COMMIT_MESSAGE], work)
    return work


def build_conductor_cell_config(task: Task) -> Dict[str, Any]:
    """The cell's .conductor/config.json, a pure function of the manifest task.

    First run asks two questions that have no default - git mode and the
    behavioral paths - and an unattended cell would block on both. Both are
    answered here from the manifest. The verify command is the task's VISIBLE
    runner: the hidden test is the measurement and never enters the repo the
    model can read.
    """
    command = list(task.repo_test_command)
    return {
        "version": 1,
        "verify": {
            "scopes": {
                "repo": {
                    "command": command,
                    "timeoutMs": task.run_timeout_sec * 1000,
                    "itemTest": command,
                }
            },
            "behavioralPaths": list(task.behavioral_paths),
            "requiredScopes": [],
        },
        "format": {"rules": []},
        "git": {"mode": "commit", "branchPolicy": "pin", "preexistingDirty": "refuse"},
        "workflow": {
            "trivialMaxFiles": 2,
            "planReviewers": 4,
            "planReviewMaxRounds": 3,
            "itemReviewers": 6,
            "skepticsPerFinding": 2,
            "reviewMaxRounds": 3,
            "vetCritics": 3,
            "vetMaxRounds": 3,
            "testRepairAttempts": 3,
            "debugFixCap": 3,
            "maxOverridesPerItem": 1,
            "maxOverridesPerRun": 2,
        },
        "parallel": {
            "writes": "off",
            "maxImplementers": 1,
            "maxReaders": 6,
            "subSessionTimeoutMs": 900000,
        },
        "models": {"default": "", "roles": {}},
        "ponytail": "full",
        "retention": {"keepRuns": 20, "maxRunDirBytes": 52428800, "pruneOnRunCreate": True},
        "logging": {"level": "info", "components": {}},
    }


def run_command(
    argv: Sequence[str],
    cwd: Any,
    timeout_sec: float,
    env: Optional[Dict[str, str]] = None,
    log_path: Optional[Any] = None,
) -> CommandOutcome:
    """Spawn argv under a wall clock, killing the whole process group on expiry.

    opencode spawns children, so terminating the direct child alone leaves them
    running and the next cell inherits a machine that is still busy.
    """
    started = time.time()
    handle = None
    if log_path is not None:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        handle = open(str(log_path), "ab")
    sink = handle if handle is not None else subprocess.DEVNULL
    try:
        try:
            process = subprocess.Popen(
                list(argv),
                cwd=str(cwd),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=sink,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except OSError as exc:
            return CommandOutcome(None, False, str(exc), _elapsed_ms(started))
        try:
            process.wait(timeout=timeout_sec)
            return CommandOutcome(process.returncode, False, None, _elapsed_ms(started))
        except subprocess.TimeoutExpired:
            _kill_process_group(process)
            return CommandOutcome(None, True, None, _elapsed_ms(started))
    finally:
        if handle is not None:
            handle.close()


def _elapsed_ms(started: float) -> int:
    return int(round((time.time() - started) * 1000.0))


def _kill_process_group(process: "subprocess.Popen") -> None:
    """SIGKILL the spawned session, then reap the direct child."""
    try:
        group = os.getpgid(process.pid)
    except OSError:
        group = None
    if group is not None:
        try:
            os.killpg(group, signal.SIGKILL)
        except OSError:
            process.kill()
    else:
        process.kill()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def default_test_runner(argv: Sequence[str], cwd: Any, timeout_sec: float) -> CommandOutcome:
    """Run a hidden or visible test command in a work tree."""
    return run_command(argv, cwd, timeout_sec)


def default_cell_invocation_runner(invocation: CellInvocation) -> CommandOutcome:
    """Run opencode for one cell, hermetically, with its transcript kept."""
    return run_command(
        invocation.argv,
        invocation.work_dir,
        invocation.timeout_sec,
        env=invocation.env,
        log_path=Path(invocation.cell_dir) / "opencode.log",
    )


def score_cell(
    exit_code: Optional[int], timed_out: bool, spawn_error: Optional[str]
) -> Dict[str, Any]:
    """The hidden test's exit status, passed through and nothing else.

    A spawn failure is the harness failing, never the model failing, so it is
    kept out of the fail bucket even when an exit code happens to be present.
    """
    if spawn_error:
        return {"passed": False, "outcome": "harness-error", "exitCode": exit_code}
    if timed_out:
        return {"passed": False, "outcome": "timeout", "exitCode": exit_code}
    if exit_code == 0:
        return {"passed": True, "outcome": "pass", "exitCode": 0}
    return {"passed": False, "outcome": "fail", "exitCode": exit_code}


def run_cell(
    cell: Cell,
    task: Task,
    cell_dir: Any,
    model: str,
    router_config: Dict[str, Any],
    base_config: Dict[str, Any],
    timeout_sec: float,
    runner: Optional[Callable[[CellInvocation], CommandOutcome]] = None,
    test_runner: Optional[Callable[[Sequence[str], Any, float], CommandOutcome]] = None,
    git_runner: Optional[Callable[[Sequence[str], Any], None]] = None,
) -> Dict[str, Any]:
    """Execute one cell end to end and return its pinned result record.

    The hidden files are materialized only after opencode has exited, so no
    ordering accident can put the measurement inside the tree the model reads.
    """
    directory = Path(cell_dir)
    directory.mkdir(parents=True, exist_ok=True)

    extra: Optional[Dict[str, str]] = None
    if cell.arm == "conductor":
        extra = {
            ".conductor/config.json": json.dumps(
                build_conductor_cell_config(task), indent=2
            )
            + "\n"
        }
    work = seed_cell(directory, task, git_runner=git_runner, extra_files=extra)

    if cell.arm == "doctrine":
        write_doctrine_prompt(directory, DOCTRINE_DIR)
    config = build_arm_config(
        cell.arm,
        model=model,
        router_config=router_config,
        cell_dir=directory,
        base_config=base_config,
    )
    validate_config_file_refs(config)
    config_path = directory / ("%s.json" % cell.arm)
    config_path.write_text(json.dumps(config, indent=2) + "\n")

    env = build_cell_env(directory, config_path)
    for key in ("HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"):
        Path(env[key]).mkdir(parents=True, exist_ok=True)

    ledger = ledger_path_of(router_config)
    ledger_before = ledger_line_count(ledger)

    argv = build_opencode_argv(cell.arm, model=model, work_dir=work, prompt=task.prompt)
    invocation = CellInvocation(
        cell=cell,
        arm=cell.arm,
        argv=argv,
        work_dir=work,
        cell_dir=directory,
        env=env,
        timeout_sec=timeout_sec,
    )
    started_iso = utc_now_iso()
    run_outcome = (default_cell_invocation_runner if runner is None else runner)(invocation)
    wall_clock_ms = run_outcome.wall_clock_ms

    if run_outcome.timed_out or run_outcome.spawn_error:
        score = score_cell(run_outcome.exit_code, run_outcome.timed_out, run_outcome.spawn_error)
    else:
        materialize_files(work, task.hidden_files)
        tester = default_test_runner if test_runner is None else test_runner
        test_outcome = tester(list(task.hidden_test_command), work, timeout_sec)
        wall_clock_ms += test_outcome.wall_clock_ms
        score = score_cell(
            test_outcome.exit_code, test_outcome.timed_out, test_outcome.spawn_error
        )

    window = summarize_ledger_window(ledger, ledger_before)
    metrics = collect_metrics(cell.arm, work)

    result = {
        "cellId": cell.cell_id,
        "arm": cell.arm,
        "taskId": cell.task_id,
        "rep": cell.rep,
        "startedIso": started_iso,
        "outcome": score["outcome"],
        "passed": score["passed"],
        "exitCode": score["exitCode"],
        "wallClockMs": wall_clock_ms,
        "tokens": {
            "prompt": window["prompt"],
            "completion": window["completion"],
            "total": window["total"],
            "partial": window["partial"],
        },
        "routerErrors": window["routerErrors"],
        "schemaRetries": metrics["schemaRetries"],
        "reviewFindingsUpheld": metrics["reviewFindingsUpheld"],
        "overridesUsed": metrics["overridesUsed"],
        "stopKind": metrics["stopKind"],
        "pluginAbsent": metrics["pluginAbsent"],
    }
    validate_result(result)
    return result


def utc_now_iso() -> str:
    """Now, in the same Z-suffixed shape the run records use."""
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


def result_path(results_dir: Any, cell: Cell) -> Path:
    """One file per cell, named for the cell. One writer, one file."""
    return Path(results_dir) / ("%s__%s__r%d.json" % (cell.arm, cell.task_id, cell.rep))


def validate_result(result: Any) -> None:
    """Every pinned key present; inapplicability spelled null, never omitted."""
    if not isinstance(result, dict):
        raise BenchError("a cell result must be an object")
    for key in RESULT_KEYS:
        if key not in result:
            raise BenchError("cell result is missing the field %r" % key)
    tokens = result["tokens"]
    if not isinstance(tokens, dict):
        raise BenchError("cell result field 'tokens' must be an object")
    for key in TOKEN_KEYS:
        if key not in tokens:
            raise BenchError("cell result is missing the field 'tokens.%s'" % key)
    if result["outcome"] not in OUTCOMES:
        raise BenchError(
            "cell result field 'outcome' is %r, which is outside %s"
            % (result["outcome"], ", ".join(OUTCOMES))
        )
    stop_kind = result["stopKind"]
    if stop_kind is not None and stop_kind not in STOP_KINDS + TERMINAL_RUN_STATES:
        raise BenchError(
            "cell result field 'stopKind' is %r, which is outside the closed stop "
            "vocabulary %s and the terminal run states %s"
            % (stop_kind, ", ".join(STOP_KINDS), ", ".join(TERMINAL_RUN_STATES))
        )
    if not isinstance(result["passed"], bool):
        raise BenchError("cell result field 'passed' must be a boolean")


def write_result(results_dir: Any, result: Dict[str, Any]) -> Path:
    """Write one validated cell result the moment its cell finishes."""
    validate_result(result)
    directory = Path(results_dir)
    directory.mkdir(parents=True, exist_ok=True)
    cell = Cell(result["arm"], result["taskId"], result["rep"])
    target = result_path(directory, cell)
    target.write_text(json.dumps(result, indent=2) + "\n")
    return target


def load_results(results_dir: Any) -> List[Dict[str, Any]]:
    """Every recorded cell result, in filename order."""
    directory = Path(results_dir)
    if not directory.is_dir():
        return []
    rows: List[Dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            raise BenchError("cannot read the cell result %s: %s" % (path, exc))
        validate_result(row)
        rows.append(row)
    return rows


def ledger_line_count(ledger_path: Any) -> int:
    """How many lines the router ledger holds right now; 0 when unreadable."""
    try:
        with open(str(ledger_path), "r") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def summarize_ledger_window(ledger_path: Any, start_line: int) -> Dict[str, Any]:
    """Token totals and infrastructure failures over one cell's ledger window.

    A hole anywhere in the window sets partial rather than quietly lowering the
    total, and a non-2xx line is counted as a router error rather than averaged
    into a model result.
    """
    try:
        with open(str(ledger_path), "r") as handle:
            lines = handle.readlines()
    except OSError:
        return {
            "prompt": None,
            "completion": None,
            "total": None,
            "partial": True,
            "routerErrors": 0,
        }

    window = lines[start_line:]
    prompt = 0
    completion = 0
    partial = not window
    router_errors = 0
    for line in window:
        text = line.strip()
        if not text:
            continue
        try:
            record = json.loads(text)
        except ValueError:
            partial = True
            continue
        if not isinstance(record, dict):
            partial = True
            continue
        status = record.get("status")
        if isinstance(status, int) and not isinstance(status, bool):
            if status < 200 or status >= 300:
                router_errors += 1
        prompt_tokens = record.get("promptTokens")
        if isinstance(prompt_tokens, int) and not isinstance(prompt_tokens, bool):
            prompt += prompt_tokens
        else:
            partial = True
        completion_tokens = record.get("completionTokens")
        if isinstance(completion_tokens, int) and not isinstance(completion_tokens, bool):
            completion += completion_tokens
        else:
            partial = True

    return {
        "prompt": prompt,
        "completion": completion,
        "total": prompt + completion,
        "partial": partial,
        "routerErrors": router_errors,
    }


# ---------------------------------------------------------------------------
# Process metrics
# ---------------------------------------------------------------------------


def collect_metrics(arm: str, work_dir: Any) -> Dict[str, Any]:
    """The four conductor-only metrics, or null for the arms that cannot have them.

    baseline and doctrine ran no plugin, so these are structurally inapplicable
    rather than zero, and this function does not go looking for a run directory
    for them.
    """
    if arm != "conductor":
        return {
            "schemaRetries": None,
            "reviewFindingsUpheld": None,
            "overridesUsed": None,
            "stopKind": None,
            "pluginAbsent": None,
        }
    return collect_conductor_metrics(work_dir)


def collect_conductor_metrics(work_dir: Any) -> Dict[str, Any]:
    """Read the plugin's own record of the run; recompute nothing it wrote.

    A conductor cell with no run directory at all is the ungated case: the
    session looked completely normal and nothing gated it, which is a fact about
    the harness rather than a model result.
    """
    run_dir = newest_run_dir(work_dir)
    if run_dir is None:
        return {
            "schemaRetries": None,
            "reviewFindingsUpheld": None,
            "overridesUsed": None,
            "stopKind": None,
            "pluginAbsent": True,
        }
    return {
        "schemaRetries": _count_schema_retries(run_dir / "journal.jsonl"),
        "reviewFindingsUpheld": _count_upheld_findings(run_dir / "reviews"),
        "overridesUsed": _read_overrides_used(run_dir / "run.json"),
        "stopKind": _read_stop_kind(run_dir / "run.json"),
        "pluginAbsent": False,
    }


def newest_run_dir(work_dir: Any) -> Optional[Path]:
    """The most recently written run directory, or None when none exists."""
    runs = Path(work_dir) / ".conductor" / "runs"
    if not runs.is_dir():
        return None
    candidates = [child for child in runs.iterdir() if child.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda child: child.stat().st_mtime)


def _count_schema_retries(journal_path: Path) -> int:
    """fanout's subsession.retry lines: the only schema retry in the system."""
    count = 0
    try:
        text = journal_path.read_text()
    except OSError:
        return 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            entry = json.loads(stripped)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        if entry.get("component") == "fanout" and entry.get("event") == "subsession.retry":
            count += 1
    return count


def _count_upheld_findings(reviews_dir: Path) -> int:
    """Upheld verdicts across every review file this run wrote."""
    if not reviews_dir.is_dir():
        return 0
    total = 0
    for path in sorted(reviews_dir.glob("*.json")):
        try:
            document = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(document, dict):
            continue
        verdicts = document.get("verdicts")
        if not isinstance(verdicts, list):
            continue
        for verdict in verdicts:
            if isinstance(verdict, dict) and verdict.get("upheld") is True:
                total += 1
    return total


def _read_run_json(run_json_path: Path) -> Dict[str, Any]:
    try:
        document = json.loads(run_json_path.read_text())
    except (OSError, ValueError):
        return {}
    return document if isinstance(document, dict) else {}


def _read_overrides_used(run_json_path: Path) -> Optional[int]:
    """run.json's own counter, never a second derivation of the same fact."""
    counters = _read_run_json(run_json_path).get("counters")
    if not isinstance(counters, dict):
        return None
    value = counters.get("overridesUsed")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _read_stop_kind(run_json_path: Path) -> Optional[str]:
    """The recorded stop, or the terminal state when the run ended without one."""
    document = _read_run_json(run_json_path)
    stop = document.get("stop")
    if isinstance(stop, dict) and isinstance(stop.get("kind"), str):
        return stop["kind"]
    state = document.get("state")
    if isinstance(state, str) and state in TERMINAL_RUN_STATES:
        return state
    return None


# ---------------------------------------------------------------------------
# Aggregation and report
# ---------------------------------------------------------------------------


def median_int(values: Sequence[int]) -> int:
    """Integer median; 0 over an empty set, which no caller reports as a datum."""
    ordered = sorted(values)
    count = len(ordered)
    if count == 0:
        return 0
    if count % 2:
        return ordered[count // 2]
    return (ordered[count // 2 - 1] + ordered[count // 2]) // 2


def within_noise(group_a: Dict[str, Any], group_b: Dict[str, Any]) -> bool:
    """Whether two groups' per-repetition pass ranges overlap at all."""
    return not (
        group_a["maxPass"] < group_b["minPass"] or group_b["maxPass"] < group_a["minPass"]
    )


def aggregate(
    results: Sequence[Dict[str, Any]],
    tasks: Sequence[Task],
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
) -> Dict[str, Any]:
    """Per-(arm, task) spread and per-arm totals over RECORDED cells only.

    Missing cells are named rather than counted either way, and a conductor cell
    that ran ungated leaves both the numerator and the denominator.
    """
    by_id: Dict[str, Dict[str, Any]] = {}
    for row in results:
        by_id[row["cellId"]] = row

    task_ids = [task.id for task in tasks]
    groups: Dict[str, Dict[str, Any]] = {}
    arm_totals: Dict[str, Any] = {}
    missing: List[str] = []

    for arm in arms:
        groups[arm] = {}
        arm_walls: List[int] = []
        totals = {
            "passes": 0,
            "recorded": 0,
            "planned": 0,
            "excluded": 0,
            "perTaskPasses": {},
            "routerErrorCells": [],
            "excludedPluginAbsent": [],
            "tokensTotal": 0,
            "tokensPartial": False,
        }
        metric_values: Dict[str, List[int]] = {
            "schemaRetries": [],
            "reviewFindingsUpheld": [],
            "overridesUsed": [],
        }
        stop_kinds: List[str] = []

        for task_id in task_ids:
            passes = 0
            recorded = 0
            excluded = 0
            outcomes: List[str] = []
            walls: List[int] = []
            for rep in range(1, reps + 1):
                cell_id = Cell(arm, task_id, rep).cell_id
                row = by_id.get(cell_id)
                if row is None:
                    missing.append(cell_id)
                    continue
                if row.get("routerErrors"):
                    totals["routerErrorCells"].append(cell_id)
                if row.get("pluginAbsent") is True:
                    excluded += 1
                    totals["excludedPluginAbsent"].append(cell_id)
                    continue
                recorded += 1
                outcomes.append(row["outcome"])
                walls.append(row["wallClockMs"])
                if row["passed"]:
                    passes += 1
                tokens = row.get("tokens") or {}
                if isinstance(tokens.get("total"), int) and not isinstance(
                    tokens.get("total"), bool
                ):
                    totals["tokensTotal"] += tokens["total"]
                if tokens.get("partial"):
                    totals["tokensPartial"] = True
                for key in metric_values:
                    value = row.get(key)
                    if isinstance(value, int) and not isinstance(value, bool):
                        metric_values[key].append(value)
                if isinstance(row.get("stopKind"), str):
                    stop_kinds.append(row["stopKind"])

            flags = [1 if outcome == "pass" else 0 for outcome in outcomes]
            groups[arm][task_id] = {
                "passes": passes,
                "recorded": recorded,
                "planned": reps,
                "excluded": excluded,
                "outcomes": outcomes,
                "minPass": min(flags) if flags else 0,
                "maxPass": max(flags) if flags else 0,
                "wallClockMsTotal": sum(walls),
                "wallClockMsMedian": median_int(walls),
            }
            totals["passes"] += passes
            totals["recorded"] += recorded
            totals["planned"] += reps
            totals["excluded"] += excluded
            totals["perTaskPasses"][task_id] = passes
            arm_walls.extend(walls)

        totals["wallClockMsTotal"] = sum(arm_walls)
        totals["wallClockMsMedian"] = median_int(arm_walls)
        totals["metrics"] = dict(
            (key, sum(values) if values else None) for key, values in metric_values.items()
        )
        totals["stopKinds"] = stop_kinds
        arm_totals[arm] = totals

    return {
        "groups": groups,
        "armTotals": arm_totals,
        "missingCells": missing,
        "arms": list(arms),
        "taskIds": task_ids,
        "reps": reps,
    }


def format_rate(passes: int, recorded: int) -> str:
    return "%d/%d" % (passes, recorded)


def format_recorded(recorded: int, planned: int) -> str:
    return "%d of %d recorded" % (recorded, planned)


def format_outcomes(outcomes: Sequence[str]) -> str:
    return " ".join(outcomes) if outcomes else "none recorded"


def format_ms(milliseconds: int) -> str:
    return "%d ms" % milliseconds


def format_tokens(total: int, partial: bool) -> str:
    return "%d %s" % (total, PARTIAL_MARKER) if partial else "%d" % total


def format_metric(value: Any) -> str:
    return NA if value is None else str(value)


def _format_stop_kinds(stop_kinds: Sequence[str]) -> str:
    if not stop_kinds:
        return NA
    counts: Dict[str, int] = {}
    for kind in stop_kinds:
        counts[kind] = counts.get(kind, 0) + 1
    return ", ".join("%s %d" % (kind, counts[kind]) for kind in sorted(counts))


def render_report(
    results: Sequence[Dict[str, Any]],
    tasks: Sequence[Task],
    model: str,
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
) -> str:
    """The markdown report: per-task spread first, comparison only after it.

    A bare aggregate delta over ten tasks and three repetitions is exactly the
    number this benchmark exists not to produce, so every arm-level line lives
    below the table that shows what it is made of.
    """
    agg = aggregate(results, tasks, arms=arms, reps=reps)
    task_ids = agg["taskIds"]
    groups = agg["groups"]
    totals = agg["armTotals"]
    lines: List[str] = ["# Conductor three-arm benchmark", ""]

    lines.append(SECTION_METHOD)
    lines.append("")
    lines.append("- Model: `%s`. Every arm ran that one model." % model)
    lines.append("- Repetitions: %d per (arm, task) cell." % reps)
    lines.append(
        "- Arms: `baseline` is plain opencode; `doctrine` is plain opencode with "
        "every doctrine pack injected as one prompt file; `conductor` is the "
        "plugin loaded from the committed opencode fragment."
    )
    lines.append(
        "- Every arm issued every request through the llama-router listen address, "
        "so token accounting is uniform across arms."
    )
    lines.append(
        "- Scoring is the hidden test command's exit status, passed through. No "
        "partial credit, no output parsing, nothing model-graded."
    )
    lines.append(
        "- The baseline and doctrine arms ran no plugin, so the four process "
        "metrics below are structurally unavailable for them and render as %s "
        "rather than zero." % NA
    )
    lines.append("")

    lines.append(SECTION_PER_TASK)
    lines.append("")
    for arm in arms:
        lines.append(
            "- %s: %s" % (arm, format_recorded(totals[arm]["recorded"], totals[arm]["planned"]))
        )
    lines.append("")
    lines.append("| Task | %s |" % " | ".join(arms))
    lines.append("|---|%s" % ("---|" * len(arms)))
    for task_id in task_ids:
        cells: List[str] = []
        for arm in arms:
            group = groups[arm][task_id]
            text = "%s (%s)" % (
                format_rate(group["passes"], group["recorded"]),
                format_outcomes(group["outcomes"]),
            )
            if group["recorded"] != group["planned"]:
                text += " %s" % format_recorded(group["recorded"], group["planned"])
            cells.append(text)
        lines.append("| %s | %s |" % (task_id, " | ".join(cells)))
    lines.append("")

    if len(arms) > 1:
        lines.append(SECTION_ARM_TOTALS)
        lines.append("")
        lines.append(
            "Read every line here against the per-task table above; none of it "
            "stands on its own."
        )
        for arm in arms:
            total = totals[arm]
            lines.append(
                "- %s: %s over %s"
                % (
                    arm,
                    format_rate(total["passes"], total["recorded"]),
                    format_recorded(total["recorded"], total["planned"]),
                )
            )
        if _has_overlapping_pair(groups, task_ids, arms):
            lines.append("")
            lines.append(NOISE_NOTE)
        lines.append("")

    lines.append(SECTION_COST)
    lines.append("")
    lines.append("| Arm | total wall clock | median cell wall clock | total tokens |")
    lines.append("|---|---|---|---|")
    for arm in arms:
        total = totals[arm]
        lines.append(
            "| %s | %s | %s | %s |"
            % (
                arm,
                format_ms(total["wallClockMsTotal"]),
                format_ms(total["wallClockMsMedian"]),
                format_tokens(total["tokensTotal"], total["tokensPartial"]),
            )
        )
    lines.append("")
    lines.append("| Task | Arm | total wall clock | median cell wall clock |")
    lines.append("|---|---|---|---|")
    for task_id in task_ids:
        for arm in arms:
            group = groups[arm][task_id]
            lines.append(
                "| %s | %s | %s | %s |"
                % (
                    task_id,
                    arm,
                    format_ms(group["wallClockMsTotal"]),
                    format_ms(group["wallClockMsMedian"]),
                )
            )
    lines.append("")

    lines.append(SECTION_PROCESS)
    lines.append("")
    lines.append("| Arm | %s |" % " | ".join(PROCESS_METRIC_LABELS))
    lines.append("|---|%s" % ("---|" * len(PROCESS_METRIC_LABELS)))
    for arm in arms:
        total = totals[arm]
        lines.append(
            "| %s | %s | %s | %s | %s |"
            % (
                arm,
                format_metric(total["metrics"]["schemaRetries"]),
                format_metric(total["metrics"]["reviewFindingsUpheld"]),
                format_metric(total["metrics"]["overridesUsed"]),
                _format_stop_kinds(total["stopKinds"]),
            )
        )
    lines.append("")

    lines.append(SECTION_ROUTER_ERRORS)
    lines.append("")
    router_cells: List[str] = []
    for arm in arms:
        router_cells.extend(totals[arm]["routerErrorCells"])
    lines.append(
        "%d cell(s) saw a non-2xx router response. Their pass or fail is recorded "
        "but the infrastructure failure is named here rather than averaged in."
        % len(router_cells)
    )
    for cell_id in router_cells:
        lines.append("- %s" % cell_id)
    lines.append("")

    lines.append(SECTION_PLUGIN_ABSENT)
    lines.append("")
    absent: List[str] = []
    for arm in arms:
        absent.extend(totals[arm]["excludedPluginAbsent"])
    lines.append(
        "%d conductor cell(s) produced no run directory: the plugin never gated "
        "them, so they are excluded from both the numerator and the denominator "
        "of that arm." % len(absent)
    )
    for cell_id in absent:
        lines.append("- %s" % cell_id)
    lines.append("")

    lines.append(SECTION_MISSING)
    lines.append("")
    lines.append(
        "%d planned cell(s) have no recorded result. They are counted neither as "
        "passes nor as failures." % len(agg["missingCells"])
    )
    for cell_id in agg["missingCells"]:
        lines.append("- %s" % cell_id)
    lines.append("")

    return "\n".join(lines)


def _has_overlapping_pair(
    groups: Dict[str, Any], task_ids: Sequence[str], arms: Sequence[str]
) -> bool:
    """Whether any two arms differ on a task while their ranges still overlap."""
    for task_id in task_ids:
        for first in range(len(arms)):
            for second in range(first + 1, len(arms)):
                left = groups[arms[first]][task_id]
                right = groups[arms[second]][task_id]
                if left["passes"] == right["passes"]:
                    continue
                if within_noise(left, right):
                    return True
    return False


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def make_cell_runner(
    model: str,
    router_config: Dict[str, Any],
    base_config: Dict[str, Any],
) -> Callable[[Cell, Task, Any], Dict[str, Any]]:
    """The live cell runner: one closure over the run-wide settings."""

    def runner(cell: Cell, task: Task, cell_dir: Any) -> Dict[str, Any]:
        return run_cell(
            cell,
            task,
            cell_dir=cell_dir,
            model=model,
            router_config=router_config,
            base_config=base_config,
            timeout_sec=task.run_timeout_sec,
        )

    return runner


def run_benchmark(
    tasks: Sequence[Task],
    results_dir: Any,
    report_path: Any,
    work_root: Any,
    model: str,
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    report_only: bool = False,
    cell_runner: Optional[Callable[[Cell, Task, Any], Dict[str, Any]]] = None,
    router_config: Optional[Dict[str, Any]] = None,
    base_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute the plan, skipping cells already on disk, then write the report.

    A cell whose result file exists is reused verbatim and its work tree is not
    even re-created, so an overnight that dies resumes where it stopped.
    """
    results_path = Path(results_dir)
    report = Path(report_path)
    root = Path(work_root)
    plan = build_run_plan(tasks, arms=arms, reps=reps)
    by_task = dict((task.id, task) for task in tasks)

    executed: List[str] = []
    skipped: List[str] = []
    rows: List[Dict[str, Any]] = []

    if report_only:
        rows = load_results(results_path)
    else:
        runner = cell_runner
        if runner is None:
            runner = make_cell_runner(
                model=model,
                router_config=router_config
                if router_config is not None
                else load_router_config(ROUTER_CONFIG_PATH),
                base_config=base_config if base_config is not None else DEFAULT_BASE_CONFIG,
            )
        for cell in plan:
            recorded = result_path(results_path, cell)
            if recorded.is_file():
                skipped.append(cell.cell_id)
                rows.append(json.loads(recorded.read_text()))
                continue
            row = runner(cell, by_task[cell.task_id], cell_dir_for(root, cell))
            write_result(results_path, row)
            executed.append(cell.cell_id)
            rows.append(row)

    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(render_report(rows, tasks, model=model, arms=arms, reps=reps))
    return {
        "results": rows,
        "skipped": skipped,
        "executed": executed,
        "reportPath": report,
    }


def verify_tasks(
    tasks: Sequence[Task],
    work_root: Any,
    timeout_sec: float = DEFAULT_TIMEOUT_SEC,
    test_runner: Optional[Callable[[Sequence[str], Any, float], CommandOutcome]] = None,
) -> Dict[str, Any]:
    """Prove every hidden test FAILS on its unmodified seed.

    A hidden test that already passes on the seed measures nothing: every arm
    would score it, and the task would silently inflate all three.
    """
    runner = default_test_runner if test_runner is None else test_runner
    exit_codes: Dict[str, int] = {}
    passed_unmodified: List[str] = []
    for task in tasks:
        scratch = Path(work_root) / task.id
        if scratch.exists():
            shutil.rmtree(str(scratch))
        scratch.mkdir(parents=True)
        materialize_files(scratch, task.seed_files)
        materialize_files(scratch, task.hidden_files)
        outcome = runner(list(task.hidden_test_command), scratch, timeout_sec)
        code = outcome.exit_code if outcome.exit_code is not None else -1
        exit_codes[task.id] = code
        if code == 0:
            passed_unmodified.append(task.id)
    return {
        "ok": not passed_unmodified,
        "passedUnmodified": passed_unmodified,
        "exitCodes": exit_codes,
    }


def load_router_config(path: Any) -> Dict[str, Any]:
    """The router config this run's arms are pointed at."""
    config_path = Path(path)
    try:
        document = json.loads(config_path.read_text())
    except (OSError, ValueError) as exc:
        raise BenchError("cannot read the router config %s: %s" % (config_path, exc))
    if not isinstance(document, dict):
        raise BenchError("%s must hold a JSON object" % config_path)
    return document


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="conductor_bench.py",
        description="Run the three-arm conductor benchmark, or check its task set.",
    )
    parser.add_argument("--manifest", default=str(MANIFEST_PATH))
    parser.add_argument("--verify-tasks", action="store_true", dest="verify_tasks")
    parser.add_argument("--report-only", action="store_true", dest="report_only")
    parser.add_argument("--work-root", default=str(WORK_ROOT), dest="work_root")
    parser.add_argument("--results-dir", default=str(RESULTS_DIR), dest="results_dir")
    parser.add_argument("--report", default=str(REPORT_PATH))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--reps", type=int, default=DEFAULT_REPS)
    parser.add_argument("--router-config", default=str(ROUTER_CONFIG_PATH), dest="router_config")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """The command line: --verify-tasks, --report-only, or the full run."""
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        tasks = load_tasks(Path(args.manifest))
    except BenchError as exc:
        print("bench: %s" % exc)
        return 2

    problems = check_commands_spawnable(tasks)
    if problems:
        for problem in problems:
            print("bench: %s" % problem)
        return 2

    if args.verify_tasks:
        report = verify_tasks(tasks, work_root=Path(args.work_root))
        for task in tasks:
            print(
                "%s: hidden test exited %d on the unmodified seed"
                % (task.id, report["exitCodes"][task.id])
            )
        if report["ok"]:
            print("every hidden test failed on its unmodified seed")
            return 0
        print(
            "these tasks measure nothing, their hidden test passed unmodified: %s"
            % ", ".join(report["passedUnmodified"])
        )
        return 1

    try:
        router_config = load_router_config(Path(args.router_config))
    except BenchError as exc:
        print("bench: %s" % exc)
        return 2

    outcome = run_benchmark(
        tasks,
        results_dir=Path(args.results_dir),
        report_path=Path(args.report),
        work_root=Path(args.work_root),
        model=args.model,
        reps=args.reps,
        report_only=args.report_only,
        router_config=router_config,
    )
    print(
        "cells executed %d, reused %d, recorded %d; report at %s"
        % (
            len(outcome["executed"]),
            len(outcome["skipped"]),
            len(outcome["results"]),
            outcome["reportPath"],
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
