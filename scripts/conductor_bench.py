#!/usr/bin/env python3
"""The three-arm conductor benchmark driver.

Three arms - plain opencode, opencode carrying the doctrine packs, and opencode
carrying the conductor plugin - run the same task set through the same router,
several times each. A cell is one (model, capability, arm, task, repetition)
point of that matrix. This module owns the manifest, the arm construction, the
run plan, one result file per cell, the run manifest that records the campaign's
own design, and the report. The live runs themselves are somebody else's job.

The tasks are a scope ladder: T0 stays inside the plugin's own triviality bound
and measures the cost floor, and each tier above it reaches further into the
process under test. That matters because a comparison runnable only on work
below the system's triviality threshold cannot answer whether the system helps.

The pure parts (manifest load, arm construction, run plan, ledger window,
scoring, aggregation, report) touch no process and no filesystem, which is what
makes them unit-testable offline. Everything that spawns or writes is a thin
layer over them and is injectable, so the suite drives the driver without ever
starting opencode, llama-server, llama-router or a model.

Scoring is the hidden test command's exit status, passed through. There is no
partial credit and nothing model-graded anywhere in this file. Beside it rides
a hand-scored rubric lane, which is the only thing here that reads a judgement,
and it is entered by a person rather than derived.
"""

from __future__ import annotations

import argparse
import difflib
import copy
import fnmatch
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import conductor_wiring

REPO_ROOT = Path(__file__).resolve().parent.parent

# ISSUE-107: the cell environment is hermetic in its opencode STATE (home dirs),
# not in its executable search path. Omitting PATH left a bare `opencode` (and
# `git`) unresolvable against os.defpath, so every cell spawn-failed. The cell
# runs with THIS PATH, and the spawnability preflight resolves argv[0] against
# the SAME value, so an approved command is one the cell can actually launch.
CELL_PATH = os.environ.get("PATH") or os.defpath

# Beside - never on top of - the model benchmark's own report.md and its
# per-model directories, which are gitignored and unrecoverable.
BENCH_DIR = REPO_ROOT / ".data" / "benchmark"
REPORT_PATH = BENCH_DIR / "conductor-report.md"
RESULTS_DIR = BENCH_DIR / "conductor" / "runs"
RUBRIC_DIR = BENCH_DIR / "conductor" / "rubrics"
# The cell work trees sit outside the repository on purpose. A cell's cwd is
# <work_root>/<model>/<capability>/<arm>/<task>/rN/repo, so a work root under
# this repository puts every answer key the campaign grades against - the
# bench/corpus/**/hidden/** trees - a constant number of `..` segments away from
# every cell. The driver materializes the hidden files only after opencode has
# exited so the measurement is never inside the tree the model reads; a
# relative path around that ordering would defeat it. Outside the repository,
# an arm that walks up out of its own tree finds other cells' work trees.
WORK_ROOT = Path(tempfile.gettempdir()) / "llama-harness-conductor-work"
RUN_MANIFEST_PATH = BENCH_DIR / "conductor-run-manifest.json"

MANIFEST_PATH = REPO_ROOT / "bench" / "conductor-tasks.json"
# The systems-implementation set, whose tasks are far too large to carry
# their file bodies inline and are drawn from bench/corpus/ instead.
CORPUS_SYSTEMS_MANIFEST_PATH = REPO_ROOT / "bench" / "corpus-systems.json"

# Ceilings on a directory-sourced file set. Every body is read into memory at
# load time and written again per cell, per arm, per rep, so a source directory
# that has grown a build output tree is a refusal with a size in it rather than
# a run that swaps and a report nobody can explain.
MAX_SOURCE_FILE_BYTES = 1 << 20
MAX_SOURCE_DIR_BYTES = 8 << 20

# What a build, an interpreter and a file browser leave inside a source tree.
# The repository root ignores all of it for the whole workspace, so no corpus
# seed's own .gitignore restates it and `git status` never reports one.
# A .git tree is deliberately absent: seeding one is a refusal with its own
# message, not something to step over quietly.
ALWAYS_IGNORED_DIR_NAMES = frozenset(
    {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
)
ALWAYS_IGNORED_NAMES = frozenset({".DS_Store", "Thumbs.db"})
ALWAYS_IGNORED_SUFFIXES = (".pyc", ".pyo")
DOCTRINE_DIR = REPO_ROOT / "conductor" / "doctrine"
FRAGMENT_PATH = REPO_ROOT / "conductor" / "opencode-fragment.json"
ROUTER_CONFIG_PATH = REPO_ROOT / conductor_wiring.ROUTER_CONFIG_RELPATH

DOCTRINE_PROMPT_NAME = "doctrine-prompt.md"
SEED_COMMIT_MESSAGE = "bench seed"

DEFAULT_REPS = 3

# A hidden test run against an untouched seed either fails in seconds or is
# broken; it never needs a campaign-sized wall clock.
VERIFY_TIMEOUT_SEC = 600

# conductor/adapter/config-io.ts:102. A run whose single item scopes more files
# than this escapes the plugin's trivial path, which is the line the scope
# ladder below is built around: T0 sits under it and every higher tier sits
# over it.
TRIVIAL_MAX_FILES = 2

# The closed arm vocabulary, in the order the run plan interleaves them.
ARMS = ("baseline", "doctrine", "conductor")

# The capability dimension, carried symmetrically by every arm. Under the
# governance posture this campaign measures, the only value is `none` - no arm
# is given a read-only capability. The dimension exists so a later
# capability-on campaign is a config change and its data is comparable with
# this one's, rather than a redesign that makes the two incomparable.
# Named `capability` and not `preset`: scripts/bench_presets.py already owns
# "preset" for llama.cpp sampling and runtime profiles.
CAPABILITIES = ("none",)
DEFAULT_CAPABILITY = "none"

# One agent name per arm. baseline and doctrine both use opencode's own primary
# agent; only the doctrine arm's config gives that agent a prompt.
ARM_AGENTS = {
    "baseline": "build",
    "doctrine": "build",
    "conductor": "conductor-orchestrator",
}

# The scope ladder. A tier is a declared statement about how much of the
# process under test a task can reach: T0 stays inside the plugin's trivial
# path and measures the cost floor, T1 produces one real item, T2 several
# independent ones, T3 a dependency chain, and T4 work that needs a file no
# plan would have scoped.
TIERS = ("T0", "T1", "T2", "T3", "T4")

# One wall clock per tier. A T3 build that ran out of half an hour is a cost
# datum, and scoring it as a wrong answer would convert process cost into
# measured quality loss.
TIER_TIMEOUT_SEC = {
    "T0": 1800,
    "T1": 2700,
    "T2": 3600,
    "T3": 7200,
    "T4": 3600,
}

# The mechanism a task is written to strain. `none` means the task is in the
# set for coverage rather than for stress; every other value names a path whose
# expected trajectory the task also declares, so a run that takes a DIFFERENT
# trajectory is the finding rather than a scoring accident.
MECHANISMS = (
    "none",
    "no-test-first",
    "scope-boundary",
    "missing-dependency",
    "ambiguous-requirement",
    "brief-window",
    "dependency-chain",
    "parallel-waves",
)

LANGUAGES = ("ts", "python", "cpp")
DIFFICULTIES = ("one-function", "multi-file")

OUTCOMES = ("pass", "fail", "timeout", "harness-error")

# Why a recorded cell can leave the pass rate. Both reasons are decided by the
# SAME predicate for every arm, and a cell excluded in one arm takes its
# arm-symmetric counterparts with it: dropping only the arm that tripped would
# leave the others carrying whatever made it trip, which biases the dropped
# arm's rate upward by exactly the cells it found hardest.
EXCLUSION_REASONS = ("harness-error", "plugin-absent")

# conductor/core/stops.ts STOP_KINDS, verbatim.
STOP_KINDS = ("done", "noop", "blocked", "surfaced", "env", "interrupt")

# core/fsm-run.ts terminal states, which stand in for a stop kind when a run
# ended without writing a stop record.
TERMINAL_RUN_STATES = ("REPORTED", "TRIVIAL_DONE", "ANSWERED")

RESULT_KEYS = (
    "cellId",
    "model",
    "capability",
    "arm",
    "taskId",
    "tier",
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
    "subSessions",
    "waves",
    "pluginAbsent",
)
TOKEN_KEYS = ("prompt", "completion", "total", "partial")

SWEEP_REQUIRED_KEYS = (
    "rationale",
    "primaryModel",
    "models",
    "sweptTiers",
    "primaryOnlyTiers",
    "capabilities",
    "reps",
)

# Every field a task must carry outright. The two file sets are absent
# because each has two spellings - an inline map or a directory to walk -
# and "exactly one of them" is a check a membership loop cannot make.
TASK_REQUIRED_KEYS = (
    "id",
    "tier",
    "mechanism",
    "expectedTrajectory",
    "expectedStopKinds",
    "language",
    "difficulty",
    "behavioral",
    "rationale",
    "prompt",
    "hiddenTestCommand",
    "repoTestCommand",
    "behavioralPaths",
)

# conductor/adapter/inject.ts:53-61, verbatim. The plugin sets
# output.temperature per request from this table; an arm running without the
# plugin runs the server default instead. That is a real difference between the
# arms and part of the process under test, so it is declared rather than
# described as parity the campaign does not have.
ROLE_TEMPERATURE = {
    "orchestrator": 0.4,
    "planner": 0.7,
    "testWriter": 0.5,
    "implementer": 0.4,
    "reviewer": 0.3,
    "skeptic": 0.3,
    "mechanical": 0.1,
}

NA = "n/a"
PARTIAL_MARKER = "(partial)"

SECTION_SCOPE = "## Run scope"
SECTION_METHOD = "## Method"
SECTION_ASYMMETRIES = "## Declared asymmetries"
SECTION_SWEEP = "## Sweep shape"
SECTION_PER_TASK = "## Per-task pass rates"
SECTION_ARM_TOTALS = "## Arm totals"
SECTION_SEPARABILITY = "## Separability"
SECTION_COST = "## Cost"
SECTION_TIER = "## Cost and quality by tier"
SECTION_PROCESS = "## Process metrics"
SECTION_TIMEOUTS = "## Timed-out cells"
SECTION_TRAJECTORIES = "## Mechanism trajectories"
SECTION_RUBRIC = "## Rubric"
SECTION_ROUTER_ERRORS = "## Router-error cells"
SECTION_EXCLUSIONS = "## Excluded cells"
SECTION_MISSING = "## Missing cells"

TIER_COST_LABELS = (
    "pass rate",
    "timeouts",
    "total wall clock",
    "median cell wall clock",
    "total tokens",
    "sub-sessions",
    "waves",
)

# The rubric lane. Pass rate answers "is it better on average"; these answer
# "is the result something a person would keep", which is the question the
# harness exists to move and which no exit status reaches.
RUBRIC_CRITERIA = ("structure", "decomposition", "testQuality", "deadCode", "overBuilding")
RUBRIC_SCORES = (0, 1, 2, 3)

NOISE_NOTE = (
    "At least one arm pair differs on a task while their per-repetition ranges "
    "overlap: those differences are within noise at three repetitions and are "
    "not separable."
)

NO_VERDICT_NOTE = (
    "This report states whether two arms are separable, and never who won. At "
    "three repetitions of a binary outcome, calling 2/3 against 1/3 a result "
    "would be reading noise as a finding. Raise the repetition count, or add a "
    "continuous per-task score, before any comparative claim is made."
)

TIMEOUT_NOTE = (
    "A timed-out cell is counted here and nowhere else. It is not a pass and "
    "not a wrong answer: it is the arm's process cost exceeding its tier's "
    "wall clock, and folding it into the pass rate would report cost as "
    "quality."
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
}


class BenchError(Exception):
    """A benchmark input or invariant the driver refuses to proceed past."""


def model_slug(model: str) -> str:
    """A model id usable as one path and cell-id segment.

    A model is spelled `<provider>/<model>`, and the separator is the same one
    the cell id and the work tree use, so it is folded to a dash rather than
    left to split one segment into two.
    """
    return model.replace("/", "-")


class Cell(NamedTuple):
    """One (model, capability, arm, task, repetition) point of the matrix.

    Model and capability lead the tuple because the plan is ordered by them:
    one llama-server in multi-model mode swaps weights on demand, so an
    interleaved order would pay a weight reload per cell.
    """

    model: str
    capability: str
    arm: str
    task_id: str
    rep: int

    @property
    def cell_id(self) -> str:
        return "%s/%s/%s/%s/r%d" % (
            model_slug(self.model),
            self.capability,
            self.arm,
            self.task_id,
            self.rep,
        )


def declared_asymmetries() -> List[Dict[str, Any]]:
    """Every way the arms are NOT alike, stated as data.

    Both entries are properties of the process under test rather than defects
    in the harness, and neither can be removed without changing conductor. They
    ride the run manifest and the report header so no number below is read as
    coming from arms that differ only in their process.
    """
    sampling = ", ".join(
        "%s %s" % (role, ROLE_TEMPERATURE[role]) for role in sorted(ROLE_TEMPERATURE)
    )
    return [
        {
            "dimension": "sampling",
            "conductor": "per-role output.temperature: %s" % sampling,
            "pluginAbsent": "the server default temperature for every request",
            "why": (
                "the plugin sets temperature per request from its own role table; "
                "an arm with no plugin has no role and no table"
            ),
        },
        {
            "dimension": "sub-agent availability",
            "conductor": "the `task` tool is denied in every session",
            "pluginAbsent": "the `task` tool is available as opencode ships it",
            "why": (
                "conductor spawns its own sub-sessions and denies the built-in "
                "spawner; a vanilla session keeps it"
            ),
        },
    ]


class Task(NamedTuple):
    """One manifest entry, with the JSON key names mapped onto python ones."""

    id: str
    tier: str
    mechanism: str
    expected_trajectory: str
    expected_stop_kinds: List[str]
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
    sweep: Dict[str, Any]
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


def load_manifest(
    path: Any,
    expected_counts: Optional[Dict[str, int]] = None,
    root: Optional[Any] = None,
) -> Manifest:
    """Parse and fully validate the task manifest at ``path``.

    The per-tier task-set pin belongs to the document: a manifest states the
    shape it is held to under ``expectedTaskCounts``, and one that states none
    is held to none. ``expected_counts`` overrides the document, which is how a
    caller checks a set against a shape the document does not declare.

    ``root`` is what a task's ``seedDir`` and ``hiddenDir`` are relative to, and
    the boundary neither may leave. It is the repository root, which is what
    lets a committed manifest name ``bench/corpus/...`` and mean the same tree
    from any working directory.
    """
    base_root = REPO_ROOT if root is None else Path(root)
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
    # The model a run with no --model plans. It is read, not merely declared:
    # a manifest that states one model and plans another produces a run
    # manifest that records two campaigns and a report that names the wrong
    # weights for every cell in it.
    model = defaults.get("model")
    if not isinstance(model, str) or not model.strip():
        raise BenchError(
            "%s: defaults.model must be the model id a run plans when no "
            "--model is given" % manifest_path
        )
    tier_timeouts = _parse_tier_timeouts(defaults.get("tierTimeoutSec"), manifest_path)

    sweep = _parse_sweep(document.get("sweep"), manifest_path)
    if model not in sweep["models"]:
        raise BenchError(
            "%s: defaults.model %r is not in sweep.models %s, so one manifest "
            "declares one campaign and plans another"
            % (manifest_path, model, ", ".join(sweep["models"]))
        )
    declared_counts = _parse_expected_counts(
        document.get("expectedTaskCounts"), manifest_path
    )

    entries = document.get("tasks")
    if not isinstance(entries, list):
        raise BenchError("%s: tasks must be an array" % manifest_path)
    # The floor is the count itself, not the pin. A manifest may decline to
    # state a shape, and a generator that derives its pin from what it emitted
    # declares an all-zero one - so neither pin refuses a set with nothing in
    # it, and every driver mode would then report success over zero tasks:
    # every hidden test failed, every seed starts green, and a report claiming
    # full coverage of a campaign that measured nothing.
    if not entries:
        raise BenchError(
            "%s: tasks is empty, so every mode would report success over a set "
            "that measures nothing" % manifest_path
        )

    tasks: List[Task] = []
    seen: Dict[str, int] = {}
    for index, entry in enumerate(entries):
        task = _parse_task(entry, index, tier_timeouts, base_root)
        if task.id in seen:
            raise BenchError(
                "task %r appears twice (positions %d and %d): task ids must be unique"
                % (task.id, seen[task.id], index)
            )
        seen[task.id] = index
        tasks.append(task)

    pin = expected_counts if expected_counts is not None else declared_counts
    if pin is not None:
        _check_tier_counts(tasks, pin, manifest_path)

    return Manifest(
        version=version,
        selection_criteria=criteria,
        defaults=defaults,
        sweep=sweep,
        tasks=tasks,
    )


def _parse_tier_timeouts(value: Any, manifest_path: Any) -> Dict[str, int]:
    """One positive run timeout per tier, with no tier left to a global default."""
    if not isinstance(value, dict):
        raise BenchError(
            "%s: defaults.tierTimeoutSec must be an object mapping every tier to "
            "a run timeout" % manifest_path
        )
    out: Dict[str, int] = {}
    for tier in TIERS:
        if tier not in value:
            raise BenchError(
                "%s: defaults.tierTimeoutSec has no entry for tier %s" % (manifest_path, tier)
            )
        seconds = value[tier]
        if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds <= 0:
            raise BenchError(
                "%s: defaults.tierTimeoutSec[%s] must be a positive integer"
                % (manifest_path, tier)
            )
        out[tier] = seconds
    for tier in value:
        if tier not in TIERS:
            raise BenchError(
                "%s: defaults.tierTimeoutSec names %r, which is outside %s"
                % (manifest_path, tier, ", ".join(TIERS))
            )
    return out


def _parse_expected_counts(value: Any, manifest_path: Any) -> Optional[Dict[str, int]]:
    """The per-tier task-set pin the manifest declares for itself, if it does.

    A scalar total cannot tell a lost T3 task from a gained T2 one, and the
    tier a task sits in is the whole point of the set - so the pin is per tier
    and, when declared, names every tier, leaving no tier's count to be
    inferred from its absence. The field is optional: a manifest that states no
    shape, such as one assembled from a corpus, is held to none.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise BenchError(
            "%s: expectedTaskCounts must be an object mapping every tier to a "
            "task count" % manifest_path
        )
    out: Dict[str, int] = {}
    for tier in TIERS:
        if tier not in value:
            raise BenchError(
                "%s: expectedTaskCounts has no entry for tier %s" % (manifest_path, tier)
            )
        count = value[tier]
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise BenchError(
                "%s: expectedTaskCounts[%s] must be a non-negative integer"
                % (manifest_path, tier)
            )
        out[tier] = count
    for tier in value:
        if tier not in TIERS:
            raise BenchError(
                "%s: expectedTaskCounts names %r, which is outside %s"
                % (manifest_path, tier, ", ".join(TIERS))
            )
    return out


def _parse_sweep(value: Any, manifest_path: Any) -> Dict[str, Any]:
    """The declared model-sweep shape, validated as a design rather than a wish.

    The full crossing of models, tiers, tasks, arms and repetitions is not
    runnable, so the shape actually intended is recorded here BEFORE the
    campaign and the run plan is built from it - which is what stops the
    coverage claim from becoming an artefact of what happened to finish.
    """
    if not isinstance(value, dict):
        raise BenchError("%s: sweep must be an object" % manifest_path)
    for key in SWEEP_REQUIRED_KEYS:
        if key not in value:
            raise BenchError("%s: sweep is missing %r" % (manifest_path, key))
    rationale = value["rationale"]
    if not isinstance(rationale, str) or not rationale.strip():
        raise BenchError(
            "%s: sweep.rationale must state why the shape is this one" % manifest_path
        )
    models = value["models"]
    if (
        not isinstance(models, list)
        or not models
        or not all(isinstance(item, str) and item.strip() for item in models)
    ):
        raise BenchError(
            "%s: sweep.models must be a non-empty list of model ids" % manifest_path
        )
    if len(set(models)) != len(models):
        raise BenchError("%s: sweep.models repeats a model id" % manifest_path)
    primary = value["primaryModel"]
    if primary not in models:
        raise BenchError(
            "%s: sweep.primaryModel %r is not in sweep.models" % (manifest_path, primary)
        )
    swept = value["sweptTiers"]
    primary_only = value["primaryOnlyTiers"]
    for field, tiers in (("sweptTiers", swept), ("primaryOnlyTiers", primary_only)):
        if not isinstance(tiers, list) or not all(item in TIERS for item in tiers):
            raise BenchError(
                "%s: sweep.%s must list tiers from %s"
                % (manifest_path, field, ", ".join(TIERS))
            )
    overlap = sorted(set(swept) & set(primary_only))
    if overlap:
        raise BenchError(
            "%s: sweep names %s as both swept and primary-only"
            % (manifest_path, ", ".join(overlap))
        )
    if sorted(set(swept) | set(primary_only)) != sorted(TIERS):
        raise BenchError(
            "%s: sweep must place every tier in exactly one of sweptTiers and "
            "primaryOnlyTiers" % manifest_path
        )
    capabilities = value["capabilities"]
    if (
        not isinstance(capabilities, list)
        or not capabilities
        or not all(item in CAPABILITIES for item in capabilities)
    ):
        raise BenchError(
            "%s: sweep.capabilities must be a non-empty subset of %s"
            % (manifest_path, ", ".join(CAPABILITIES))
        )
    reps = value["reps"]
    if not isinstance(reps, int) or isinstance(reps, bool) or reps < 1:
        raise BenchError("%s: sweep.reps must be a positive integer" % manifest_path)
    return dict(value)


def _check_tier_counts(
    tasks: Sequence[Task], expected_counts: Dict[str, int], manifest_path: Any
) -> None:
    """Refuse a set whose per-tier shape is not the declared one."""
    counted = dict((tier, 0) for tier in TIERS)
    for task in tasks:
        counted[task.tier] += 1
    # Every mismatching tier is named in one message: a set that traded a T3
    # task for a T2 one is off in two places at once, and reporting only the
    # first would describe half the defect.
    off = [
        "%s is pinned at %d task(s), found %d"
        % (tier, expected_counts.get(tier, 0), counted[tier])
        for tier in TIERS
        if counted[tier] != expected_counts.get(tier, 0)
    ]
    if off:
        raise BenchError("%s: %s" % (manifest_path, "; ".join(off)))


def tasks_by_tier(tasks: Sequence[Task]) -> Dict[str, List[Task]]:
    """The task set grouped by tier, in manifest order inside each tier."""
    out: Dict[str, List[Task]] = dict((tier, []) for tier in TIERS)
    for task in tasks:
        out[task.tier].append(task)
    return out


def load_tasks(
    path: Any,
    expected_counts: Optional[Dict[str, int]] = None,
    root: Optional[Any] = None,
) -> List[Task]:
    """The manifest's tasks, in manifest order.

    ``expected_counts`` and ``root`` mean exactly what they mean for
    ``load_manifest``.
    """
    return load_manifest(path, expected_counts=expected_counts, root=root).tasks


def _parse_task(entry: Any, index: int, tier_timeouts: Dict[str, int], root: Path) -> Task:
    """One validated task record; every rejection names the task and the field."""
    if not isinstance(entry, dict):
        raise BenchError("task at position %d is not an object" % index)
    task_id = entry.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise BenchError("task at position %d has no usable id" % index)

    for key in TASK_REQUIRED_KEYS:
        if key not in entry:
            raise BenchError("task %r is missing the required field %r" % (task_id, key))

    tier = entry["tier"]
    if tier not in TIERS:
        raise BenchError(
            "task %r: field 'tier' is %r, which is outside %s"
            % (task_id, tier, ", ".join(TIERS))
        )
    mechanism = entry["mechanism"]
    if mechanism not in MECHANISMS:
        raise BenchError(
            "task %r: field 'mechanism' is %r, which is outside %s"
            % (task_id, mechanism, ", ".join(MECHANISMS))
        )
    trajectory = entry["expectedTrajectory"]
    if not isinstance(trajectory, str) or not trajectory.strip():
        raise BenchError(
            "task %r: field 'expectedTrajectory' must say what the run is expected "
            "to do, so a run that does something else is a finding" % task_id
        )
    expected_stops = entry["expectedStopKinds"]
    if not isinstance(expected_stops, list) or not expected_stops:
        raise BenchError(
            "task %r: field 'expectedStopKinds' must be a non-empty list" % task_id
        )
    for kind in expected_stops:
        if kind not in STOP_KINDS + TERMINAL_RUN_STATES:
            raise BenchError(
                "task %r: field 'expectedStopKinds' names %r, which is outside the "
                "closed stop vocabulary %s and the terminal run states %s"
                % (task_id, kind, ", ".join(STOP_KINDS), ", ".join(TERMINAL_RUN_STATES))
            )

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

    seed_files, seed_dir = _parse_file_source(
        entry, root, task_id, "seedFiles", "seedDir"
    )
    hidden_files, hidden_dir = _parse_file_source(
        entry, root, task_id, "hiddenFiles", "hiddenDir"
    )
    overlap = sorted(set(seed_files) & set(hidden_files))
    if overlap:
        raise BenchError(
            "task %r: the hidden file set overlaps the seed at %s - a hidden test "
            "the model can read measures nothing" % (task_id, ", ".join(overlap))
        )
    # Two directories walked from different roots produce relative paths that
    # never collide as keys, so the check above cannot see a hidden tree sitting
    # inside the seed tree. Containment is the check that can.
    if seed_dir is not None and hidden_dir is not None:
        for outer, inner, outer_field, inner_field in (
            (seed_dir, hidden_dir, "seedDir", "hiddenDir"),
            (hidden_dir, seed_dir, "hiddenDir", "seedDir"),
        ):
            if inner == outer or _is_within(inner, outer):
                raise BenchError(
                    "task %r: field %r at %s sits inside %r at %s - a hidden test "
                    "the model can read measures nothing"
                    % (task_id, inner_field, inner, outer_field, outer)
                )

    hidden_command = _parse_command(entry["hiddenTestCommand"], task_id, "hiddenTestCommand")
    repo_command = _parse_command(entry["repoTestCommand"], task_id, "repoTestCommand")

    behavioral_paths = entry["behavioralPaths"]
    if not isinstance(behavioral_paths, list) or not all(
        isinstance(item, str) for item in behavioral_paths
    ):
        raise BenchError("task %r: field 'behavioralPaths' must be a list of globs" % task_id)

    timeout = entry.get("runTimeoutSec", tier_timeouts[tier])
    if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout <= 0:
        raise BenchError("task %r: field 'runTimeoutSec' must be a positive integer" % task_id)

    return Task(
        id=task_id,
        tier=tier,
        mechanism=mechanism,
        expected_trajectory=trajectory,
        expected_stop_kinds=list(expected_stops),
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


def _parse_file_source(
    entry: Dict[str, Any],
    root: Path,
    task_id: str,
    inline_field: str,
    dir_field: str,
) -> Tuple[Dict[str, str], Optional[Path]]:
    """One side's file set, however the task chose to state it.

    A task states each side once: an inline path -> body map for a handful of
    small files, or a directory to walk for corpus material too large to sit in
    a JSON string. Both spellings yield the identical validated map, so nothing
    downstream of this function can tell them apart; the directory, when there
    was one, comes back beside it only so the seed/hidden containment check has
    something to compare.
    """
    has_inline = inline_field in entry
    has_dir = dir_field in entry
    if has_inline and has_dir:
        raise BenchError(
            "task %r: fields %r and %r both state the same file set; a task "
            "states each side once" % (task_id, inline_field, dir_field)
        )
    if not has_inline and not has_dir:
        raise BenchError(
            "task %r: neither %r nor %r is present; a task states each side once"
            % (task_id, inline_field, dir_field)
        )
    if has_inline:
        return _parse_file_map(entry[inline_field], task_id, inline_field), None
    base = _resolve_source_dir(entry[dir_field], root, task_id, dir_field)
    return _read_dir_map(base, task_id, dir_field), base


def _resolve_source_dir(value: Any, root: Path, task_id: str, field: str) -> Path:
    """The real directory a ``seedDir``/``hiddenDir`` names, or a refusal.

    The declared value is repo-relative and stays inside the repository, and
    the directory itself is a real directory rather than a symlink pointing at
    one: a symlink resolves to a tree the manifest does not name, and the file
    it would seed is not the file the repository holds.
    """
    if not isinstance(value, str) or not value.strip():
        raise BenchError("task %r: field %r must name a directory" % (task_id, field))
    _validate_relpath(value, task_id, field)
    base = root / value
    if base.is_symlink():
        raise BenchError(
            "task %r: field %r path %r is a symlink; a source directory is the "
            "tree the manifest names" % (task_id, field, value)
        )
    if not base.exists():
        raise BenchError(
            "task %r: field %r path %r does not exist under %s"
            % (task_id, field, value, root)
        )
    if not base.is_dir():
        raise BenchError(
            "task %r: field %r path %r is not a directory" % (task_id, field, value)
        )
    resolved = base.resolve()
    if not _is_within(resolved, root.resolve()):
        raise BenchError(
            "task %r: field %r path %r resolves to %s, outside %s"
            % (task_id, field, value, resolved, root)
        )
    return resolved


def _read_ignore_rules(base: Path, task_id: str, field: str) -> List[Tuple[Tuple[str, ...], str, bool]]:
    """The skip rules the walked tree states for itself, in git's own spelling.

    One rule per pattern: the directory segments the ``.gitignore`` stating it
    sits in, the pattern, and whether it matches directories only. A tree that
    states a rule this cannot honour - a re-inclusion, which needs ordering
    this does not model - is refused by name rather than skipped wider or
    narrower than the tree asked for.
    """
    rules: List[Tuple[Tuple[str, ...], str, bool]] = []
    for path in sorted(base.rglob(".gitignore")):
        if not path.is_file():
            continue
        where = path.relative_to(base).parts[:-1]
        relpath = "/".join(path.relative_to(base).parts)
        try:
            stated = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise BenchError(
                "task %r: field %r file %r is not UTF-8 text (byte %d): %s"
                % (task_id, field, relpath, exc.start, exc.reason)
            )
        for raw in stated.split("\n"):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("!"):
                raise BenchError(
                    "task %r: field %r holds %s, which re-includes %r; this walk "
                    "cannot honour a re-inclusion and will not guess at it"
                    % (task_id, field, "/".join(where + (".gitignore",)), line)
                )
            directory_only = line.endswith("/")
            pattern = line.rstrip("/")
            if pattern:
                rules.append((where, pattern, directory_only))
    return rules


def _is_ignored(relparts: Tuple[str, ...], rules: Sequence[Tuple[Tuple[str, ...], str, bool]]) -> bool:
    """Whether the tree's own rules, or this repository's, skip one file.

    The three ``ALWAYS_IGNORED`` sets carry what a build, an interpreter and a
    file browser leave in every tree here and no ``.gitignore`` under a corpus
    restates, because the repository root already ignores it for the whole
    workspace. ``rules`` carries what the walked tree declares for itself.
    """
    name = relparts[-1]
    if name in ALWAYS_IGNORED_NAMES or name.endswith(ALWAYS_IGNORED_SUFFIXES):
        return True
    if set(relparts[:-1]) & ALWAYS_IGNORED_DIR_NAMES:
        return True
    for where, pattern, directory_only in rules:
        if relparts[: len(where)] != where:
            continue
        rest = relparts[len(where):]
        if "/" in pattern:
            anchored = tuple(part for part in pattern.strip("/").split("/") if part)
            span = rest[: len(anchored)]
            if len(span) == len(anchored) and all(
                fnmatch.fnmatch(span[i], anchored[i]) for i in range(len(anchored))
            ):
                if not directory_only or len(rest) > len(anchored):
                    return True
            continue
        candidates = rest[:-1] if directory_only else rest
        for segment in candidates:
            if fnmatch.fnmatch(segment, pattern):
                return True
    return False


def _read_dir_map(base: Path, task_id: str, field: str) -> Dict[str, str]:
    """Every file under ``base``, flattened into the inline form's map.

    The walk is sorted by relative path, so two loads of the same tree seed
    byte-identical work trees in a byte-identical order.

    What the tree's own ``.gitignore`` skips is skipped here too, and so is
    what this repository ignores everywhere. A seed's build directory, its
    generated workload and the ``__pycache__`` an interpreter drops in it are
    invisible to ``git status`` by the corpus author's own declaration, so a
    walk that read them would refuse a whole task set over bytes nobody wrote,
    naming a file the operator cannot find in any diff. The map this returns is
    the source the repository holds, which is the tree the model is handed.

    Bodies are text, and a file this cannot decode as UTF-8 is refused by name.
    The whole seeding path is text - the inline form is a JSON string,
    ``materialize_files`` writes with ``write_text``, and the result is
    committed - so a byte-exact binary file cannot survive it. Decoding it with
    a replacement character would hand the model a file that differs from the
    one the repository holds, in a way no test would report; a corpus that needs
    exact bytes states them in a text encoding its own tooling decodes.
    """
    entries: List[Tuple[str, Path]] = []
    total = 0
    rules = _read_ignore_rules(base, task_id, field)
    for path in base.rglob("*"):
        parts = path.relative_to(base).parts
        relpath = "/".join(parts)
        if _is_ignored(parts, rules):
            continue
        if ".git" in parts:
            raise BenchError(
                "task %r: field %r holds %r; a seeded .git tree is written before "
                "the cell repository is initialised and would replace it"
                % (task_id, field, relpath)
            )
        if path.is_symlink():
            raise BenchError(
                "task %r: field %r holds the symlink %r; the seeded tree is the "
                "tree the repository holds" % (task_id, field, relpath)
            )
        if path.is_dir():
            continue
        if not path.is_file():
            raise BenchError(
                "task %r: field %r holds %r, which is not a regular file"
                % (task_id, field, relpath)
            )
        if not _is_within(path.resolve(), base):
            raise BenchError(
                "task %r: field %r path %r resolves to %s, outside %s"
                % (task_id, field, relpath, path.resolve(), base)
            )
        size = path.stat().st_size
        if size > MAX_SOURCE_FILE_BYTES:
            raise BenchError(
                "task %r: field %r file %r is %d bytes, over the %d-byte per-file "
                "ceiling" % (task_id, field, relpath, size, MAX_SOURCE_FILE_BYTES)
            )
        total += size
        if total > MAX_SOURCE_DIR_BYTES:
            raise BenchError(
                "task %r: field %r exceeds the %d-byte ceiling for one file set"
                % (task_id, field, MAX_SOURCE_DIR_BYTES)
            )
        entries.append((relpath, path))
    if not entries:
        raise BenchError(
            "task %r: field %r walks %s and finds no file" % (task_id, field, base)
        )
    out: Dict[str, str] = {}
    for relpath, path in sorted(entries):
        _validate_relpath(relpath, task_id, field)
        try:
            body = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as exc:
            raise BenchError(
                "task %r: field %r file %r is not UTF-8 text (byte %d): %s"
                % (task_id, field, relpath, exc.start, exc.reason)
            )
        out[relpath] = body
    return out


def _is_within(candidate: Path, base: Path) -> bool:
    """Whether ``candidate`` sits under ``base``, both already resolved."""
    try:
        candidate.relative_to(base)
    except ValueError:
        return False
    return True


def _validate_relpath(relpath: Any, task_id: str, field: str) -> None:
    """The path rules both file-set spellings are held to."""
    if not isinstance(relpath, str) or not relpath.strip():
        raise BenchError("task %r: field %r has an empty path" % (task_id, field))
    if os.path.isabs(relpath) or relpath.startswith("/"):
        raise BenchError(
            "task %r: field %r path %r is absolute; paths are repo-relative"
            % (task_id, field, relpath)
        )
    if ".." in Path(relpath).parts:
        raise BenchError(
            "task %r: field %r path %r escapes the work tree" % (task_id, field, relpath)
        )


def _parse_file_map(value: Any, task_id: str, field: str) -> Dict[str, str]:
    """A repo-relative path -> content map that cannot escape the work tree."""
    if not isinstance(value, dict) or not value:
        raise BenchError("task %r: field %r must be a non-empty object" % (task_id, field))
    out: Dict[str, str] = {}
    for relpath in value:
        body = value[relpath]
        _validate_relpath(relpath, task_id, field)
        if not isinstance(body, str):
            raise BenchError(
                "task %r: field %r path %r must map to file text" % (task_id, field, relpath)
            )
        out[relpath] = body
    return out


def _parse_command(value: Any, task_id: str, field: str) -> List[str]:
    """An argv LIST. A shell string here would need shell=True to run at all."""
    if not isinstance(value, list) or not value:
        raise BenchError(
            "task %r: field %r must be a non-empty argv list, not %r" % (task_id, field, value)
        )
    for token in value:
        if not isinstance(token, str):
            raise BenchError(
                "task %r: field %r contains a non-string token" % (task_id, field)
            )
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
    return shutil.which(program, path=CELL_PATH) is not None


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
    per_slot_ctx: int,
) -> Dict[str, Any]:
    """The opencode config for one arm of one cell.

    The arms differ in exactly one thing: what process the model is running
    inside. Provider, base URL, model selection, the served model limit and every
    other key are built from the same code path so the experiment keeps its
    control. ``per_slot_ctx`` is the window llama-server serves each slot, probed
    from the server by served_per_slot_context: opencode compacts against the
    limit it is told, and a cell that does not tell it discovers the slot by
    being refused, then loops through a compaction that cannot shrink the
    system prompt (the 13.2 smoke, 2026-08-21).
    """
    if arm not in ARMS:
        raise BenchError("unknown arm %r: the closed set is %s" % (arm, ", ".join(ARMS)))
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
    entry = copy.deepcopy(models.get(model_name) or {}) if isinstance(models, dict) else {}
    entry["limit"] = conductor_wiring.opencode_model_limit(per_slot_ctx)
    provider["models"] = {model_name: entry}

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


def parse_served_context(payload: Any) -> int:
    """The per-slot window out of llama-server's /props body, or a refusal.

    /props for a served model reports default_generation_settings.n_ctx, which
    is the slot's window after --parallel has divided --ctx-size (the parent's
    own /props, with no model named, reports 0). A zero or missing value means
    no served model answered, and a campaign must not guess a window.
    """
    settings = payload.get("default_generation_settings") if isinstance(payload, dict) else None
    n_ctx = settings.get("n_ctx") if isinstance(settings, dict) else None
    if isinstance(n_ctx, bool) or not isinstance(n_ctx, int) or n_ctx <= 0:
        raise BenchError(
            "llama-server's /props did not report a served per-slot context "
            "(default_generation_settings.n_ctx = %r); is the model loaded?" % (n_ctx,)
        )
    return n_ctx


def _fetch_bytes(url: str) -> bytes:
    import urllib.request

    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def served_per_slot_context(
    router_config: Dict[str, Any],
    model: str,
    fetch: Optional[Callable[[str], bytes]] = None,
) -> int:
    """Ask llama-server what window it serves the model with, through the router's upstream.

    The router proxies /v1/* only, so the probe goes to the upstream llama-server
    the router config names. One probe per run: the window is a server fact, not
    a cell fact, and it is what every arm's opencode limit is set from.
    """
    upstream = router_config.get("upstream")
    if not isinstance(upstream, dict):
        raise BenchError("the router config has no upstream block")
    host = upstream.get("host")
    port = upstream.get("port")
    if not isinstance(host, str) or not host or isinstance(port, bool) or not isinstance(port, int):
        raise BenchError("the router config has no upstream.host / integer upstream.port")
    _, _, model_name = model.partition("/")
    url = "http://%s:%d/props?model=%s" % (host, port, model_name)
    try:
        raw = (_fetch_bytes if fetch is None else fetch)(url)
        payload = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError) as exc:
        raise BenchError("cannot probe the served context at %s: %s" % (url, exc))
    return parse_served_context(payload)


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
            "as cwd and a relative path would resolve against the driver's own" % str(work_dir)
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


def hermetic_home_env(home: Any) -> Dict[str, str]:
    """PATH, plus every home a spawned process must not read the operator's.

    One definition for the model's process and for the test commands measured
    beside it. HOME is the load-bearing key beyond opencode state: CPython
    derives the per-user site directory from it, so a process given the
    operator's HOME can import a `pip install --user` package and a process
    given a cell's cannot. Two environments here means a graded run that
    resolves imports the model's own run could not.
    """
    root = Path(home)
    return {
        # ISSUE-107: opencode and git are spawned by bare name, so the cell needs
        # a PATH to resolve them; without it every cell spawn-fails against
        # os.defpath. Hermeticity is over process STATE (the homes below), not
        # over the executable search path.
        "PATH": CELL_PATH,
        "HOME": str(root),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_CACHE_HOME": str(root / "cache"),
    }


def build_cell_env(cell_dir: Any, config_path: Any) -> Dict[str, str]:
    """The hermetic environment one cell runs in.

    Config, config home and test home are the verified triple; the state, data
    and cache homes are here so one cell's stale-red registry, quarantine and
    worktrees cannot reach the next cell's. Nothing is inherited from the user's
    own environment, so a developer's opencode state cannot enter a measurement.
    """
    home = Path(cell_dir) / "home"
    env = hermetic_home_env(home)
    env["OPENCODE_CONFIG"] = str(Path(config_path))
    env["OPENCODE_TEST_HOME"] = str(home)
    return env


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
    tasks: Sequence[Task],
    models: Sequence[str],
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    capabilities: Sequence[str] = (DEFAULT_CAPABILITY,),
) -> List[Cell]:
    """Every cell, model-major, then repetition-major and arm-interleaved.

    Model leads so a multi-model server loads each set of weights once rather
    than once per cell. Inside one model, truncating at any prefix leaves the
    arms balanced to within one cell, so an overnight that dies half way
    through is still comparable.
    """
    return _plan_cells(
        [(model, capability, list(tasks)) for model in models for capability in capabilities],
        arms=arms,
        reps=reps,
    )


def _plan_cells(
    blocks: Sequence[Tuple[str, str, Sequence[Task]]],
    arms: Sequence[str],
    reps: int,
) -> List[Cell]:
    """The shared plan body: one arm-interleaved block per (model, capability)."""
    if reps < 1:
        raise BenchError("reps must be at least 1, got %r" % reps)
    for arm in arms:
        if arm not in ARMS:
            raise BenchError("unknown arm %r: the closed set is %s" % (arm, ", ".join(ARMS)))
    plan: List[Cell] = []
    for model, capability, tasks in blocks:
        if capability not in CAPABILITIES:
            raise BenchError(
                "unknown capability %r: the closed set is %s"
                % (capability, ", ".join(CAPABILITIES))
            )
        for rep in range(1, reps + 1):
            for task in tasks:
                for arm in arms:
                    plan.append(Cell(model, capability, arm, task.id, rep))
    return plan


def select_tasks(
    tasks: Sequence[Task],
    task_ids: Sequence[str] = (),
    tiers: Sequence[str] = (),
) -> List[Task]:
    """The subset a `--task`/`--tier` selection names, in manifest order.

    Values union inside a dimension and the two dimensions intersect, so
    `--task euler-cli-py --tier T1` is that task if it sits in T1 and nothing
    otherwise. Both an unknown id and a selection that matches nothing are
    refusals: a benchmark that plans zero cells and exits green is the reading
    this driver exists to make impossible.
    """
    if not task_ids and not tiers:
        return list(tasks)
    known = dict((task.id, task) for task in tasks)
    unknown = [task_id for task_id in task_ids if task_id not in known]
    if unknown:
        named = []
        for task_id in unknown:
            near = difflib.get_close_matches(task_id, sorted(known), n=3, cutoff=0.6)
            named.append(
                "%r (did you mean %s?)" % (task_id, ", ".join(near))
                if near
                else "%r (no id in the manifest is close to it)" % task_id
            )
        raise BenchError(
            "--task names %s; the manifest holds %d task(s)"
            % ("; ".join(named), len(tasks))
        )
    wanted_ids = set(task_ids)
    wanted_tiers = set(tiers)
    selected = [
        task
        for task in tasks
        if (not wanted_ids or task.id in wanted_ids)
        and (not wanted_tiers or task.tier in wanted_tiers)
    ]
    if not selected:
        raise BenchError(
            "the selection matched no task: --task %s and --tier %s have nothing "
            "in common"
            % (
                ", ".join(task_ids) or "(unset)",
                ", ".join(tiers) or "(unset)",
            )
        )
    return selected


def task_filter_record(
    manifest_tasks: Sequence[Task],
    selected: Sequence[Task],
    task_ids: Sequence[str] = (),
    tiers: Sequence[str] = (),
) -> Dict[str, Any]:
    """What was asked for and how much of the declared set it left.

    Written whether or not a selection was given, because `partial` false is a
    positive statement that the run covered the manifest, which an absent key
    is not.
    """
    return {
        "taskIds": list(task_ids),
        "tiers": list(tiers),
        "selectedTaskIds": [task.id for task in selected],
        "partial": len(selected) < len(manifest_tasks),
    }


def models_for_tier(sweep: Dict[str, Any], tier: str) -> List[str]:
    """Which models a tier is run on under the declared sweep shape.

    The cheap tiers are swept across every model; the expensive ones run on the
    primary model alone, so the tier curve rather than the full crossing
    carries the scope story.
    """
    if tier not in TIERS:
        raise BenchError("unknown tier %r: the closed set is %s" % (tier, ", ".join(TIERS)))
    if tier in sweep["primaryOnlyTiers"]:
        return [sweep["primaryModel"]]
    return list(sweep["models"])


def build_sweep_plan(manifest: Manifest, arms: Sequence[str] = ARMS) -> List[Cell]:
    """The campaign the manifest's sweep block declares, grouped by model."""
    sweep = manifest.sweep
    blocks: List[Tuple[str, str, List[Task]]] = []
    for model in sweep["models"]:
        for capability in sweep["capabilities"]:
            tasks = [
                task for task in manifest.tasks if model in models_for_tier(sweep, task.tier)
            ]
            if tasks:
                blocks.append((model, capability, tasks))
    return _plan_cells(blocks, arms=arms, reps=sweep["reps"])


def build_run_manifest(
    manifest: Manifest,
    models: Sequence[str],
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    capabilities: Sequence[str] = CAPABILITIES,
    tasks: Optional[Sequence[Task]] = None,
    filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """What this campaign is, recorded before any cell runs.

    A coverage claim written after the fact describes what finished in time.
    This is the design, and the report is rendered against it.

    ``tasks`` is what the run actually plans, which a selection can narrow to a
    subset of the manifest. Both sets ride the record - ``taskIdsByTier`` is
    what ran and ``manifestTaskIdsByTier`` is what the manifest declares - so a
    narrowed run at the single run-manifest path can never be read as the
    campaign.
    """
    planned = list(manifest.tasks) if tasks is None else list(tasks)
    selection = (
        filters if filters is not None else task_filter_record(manifest.tasks, planned)
    )
    planned_by_tier = tasks_by_tier(planned)
    return {
        "startedIso": utc_now_iso(),
        "models": list(models),
        "capabilities": list(capabilities),
        "arms": list(arms),
        "reps": reps,
        "tiers": [tier for tier in TIERS if planned_by_tier[tier]],
        "tierTimeoutSec": dict(manifest.defaults["tierTimeoutSec"]),
        "sweep": dict(manifest.sweep),
        "asymmetries": declared_asymmetries(),
        "exclusionReasons": list(EXCLUSION_REASONS),
        "filters": selection,
        "partial": selection["partial"],
        "taskIdsByTier": dict(
            (tier, [task.id for task in group]) for tier, group in planned_by_tier.items()
        ),
        "manifestTaskIdsByTier": dict(
            (tier, [task.id for task in group])
            for tier, group in tasks_by_tier(manifest.tasks).items()
        ),
    }


def write_run_manifest(path: Any, run_manifest: Dict[str, Any]) -> Path:
    """Write the run manifest beside the report it qualifies."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(run_manifest, indent=2) + "\n")
    return target


def cell_dir_for(work_root: Any, cell: Cell) -> Path:
    """One directory per cell, shared by no other cell."""
    return (
        Path(work_root)
        / model_slug(cell.model)
        / cell.capability
        / cell.arm
        / cell.task_id
        / ("r%d" % cell.rep)
    )


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
            # The cell's runner is the task's whole visible suite, so the scope
            # that covers one path covers all of them. An empty list here is not a
            # neutral default: conductor_submit_test and conductor_mark_green both
            # refuse an item that selects no scope - a verify over an empty scope
            # map would be vacuously green - so a cell with no entry wedges every
            # behavioral item at RED and scores the arm on a wedge.
            "requiredScopes": [{"pattern": "**", "scopes": ["repo"]}],
        },
        "format": {"rules": []},
        "git": {"mode": "commit", "branchPolicy": "pin", "preexistingDirty": "refuse"},
        "workflow": {
            "trivialMaxFiles": TRIVIAL_MAX_FILES,
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
            # ISSUE-112: derived from conductor_wiring's single source, never a
            # third hand-spelled copy that drifts from the served --parallel /
            # admission sizing with nothing to catch it.
            "maxReaders": conductor_wiring.DEFAULT_MAX_READERS,
            "subSessionTimeoutMs": conductor_wiring.SUB_SESSION_TIMEOUT_MS,
        },
        "models": {"default": "", "roles": {}},
        "ponytail": "full",
        "retention": {"keepRuns": 20, "maxRunDirBytes": 52428800, "pruneOnRunCreate": True},
        # conductor/adapter/tools.ts journals a read-shaped allow at debug and
        # only an R3 side effect at warn. The campaign's central question is what
        # each arm REACHED and whether reaching it correlates with passing, so a
        # cell gathered at info holds the denies and the network allows and
        # nothing behind that question.
        "logging": {"level": "debug", "components": {}},
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
    """Run a hidden or visible test command in a work tree.

    Under the same scrubbed homes the model's own process ran under, and a
    fresh one per command so no run leaves state for the next. Inheriting the
    operator's environment here would grade a tree against tools the model was
    never given, and would leave every preflight blind to a task whose suite
    only runs on the operator's machine.
    """
    with tempfile.TemporaryDirectory(prefix="bench-test-home-") as home:
        env = hermetic_home_env(home)
        for key in ("HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME",
                    "XDG_CACHE_HOME"):
            Path(env[key]).mkdir(parents=True, exist_ok=True)
        return run_command(argv, cwd, timeout_sec, env=env)


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
    per_slot_ctx: int,
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

    # Every arm is seeded with the SAME file set, conductor's config included.
    # The alternative - writing it only for the conductor arm - gives that arm a
    # different startHead and a different file listing from the others, so the
    # trees the arms are compared on are not the same tree. Writing it after the
    # seed commit instead is worse still: an uncommitted file leaves the tree
    # dirty, which conductor's own `preexistingDirty: refuse` would then refuse.
    # The arms with no plugin never read the file.
    extra = {
        ".conductor/config.json": json.dumps(build_conductor_cell_config(task), indent=2)
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
        per_slot_ctx=per_slot_ctx,
    )
    validate_config_file_refs(config)
    config_path = directory / ("%s.json" % cell.arm)
    config_path.write_text(json.dumps(config, indent=2) + "\n")

    env = build_cell_env(directory, config_path)
    for key in (
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_STATE_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
    ):
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
        score = score_cell(
            run_outcome.exit_code, run_outcome.timed_out, run_outcome.spawn_error
        )
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
        "model": cell.model,
        "capability": cell.capability,
        "arm": cell.arm,
        "taskId": cell.task_id,
        "tier": task.tier,
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
        "subSessions": metrics["subSessions"],
        "waves": metrics["waves"],
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
    return Path(results_dir) / (
        "%s__%s__%s__%s__r%d.json"
        % (model_slug(cell.model), cell.capability, cell.arm, cell.task_id, cell.rep)
    )


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
    cell = Cell(
        result["model"],
        result["capability"],
        result["arm"],
        result["taskId"],
        result["rep"],
    )
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
            "subSessions": None,
            "waves": None,
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
            "subSessions": None,
            "waves": None,
            "pluginAbsent": True,
        }
    return {
        "schemaRetries": _count_schema_retries(run_dir / "journal.jsonl"),
        "reviewFindingsUpheld": _count_upheld_findings(run_dir / "reviews"),
        "overridesUsed": _read_overrides_used(run_dir / "run.json"),
        "stopKind": _read_stop_kind(run_dir / "run.json"),
        "subSessions": _count_sub_sessions(run_dir / "journal.jsonl"),
        "waves": read_wave_count(run_dir),
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


def _count_sub_sessions(journal_path: Path) -> int:
    """How many sub-sessions the fan-out engine actually dispatched.

    A dispatch record names the role it dispatched. The same event name also
    carries a clamp warning that dispatches nothing, so counting the event
    alone would count a warning as a sub-session; the role field is what
    separates them.
    """
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
        if entry.get("component") != "fanout" or entry.get("event") != "subsession.dispatched":
            continue
        data = entry.get("data")
        if isinstance(data, dict) and isinstance(data.get("role"), str):
            count += 1
    return count


def read_wave_count(run_dir: Path) -> Optional[int]:
    """How many waves the scheduler dispatched, from the run's journal.

    The source is one ``fanout``/``wave`` record per wave, emitted by
    ``dispatchWave`` in ``conductor/adapter/fanout.ts`` — the only place that
    knows a wave happened. The per-job ``subsession.dispatched`` records cannot
    be grouped back into waves after the fact, which is why the engine emits a
    record of its own.

    An absent journal reads as None — "not measured" — rather than a fabricated 0
    that a per-tier cost table would render as a run that scheduled nothing. A
    journal that exists and carries no wave record measured zero, which is a
    different fact and is reported as one. A torn trailing line is the normal
    state of a file being appended to and costs only that line.
    """
    journal = Path(run_dir) / "journal.jsonl"
    if not journal.is_file():
        return None
    try:
        text = journal.read_text()
    except OSError:
        return None
    waves = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if (
            isinstance(record, dict)
            and record.get("component") == "fanout"
            and record.get("event") == "wave"
        ):
            waves += 1
    return waves


def _count_upheld_findings(reviews_dir: Path) -> Optional[int]:
    """Upheld verdicts across every review file this run wrote.

    ISSUE-104: no live run writes this directory yet (the §1.2 reviews writer is
    not landed), so an absent source reads as None — "not measured" — rather than
    a fabricated measured 0 that a report column would render as a real finding
    count. When the writer lands and a run records reviews/<id>.json with the
    verdict shape below, the count becomes a real datum with no reader change.
    """
    if not reviews_dir.is_dir():
        return None
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


def exclusion_reason(row: Dict[str, Any]) -> Optional[str]:
    """Why this recorded cell leaves the pass rate, or None when it stays.

    One predicate for every arm. `harness-error` is the driver failing to run
    the cell at all, which is never a model result; `plugin-absent` is a
    conductor session nothing gated, which is a fact about the harness rather
    than about the work. Neither is reachable by only one arm through this
    function: a baseline cell that spawn-failed excludes exactly as a conductor
    one does.
    """
    if row.get("outcome") == "harness-error":
        return "harness-error"
    if row.get("pluginAbsent") is True:
        return "plugin-absent"
    return None


def aggregate(
    results: Sequence[Dict[str, Any]],
    tasks: Sequence[Task],
    model: str,
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    capability: str = DEFAULT_CAPABILITY,
) -> Dict[str, Any]:
    """Per-(arm, task) spread and per-arm totals over ONE (model, capability).

    Exclusion is by stratum, not by cell: when any arm's cell at a given
    (task, repetition) is excluded, every arm's cell there is excluded with it.
    Dropping only the arm that tripped would leave the other arms carrying
    whatever made it trip, which moves that arm's rate for a reason that has
    nothing to do with its output.

    A timeout leaves the pass-rate denominator and is counted on its own axis:
    the timeout is a cost datum, and scoring it as a wrong answer would turn
    process cost into measured quality loss.
    """
    by_id: Dict[str, Dict[str, Any]] = {}
    for row in results:
        by_id[row["cellId"]] = row

    task_ids = [task.id for task in tasks]
    tier_of = dict((task.id, task.tier) for task in tasks)
    tiers = [tier for tier in TIERS if tier in set(tier_of.values())]

    def cell_id_at(arm: str, task_id: str, rep: int) -> str:
        return Cell(model, capability, arm, task_id, rep).cell_id

    excluded_strata: Dict[Tuple[str, int], str] = {}
    for task_id in task_ids:
        for rep in range(1, reps + 1):
            for arm in arms:
                row = by_id.get(cell_id_at(arm, task_id, rep))
                if row is None:
                    continue
                reason = exclusion_reason(row)
                if reason is not None and (task_id, rep) not in excluded_strata:
                    excluded_strata[(task_id, rep)] = reason

    groups: Dict[str, Dict[str, Any]] = {}
    arm_totals: Dict[str, Any] = {}
    tier_totals: Dict[str, Dict[str, Any]] = dict(
        (tier, dict((arm, _empty_tier_row()) for arm in arms)) for tier in tiers
    )
    missing: List[str] = []

    for arm in arms:
        groups[arm] = {}
        arm_walls: List[int] = []
        totals = {
            "passes": 0,
            "scored": 0,
            "recorded": 0,
            "planned": 0,
            "excluded": 0,
            "timeouts": 0,
            "perTaskPasses": {},
            "routerErrorCells": [],
            "excludedCells": [],
            "timeoutCells": [],
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
            tier_row = tier_totals[tier_of[task_id]][arm]
            passes = 0
            scored = 0
            recorded = 0
            excluded = 0
            timeouts = 0
            outcomes: List[str] = []
            walls: List[int] = []
            for rep in range(1, reps + 1):
                cell_id = cell_id_at(arm, task_id, rep)
                row = by_id.get(cell_id)
                if row is None:
                    missing.append(cell_id)
                    continue
                recorded += 1
                if row.get("routerErrors"):
                    totals["routerErrorCells"].append(cell_id)
                stratum = excluded_strata.get((task_id, rep))
                if stratum is not None:
                    excluded += 1
                    totals["excludedCells"].append({"cellId": cell_id, "reason": stratum})
                    continue
                outcomes.append(row["outcome"])
                walls.append(row["wallClockMs"])
                tokens = row.get("tokens") or {}
                if isinstance(tokens.get("total"), int) and not isinstance(
                    tokens.get("total"), bool
                ):
                    totals["tokensTotal"] += tokens["total"]
                    tier_row["tokensTotal"] += tokens["total"]
                if tokens.get("partial"):
                    totals["tokensPartial"] = True
                    tier_row["tokensPartial"] = True
                for key in metric_values:
                    value = row.get(key)
                    if isinstance(value, int) and not isinstance(value, bool):
                        metric_values[key].append(value)
                for key in ("subSessions", "waves"):
                    value = row.get(key)
                    if isinstance(value, int) and not isinstance(value, bool):
                        tier_row[key] = (tier_row[key] or 0) + value
                if isinstance(row.get("stopKind"), str):
                    stop_kinds.append(row["stopKind"])
                tier_row["walls"].append(row["wallClockMs"])
                if row["outcome"] == "timeout":
                    timeouts += 1
                    totals["timeoutCells"].append(cell_id)
                    tier_row["timeouts"] += 1
                    continue
                scored += 1
                tier_row["scored"] += 1
                if row["passed"]:
                    passes += 1
                    tier_row["passes"] += 1

            flags = [1 if outcome == "pass" else 0 for outcome in outcomes if outcome != "timeout"]
            groups[arm][task_id] = {
                "passes": passes,
                "scored": scored,
                "recorded": recorded,
                "planned": reps,
                "excluded": excluded,
                "timeouts": timeouts,
                "outcomes": outcomes,
                "minPass": min(flags) if flags else 0,
                "maxPass": max(flags) if flags else 0,
                "wallClockMsTotal": sum(walls),
                "wallClockMsMedian": median_int(walls),
            }
            totals["passes"] += passes
            totals["scored"] += scored
            totals["recorded"] += recorded
            totals["planned"] += reps
            totals["excluded"] += excluded
            totals["timeouts"] += timeouts
            totals["perTaskPasses"][task_id] = passes
            arm_walls.extend(walls)

        totals["wallClockMsTotal"] = sum(arm_walls)
        totals["wallClockMsMedian"] = median_int(arm_walls)
        totals["metrics"] = dict(
            (key, sum(values) if values else None) for key, values in metric_values.items()
        )
        totals["stopKinds"] = stop_kinds
        arm_totals[arm] = totals

    for tier in tiers:
        for arm in arms:
            row = tier_totals[tier][arm]
            row["wallClockMsTotal"] = sum(row["walls"])
            row["wallClockMsMedian"] = median_int(row["walls"])
            del row["walls"]

    return {
        "model": model,
        "capability": capability,
        "groups": groups,
        "armTotals": arm_totals,
        "tierTotals": tier_totals,
        "excludedStrata": [
            {"taskId": task_id, "rep": rep, "reason": reason}
            for (task_id, rep), reason in sorted(excluded_strata.items())
        ],
        "missingCells": missing,
        "arms": list(arms),
        "taskIds": task_ids,
        "tiers": tiers,
        "reps": reps,
    }


def _empty_tier_row() -> Dict[str, Any]:
    """One (tier, arm) accumulator. subSessions and waves start unmeasured."""
    return {
        "passes": 0,
        "scored": 0,
        "timeouts": 0,
        "tokensTotal": 0,
        "tokensPartial": False,
        "subSessions": None,
        "waves": None,
        "walls": [],
    }


def trajectory_divergences(
    results: Sequence[Dict[str, Any]], tasks: Sequence[Task], arms: Sequence[str] = ARMS
) -> List[Dict[str, Any]]:
    """Every cell whose run stopped somewhere its task rules out.

    A stress task is written to strain a named mechanism, and the trajectory it
    declares is the claim under test. A coverage task names no mechanism and
    still declares the stop kinds it expects, authored as deliberately: a T1
    that lists `done` and `REPORTED` and not `TRIVIAL_DONE` is saying that a run
    routed into the plugin's trivial path took a route the task rules out. The
    declared list is the comparison for both, so the finding is not lost for the
    tasks that name no mechanism - which is most of the committed corpus.

    A divergence is a different thing from a cell that failed its hidden test,
    and is reported as one: a cell can pass its gauge and still have arrived
    somewhere the task says it should not have.
    """
    by_task = dict((task.id, task) for task in tasks)
    out: List[Dict[str, Any]] = []
    for row in results:
        if row["arm"] not in arms:
            continue
        task = by_task.get(row["taskId"])
        if task is None:
            continue
        observed = row.get("stopKind")
        if not isinstance(observed, str) or observed in task.expected_stop_kinds:
            continue
        out.append(
            {
                "cellId": row["cellId"],
                "arm": row["arm"],
                "taskId": task.id,
                "tier": task.tier,
                "mechanism": task.mechanism,
                "expected": list(task.expected_stop_kinds),
                "observed": observed,
                "why": task.expected_trajectory,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Rubric lane
# ---------------------------------------------------------------------------


def validate_rubric(row: Any) -> None:
    """Every pinned rubric key present, every score inside the closed range."""
    if not isinstance(row, dict):
        raise BenchError("a rubric record must be an object")
    cell_id = row.get("cellId")
    if not isinstance(cell_id, str) or not cell_id.strip():
        raise BenchError("a rubric record must name the cell it scores")
    reviewer = row.get("reviewer")
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise BenchError("rubric %s: 'reviewer' must name who scored it" % cell_id)
    scores = row.get("scores")
    if not isinstance(scores, dict):
        raise BenchError("rubric %s: 'scores' must be an object" % cell_id)
    for criterion in RUBRIC_CRITERIA:
        if criterion not in scores:
            raise BenchError("rubric %s: no score for %r" % (cell_id, criterion))
        value = scores[criterion]
        if value not in RUBRIC_SCORES or isinstance(value, bool):
            raise BenchError(
                "rubric %s: %r scored %r, which is outside %s"
                % (cell_id, criterion, value, ", ".join(str(s) for s in RUBRIC_SCORES))
            )
    for criterion in scores:
        if criterion not in RUBRIC_CRITERIA:
            raise BenchError(
                "rubric %s: %r is outside the criteria %s"
                % (cell_id, criterion, ", ".join(RUBRIC_CRITERIA))
            )
    findings = row.get("findings")
    if not isinstance(findings, list) or not all(isinstance(item, str) for item in findings):
        raise BenchError("rubric %s: 'findings' must be a list of strings" % cell_id)
    if not isinstance(row.get("notes"), str):
        raise BenchError("rubric %s: 'notes' must be text" % cell_id)


def rubric_path(rubric_dir: Any, cell_id: str) -> Path:
    """One file per reviewed cell, named for the cell."""
    return Path(rubric_dir) / ("%s.json" % cell_id.replace("/", "__"))


def write_rubric(rubric_dir: Any, row: Dict[str, Any]) -> Path:
    """Write one validated rubric record."""
    validate_rubric(row)
    target = rubric_path(rubric_dir, row["cellId"])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(row, indent=2) + "\n")
    return target


def load_rubrics(rubric_dir: Any) -> List[Dict[str, Any]]:
    """Every rubric record on disk, in filename order; none is not an error."""
    directory = Path(rubric_dir)
    if not directory.is_dir():
        return []
    rows: List[Dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError) as exc:
            raise BenchError("cannot read the rubric %s: %s" % (path, exc))
        validate_rubric(row)
        rows.append(row)
    return rows


def aggregate_rubrics(
    rubrics: Sequence[Dict[str, Any]],
    results: Sequence[Dict[str, Any]],
    arms: Sequence[str] = ARMS,
) -> Dict[str, Any]:
    """Per-arm rubric medians over the cells a human actually reviewed.

    An arm with no reviewed cell reports None per criterion - not measured -
    rather than a zero a table would render as a real score.
    """
    arm_of = dict((row["cellId"], row["arm"]) for row in results)
    scored: Dict[str, List[Dict[str, Any]]] = dict((arm, []) for arm in arms)
    for row in rubrics:
        arm = arm_of.get(row["cellId"])
        if arm in scored:
            scored[arm].append(row)
    out: Dict[str, Any] = {}
    for arm in arms:
        reviewed = scored[arm]
        out[arm] = {
            "reviewed": len(reviewed),
            "medians": dict(
                (
                    criterion,
                    median_int([row["scores"][criterion] for row in reviewed])
                    if reviewed
                    else None,
                )
                for criterion in RUBRIC_CRITERIA
            ),
            "findings": [finding for row in reviewed for finding in row["findings"]],
        }
    return out


def stratified_review_sample(
    plan: Sequence[Cell], tasks: Sequence[Task], per_stratum: int = 1
) -> List[Dict[str, Any]]:
    """Which cells a human should read, one stratum at a time.

    A full campaign is far too large to hand-review, and reviewing whatever is
    convenient is how a sample stops representing the campaign. The sample is a
    pure function of the plan, so two people asking for it get the same cells.
    """
    if per_stratum < 1:
        raise BenchError("per_stratum must be at least 1, got %r" % per_stratum)
    tier_of = dict((task.id, task.tier) for task in tasks)
    strata: Dict[Tuple[str, str], List[Cell]] = {}
    for cell in plan:
        tier = tier_of.get(cell.task_id)
        if tier is None:
            continue
        strata.setdefault((tier, cell.arm), []).append(cell)
    out: List[Dict[str, Any]] = []
    for tier, arm in sorted(strata):
        for cell in strata[(tier, arm)][:per_stratum]:
            out.append(
                {
                    "tier": tier,
                    "arm": arm,
                    "model": cell.model,
                    "capability": cell.capability,
                    "taskId": cell.task_id,
                    "rep": cell.rep,
                    "cellId": cell.cell_id,
                }
            )
    return out


def format_rate(passes: int, scored: int) -> str:
    return "%d/%d" % (passes, scored)



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
    models: Sequence[str],
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    capabilities: Sequence[str] = (DEFAULT_CAPABILITY,),
    rubrics: Sequence[Dict[str, Any]] = (),
    sweep: Optional[Dict[str, Any]] = None,
    task_filter: Optional[Dict[str, Any]] = None,
) -> str:
    """The markdown report: per-task spread first, comparison only after it.

    A bare aggregate delta over ten tasks and three repetitions is exactly the
    number this benchmark exists not to produce, so every arm-level line lives
    below the table that shows what it is made of - and the asymmetries the
    arms carry are printed above all of it, because they qualify every number
    underneath.

    ``task_filter`` is the run's provenance and this function has no other
    source for it: ``tasks`` is what to render, not what was declared. An
    omitted record therefore means unknown provenance, and the scope section
    says so rather than measuring the rendered list against itself.
    """
    strata = [(model, capability) for model in models for capability in capabilities]
    aggs = dict(
        (
            (model, capability),
            aggregate(results, tasks, model=model, arms=arms, reps=reps, capability=capability),
        )
        for model, capability in strata
    )
    task_ids = [task.id for task in tasks]
    tier_of = dict((task.id, task.tier) for task in tasks)
    lines: List[str] = ["# Conductor three-arm benchmark", ""]

    lines.extend(_scope_lines(task_filter))
    lines.extend(_method_lines(models, capabilities, arms, reps))
    lines.extend(_asymmetry_lines())
    if sweep is not None:
        lines.extend(_sweep_lines(sweep))
    lines.extend(_per_task_lines(aggs, strata, task_ids, arms))
    if len(arms) > 1:
        lines.extend(_arm_total_lines(aggs, strata, task_ids, arms))
    lines.extend(_separability_lines(aggs, strata, task_ids, arms))
    lines.extend(_cost_lines(aggs, strata, task_ids, arms))
    lines.extend(_tier_lines(aggs, strata, arms))
    lines.extend(_process_lines(aggs, strata, arms))
    lines.extend(_timeout_lines(aggs, strata, arms))
    lines.extend(_trajectory_lines(results, tasks, arms))
    lines.extend(_rubric_lines(rubrics, results, arms))
    lines.extend(_router_error_lines(aggs, strata, arms))
    lines.extend(_exclusion_lines(aggs, strata, arms))
    lines.extend(_missing_lines(aggs, strata))
    return "\n".join(lines)


def _stratum_label(model: str, capability: str) -> str:
    return "### %s / capability %s" % (model, capability)


def _selection_flags(task_filter: Dict[str, Any]) -> str:
    """The selection as the flags that carried it, or empty for none given.

    ``partial`` answers how much of the declared set a run covered, which is a
    different question from whether a selection was typed: a `--tier`
    enumeration naming every tier covers everything. Both answers are stated,
    and neither stands in for the other.
    """
    given = ["`--task %s`" % value for value in task_filter["taskIds"]]
    given += ["`--tier %s`" % value for value in task_filter["tiers"]]
    return ", ".join(given)


def _scope_lines(task_filter: Optional[Dict[str, Any]]) -> List[str]:
    """What the run covered, above every number that covering qualifies.

    The tables below are rendered over the planned tasks alone, so a narrowed
    run reads exactly like a whole one at a smaller scale unless the narrowing
    is said out loud. It is said here, first.

    An absent record is a report whose provenance was never handed to the
    renderer, which holds the tasks it was given and no manifest to measure
    them against. It states that and nothing more: a coverage claim assembled
    out of the rendered list alone is a claim about a set nobody supplied.
    """
    lines = [SECTION_SCOPE, ""]
    if task_filter is None:
        lines.append(
            "The task selection was not recorded with this report, so it makes "
            "no claim about how much of any declared task set the numbers below "
            "cover."
        )
        lines.append("")
        return lines
    selected = task_filter["selectedTaskIds"]
    given = _selection_flags(task_filter)
    if not task_filter["partial"]:
        lines.append(
            "This run covers the whole declared task set: %d task(s), %s."
            % (
                len(selected),
                "selected by %s, which excluded nothing" % given
                if given
                else "with no `--task` or `--tier` selection",
            )
        )
        lines.append("")
        return lines
    lines.append(
        "**This run is a selection out of the declared task set, not the "
        "campaign.** Every number below describes the selected tasks only, and "
        "a task outside the selection was never planned and is not a missing "
        "cell."
    )
    lines.append("")
    lines.append(
        "- Tasks planned: %s" % ", ".join("`%s`" % task_id for task_id in selected)
    )
    lines.append(
        "- `--task`: %s"
        % (", ".join("`%s`" % t for t in task_filter["taskIds"]) or "not given")
    )
    lines.append(
        "- `--tier`: %s"
        % (", ".join("`%s`" % t for t in task_filter["tiers"]) or "not given")
    )
    lines.append("")
    return lines


def _method_lines(
    models: Sequence[str],
    capabilities: Sequence[str],
    arms: Sequence[str],
    reps: int,
) -> List[str]:
    lines = [SECTION_METHOD, ""]
    lines.append(
        "- Models: %s. Cells are ordered by model, so one server loads each set "
        "of weights once." % ", ".join("`%s`" % model for model in models)
    )
    lines.append(
        "- Capabilities: %s. Every arm carries the dimension alike."
        % ", ".join("`%s`" % capability for capability in capabilities)
    )
    lines.append("- Repetitions: %d per (model, capability, arm, task) cell." % reps)
    lines.append(
        "- Arms: `baseline` is plain opencode; `doctrine` is plain opencode with "
        "every doctrine pack injected as one prompt file; `conductor` is the "
        "plugin loaded from the committed opencode fragment."
    )
    lines.append("- Arms reported: %s." % ", ".join(arms))
    lines.append(
        "- Every arm issued every request through the llama-router listen address, "
        "so token accounting is uniform across arms."
    )
    lines.append(
        "- Every arm's work tree is seeded from the same file set and the same "
        "commit, conductor's `.conductor/config.json` included."
    )
    lines.append(
        "- Scoring is the hidden test command's exit status, passed through. No "
        "partial credit, no output parsing, nothing model-graded."
    )
    lines.append(
        "- The baseline and doctrine arms ran no plugin, so the process "
        "metrics below are structurally unavailable for them and render as %s "
        "rather than zero." % NA
    )
    lines.append("")
    return lines


def _asymmetry_lines() -> List[str]:
    lines = [SECTION_ASYMMETRIES, ""]
    lines.append(
        "The arms are not identical, and these are the ways they are not. Both "
        "are part of the process under test and neither can be removed without "
        "changing conductor, so they qualify every number below."
    )
    lines.append("")
    for item in declared_asymmetries():
        lines.append("- **%s** - %s" % (item["dimension"], item["why"]))
        lines.append("  - conductor: %s" % item["conductor"])
        lines.append("  - plugin-absent arms: %s" % item["pluginAbsent"])
    lines.append("")
    return lines


def _sweep_lines(sweep: Dict[str, Any]) -> List[str]:
    lines = [SECTION_SWEEP, ""]
    lines.append("%s" % sweep["rationale"])
    lines.append("")
    lines.append("- Primary model: `%s`" % sweep["primaryModel"])
    lines.append("- Models swept: %s" % ", ".join("`%s`" % m for m in sweep["models"]))
    lines.append("- Tiers swept across every model: %s" % ", ".join(sweep["sweptTiers"]))
    lines.append("- Tiers on the primary model only: %s" % ", ".join(sweep["primaryOnlyTiers"]))
    lines.append("- Repetitions: %d" % sweep["reps"])
    lines.append("")
    return lines


def _per_task_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    task_ids: Sequence[str],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_PER_TASK, ""]
    for model, capability in strata:
        agg = aggs[(model, capability)]
        totals = agg["armTotals"]
        groups = agg["groups"]
        lines.append(_stratum_label(model, capability))
        lines.append("")
        for arm in arms:
            lines.append(
                "- %s: %s"
                % (arm, format_recorded(totals[arm]["recorded"], totals[arm]["planned"]))
            )
        lines.append("")
        lines.append("| Task | %s |" % " | ".join(arms))
        lines.append("|---|%s" % ("---|" * len(arms)))
        for task_id in task_ids:
            cells: List[str] = []
            for arm in arms:
                group = groups[arm][task_id]
                text = "%s (%s)" % (
                    format_rate(group["passes"], group["scored"]),
                    format_outcomes(group["outcomes"]),
                )
                if group["recorded"] != group["planned"]:
                    text += " %s" % format_recorded(group["recorded"], group["planned"])
                cells.append(text)
            lines.append("| %s | %s |" % (task_id, " | ".join(cells)))
        lines.append("")
    return lines


def _arm_total_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    task_ids: Sequence[str],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_ARM_TOTALS, ""]
    lines.append(
        "Read every line here against the per-task table above; none of it "
        "stands on its own."
    )
    overlapping = False
    for model, capability in strata:
        agg = aggs[(model, capability)]
        lines.append("")
        lines.append(_stratum_label(model, capability))
        lines.append("")
        for arm in arms:
            total = agg["armTotals"][arm]
            lines.append(
                "- %s: %s over %s"
                % (
                    arm,
                    format_rate(total["passes"], total["scored"]),
                    format_recorded(total["recorded"], total["planned"]),
                )
            )
        if _has_overlapping_pair(agg["groups"], task_ids, arms):
            overlapping = True
    if overlapping:
        lines.append("")
        lines.append(NOISE_NOTE)
    lines.append("")
    return lines


def _separability_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    task_ids: Sequence[str],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_SEPARABILITY, ""]
    lines.append(NO_VERDICT_NOTE)
    lines.append("")
    if len(arms) < 2:
        lines.append("One arm was reported, so there is no pair to separate.")
        lines.append("")
        return lines
    lines.append("| Task | Arm pair | ranges | separable |")
    lines.append("|---|---|---|---|")
    for model, capability in strata:
        groups = aggs[(model, capability)]["groups"]
        for task_id in task_ids:
            for first in range(len(arms)):
                for second in range(first + 1, len(arms)):
                    left = groups[arms[first]][task_id]
                    right = groups[arms[second]][task_id]
                    if left["passes"] == right["passes"]:
                        continue
                    separable = "no - within noise" if within_noise(left, right) else "yes"
                    lines.append(
                        "| %s | %s vs %s | %s vs %s | %s |"
                        % (
                            task_id,
                            arms[first],
                            arms[second],
                            format_rate(left["passes"], left["scored"]),
                            format_rate(right["passes"], right["scored"]),
                            separable,
                        )
                    )
    lines.append("")
    return lines


def _cost_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    task_ids: Sequence[str],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_COST, ""]
    lines.append(
        "Wall clock is an axis of its own here, never a discount on the quality "
        "column: conductor's process cost is reported as cost."
    )
    lines.append("")
    lines.append("| Model | Arm | total wall clock | median cell wall clock | total tokens |")
    lines.append("|---|---|---|---|---|")
    for model, capability in strata:
        for arm in arms:
            total = aggs[(model, capability)]["armTotals"][arm]
            lines.append(
                "| %s | %s | %s | %s | %s |"
                % (
                    model,
                    arm,
                    format_ms(total["wallClockMsTotal"]),
                    format_ms(total["wallClockMsMedian"]),
                    format_tokens(total["tokensTotal"], total["tokensPartial"]),
                )
            )
    lines.append("")
    lines.append("| Task | Arm | total wall clock | median cell wall clock |")
    lines.append("|---|---|---|---|")
    for model, capability in strata:
        groups = aggs[(model, capability)]["groups"]
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
    return lines


def _tier_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_TIER, ""]
    lines.append(
        "Quality and cost against scope. The tier at which the curves cross is "
        "the number this campaign exists to find; a single win rate is not."
    )
    lines.append("")
    lines.append("| Model | Tier | Arm | %s |" % " | ".join(TIER_COST_LABELS))
    lines.append("|---|---|---|%s" % ("---|" * len(TIER_COST_LABELS)))
    for model, capability in strata:
        agg = aggs[(model, capability)]
        for tier in agg["tiers"]:
            for arm in arms:
                row = agg["tierTotals"][tier][arm]
                lines.append(
                    "| %s | %s | %s | %s | %d | %s | %s | %s | %s | %s |"
                    % (
                        model,
                        tier,
                        arm,
                        format_rate(row["passes"], row["scored"]),
                        row["timeouts"],
                        format_ms(row["wallClockMsTotal"]),
                        format_ms(row["wallClockMsMedian"]),
                        format_tokens(row["tokensTotal"], row["tokensPartial"]),
                        format_metric(row["subSessions"]),
                        format_metric(row["waves"]),
                    )
                )
    lines.append("")
    return lines


def _process_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_PROCESS, ""]
    lines.append("| Model | Arm | %s |" % " | ".join(PROCESS_METRIC_LABELS))
    lines.append("|---|---|%s" % ("---|" * len(PROCESS_METRIC_LABELS)))
    for model, capability in strata:
        for arm in arms:
            total = aggs[(model, capability)]["armTotals"][arm]
            lines.append(
                "| %s | %s | %s | %s | %s | %s |"
                % (
                    model,
                    arm,
                    format_metric(total["metrics"]["schemaRetries"]),
                    format_metric(total["metrics"]["reviewFindingsUpheld"]),
                    format_metric(total["metrics"]["overridesUsed"]),
                    _format_stop_kinds(total["stopKinds"]),
                )
            )
    lines.append("")
    return lines


def _timeout_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_TIMEOUTS, ""]
    lines.append(TIMEOUT_NOTE)
    lines.append("")
    cells: List[Tuple[str, str]] = []
    for model, capability in strata:
        for arm in arms:
            for cell_id in aggs[(model, capability)]["armTotals"][arm]["timeoutCells"]:
                cells.append((arm, cell_id))
    lines.append("%d cell(s) ran out of their tier's wall clock." % len(cells))
    for arm, cell_id in cells:
        lines.append("- %s" % cell_id)
    lines.append("")
    return lines


def _trajectory_lines(
    results: Sequence[Dict[str, Any]], tasks: Sequence[Task], arms: Sequence[str]
) -> List[str]:
    lines = [SECTION_TRAJECTORIES, ""]
    divergences = trajectory_divergences(results, tasks, arms=arms)
    lines.append(
        "%d cell(s) stopped somewhere their task rules out. Every task declares "
        "the stop kinds it expects, whether or not it names a mechanism to "
        "strain, and a divergence here is the finding; it is neither a pass nor "
        "a fail." % len(divergences)
    )
    if divergences:
        lines.append("")
        lines.append("| Cell | Mechanism | expected stop | observed stop | expected trajectory |")
        lines.append("|---|---|---|---|---|")
        for row in divergences:
            lines.append(
                "| %s | %s | %s | %s | %s |"
                % (
                    row["cellId"],
                    row["mechanism"],
                    ", ".join(row["expected"]),
                    row["observed"],
                    row["why"],
                )
            )
    lines.append("")
    return lines


def _rubric_lines(
    rubrics: Sequence[Dict[str, Any]],
    results: Sequence[Dict[str, Any]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_RUBRIC, ""]
    lines.append(
        "Hand-scored on a stratified sample. The pass rate answers whether an "
        "arm is better on average; this answers whether its output is something "
        "a person would keep."
    )
    lines.append("")
    summary = aggregate_rubrics(rubrics, results, arms=arms)
    lines.append("| Arm | cells reviewed | %s |" % " | ".join(RUBRIC_CRITERIA))
    lines.append("|---|---|%s" % ("---|" * len(RUBRIC_CRITERIA)))
    for arm in arms:
        row = summary[arm]
        lines.append(
            "| %s | %d | %s |"
            % (
                arm,
                row["reviewed"],
                " | ".join(format_metric(row["medians"][c]) for c in RUBRIC_CRITERIA),
            )
        )
    findings = [(arm, finding) for arm in arms for finding in summary[arm]["findings"]]
    if findings:
        lines.append("")
        lines.append(
            "Findings a score cannot carry - output whose shape, rather than "
            "whose answer, is the result:"
        )
        for arm, finding in findings:
            lines.append("- %s: %s" % (arm, finding))
    lines.append("")
    return lines


def _router_error_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_ROUTER_ERRORS, ""]
    cells: List[str] = []
    for model, capability in strata:
        for arm in arms:
            cells.extend(aggs[(model, capability)]["armTotals"][arm]["routerErrorCells"])
    lines.append(
        "%d cell(s) saw a non-2xx router response. Their pass or fail is recorded "
        "but the infrastructure failure is named here rather than averaged in."
        % len(cells)
    )
    for cell_id in cells:
        lines.append("- %s" % cell_id)
    lines.append("")
    return lines


def _exclusion_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]],
    strata: Sequence[Tuple[str, str]],
    arms: Sequence[str],
) -> List[str]:
    lines = [SECTION_EXCLUSIONS, ""]
    lines.append(
        "Exclusion is arm-symmetric: one predicate decides it for every arm, "
        "and an excluded cell takes its counterparts in the other arms with it, "
        "so no arm keeps the cells another arm found impossible."
    )
    lines.append("")
    total = 0
    for model, capability in strata:
        for arm in arms:
            total += len(aggs[(model, capability)]["armTotals"][arm]["excludedCells"])
    lines.append("%d cell(s) left both the numerator and the denominator." % total)
    lines.append("")
    lines.append("| Arm | excluded | cells |")
    lines.append("|---|---|---|")
    for model, capability in strata:
        for arm in arms:
            rows = aggs[(model, capability)]["armTotals"][arm]["excludedCells"]
            lines.append(
                "| %s | %d | %s |"
                % (
                    arm,
                    len(rows),
                    ", ".join("%s (%s)" % (r["cellId"], r["reason"]) for r in rows) or NA,
                )
            )
    lines.append("")
    return lines


def _missing_lines(
    aggs: Dict[Tuple[str, str], Dict[str, Any]], strata: Sequence[Tuple[str, str]]
) -> List[str]:
    lines = [SECTION_MISSING, ""]
    cells: List[str] = []
    for model, capability in strata:
        cells.extend(aggs[(model, capability)]["missingCells"])
    lines.append(
        "%d planned cell(s) have no recorded result. They are counted neither as "
        "passes nor as failures." % len(cells)
    )
    for cell_id in cells:
        lines.append("- %s" % cell_id)
    lines.append("")
    return lines



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
    router_config: Dict[str, Any],
    base_config: Dict[str, Any],
    per_slot_ctx: int,
) -> Callable[[Cell, Task, Any], Dict[str, Any]]:
    """The live cell runner: one closure over the run-wide settings.

    The model comes from the cell rather than from this closure, because model
    is a matrix dimension: one plan carries several of them. The served window
    is run-wide: one server, one slot size, probed once before the first cell.
    """

    def runner(cell: Cell, task: Task, cell_dir: Any) -> Dict[str, Any]:
        return run_cell(
            cell,
            task,
            cell_dir=cell_dir,
            model=cell.model,
            router_config=router_config,
            base_config=base_config,
            timeout_sec=task.run_timeout_sec,
            per_slot_ctx=per_slot_ctx,
        )

    return runner


def run_benchmark(
    tasks: Sequence[Task],
    results_dir: Any,
    report_path: Any,
    work_root: Any,
    models: Sequence[str],
    arms: Sequence[str] = ARMS,
    reps: int = DEFAULT_REPS,
    capabilities: Sequence[str] = (DEFAULT_CAPABILITY,),
    plan: Optional[Sequence[Cell]] = None,
    sweep: Optional[Dict[str, Any]] = None,
    rubric_dir: Optional[Any] = None,
    report_only: bool = False,
    task_filter: Optional[Dict[str, Any]] = None,
    cell_runner: Optional[Callable[[Cell, Task, Any], Dict[str, Any]]] = None,
    router_config: Optional[Dict[str, Any]] = None,
    base_config: Optional[Dict[str, Any]] = None,
    per_slot_ctx: Optional[int] = None,
) -> Dict[str, Any]:
    """Execute the plan, skipping cells already on disk, then write the report.

    A cell whose result file exists is reused verbatim and its work tree is not
    even re-created, so an overnight that dies resumes where it stopped.
    """
    results_path = Path(results_dir)
    report = Path(report_path)
    root = Path(work_root)
    cells = (
        list(plan)
        if plan is not None
        else build_run_plan(
            tasks, arms=arms, reps=reps, models=models, capabilities=capabilities
        )
    )
    by_task = dict((task.id, task) for task in tasks)

    executed: List[str] = []
    skipped: List[str] = []
    rows: List[Dict[str, Any]] = []

    if report_only:
        # The plan is what a run covers, and a rebuild covers the same thing: a
        # cell belonging to a task outside the selection is not this report's to
        # describe. The scope section states that every number below it
        # describes the selected tasks only, and the rubric lane keys off these
        # rows with no task list of its own to filter by, so an unfiltered read
        # renders another task's hand-scored medians and findings under a
        # heading that just said otherwise.
        rows = [row for row in load_results(results_path) if row["taskId"] in by_task]
    else:
        runner = cell_runner
        if runner is None:
            live_router_config = (
                router_config if router_config is not None else load_router_config(ROUTER_CONFIG_PATH)
            )
            runner = make_cell_runner(
                router_config=live_router_config,
                base_config=base_config if base_config is not None else DEFAULT_BASE_CONFIG,
                per_slot_ctx=(
                    per_slot_ctx
                    if per_slot_ctx is not None
                    else served_per_slot_context(live_router_config, models[0])
                ),
            )
        for cell in cells:
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
    report.write_text(
        render_report(
            rows,
            tasks,
            models=models,
            arms=arms,
            reps=reps,
            capabilities=capabilities,
            rubrics=load_rubrics(rubric_dir) if rubric_dir is not None else (),
            sweep=sweep,
            task_filter=task_filter,
        )
    )
    return {
        "results": rows,
        "skipped": skipped,
        "executed": executed,
        "reportPath": report,
        "plan": cells,
    }


def verify_tasks(
    tasks: Sequence[Task],
    work_root: Any,
    timeout_sec: float = VERIFY_TIMEOUT_SEC,
    test_runner: Optional[Callable[[Sequence[str], Any, float], CommandOutcome]] = None,
) -> Dict[str, Any]:
    """Prove every hidden test FAILS on its unmodified seed.

    A hidden test that already passes on the seed measures nothing: every arm
    would score it, and the task would silently inflate all three.

    A gate the clock killed answered nothing, and is reported as its own
    outcome rather than folded into the non-zero codes. Folding it in is the
    one reading that certifies the opposite of the truth: a gate that passes on
    its seed - the hollowness this exists to catch - is also the gate that runs
    longest, because it never short-circuits on the refusal an honest seed
    trips first.
    """
    runner = default_test_runner if test_runner is None else test_runner
    exit_codes: Dict[str, Optional[int]] = {}
    passed_unmodified: List[str] = []
    timed_out: List[str] = []
    for task in tasks:
        scratch = Path(work_root) / task.id
        if scratch.exists():
            shutil.rmtree(str(scratch))
        scratch.mkdir(parents=True)
        materialize_files(scratch, task.seed_files)
        materialize_files(scratch, task.hidden_files)
        outcome = runner(list(task.hidden_test_command), scratch, timeout_sec)
        exit_codes[task.id] = outcome.exit_code
        if outcome.timed_out:
            timed_out.append(task.id)
        elif outcome.exit_code == 0:
            passed_unmodified.append(task.id)
    return {
        "ok": not passed_unmodified and not timed_out,
        "passedUnmodified": passed_unmodified,
        "timedOut": timed_out,
        "exitCodes": exit_codes,
    }


def verify_seed_green(
    tasks: Sequence[Task],
    work_root: Any,
    timeout_sec: float = VERIFY_TIMEOUT_SEC,
    test_runner: Optional[Callable[[Sequence[str], Any, float], CommandOutcome]] = None,
) -> Dict[str, Any]:
    """Prove every seeded repository PASSES its own visible suite untouched.

    A seed that starts red makes a red visible test ambiguous: nobody can tell
    the arm's damage from the task's. The hidden files are not materialized
    here, so this is the tree the model is handed, exactly.

    A suite the clock killed is reported as its own outcome, the same way the
    hidden-test floor reports one: a killed suite is not a red suite, and
    naming it one sends the operator after a seed that is not broken.
    """
    runner = default_test_runner if test_runner is None else test_runner
    exit_codes: Dict[str, Optional[int]] = {}
    started_red: List[str] = []
    timed_out: List[str] = []
    for task in tasks:
        scratch = Path(work_root) / task.id
        if scratch.exists():
            shutil.rmtree(str(scratch))
        scratch.mkdir(parents=True)
        materialize_files(scratch, task.seed_files)
        outcome = runner(list(task.repo_test_command), scratch, timeout_sec)
        exit_codes[task.id] = outcome.exit_code
        if outcome.timed_out:
            timed_out.append(task.id)
        elif outcome.exit_code != 0:
            started_red.append(task.id)
    return {
        "ok": not started_red and not timed_out,
        "startedRed": started_red,
        "timedOut": timed_out,
        "exitCodes": exit_codes,
    }


def work_root_problem(work_root: Path) -> str:
    """Why a work root cannot be used, or the empty string.

    A cell's cwd is <work_root>/<model>/<capability>/<arm>/<task>/rN/repo, so a
    work root under this repository sits a constant number of `..` segments from
    bench/corpus/**/hidden/**, where every answer key the campaign grades
    against lives. The driver keeps the hidden files out of the work tree until
    opencode has exited; a relative path around that ordering defeats it, and
    nothing in a cell's record would tell such a cell from an honest pass.
    """
    resolved = Path(work_root).expanduser().resolve()
    if _is_within(resolved, REPO_ROOT.resolve()):
        return (
            "work root %s lies inside %s, which puts every graded gauge a constant "
            "relative path from every cell; name one outside the repository"
            % (resolved, REPO_ROOT)
        )
    return ""


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
    parser.add_argument("--run-manifest", default=str(RUN_MANIFEST_PATH), dest="run_manifest")
    parser.add_argument("--rubric-dir", default=str(RUBRIC_DIR), dest="rubric_dir")
    parser.add_argument("--seed-green", action="store_true", dest="seed_green")
    parser.add_argument("--plan-only", action="store_true", dest="plan_only")
    parser.add_argument("--sweep", action="store_true", dest="sweep")
    # Repeatable: model is a matrix dimension, and the plan is grouped by it.
    # Absent, the model is the manifest's own `defaults.model`, so a manifest
    # cannot declare one model and plan another.
    parser.add_argument(
        "--model",
        action="append",
        dest="models",
        help="repeatable; default: the manifest's defaults.model",
    )
    parser.add_argument("--capability", action="append", dest="capabilities")
    # Repeatable: a selection unions inside a dimension and intersects across
    # the two. --tier is spelled against the closed vocabulary so argparse
    # refuses an unknown one before the manifest is even read.
    parser.add_argument("--task", action="append", dest="task_ids")
    parser.add_argument("--tier", action="append", dest="tiers", choices=TIERS)
    parser.add_argument("--review-sample", type=int, default=0, dest="review_sample")
    # Left unset rather than defaulted, so "the operator typed the default" and
    # "the operator typed nothing" stay distinguishable: --sweep reads the
    # repetition count from the manifest and refuses to be handed a second one.
    parser.add_argument(
        "--reps",
        type=int,
        default=None,
        help="repetitions per (arm, task) cell; default: %d" % DEFAULT_REPS,
    )
    # The wall clock one gate gets under --verify-tasks and --seed-green. A
    # corpus gate that compiles a reference and runs timed workloads needs more
    # than the floor's default on a loaded machine, and a killed gate proves
    # nothing either way.
    parser.add_argument(
        "--verify-timeout",
        type=float,
        default=float(VERIFY_TIMEOUT_SEC),
        dest="verify_timeout",
        help="seconds one hidden test or visible suite gets; default: %d" % VERIFY_TIMEOUT_SEC,
    )
    parser.add_argument(
        "--router-config", default=str(ROUTER_CONFIG_PATH), dest="router_config"
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """The command line: a task check, a dry run, a report rebuild, or a run."""
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        manifest = load_manifest(Path(args.manifest))
    except BenchError as exc:
        print("bench: %s" % exc)
        return 2
    requested_task_ids = list(args.task_ids) if args.task_ids else []
    requested_tiers = list(args.tiers) if args.tiers else []

    # The sweep block is the manifest's own declared campaign shape - which
    # tiers run on which models, on which capabilities, for how many
    # repetitions - and a command-line selection is a second, narrower
    # statement of what to run. Composed, the plan is neither: the sweep's model
    # list would still name models a tier selection had emptied, and the
    # report's sweep section would describe a campaign that did not happen. A
    # narrower sweep is a narrower sweep block.
    #
    # Every flag the sweep branch overwrites is named here. Accepting one and
    # discarding it is worse than refusing it: `--sweep --reps 1` plans the
    # manifest's repetitions over a lane whose cells are hours long, and
    # `--sweep --model X` measures a model the operator did not name, which is
    # the confound the one-model campaign rule exists to prevent.
    if args.sweep:
        composed = [
            flag
            for flag, given in (
                ("--task", bool(requested_task_ids)),
                ("--tier", bool(requested_tiers)),
                ("--model", args.models is not None),
                ("--capability", args.capabilities is not None),
                ("--reps", args.reps is not None),
            )
            if given
        ]
        if composed:
            print(
                "bench: --sweep runs the shape the manifest declares; state %s "
                "in the manifest's sweep block rather than on the command line"
                % ", ".join(composed)
            )
            return 2

    problem = work_root_problem(Path(args.work_root))
    if problem:
        print("bench: %s" % problem)
        return 2

    try:
        tasks = select_tasks(
            manifest.tasks, task_ids=requested_task_ids, tiers=requested_tiers
        )
    except BenchError as exc:
        print("bench: %s" % exc)
        return 2
    task_filter = task_filter_record(
        manifest.tasks, tasks, task_ids=requested_task_ids, tiers=requested_tiers
    )

    # The preflight covers what this invocation will launch. A whole-set run
    # still checks every committed task, which is where a broken runner is
    # caught; a selection is not blocked by the runner of a task it excludes.
    problems = check_commands_spawnable(tasks)
    if problems:
        for problem in problems:
            print("bench: %s" % problem)
        return 2

    if args.verify_tasks:
        report = verify_tasks(
            tasks, work_root=Path(args.work_root), timeout_sec=args.verify_timeout
        )
        timed_out = set(report["timedOut"])
        for task in tasks:
            if task.id in timed_out:
                print(
                    "%s: hidden test timed out after %gs and answered nothing"
                    % (task.id, args.verify_timeout)
                )
            else:
                print(
                    "%s: hidden test exited %d on the unmodified seed"
                    % (task.id, report["exitCodes"][task.id])
                )
        if report["ok"]:
            print("every hidden test failed on its unmodified seed")
            return 0
        if report["passedUnmodified"]:
            print(
                "these tasks measure nothing, their hidden test passed unmodified: %s"
                % ", ".join(report["passedUnmodified"])
            )
        if report["timedOut"]:
            print(
                "these gates were killed on the clock, so this floor proves "
                "nothing about them; raise --verify-timeout: %s"
                % ", ".join(report["timedOut"])
            )
        return 1

    if args.seed_green:
        green = verify_seed_green(
            tasks, work_root=Path(args.work_root), timeout_sec=args.verify_timeout
        )
        timed_out = set(green["timedOut"])
        for task in tasks:
            if task.id in timed_out:
                print(
                    "%s: visible suite timed out after %gs and answered nothing"
                    % (task.id, args.verify_timeout)
                )
            else:
                print(
                    "%s: visible suite exited %d on the unmodified seed"
                    % (task.id, green["exitCodes"][task.id])
                )
        if green["ok"]:
            print("every seeded repository starts green")
            return 0
        if green["startedRed"]:
            print(
                "these seeds do not start green, so a red visible test would not be "
                "the arm's doing: %s" % ", ".join(green["startedRed"])
            )
        if green["timedOut"]:
            print(
                "these suites were killed on the clock, so this floor proves "
                "nothing about them; raise --verify-timeout: %s"
                % ", ".join(green["timedOut"])
            )
        return 1

    if args.sweep:
        models = list(manifest.sweep["models"])
        capabilities = list(manifest.sweep["capabilities"])
        reps = manifest.sweep["reps"]
        plan = build_sweep_plan(manifest)
    else:
        models = list(args.models) if args.models else [manifest.defaults["model"]]
        capabilities = list(args.capabilities) if args.capabilities else [DEFAULT_CAPABILITY]
        reps = DEFAULT_REPS if args.reps is None else args.reps
        plan = build_run_plan(tasks, reps=reps, models=models, capabilities=capabilities)

    run_manifest = build_run_manifest(
        manifest,
        models=models,
        reps=reps,
        capabilities=capabilities,
        tasks=tasks,
        filters=task_filter,
    )
    write_run_manifest(Path(args.run_manifest), run_manifest)

    if args.review_sample:
        for row in stratified_review_sample(plan, tasks, per_stratum=args.review_sample):
            print("review %s (tier %s, arm %s)" % (row["cellId"], row["tier"], row["arm"]))
        return 0

    if args.plan_only:
        print("run manifest at %s" % args.run_manifest)
        if task_filter["partial"]:
            print(
                "selection: %d of %d task(s) - %s"
                % (
                    len(tasks),
                    len(manifest.tasks),
                    ", ".join(task_filter["selectedTaskIds"]),
                )
            )
        for model in models:
            grouped = [cell for cell in plan if cell.model == model]
            print("%s: %d cell(s)" % (model, len(grouped)))
            for cell in grouped:
                print("  %s" % cell.cell_id)
        print("%d cell(s) planned over %d model(s)" % (len(plan), len(models)))
        return 0

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
        models=models,
        reps=reps,
        capabilities=capabilities,
        plan=plan,
        sweep=manifest.sweep,
        task_filter=task_filter,
        rubric_dir=Path(args.rubric_dir),
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
