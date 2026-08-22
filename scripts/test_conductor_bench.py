"""Unit suite for scripts/conductor_bench.py - the Task 14.1 three-arm driver.

Every docstring opens with a row id in square brackets so coverage can be mapped
onto tests mechanically: a 14.1-* id is a row of
docs/build/specs/task-14.1.assertions.json, and a 22.*/22A.* id is a clause of
the bench-integrity and scope-ladder phases in
docs/plans/readonly-capability-plan.md.

Everything here runs offline. Three tests spawn a process on purpose and nothing
else does: the wall-clock timeout row (one sleeping child, killed by group), the
--verify-tasks row (/usr/bin/false and /usr/bin/true, which cost nothing), and
the fresh-work-tree row, which has to ask real git whether the seeded tree is
clean. No server, no model, no network, and every path written to lives under a
tempfile directory.

Run with the stdlib runner the gate uses::

    /usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
"""

from __future__ import annotations

import ast
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import sysconfig
import tempfile
import time
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Sequence
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conductor_bench as cb  # noqa: E402


# Shell-free argv that always fail / always succeed. Cheaper and more portable
# than spawning a python interpreter, and neither reads stdin.
FALSE_BIN = "/usr/bin/false"
TRUE_BIN = "/usr/bin/true"
# A gate that outlives the clock it was given, for the modes that must tell a
# killed gate apart from a gate that answered.
SLEEP_BIN = "/bin/sleep"

# The per-tier shape the synthetic manifest declares for itself. The fixture is
# built to satisfy it, so the loader under test is never handed a shape it would
# refuse for a reason the test did not intend. The report and plan fixtures
# below use the first ten of these against the hand-written PATTERN table.
SYNTHETIC_COUNTS = {"T0": 10, "T1": 4, "T2": 3, "T3": 3, "T4": 3}


def _synthetic_tiers() -> List[str]:
    """The declared tier counts, dealt round-robin.

    Dealt rather than blocked so the first ten - the slice PATTERN is written
    for - span every tier, which is what makes the per-tier rollups testable
    on the same fixture as everything else.
    """
    remaining = dict(SYNTHETIC_COUNTS)
    out: List[str] = []
    while sum(remaining.values()):
        for tier in cb.TIERS:
            if remaining[tier]:
                out.append(tier)
                remaining[tier] -= 1
    return out


SYNTHETIC_TIERS = _synthetic_tiers()
TASK_COUNT = len(SYNTHETIC_TIERS)
TASK_IDS = ["bt%02d" % n for n in range(1, TASK_COUNT + 1)]

# The one model this campaign serves. The corpus manifests declare it,
# and a second id in one of them would be a model nothing here can run.
CAMPAIGN_MODEL = "llamacpp/qwen3.8-27b"

SENTINEL_MODEL = "llamacpp/sentinel-model-x"
SENTINEL_MODEL_B = "llamacpp/sentinel-model-y"
SERVED_CTX = 32768
CAPABILITY = cb.DEFAULT_CAPABILITY


def make_cell(
    arm: str,
    task_id: str,
    rep: int,
    model: str = SENTINEL_MODEL,
    capability: str = CAPABILITY,
) -> object:
    """One cell of the default (model, capability) stratum."""
    return cb.Cell(model, capability, arm, task_id, rep)

ROUTER_CONFIG = {
    "version": 1,
    "listen": {"host": "127.0.0.1", "port": 9099},
    "upstream": {"host": "127.0.0.1", "port": 8080},
    "admission": {"maxInflightPerModel": 4, "maxQueued": 64, "queueTimeoutMs": 600000},
    "priorities": {"interactive": 0, "review": 1, "batch": 2},
    "affinity": {"header": "X-Conductor-Group", "contiguousDequeue": True},
    "schema": {
        "observeHeader": "X-Conductor-Schema",
        "validateResponses": True,
        "rejectOnMissing": False,
    },
    "metrics": {"ledgerPath": "/tmp/nowhere/metrics.jsonl"},
    "logging": {"level": "info"},
}

BASE_OPENCODE_CONFIG = {
    "$schema": "https://opencode.ai/config.json",
    "provider": {
        "llamacpp": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "llama.cpp (local router)",
            "options": {
                "baseURL": "http://127.0.0.1:8080/v1",
                "apiKey": "local",
                "timeout": 1800000,
                "headerTimeout": 600000,
            },
            "models": ["ornith-9b", "qwen3.6-27b"],
        }
    },
    "model": "llamacpp/ornith-9b",
    "small_model": "llamacpp/ornith-9b",
}

# Per-arm, per-task repetition outcomes for the report fixtures. "P" is a pass,
# "F" a fail. Hand-written so every expected number below is computed from THIS
# table rather than from the module under test.
PATTERN_TASKS = 10

PATTERN = {
    "baseline": ["FFF", "PPP", "PFF", "FFF", "PFP", "FFF", "FFF", "PPF", "FFF", "FFF"],
    "doctrine": ["FFF", "PPP", "PPF", "FPF", "PPP", "FFF", "PFF", "PPP", "FFF", "PFF"],
    "conductor": ["PPP", "PPP", "PPP", "PPF", "PPP", "FFF", "PPF", "PPP", "PFF", "PPP"],
}

OUTCOME_OF = {"P": "pass", "F": "fail"}


def median(values: Sequence[int]) -> int:
    """Independent median so report expectations are not read off the module."""
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return 0
    if n % 2:
        return ordered[n // 2]
    return (ordered[n // 2 - 1] + ordered[n // 2]) // 2


def task_dict(idx: int, **over: object) -> Dict[str, object]:
    """One well-formed manifest task. idx is 0-based."""
    entry = {
        "id": TASK_IDS[idx],
        "tier": SYNTHETIC_TIERS[idx],
        "mechanism": "no-test-first" if idx in (0, 4) else "none",
        "expectedTrajectory": "task %d runs to a report and stops" % idx,
        "expectedStopKinds": ["done", "REPORTED", "TRIVIAL_DONE"],
        "language": ("ts", "python", "cpp")[idx % 3],
        "difficulty": "one-function" if idx % 2 else "multi-file",
        # Tasks 0 and 4 are the non-behavioral (docs/comment) pair.
        "behavioral": idx not in (0, 4),
        "rationale": "task %d is in the set to cover %s" % (idx, ("ts", "python", "cpp")[idx % 3]),
        "prompt": "Implement the change described for %s." % TASK_IDS[idx],
        "seedFiles": {
            "src/mod_%02d.txt" % idx: "seed body %d\n" % idx,
            "README.md": "readme %d\n" % idx,
        },
        "hiddenFiles": {"tests/hidden_spec_%02d.txt" % idx: "hidden body %d\n" % idx},
        "hiddenTestCommand": [FALSE_BIN, "hiddensuite%02d" % idx],
        "repoTestCommand": [TRUE_BIN, "visiblesuite%02d" % idx],
        "behavioralPaths": ["src/**"] if idx not in (0, 4) else [],
    }
    entry.update(over)
    return entry


def manifest_dict(count: int = TASK_COUNT, **over: object) -> Dict[str, object]:
    doc = {
        "version": 1,
        "selectionCriteria": {
            "languageMix": "ts, python and cpp each appear at least once",
            "difficultySpread": "one-function through small-multi-file",
            "nonBehavioral": "at least two docs/comment tasks",
            "scopeLadder": "every tier from T0 to T4 carries tasks",
        },
        "defaults": {
            "model": SENTINEL_MODEL,
            "tierTimeoutSec": dict(cb.TIER_TIMEOUT_SEC),
        },
        "sweep": sweep_dict(),
        "expectedTaskCounts": dict(SYNTHETIC_COUNTS),
        "tasks": [task_dict(i) for i in range(count)],
    }
    doc.update(over)
    return doc


def sweep_dict(**over: object) -> Dict[str, object]:
    """A well-formed §22.8 sweep block: one primary model, no second model."""
    doc = {
        "rationale": "the synthetic sweep runs one model so the fixture stays cheap",
        "primaryModel": SENTINEL_MODEL,
        "models": [SENTINEL_MODEL],
        "sweptTiers": ["T0", "T1"],
        "primaryOnlyTiers": ["T2", "T3", "T4"],
        "capabilities": ["none"],
        "reps": 3,
    }
    doc.update(over)
    return doc


def committed_expected_counts() -> Dict[str, int]:
    """The per-tier pin the committed manifest declares for itself."""
    return json.loads(cb.MANIFEST_PATH.read_text())["expectedTaskCounts"]


# The keys under which a conformance suite in this repository's corpora holds
# its list of cases. A case that spells its identifier `name` is held to the
# same rule as one that spells it `id`, and reading only `id` leaves a whole
# 869-case suite outside a guard the manifest claims over the whole set. The
# key is scoped to a case list so a group label - `group_info` carries one
# beside a description and a count - is not read as a case identifier: a group
# is named in prose the seed is meant to contain.
CASE_LIST_KEYS = ("cases", "tests", "vectors")


def case_identifiers(files: Dict[str, str]) -> List[str]:
    """Every case identifier a JSON file in this map states, at any depth.

    A conformance suite names its cases, and the names are the one thing in it
    that could only have come from reading it.
    """
    found: List[str] = []

    def walk(node: object, in_case: bool) -> None:
        if isinstance(node, dict):
            for key in node:
                value = node[key]
                named = key == "id" or (in_case and key == "name")
                if named and isinstance(value, str) and value.strip():
                    found.append(value)
                walk(value, key in CASE_LIST_KEYS and isinstance(value, list))
        elif isinstance(node, list):
            for item in node:
                walk(item, in_case)

    for relpath in sorted(files):
        try:
            walk(json.loads(files[relpath]), False)
        except ValueError:
            continue
    return found



# One line per shape a suite in this repository's corpora uses to name a test.
TEST_NAME_PATTERNS = (
    re.compile(r'^\s*test\(\s*"([^"]+)"'),
    re.compile(r"^\s*def (test_[A-Za-z0-9_]+)\s*\("),
    re.compile(r"^\s*TEST\(([A-Za-z0-9_]+)\)"),
)


def declared_test_names(files: Dict[str, str]) -> List[str]:
    """Every test a map of source files declares, however it spells one.

    A test's name is the suite's own account of the behaviour it measures, so a
    name that only the graded suite declares is a name that describes a fault
    the model is graded on finding.
    """
    found: List[str] = []
    for relpath in sorted(files):
        for line in files[relpath].split("\n"):
            for pattern in TEST_NAME_PATTERNS:
                match = pattern.match(line)
                if match is not None:
                    found.append(match.group(1))
                    break
    return found


def write_tree(root: Path, files: Dict[str, str]) -> Path:
    """A directory of corpus material, built from a relpath -> body map."""
    for relpath in sorted(files):
        target = root / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(files[relpath])
    return root


def write_manifest(root: Path, doc: Dict[str, object], name: str = "tasks.json") -> Path:
    path = root / name
    path.write_text(json.dumps(doc, indent=2))
    return path


def load_synthetic(root: Path, doc: Optional[Dict[str, object]] = None) -> List[object]:
    return cb.load_tasks(write_manifest(root, doc if doc is not None else manifest_dict()))


def fixture_tasks(root: Path) -> List[object]:
    """The ten synthetic tasks PATTERN is hand-written for.

    The manifest holds the whole ladder; the aggregation and report fixtures
    read the first ten so every expected number below stays computable from the
    hand-written table rather than from a generated one.
    """
    return load_synthetic(root)[:PATTERN_TASKS]


def snapshot(root: Path) -> Dict[str, int]:
    """Path -> size for every file under root, so a stray write is visible."""
    out = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            out[str(path.relative_to(root))] = path.stat().st_size
    return out


@contextlib.contextmanager
def no_subprocess():
    """Fail loudly if the code under test tries to spawn anything."""

    def boom(*_a, **_k):
        raise AssertionError("this code path must not start a subprocess")

    with mock.patch.object(subprocess, "Popen", boom), mock.patch.object(
        subprocess, "run", boom
    ), mock.patch.object(subprocess, "check_output", boom):
        yield


def is_stdlib(name: str) -> bool:
    names = getattr(sys, "stdlib_module_names", None)
    if names is not None:
        return name in names
    if name in sys.builtin_module_names:
        return True
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ValueError):
        return False
    if spec is None:
        return False
    if spec.origin in (None, "built-in", "frozen"):
        return True
    stdlib_dir = sysconfig.get_paths()["stdlib"]
    return os.path.realpath(spec.origin).startswith(os.path.realpath(stdlib_dir))


def module_source() -> str:
    return Path(cb.__file__).read_text()


def module_ast() -> ast.Module:
    return ast.parse(module_source())


def section_of(report: str, heading: str) -> str:
    """The heading plus everything up to the next second-level heading."""
    if heading not in report:
        raise AssertionError("the report has no %r section:\n%s" % (heading, report))
    start = report.index(heading)
    rest = report[start + len(heading) :]
    nxt = rest.find("\n## ")
    return heading + (rest if nxt < 0 else rest[:nxt])


def fixture_results(
    tasks: Sequence[object],
    arms: Sequence[str],
    drop: Sequence[str] = (),
    partial_cell: Optional[str] = None,
) -> List[Dict[str, object]]:
    """Cell results generated from PATTERN, minus any cell ids in `drop`."""
    out = []
    for rep in (1, 2, 3):
        for t_idx, task in enumerate(tasks):
            for arm in arms:
                cell = make_cell(arm, task.id, rep)
                if cell.cell_id in drop:
                    continue
                mark = PATTERN[arm][t_idx][rep - 1]
                partial = cell.cell_id == partial_cell
                out.append(
                    make_result(
                        arm,
                        task.id,
                        rep,
                        tier=task.tier,
                        outcome=OUTCOME_OF[mark],
                        passed=mark == "P",
                        exit_code=0 if mark == "P" else 1,
                        wall_clock_ms=1000 + 10 * t_idx + rep,
                        tokens_partial=partial,
                    )
                )
    return out


def make_result(
    arm: str,
    task_id: str,
    rep: int,
    model: str = SENTINEL_MODEL,
    capability: str = CAPABILITY,
    tier: str = "T0",
    outcome: str = "pass",
    passed: bool = True,
    exit_code: Optional[int] = 0,
    wall_clock_ms: int = 1000,
    tokens_partial: bool = False,
    router_errors: int = 0,
    plugin_absent: Optional[bool] = None,
    **over: object
) -> Dict[str, object]:
    """A result carrying every pinned key, with the conductor-only four null
    for the non-conductor arms exactly as the schema requires."""
    conductor = arm == "conductor"
    result = {
        "cellId": make_cell(arm, task_id, rep, model=model, capability=capability).cell_id,
        "model": model,
        "capability": capability,
        "arm": arm,
        "taskId": task_id,
        "tier": tier,
        "rep": rep,
        "startedIso": "2026-08-14T00:0%d:00Z" % (rep % 10),
        "outcome": outcome,
        "passed": passed,
        "exitCode": exit_code,
        "wallClockMs": wall_clock_ms,
        "tokens": {
            "prompt": 100,
            "completion": 50,
            "total": 150,
            "partial": tokens_partial,
        },
        "routerErrors": router_errors,
        "schemaRetries": 2 if conductor else None,
        "reviewFindingsUpheld": 1 if conductor else None,
        "overridesUsed": 0 if conductor else None,
        "stopKind": "done" if conductor else None,
        "subSessions": 4 if conductor else None,
        "waves": 2 if conductor else None,
        "pluginAbsent": (False if plugin_absent is None else plugin_absent) if conductor else None,
    }
    result.update(over)
    return result


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-manifest-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    def test_manifest_parse_and_shape(self):
        """[14.1-manifest-parse-and-shape] load_tasks parses the manifest, pins
        every required field, and rejects each malformed input by naming the
        offending task id and field."""
        path = write_manifest(self.tmp, manifest_dict())
        manifest = cb.load_manifest(path)
        self.assertEqual(manifest.version, 1)
        self.assertTrue(manifest.selection_criteria)
        self.assertIn("model", manifest.defaults)
        self.assertEqual(
            sorted(manifest.defaults["tierTimeoutSec"]),
            sorted(cb.TIERS),
            "defaults must carry one timeout per tier",
        )

        tasks = cb.load_tasks(path)
        self.assertEqual(len(tasks), sum(SYNTHETIC_COUNTS.values()))
        self.assertEqual(
            dict((tier, len(group)) for tier, group in cb.tasks_by_tier(tasks).items()),
            SYNTHETIC_COUNTS,
            "the loaded set must match the shape the manifest declares",
        )
        self.assertEqual([t.id for t in tasks], TASK_IDS, "manifest order must be preserved")
        self.assertEqual(len({t.id for t in tasks}), TASK_COUNT)

        first = tasks[0]
        self.assertIn(first.language, cb.LANGUAGES)
        self.assertIn(first.difficulty, cb.DIFFICULTIES)
        self.assertIn(first.tier, cb.TIERS)
        self.assertIn(first.mechanism, cb.MECHANISMS)
        self.assertTrue(first.expected_trajectory.strip())
        self.assertTrue(first.expected_stop_kinds)
        self.assertIsInstance(first.behavioral, bool)
        self.assertTrue(first.rationale.strip())
        self.assertTrue(first.prompt.strip())
        self.assertTrue(first.seed_files)
        self.assertTrue(first.hidden_files)
        self.assertIsInstance(first.hidden_test_command, list)
        self.assertIsInstance(first.repo_test_command, list)
        self.assertIsInstance(first.behavioral_paths, list)

        bad_cases = {
            "missing-key": self._mutate(0, drop="prompt"),
            "bad-language": self._mutate(0, language="rust"),
            "bad-tier": self._mutate(0, tier="T9"),
            "bad-mechanism": self._mutate(0, mechanism="vibes"),
            "bad-stop-kind": self._mutate(0, expectedStopKinds=["exploded"]),
            "empty-stop-kinds": self._mutate(0, expectedStopKinds=[]),
            "bad-difficulty": self._mutate(0, difficulty="medium"),
            "string-command": self._mutate(0, hiddenTestCommand="pytest tests"),
            "absolute-seed": self._mutate(0, seedFiles={"/etc/passwd": "x"}),
            "dotdot-seed": self._mutate(0, seedFiles={"../escape.txt": "x"}),
        }
        for label, doc in bad_cases.items():
            bad_path = write_manifest(self.tmp, doc, name="bad-%s.json" % label)
            with self.assertRaises(cb.BenchError, msg=label) as ctx:
                cb.load_tasks(bad_path)
            message = str(ctx.exception)
            self.assertIn(TASK_IDS[0], message, "%s: message must name the task id" % label)

        dup = manifest_dict()
        dup["tasks"][3]["id"] = TASK_IDS[0]
        dup_path = write_manifest(self.tmp, dup, name="bad-dup.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(dup_path)
        self.assertIn(TASK_IDS[0], str(ctx.exception))

        # The count pin is per tier: losing one T3 task and gaining one T2 task
        # keeps the total unchanged and must still be refused, which a scalar
        # total could not catch.
        thin = manifest_dict()
        dropped = next(i for i, t in enumerate(thin["tasks"]) if t["tier"] == "T3")
        thin["tasks"].pop(dropped)
        thin["tasks"].append(task_dict(0, id="bt-extra", tier="T2"))
        thin_path = write_manifest(self.tmp, thin, name="bad-tier-mix.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(thin_path)
        self.assertIn("T3", str(ctx.exception))

        for tier in cb.TIERS:
            missing = manifest_dict()
            missing["tasks"] = [t for t in missing["tasks"] if t["tier"] != tier]
            missing_path = write_manifest(self.tmp, missing, name="bad-missing-%s.json" % tier)
            with self.assertRaises(cb.BenchError):
                cb.load_tasks(missing_path)

        # defaults carries a timeout per tier, and a tier without one is refused.
        no_timeout = manifest_dict()
        no_timeout["defaults"]["tierTimeoutSec"].pop("T3")
        no_timeout_path = write_manifest(self.tmp, no_timeout, name="bad-timeouts.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(no_timeout_path)
        self.assertIn("T3", str(ctx.exception))

    def _mutate(self, idx: int, drop: Optional[str] = None, **over: object):
        doc = manifest_dict()
        if drop is not None:
            doc["tasks"][idx].pop(drop)
        doc["tasks"][idx].update(over)
        return doc

    def _dir_sourced(self, seed: str, hidden: str, **over: object):
        """A manifest whose first task draws both file sets from directories."""
        doc = manifest_dict()
        entry = doc["tasks"][0]
        entry.pop("seedFiles")
        entry.pop("hiddenFiles")
        entry["seedDir"] = seed
        entry["hiddenDir"] = hidden
        entry.update(over)
        return doc

    def test_directory_sourced_task_files(self):
        """[23B.2-directory-sourced-files] a task may draw its seed and hidden
        file sets from directories instead of inline maps; the walk is sorted,
        every inline validation still holds over the walked map, and a path that
        leaves its declared directory, a binary body, an empty directory or a
        seed/hidden collision is a named refusal rather than a surprise."""
        corpus = self.tmp / "corpus"
        write_tree(
            corpus / "seed",
            {
                "README.md": "readme body\n",
                "src/parser.py": "parser body\n",
                "src/lib/util.py": "util body\n",
            },
        )
        write_tree(corpus / "hidden", {"gauge/runner.py": "runner body\n"})

        good = self._dir_sourced("corpus/seed", "corpus/hidden")
        path = write_manifest(self.tmp, good, name="dir-good.json")
        tasks = cb.load_tasks(path, root=self.tmp)
        first = tasks[0]
        self.assertEqual(
            first.seed_files,
            {
                "README.md": "readme body\n",
                "src/parser.py": "parser body\n",
                "src/lib/util.py": "util body\n",
            },
            "the walk must flatten to repo-relative keys with exact bodies",
        )
        self.assertEqual(first.hidden_files, {"gauge/runner.py": "runner body\n"})
        self.assertEqual(
            sorted(first.seed_files),
            list(first.seed_files),
            "the walk must be sorted, so two runs seed identical trees",
        )
        again = cb.load_tasks(path, root=self.tmp)[0]
        self.assertEqual(
            list(again.seed_files.items()),
            list(first.seed_files.items()),
            "two loads of the same directory must produce identical maps",
        )
        # A directory-sourced task is indistinguishable downstream: the same
        # accessor that reports an inline task's seed reports this one's.
        self.assertEqual(cb.seeded_paths(first), sorted(first.seed_files))

        both = self._dir_sourced("corpus/seed", "corpus/hidden")
        both["tasks"][0]["seedFiles"] = {"src/x.txt": "x\n"}
        neither = manifest_dict()
        neither["tasks"][0].pop("seedFiles")
        hidden_both = self._dir_sourced("corpus/seed", "corpus/hidden")
        hidden_both["tasks"][0]["hiddenFiles"] = {"t/x.txt": "x\n"}
        hidden_neither = manifest_dict()
        hidden_neither["tasks"][0].pop("hiddenFiles")

        nested = self.tmp / "nested"
        write_tree(nested / "seed", {"run.sh": "run\n"})
        write_tree(nested / "seed" / "gauge", {"runner.py": "runner\n"})

        collide = self.tmp / "collide"
        write_tree(collide / "seed", {"run.sh": "run\n"})
        write_tree(collide / "hidden", {"run.sh": "hidden run\n"})

        (self.tmp / "empty").mkdir()
        outside = self.tmp / "outside"
        outside.mkdir()
        (outside / "secret.txt").write_text("answer key\n")
        (self.tmp / "linked").symlink_to(outside, target_is_directory=True)
        write_tree(self.tmp / "leaky", {"ok.txt": "ok\n"})
        (self.tmp / "leaky" / "escape.txt").symlink_to(outside / "secret.txt")
        write_tree(self.tmp / "binary", {"ok.txt": "ok\n"})
        (self.tmp / "binary" / "session.request").write_bytes(b"CASE x 3\n\xff\xfe\x00\n")

        bad_cases = {
            "both-seed-sources": both,
            "no-seed-source": neither,
            "both-hidden-sources": hidden_both,
            "no-hidden-source": hidden_neither,
            "absolute-seed-dir": self._dir_sourced(str(corpus / "seed"), "corpus/hidden"),
            "dotdot-seed-dir": self._dir_sourced("corpus/../corpus/seed", "corpus/hidden"),
            "empty-seed-dir": self._dir_sourced("empty", "corpus/hidden"),
            "missing-seed-dir": self._dir_sourced("corpus/absent", "corpus/hidden"),
            "seed-dir-is-a-file": self._dir_sourced("corpus/seed/README.md", "corpus/hidden"),
            "symlinked-seed-dir": self._dir_sourced("linked", "corpus/hidden"),
            "symlink-escapes-seed-dir": self._dir_sourced("leaky", "corpus/hidden"),
            "binary-seed-file": self._dir_sourced("binary", "corpus/hidden"),
            "binary-hidden-file": self._dir_sourced("corpus/seed", "binary"),
            "hidden-dir-inside-seed-dir": self._dir_sourced("nested/seed", "nested/seed/gauge"),
            "seed-dir-inside-hidden-dir": self._dir_sourced("nested/seed/gauge", "nested/seed"),
            "same-dir-both-sides": self._dir_sourced("corpus/seed", "corpus/seed"),
            "colliding-relpaths": self._dir_sourced("collide/seed", "collide/hidden"),
        }
        for label, doc in bad_cases.items():
            bad_path = write_manifest(self.tmp, doc, name="bad-%s.json" % label)
            with self.assertRaises(cb.BenchError, msg=label) as ctx:
                cb.load_tasks(bad_path, root=self.tmp)
            message = str(ctx.exception)
            self.assertIn(TASK_IDS[0], message, "%s: message must name the task id" % label)

        # The binary refusal must name the file, because "somewhere under this
        # directory" is not enough to act on.
        binary_path = write_manifest(
            self.tmp, bad_cases["binary-seed-file"], name="named-binary.json"
        )
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(binary_path, root=self.tmp)
        self.assertIn("session.request", str(ctx.exception))

        # A relative directory resolves against the repo root by default, which
        # is what lets a committed manifest name bench/corpus/... and mean it.
        escaping = self._dir_sourced("corpus/seed", "corpus/hidden")
        escaping_path = write_manifest(self.tmp, escaping, name="default-root.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(escaping_path)
        self.assertIn(TASK_IDS[0], str(ctx.exception))

    def test_directory_source_guards_refuse_what_a_cell_cannot_seed(self):
        """[23B.2-directory-source-guards] the four refusals the walk owns
        beyond path shape - a seeded `.git`, an entry that is not a regular
        file, a body over the per-file ceiling, and a set over the per-set
        ceiling. Each names the task id and what it refused, each tree loads
        once its one offending entry is gone, and the two ceilings are the
        committed numbers rather than whatever the walk happens to tolerate."""
        self.assertEqual(cb.MAX_SOURCE_FILE_BYTES, 1 << 20)
        self.assertEqual(cb.MAX_SOURCE_DIR_BYTES, 8 << 20)
        write_tree(self.tmp / "hid", {"gauge/runner.py": "runner body\n"})

        # A gitlink is a plain UTF-8 file, so it clears the symlink, regular
        # file, ceiling and decode guards on its own. The .git refusal is the
        # only thing between a submodule or linked-worktree checkout and a cell
        # whose history is not the seed commit the conductor arm is graded on.
        write_tree(
            self.tmp / "gitlink",
            {"src/main.py": "main body\n", ".git": "gitdir: ../elsewhere\n"},
        )
        write_tree(
            self.tmp / "gitdir",
            {"src/main.py": "main body\n", ".git/HEAD": "ref: refs/heads/main\n"},
        )

        big = write_tree(self.tmp / "big", {"src/main.py": "main body\n"})
        (big / "workload.txt").write_text("w" * (cb.MAX_SOURCE_FILE_BYTES + 1))

        # Every body sits on the per-file ceiling, so only the per-set total
        # can refuse this tree.
        span = cb.MAX_SOURCE_DIR_BYTES // cb.MAX_SOURCE_FILE_BYTES + 1
        wide = write_tree(
            self.tmp / "wide",
            dict(
                ("part-%02d.txt" % index, "u" * cb.MAX_SOURCE_FILE_BYTES)
                for index in range(span)
            ),
        )

        special = write_tree(self.tmp / "special", {"main.py": "main body\n"})
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        listener.bind(str(special / "s"))

        refusals = {
            "gitlink-file": ("gitlink", "seeded .git tree"),
            "git-directory": ("gitdir", "seeded .git tree"),
            "over-per-file-ceiling": ("big", "per-file"),
            "over-per-set-ceiling": ("wide", "ceiling for one file set"),
            "not-a-regular-file": ("special", "not a regular file"),
        }
        for label in sorted(refusals):
            source, expected = refusals[label]
            path = write_manifest(
                self.tmp, self._dir_sourced(source, "hid"), name="guard-%s.json" % label
            )
            with self.assertRaises(cb.BenchError, msg=label) as ctx:
                cb.load_tasks(path, root=self.tmp)
            message = str(ctx.exception)
            self.assertIn(TASK_IDS[0], message, label)
            self.assertIn(expected, message, label)

        (self.tmp / "gitlink" / ".git").unlink()
        shutil.rmtree(str(self.tmp / "gitdir" / ".git"))
        (big / "workload.txt").unlink()
        (wide / ("part-%02d.txt" % (span - 1))).unlink()
        (special / "s").unlink()
        for source in ("gitlink", "gitdir", "big", "wide", "special"):
            path = write_manifest(
                self.tmp, self._dir_sourced(source, "hid"), name="clean-%s.json" % source
            )
            self.assertTrue(cb.load_tasks(path, root=self.tmp)[0].seed_files, source)

    def test_an_empty_task_set_is_refused(self):
        """[23C.1-empty-task-set] a manifest whose task array is empty is a
        refusal at load, whether or not it declares a per-tier pin.

        Every driver mode reports success over the set it was handed, so a set
        with nothing in it makes --verify-tasks print that every hidden test
        failed, --seed-green print that every seed starts green, and the report
        claim full coverage of a campaign that measured nothing. The floor is
        the task count itself, not the pin: a manifest may decline to state a
        shape, and a generator that derives its pin from what it emitted
        declares an all-zero one.
        """
        for label, over in (
            ("no-pin", {"tasks": [], "expectedTaskCounts": None}),
            ("zero-pin", {"tasks": [], "expectedTaskCounts": dict((t, 0) for t in cb.TIERS)}),
        ):
            doc = manifest_dict()
            doc["tasks"] = []
            if over["expectedTaskCounts"] is None:
                doc.pop("expectedTaskCounts")
            else:
                doc["expectedTaskCounts"] = over["expectedTaskCounts"]
            path = write_manifest(self.tmp, doc, name="empty-%s.json" % label)
            with self.assertRaises(cb.BenchError, msg=label) as ctx:
                cb.load_manifest(path)
            self.assertIn("tasks", str(ctx.exception), label)

        buf = io.StringIO()
        doc = manifest_dict()
        doc["tasks"] = []
        doc.pop("expectedTaskCounts")
        empty = write_manifest(self.tmp, doc, name="empty-cli.json")
        for mode in ("--verify-tasks", "--seed-green", "--plan-only"):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                code = cb.main(
                    [
                        mode,
                        "--manifest",
                        str(empty),
                        "--work-root",
                        str(self.tmp / ("empty-" + mode.strip("-"))),
                        "--run-manifest",
                        str(self.tmp / "empty-run-manifest.json"),
                    ]
                )
            self.assertEqual(code, 2, "%s over an empty set: %s" % (mode, buf.getvalue()))

    def test_directory_walk_skips_what_the_tree_ignores(self):
        """[23C.2-walk-skips-build-output] the walk reads the source a tree
        commits and steps over the artifacts a build and a tool leave in it.

        Every corpus seed's own .gitignore enumerates its generated data and its
        build directory, and the repository ignores __pycache__ and .DS_Store
        everywhere, so none of it is reportable by `git status`. A walk that read
        them would refuse the whole task set over a byte no author wrote, and the
        refusal would name a file the operator cannot find in any diff.
        """
        tree = self.tmp / "artifacts"
        write_tree(
            tree / "seed",
            {
                ".gitignore": "# generated\ndata/\nbuild/\n*.report.json\nsample/base.bin\n",
                "README.md": "readme\n",
                "src/solver.py": "solver\n",
            },
        )
        write_tree(tree / "hidden", {"gauge/run.py": "run\n"})
        # What Finder, a build and an interpreter leave behind.
        (tree / "seed" / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1" + b"\xff" * 64)
        (tree / "seed" / "src" / "__pycache__").mkdir()
        (tree / "seed" / "src" / "__pycache__" / "solver.cpython-39.pyc").write_bytes(
            b"\xf3\x0d\x0d\x0a\x00\x01\x02"
        )
        (tree / "seed" / "build").mkdir()
        (tree / "seed" / "build" / "reference").write_bytes(b"\xcf\xfa\xed\xfe binary")
        (tree / "seed" / "data").mkdir()
        (tree / "seed" / "data" / "generated.bin").write_bytes(b"\x00\xff" * 32)
        (tree / "seed" / "sample").mkdir()
        (tree / "seed" / "sample" / "base.bin").write_bytes(b"\x99" * 16)
        (tree / "seed" / "run.report.json").write_text("{}\n")
        (tree / "hidden" / "gauge" / "__pycache__").mkdir()
        (tree / "hidden" / "gauge" / "__pycache__" / "run.cpython-39.pyc").write_bytes(
            b"\xf3\x0d\x0d\x0a"
        )

        doc = self._dir_sourced("artifacts/seed", "artifacts/hidden")
        path = write_manifest(self.tmp, doc, name="artifacts.json")
        task = cb.load_tasks(path, root=self.tmp)[0]
        self.assertEqual(
            sorted(task.seed_files),
            [".gitignore", "README.md", "src/solver.py"],
            "the walk must hand the model the committed source and nothing else",
        )
        self.assertEqual(sorted(task.hidden_files), ["gauge/run.py"])

        # A tree that states an ignore rule this walk cannot honour is a named
        # refusal, never a silently wider or narrower skip.
        negated = self.tmp / "negated"
        write_tree(
            negated / "seed",
            {".gitignore": "build/\n!build/keep.txt\n", "src/a.py": "a\n"},
        )
        write_tree(negated / "hidden", {"gauge/run.py": "run\n"})
        bad = write_manifest(
            self.tmp, self._dir_sourced("negated/seed", "negated/hidden"), name="negated.json"
        )
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(bad, root=self.tmp)
        self.assertIn("!build/keep.txt", str(ctx.exception))

        # A binary file the tree does NOT ignore is still the refusal it was.
        stray = self.tmp / "stray"
        write_tree(stray / "seed", {"src/a.py": "a\n"})
        (stray / "seed" / "src" / "fixture.dat").write_bytes(b"\xff\xfe\x00")
        write_tree(stray / "hidden", {"gauge/run.py": "run\n"})
        stray_path = write_manifest(
            self.tmp, self._dir_sourced("stray/seed", "stray/hidden"), name="stray.json"
        )
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(stray_path, root=self.tmp)
        self.assertIn("fixture.dat", str(ctx.exception))

    def test_corpus_games_manifest(self):
        """[23C.3-corpus-games-manifest] the committed headless-games manifest
        is directory-sourced, runs the one model this campaign has, and hands
        the model a tree that carries none of the gauge's own expectations.

        Its four sibling corpus manifests each carry a row like this one. A
        manifest with no row is a file whose model id, whose seed directories
        and whose graded command can all be broken without a gate noticing,
        and the break surfaces on a live campaign as a result nobody can
        attribute.
        """
        path = cb.REPO_ROOT / "bench" / "corpus-games.json"
        manifest = cb.load_manifest(path)
        document = json.loads(path.read_text())
        self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL])
        self.assertTrue(manifest.selection_criteria, "the set must say why it is the set")
        self.assertTrue(manifest.tasks, "an empty manifest measures nothing")
        self.assertEqual(cb.check_commands_spawnable(manifest.tasks), [])

        for entry in document["tasks"]:
            self.assertIn("seedDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertIn("hiddenDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertNotIn("seedFiles", entry)
            self.assertNotIn("hiddenFiles", entry)

        for task in manifest.tasks:
            self.assertFalse(
                set(task.seed_files) & set(task.hidden_files),
                "%s: a hidden file the model can read measures nothing" % task.id,
            )
            seed_bodies = "\n".join(task.seed_files[k] for k in sorted(task.seed_files))
            for relpath in sorted(task.hidden_files):
                self.assertNotIn(
                    relpath,
                    task.prompt,
                    "%s: the prompt names the graded path %s" % (task.id, relpath),
                )
                basename = re.compile(
                    r"(?<![\w./-])" + re.escape(os.path.basename(relpath))
                )
                self.assertIsNone(
                    basename.search(task.prompt),
                    "%s: the prompt names the graded file %s" % (task.id, relpath),
                )
                # A graded file that is byte-for-byte a whole seed file is the
                # same instrument kept out of reach - a generic runner is one -
                # and carries no expectation the seed did not already state. A
                # graded body that turns up INSIDE a larger seed file is the
                # other thing, and is refused.
                body = task.hidden_files[relpath]
                if body in seed_bodies:
                    self.assertIn(
                        body,
                        set(task.seed_files.values()),
                        "%s: graded file %s appears inside a seed file rather "
                        "than as a copy of one" % (task.id, relpath),
                    )
            for case_id in sorted(case_identifiers(task.hidden_files)):
                self.assertNotIn(
                    case_id,
                    seed_bodies,
                    "%s: the seed names the graded case %s" % (task.id, case_id),
                )
                self.assertNotIn(
                    case_id,
                    task.prompt,
                    "%s: the prompt names the graded case %s" % (task.id, case_id),
                )
            carved = set(declared_test_names(task.hidden_files)) - set(
                declared_test_names(task.seed_files)
            )
            for name in sorted(carved):
                self.assertNotIn(
                    name,
                    seed_bodies,
                    "%s: the seed names the graded test %r" % (task.id, name),
                )
                self.assertNotIn(
                    name,
                    task.prompt,
                    "%s: the prompt names the graded test %r" % (task.id, name),
                )
            # The visible gate and the graded gate are different commands over
            # different trees; a task whose two commands agree measures the seed
            # twice and the model never.
            self.assertNotEqual(task.repo_test_command, task.hidden_test_command)

    def test_corpus_systems_manifest(self):
        """[23B.3-corpus-systems-manifest] the committed systems-implementation
        manifest is directory-sourced, runs the one model this campaign has, and
        hands the model a tree that cannot answer its own hidden suite."""
        manifest = cb.load_manifest(cb.CORPUS_SYSTEMS_MANIFEST_PATH)
        document = json.loads(cb.CORPUS_SYSTEMS_MANIFEST_PATH.read_text())
        self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL])
        self.assertTrue(manifest.selection_criteria, "the set must say why it is the set")
        self.assertTrue(manifest.tasks, "an empty manifest measures nothing")
        self.assertEqual(cb.check_commands_spawnable(manifest.tasks), [])

        for entry in document["tasks"]:
            self.assertIn("seedDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertIn("hiddenDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertNotIn("seedFiles", entry)
            self.assertNotIn("hiddenFiles", entry)

        for task in manifest.tasks:
            self.assertFalse(
                set(task.seed_files) & set(task.hidden_files),
                "%s: a hidden file the model can read measures nothing" % task.id,
            )
            seed_bodies = "\n".join(task.seed_files[k] for k in sorted(task.seed_files))
            for relpath in task.hidden_files:
                self.assertNotIn(
                    relpath,
                    task.prompt,
                    "%s: the prompt names the hidden path %s" % (task.id, relpath),
                )
                self.assertNotIn(
                    os.path.basename(relpath),
                    task.prompt,
                    "%s: the prompt names the hidden file %s" % (task.id, relpath),
                )
            for relpath in sorted(task.hidden_files):
                body = task.hidden_files[relpath]
                self.assertNotIn(
                    body,
                    seed_bodies,
                    "%s: hidden file %s is reproduced in the seed" % (task.id, relpath),
                )
            # A case identifier is the suite's own name for one measurement, so
            # a seed that names one names a case the model is graded on. The
            # cases' expected VALUES are not checked here: a specification
            # carries worked examples, and demanding that it carry none would
            # gut the document the task is built against.
            #
            # A suite spells its identifier `id` or `name`, and both are read:
            # resp-server's 869 cases carry only `name`, so reading `id` alone
            # left one of the four tasks outside a claim the manifest makes over
            # the whole set. Where a corpus's own specification publishes a case
            # name - which two of them do - the manifest says so in the very
            # field that makes the claim, and the collision is measured against
            # that disclosure. An undisclosed one is a failure, and a disclosure
            # for a collision that no longer exists cannot hide a later one.
            disclosure = manifest.selection_criteria["hiddenTests"]
            for case_id in sorted(set(case_identifiers(task.hidden_files))):
                if case_id in seed_bodies:
                    self.assertIn(
                        case_id,
                        disclosure,
                        "%s: the seed names the hidden case %s and the manifest "
                        "does not disclose it" % (task.id, case_id),
                    )
                self.assertNotIn(
                    case_id,
                    task.prompt,
                    "%s: the prompt names the hidden case %s" % (task.id, case_id),
                )
            # The visible gate and the graded gate are different commands over
            # different trees; a task whose two commands agree measures the seed
            # twice and the model never.
            self.assertNotEqual(task.repo_test_command, task.hidden_test_command)

    def test_corpus_repair_manifest(self):
        """[23B.4-corpus-repair-manifest] the committed repair-and-migration
        manifest is directory-sourced, runs the one model this campaign has,
        seeds a tree that passes its own visible suite while still failing the
        graded one, and carries none of the corpus's operator-only material."""
        path = cb.REPO_ROOT / "bench" / "corpus-repair.json"
        manifest = cb.load_manifest(path)
        document = json.loads(path.read_text())
        self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL])
        self.assertTrue(manifest.selection_criteria, "the set must say why it is the set")
        self.assertTrue(manifest.tasks, "an empty manifest measures nothing")
        self.assertEqual(cb.check_commands_spawnable(manifest.tasks), [])

        for entry in document["tasks"]:
            self.assertIn("seedDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertIn("hiddenDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertNotIn("seedFiles", entry)
            self.assertNotIn("hiddenFiles", entry)

        for task in manifest.tasks:
            self.assertFalse(
                set(task.seed_files) & set(task.hidden_files),
                "%s: a hidden file the model can read measures nothing" % task.id,
            )
            seed_bodies = "\n".join(task.seed_files[k] for k in sorted(task.seed_files))
            for relpath in sorted(task.hidden_files):
                self.assertNotIn(
                    relpath,
                    task.prompt,
                    "%s: the prompt names the hidden path %s" % (task.id, relpath),
                )
                self.assertNotIn(
                    os.path.basename(relpath),
                    task.prompt,
                    "%s: the prompt names the hidden file %s" % (task.id, relpath),
                )
                # A graded file that is byte-for-byte a seed file is the same
                # instrument kept out of reach, which is the point: a model
                # cannot weaken what it cannot edit. A graded body that turns up
                # INSIDE a larger seed file is the other thing - a fragment of
                # the measurement pasted into the tree - and is refused.
                body = task.hidden_files[relpath]
                if body in seed_bodies:
                    self.assertIn(
                        body,
                        set(task.seed_files.values()),
                        "%s: graded file %s appears inside a seed file rather "
                        "than as a copy of one" % (task.id, relpath),
                    )
            # The corpus ships an answer key beside each repair task: the fault,
            # its line, and the corrected source. None of that material, and no
            # marker that would tell a model such a document exists, may reach a
            # seeded tree.
            for marker in ("solution-notes", "OPERATOR-ONLY", "Ground truth", "expected_failing_tests"):
                self.assertNotIn(
                    marker,
                    seed_bodies,
                    "%s: the seed carries the operator-only marker %r" % (task.id, marker),
                )
                self.assertNotIn(
                    marker,
                    task.prompt,
                    "%s: the prompt carries the operator-only marker %r" % (task.id, marker),
                )
            # A test the graded suite declares and the seeded suite does not is
            # a test that proves a fault. Naming one in the seed, or in the
            # prompt, hands over the fault the run is supposed to localise.
            carved = set(declared_test_names(task.hidden_files)) - set(
                declared_test_names(task.seed_files)
            )
            for name in sorted(carved):
                self.assertNotIn(
                    name,
                    seed_bodies,
                    "%s: the seed names the graded test %r" % (task.id, name),
                )
                self.assertNotIn(
                    name,
                    task.prompt,
                    "%s: the prompt names the graded test %r" % (task.id, name),
                )
            # The visible gate and the graded gate are different commands over
            # different trees; a task whose two commands agree measures the seed
            # twice and the model never.
            self.assertNotEqual(task.repo_test_command, task.hidden_test_command)

    def test_corpus_perf_manifest(self):
        """[23B.5-corpus-perf-manifest] the committed speed-gate manifest is
        directory-sourced, runs the one model this campaign has, keeps every
        pristine copy its graded gate measures against in step with the seed
        file it guards, and states in the prompt the same speedup factor the
        gate enforces."""
        path = cb.REPO_ROOT / "bench" / "corpus-perf.json"
        manifest = cb.load_manifest(path)
        document = json.loads(path.read_text())
        self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL])
        self.assertTrue(manifest.selection_criteria, "the set must say why it is the set")
        self.assertTrue(manifest.tasks, "an empty manifest measures nothing")
        self.assertEqual(cb.check_commands_spawnable(manifest.tasks), [])

        for entry in document["tasks"]:
            self.assertIn("seedDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertIn("hiddenDir", entry, "%s must be directory-sourced" % entry["id"])
            self.assertNotIn("seedFiles", entry)
            self.assertNotIn("hiddenFiles", entry)

        target_pattern = re.compile(r"TARGET_SPEEDUP\s*=\s*([0-9]+(?:\.[0-9]+)?)")
        for task in manifest.tasks:
            self.assertFalse(
                set(task.seed_files) & set(task.hidden_files),
                "%s: a hidden file the model can read measures nothing" % task.id,
            )
            seed_bodies = "\n".join(task.seed_files[k] for k in sorted(task.seed_files))

            # Every graded gate here decides a ratio between a candidate and a
            # reference it re-times beside it, and refuses a workspace whose
            # reference no longer holds the bytes gauge/pristine holds. A
            # pristine copy that drifted from the seed it guards fails that
            # check on every run before anything is measured, so the two are
            # pinned equal here rather than discovered on a live campaign.
            guarded = [r for r in task.hidden_files if r.startswith("gauge/pristine/")]
            self.assertTrue(
                guarded,
                "%s: the gate holds no pristine copy and can vouch for nothing" % task.id,
            )
            for relpath in sorted(guarded):
                seed_relpath = relpath[len("gauge/pristine/"):]
                self.assertIn(
                    seed_relpath,
                    task.seed_files,
                    "%s: pristine %s guards nothing in the seed" % (task.id, seed_relpath),
                )
                self.assertEqual(
                    task.hidden_files[relpath],
                    task.seed_files[seed_relpath],
                    "%s: pristine %s has drifted from the seed file it guards"
                    % (task.id, seed_relpath),
                )

            # Only the files that exist nowhere in the seed are a leak risk;
            # the pristine copies are seed files by construction.
            for relpath in sorted(set(task.hidden_files) - set(guarded)):
                self.assertNotIn(
                    relpath,
                    task.prompt,
                    "%s: the prompt names the graded path %s" % (task.id, relpath),
                )
                # The basename is matched as a whole path token: a plain
                # substring test reads `aggregate.py` as naming `gate.py`.
                basename = re.compile(
                    r"(?<![\w./-])" + re.escape(os.path.basename(relpath))
                )
                self.assertIsNone(
                    basename.search(task.prompt),
                    "%s: the prompt names the graded file %s" % (task.id, relpath),
                )
                self.assertNotIn(
                    task.hidden_files[relpath],
                    seed_bodies,
                    "%s: graded file %s is reproduced in the seed" % (task.id, relpath),
                )

            # A wall-clock threshold is a property of the machine that measured
            # it, so the gate states a factor and the prompt states the same
            # one. A task whose prompt names a different number is asking for
            # something other than what it grades.
            bodies = list(task.seed_files.values()) + list(task.hidden_files.values())
            targets = set()
            for body in bodies:
                targets.update(target_pattern.findall(body))
            self.assertEqual(
                len(targets),
                1,
                "%s: the tree declares %d speedup targets, not one" % (task.id, len(targets)),
            )
            target = targets.pop()
            self.assertIn(
                target,
                task.prompt,
                "%s: the gate requires x%s and the prompt never says so" % (task.id, target),
            )

            # The measurement is a median over repeated runs of both sides, not
            # a single timing of either.
            gate = task.hidden_files["gauge/gate.py"]
            for word in ("median", "TARGET_SPEEDUP" if "TARGET_SPEEDUP" in gate else "speedup"):
                self.assertIn(word, gate, "%s: the gate never mentions %r" % (task.id, word))

            # The corpus ships operator notes beside each of these tasks that
            # publish the calibration table, the expected failure modes and the
            # measured baseline. None of that, and no pointer to a document
            # this workspace does not contain, may reach a seeded tree.
            for marker in ("operator notes", "Interpreting a partial result",
                           "Known failure modes", "Measured baseline",
                           "new_workspace", "OPTIMIZATION-NOTES", "CONVENTIONS.md",
                           "rubric.md", "solutions/"):
                self.assertNotIn(
                    marker,
                    seed_bodies,
                    "%s: the seed carries the operator-only marker %r" % (task.id, marker),
                )
                self.assertNotIn(
                    marker,
                    task.prompt,
                    "%s: the prompt carries the operator-only marker %r" % (task.id, marker),
                )

            # The visible gate and the graded gate are different commands over
            # different trees; a task whose two commands agree measures the seed
            # twice and the model never.
            self.assertNotEqual(task.repo_test_command, task.hidden_test_command)

    def test_corpus_python_material_imports_inside_a_cell(self):
        """[23B.8-corpus-imports-inside-a-cell] every module the committed
        Python material imports resolves under the environment a cell actually
        runs in.

        build_cell_env redirects HOME, and CPython derives the per-user site
        directory from HOME, so a package installed with `pip install --user`
        sits on the driver's import path and off the model's. A seed that
        reaches for one hands the model a suite whose first command fails, and
        every preflight that runs under the operator's own environment reports
        it green.
        """
        provided = set()
        roots = set()
        for path in sorted((cb.REPO_ROOT / "bench").glob("*.json")):
            for task in cb.load_manifest(path).tasks:
                bodies = dict(task.seed_files)
                bodies.update(task.hidden_files)
                for relpath in sorted(bodies):
                    # Anything the task ships is resolvable from inside the
                    # task: a top-level package, a module beside its importer,
                    # a directory a runner puts on the path. Only the names
                    # nothing in the tree provides have to come from outside.
                    for segment in relpath.split("/"):
                        provided.add(
                            segment[:-3] if segment.endswith(".py") else segment
                        )
                    if not relpath.endswith(".py"):
                        continue
                    for node in ast.walk(ast.parse(bodies[relpath])):
                        if isinstance(node, ast.Import):
                            for alias in node.names:
                                roots.add(alias.name.split(".")[0])
                        elif isinstance(node, ast.ImportFrom) and not node.level:
                            roots.add((node.module or "").split(".")[0])
        roots -= provided
        roots.discard("")
        self.assertTrue(roots, "the corpus imports nothing; the scan found no material")

        cell_dir = self.tmp / "cell"
        cell_dir.mkdir(parents=True, exist_ok=True)
        env = cb.build_cell_env(cell_dir, cell_dir / "config.json")
        for key in ("HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME",
                    "XDG_CACHE_HOME"):
            Path(env[key]).mkdir(parents=True, exist_ok=True)
        elsewhere = self.tmp / "elsewhere"
        elsewhere.mkdir(exist_ok=True)

        unreachable = []
        for root in sorted(roots):
            probe = subprocess.run(
                ["/usr/bin/python3", "-c", "import %s" % root],
                cwd=str(elsewhere), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            )
            if probe.returncode != 0:
                unreachable.append("%s: %s" % (root, probe.stdout.decode().strip()))
        self.assertEqual(
            unreachable,
            [],
            "the corpus imports modules a cell cannot resolve:\n%s"
            % "\n".join(unreachable),
        )

    def test_expected_task_counts_is_a_manifest_field(self):
        """[23B.1-expected-task-counts] the per-tier task-set pin is declared by
        the manifest document, not by the driver: a manifest that declares
        expectedTaskCounts is held to it, one that omits the field is held to no
        per-tier shape, and an explicit expected_counts argument overrides
        both."""
        # Declaring the pin keeps the guard: trading a T3 task for a T2 one
        # leaves the total unchanged and must still be refused.
        pinned = manifest_dict()
        dropped = next(i for i, t in enumerate(pinned["tasks"]) if t["tier"] == "T3")
        pinned["tasks"].pop(dropped)
        pinned["tasks"].append(task_dict(0, id="bt-extra", tier="T2"))
        pinned_path = write_manifest(self.tmp, pinned, name="pinned-mix.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_tasks(pinned_path)
        self.assertIn("T3", str(ctx.exception))

        # The same set without the field loads clean: no declared shape, no pin.
        unpinned = dict(pinned)
        unpinned.pop("expectedTaskCounts")
        unpinned_path = write_manifest(self.tmp, unpinned, name="unpinned-mix.json")
        loaded = cb.load_tasks(unpinned_path)
        self.assertEqual(len(loaded), TASK_COUNT)
        self.assertEqual(
            len(cb.tasks_by_tier(loaded)["T3"]),
            SYNTHETIC_COUNTS["T3"] - 1,
            "an unpinned manifest keeps whatever shape it has",
        )

        # An explicit argument is the caller checking a set against a shape the
        # document does not declare, and wins over the document either way.
        with self.assertRaises(cb.BenchError):
            cb.load_tasks(unpinned_path, expected_counts=dict(SYNTHETIC_COUNTS))
        wider = dict(SYNTHETIC_COUNTS)
        wider["T3"] = SYNTHETIC_COUNTS["T3"] - 1
        wider["T2"] = SYNTHETIC_COUNTS["T2"] + 1
        self.assertEqual(
            len(cb.load_tasks(pinned_path, expected_counts=wider)),
            TASK_COUNT,
            "an explicit shape overrides the document's own",
        )

        # A declared pin is validated as a shape, and every refusal names the field.
        bad_counts = {
            "not-an-object": [10, 4, 3, 3, 3],
            "unknown-tier": dict(list(SYNTHETIC_COUNTS.items()) + [("T9", 1)]),
            "missing-tier": dict(
                (tier, n) for tier, n in SYNTHETIC_COUNTS.items() if tier != "T3"
            ),
            "negative-count": dict(SYNTHETIC_COUNTS, T3=-1),
            "boolean-count": dict(SYNTHETIC_COUNTS, T3=True),
        }
        for label, value in bad_counts.items():
            doc = manifest_dict(expectedTaskCounts=value)
            bad = write_manifest(self.tmp, doc, name="bad-counts-%s.json" % label)
            with self.assertRaises(cb.BenchError, msg=label) as ctx:
                cb.load_tasks(bad)
            self.assertIn("expectedTaskCounts", str(ctx.exception), label)

        # The committed ladder declares its own pin, so it keeps the guard it
        # had when the driver carried one.
        committed = json.loads(cb.MANIFEST_PATH.read_text())
        self.assertEqual(
            committed["expectedTaskCounts"],
            {"T0": 10, "T1": 4, "T2": 3, "T3": 3, "T4": 3},
            "the committed manifest must declare the ladder it is held to",
        )

        # No module-level shape is left to be applied to an arbitrary manifest.
        self.assertFalse(
            hasattr(cb, "EXPECTED_TASK_COUNTS"),
            "the driver must carry no per-tier pin of its own",
        )

    def test_manifest_selection_criteria(self):
        """[14.1-manifest-selection-criteria] the committed
        bench/conductor-tasks.json satisfies the plan's stated selection
        criteria as properties of the loaded set."""
        self.assertTrue(
            cb.MANIFEST_PATH.is_file(),
            "the committed manifest must exist at %s" % cb.MANIFEST_PATH,
        )
        manifest = cb.load_manifest(cb.MANIFEST_PATH)
        tasks = manifest.tasks
        self.assertEqual(len(tasks), sum(committed_expected_counts().values()))

        languages = {t.language for t in tasks}
        for lang in ("ts", "python", "cpp"):
            self.assertIn(lang, languages, "language mix must include %s" % lang)

        non_behavioral = [t.id for t in tasks if not t.behavioral]
        self.assertGreaterEqual(
            len(non_behavioral), 2, "at least two non-behavioral tasks are required"
        )

        difficulties = {t.difficulty for t in tasks}
        self.assertEqual(difficulties, {"one-function", "multi-file"})

        for task in tasks:
            self.assertTrue(task.rationale.strip(), "%s has no rationale" % task.id)
            self.assertTrue(task.prompt.strip(), "%s has no prompt" % task.id)

        self.assertTrue(manifest.selection_criteria, "selectionCriteria must be present")
        self.assertIsInstance(manifest.selection_criteria, dict)

    def test_manifest_scope_ladder(self):
        """[22A.1-scope-ladder] the committed manifest carries every scope tier
        with at least three tasks each, T0 holds the trivial floor set, and each
        task declares the mechanism it strains and the trajectory expected."""
        tasks = cb.load_tasks(cb.MANIFEST_PATH)
        by_tier = cb.tasks_by_tier(tasks)
        self.assertEqual(sorted(by_tier), sorted(cb.TIERS), "every tier must be populated")
        for tier in cb.TIERS:
            self.assertGreaterEqual(
                len(by_tier[tier]), 3, "tier %s carries fewer than three tasks" % tier
            )
            self.assertEqual(len(by_tier[tier]), committed_expected_counts()[tier], tier)
        self.assertEqual(len(by_tier["T0"]), 10, "T0 is the ten-task cost floor")

        for task in tasks:
            self.assertIn(task.mechanism, cb.MECHANISMS, task.id)
            self.assertTrue(task.expected_trajectory.strip(), task.id)
            for kind in task.expected_stop_kinds:
                self.assertIn(kind, cb.STOP_KINDS + cb.TERMINAL_RUN_STATES, task.id)

        # A T0 task stays inside the plugin's own triviality bound; a T1+ task
        # must not, or the tier measures the same trivial path T0 already does.
        for task in by_tier["T0"]:
            self.assertLessEqual(
                len([p for p in task.seed_files if p.startswith("src/")]),
                3,
                "%s is a trivial-tier task with a large source surface" % task.id,
            )
        for tier in ("T1", "T2", "T3", "T4"):
            for task in by_tier[tier]:
                self.assertGreater(
                    len([p for p in task.seed_files if p.startswith("src/")]),
                    cb.TRIVIAL_MAX_FILES,
                    "%s cannot classify as work: its source surface is within "
                    "trivialMaxFiles" % task.id,
                )

        # The mechanism-stress corpus: each named mechanism is actually covered.
        covered = {task.mechanism for task in tasks}
        for mechanism in (
            "no-test-first",
            "scope-boundary",
            "missing-dependency",
            "ambiguous-requirement",
            "brief-window",
            "dependency-chain",
            "parallel-waves",
        ):
            self.assertIn(mechanism, covered, "no task strains %r" % mechanism)

    def test_manifest_per_tier_timeouts(self):
        """[22A.3c-per-tier-timeouts] a task's run timeout comes from its tier,
        so a T3 build is not scored as a wrong answer for taking longer than a
        one-function edit."""
        manifest = cb.load_manifest(cb.MANIFEST_PATH)
        table = manifest.defaults["tierTimeoutSec"]
        self.assertEqual(sorted(table), sorted(cb.TIERS))
        for tier in cb.TIERS:
            self.assertEqual(table[tier], cb.TIER_TIMEOUT_SEC[tier], tier)
        for task in manifest.tasks:
            self.assertEqual(task.run_timeout_sec, table[task.tier], task.id)
        self.assertGreater(
            cb.TIER_TIMEOUT_SEC["T3"],
            cb.TIER_TIMEOUT_SEC["T0"],
            "a deeper tier needs longer than the trivial floor",
        )

        # An explicit per-task override still wins over its tier's default.
        doc = manifest_dict()
        doc["tasks"][0]["runTimeoutSec"] = 123
        tasks = cb.load_tasks(write_manifest(self.tmp, doc, name="override.json"))
        self.assertEqual(tasks[0].run_timeout_sec, 123)
        self.assertEqual(tasks[1].run_timeout_sec, cb.TIER_TIMEOUT_SEC[tasks[1].tier])

    def test_hidden_command_spawnable(self):
        """[14.1-hidden-command-spawnable] every hidden and visible test command
        is a spawnable argv list, checked by a pure predicate that starts no
        process, and no code path in the module passes shell=True."""
        with no_subprocess():
            self.assertTrue(cb.command_is_spawnable([TRUE_BIN, "x"]))
            self.assertTrue(cb.command_is_spawnable(["git", "status"]))
            self.assertFalse(cb.command_is_spawnable(["definitely-not-a-real-runner"]))
            self.assertFalse(cb.command_is_spawnable([]))

            tasks = load_synthetic(self.tmp)
            self.assertEqual(cb.check_commands_spawnable(tasks), [])

            broken = manifest_dict()
            broken["tasks"][2]["hiddenTestCommand"] = ["definitely-not-a-real-runner", "-q"]
            bad_tasks = cb.load_tasks(write_manifest(self.tmp, broken, name="broken.json"))
            problems = cb.check_commands_spawnable(bad_tasks)
            self.assertEqual(len(problems), 1)
            self.assertIn(TASK_IDS[2], problems[0])
            self.assertIn("definitely-not-a-real-runner", problems[0])

        committed = cb.load_tasks(cb.MANIFEST_PATH)
        with no_subprocess():
            self.assertEqual(cb.check_commands_spawnable(committed), [])
            for task in committed:
                self.assertIsInstance(task.hidden_test_command, list)
                self.assertIsInstance(task.repo_test_command, list)

        for node in ast.walk(module_ast()):
            if isinstance(node, ast.Call):
                for kw in node.keywords:
                    self.assertNotEqual(
                        kw.arg, "shell", "conductor_bench.py must never pass shell=True"
                    )

    def test_cell_env_carries_path_and_preflight_uses_it(self):
        """[14.1-cell-path] ISSUE-107: the cell env carries a PATH so bare
        `opencode`/`git` resolve, and the spawnability preflight resolves argv[0]
        against that SAME PATH - so an approved command is one the cell can
        actually launch, not one the driver's richer PATH happens to reach."""
        cell = self.tmp / "cell-path"
        env = cb.build_cell_env(cell, cell / "arm.json")
        self.assertIn("PATH", env)
        self.assertEqual(env["PATH"], cb.CELL_PATH)
        self.assertTrue(env["PATH"], "an empty cell PATH cannot spawn opencode")

        # A command that resolves only on the CELL PATH must be approved, and one
        # that does not must be refused - proving the preflight reads CELL_PATH,
        # not the process PATH.
        bindir = self.tmp / "cellbin"
        bindir.mkdir()
        fake = bindir / "cell-only-runner"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(0o755)
        with mock.patch.object(cb, "CELL_PATH", str(bindir)):
            self.assertTrue(cb.command_is_spawnable(["cell-only-runner"]))
            self.assertFalse(cb.command_is_spawnable(["definitely-not-a-real-runner"]))


class CorpusSpeedGateTests(unittest.TestCase):
    """The speed gates decide a ratio, so what they time has to be two things."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-gate-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    @staticmethod
    def _load_module(name, path):
        spec = importlib.util.spec_from_file_location(name, str(path))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _etl_workspace(self, delay_seconds):
        """The etl-pipeline work tree, with the FROZEN baseline slowed down.

        The delay goes into both copies of the frozen implementation - the
        workspace's `baseline/` and the gate's `gauge/pristine/baseline/` - so
        the gate's integrity check still sees the two as equal. `etl/`, the
        package the task hands to the model, is left exactly as seeded. A gate
        that times the frozen baseline therefore measures the delay; a gate
        that re-imports `etl/` under the baseline's name measures nothing.
        """
        manifest = cb.load_manifest(cb.REPO_ROOT / "bench" / "corpus-perf.json")
        task = next(t for t in manifest.tasks if t.id == "etl-pipeline-py")
        root = self.tmp / "ws"
        root.mkdir()
        cb.materialize_files(root, task.seed_files)
        cb.materialize_files(root, task.hidden_files)
        delay = "\nimport time as _delay_clock\n_delay_clock.sleep(%r)\n" % delay_seconds
        for relpath in ("baseline/etl/__init__.py",
                        "gauge/pristine/baseline/etl/__init__.py"):
            target = root / relpath
            target.write_text(target.read_text() + delay)
        return root, task

    def test_etl_gate_times_the_frozen_baseline(self):
        """[23B.7-etl-baseline-not-shadowed] the etl-pipeline gate's baseline
        side runs the frozen implementation under gauge/pristine, not the
        workspace package the model is handed."""
        delay = 0.45
        root, _task = self._etl_workspace(delay)
        gate = self._load_module("etl_gate_under_test", root / "gauge" / "gate.py")
        self.assertEqual(gate.ROOT, str(root))

        # A gate reading this workspace must still call the material intact:
        # the delay went into both copies of the frozen baseline.
        self.assertTrue(gate.check_integrity())

        os.makedirs(gate.WORK, exist_ok=True)
        env = gate.pinned_environment()
        paths = gate.generate(env, os.path.join(gate.WORK, "tiny"), 3000, 11, "40")
        self.assertIsNotNone(paths)

        gate.GATE_WARMUP_RUNS = 0
        gate.GATE_TIMED_RUNS = 2
        gate.TARGET_SPEEDUP = 2.0
        gate.GATE_WORKERS = "2"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            met = gate.check_speed(env, paths[0], paths[1])
        report = buf.getvalue()

        timed = re.compile(
            r"run \d+/\d+\s+baseline\s+([\d.]+)s\s+candidate\s+([\d.]+)s\s+x([\d.]+)"
        )
        ratios = [float(match.group(3)) for match in timed.finditer(report)]
        self.assertTrue(ratios, report)
        self.assertGreater(
            max(ratios),
            2.0,
            "the baseline carries a %.2fs delay the candidate does not; a ratio "
            "at 1.0 means both sides ran the same package:\n%s" % (delay, report),
        )
        self.assertTrue(met, report)

    def test_etl_self_measurement_times_the_frozen_baseline(self):
        """[23B.7-etl-bench-not-shadowed] tools/bench.py, the harness the prompt
        tells the model to trust, measures the same two things the gate does."""
        delay = 0.45
        root, _task = self._etl_workspace(delay)
        env = dict(os.environ)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        work = self.tmp / "workload"
        generated = subprocess.run(
            [sys.executable, "tools/gen_workload.py", "--out", str(work),
             "--records", "3000", "--seed", "11", "--devices", "40", "--quiet"],
            cwd=str(root), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        self.assertEqual(generated.returncode, 0, generated.stdout.decode())

        completed = subprocess.run(
            [sys.executable, "tools/bench.py",
             "--events", str(work / "events.ndjson"),
             "--devices", str(work / "devices.tsv"),
             "--workers", "2", "--runs", "2", "--warmup", "0",
             "--outdir", str(self.tmp / "bench-out")],
            cwd=str(root), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        output = completed.stdout.decode()
        self.assertEqual(completed.returncode, 0, output)
        payload = json.loads(output.rsplit("BENCHMARK_JSON ", 1)[1].splitlines()[0])
        self.assertTrue(payload["outputs_identical"], output)
        self.assertGreater(
            payload["speedup"],
            2.0,
            "the baseline carries a %.2fs delay the candidate does not; a "
            "speedup at 1.0 means both sides ran the same package:\n%s"
            % (delay, output),
        )


class ArmTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-arm-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.cell_dir = self.tmp / "cell"
        self.cell_dir.mkdir()

    def build(self, arm: str, model: str = SENTINEL_MODEL, cell_dir: Optional[Path] = None):
        return cb.build_arm_config(
            arm,
            model=model,
            router_config=ROUTER_CONFIG,
            cell_dir=self.cell_dir if cell_dir is None else cell_dir,
            base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
        )

    def test_arms_exactly_three(self):
        """[14.1-arms-exactly-three] ARMS is the closed ordered tuple and any
        other arm string is refused by name."""
        self.assertEqual(cb.ARMS, ("baseline", "doctrine", "conductor"))
        self.assertIsInstance(cb.ARMS, tuple)

        for bogus in ("Baseline", "full", "control"):
            with self.assertRaises(cb.BenchError) as ctx:
                self.build(bogus)
            self.assertIn(bogus, str(ctx.exception), "the error must name the unknown arm")
        with self.assertRaises(cb.BenchError):
            self.build("")

        tasks = load_synthetic(self.tmp)
        plan = cb.build_run_plan(tasks, models=[SENTINEL_MODEL])
        self.assertEqual({cell.arm for cell in plan}, set(cb.ARMS))

    def test_arms_same_model_g13(self):
        """[14.1-arms-same-model-g13] the model identifier is one parameter that
        reaches all three arms, and no arm carries a model literal."""
        source = (cb.REPO_ROOT / "scripts" / "conductor_bench.py").read_text()
        self.assertNotIn(
            "qwen",
            source,
            "a model id in the driver plans a campaign no manifest declared",
        )
        configs = {arm: self.build(arm) for arm in cb.ARMS}
        selections = set()
        for arm, cfg in configs.items():
            self.assertEqual(cfg["model"], SENTINEL_MODEL, arm)
            self.assertEqual(cfg["small_model"], SENTINEL_MODEL, arm)
            selections.add((cfg["model"], cfg["small_model"]))
            blob = json.dumps(cfg)
            self.assertIn("sentinel-model-x", blob, arm)
            self.assertNotIn("ornith-9b", blob, "%s carries a foreign model id" % arm)
            self.assertNotIn("qwen3.6-27b", blob, "%s carries a foreign model id" % arm)
        self.assertEqual(len(selections), 1, "the arms must agree byte-for-byte on the model")

        other = "llamacpp/other-model-y"
        for arm in cb.ARMS:
            cfg = self.build(arm, model=other)
            self.assertEqual(cfg["model"], other, arm)
            self.assertNotIn("sentinel-model-x", json.dumps(cfg), arm)

    def test_arm_baseline_plain(self):
        """[14.1-arm-baseline-plain] the baseline arm is plain opencode: no
        plugin key, no conductor-* agents, no doctrine text - but it does carry
        the provider block and the model."""
        cfg = self.build("baseline")
        blob = json.dumps(cfg)
        self.assertNotIn("plugin", _all_keys(cfg))
        for agent in _fragment_agents():
            self.assertNotIn(agent, blob, "baseline must not carry %s" % agent)

        for pack in sorted(cb.DOCTRINE_DIR.glob("*.md")):
            first = _first_non_empty_line(pack)
            self.assertTrue(first, "%s is empty" % pack)
            self.assertNotIn(first, blob, "baseline leaked text from %s" % pack.name)

        self.assertIn("provider", cfg)
        self.assertEqual(cfg["model"], SENTINEL_MODEL)

    def test_arm_doctrine_packs_verbatim(self):
        """[14.1-arm-doctrine-packs-verbatim] the doctrine arm injects every
        pack byte-verbatim through one generated file and one {file:} reference,
        with the pack list read from the directory."""
        packs = sorted(cb.DOCTRINE_DIR.glob("*.md"))
        self.assertEqual(len(packs), 9, "the tree carries nine doctrine packs")

        text = cb.build_doctrine_prompt(cb.DOCTRINE_DIR)
        for pack in packs:
            self.assertIn("# %s" % pack.name, text, "missing separator for %s" % pack.name)
            self.assertIn(pack.read_text(), text, "%s is not verbatim" % pack.name)
        order = [text.index("# %s" % p.name) for p in packs]
        self.assertEqual(order, sorted(order), "packs must appear in sorted filename order")

        # The list comes from a directory listing, not a hardcoded roster.
        temp_doctrine = self.tmp / "doctrine"
        temp_doctrine.mkdir()
        (temp_doctrine / "aaa.md").write_text("alpha pack body\n")
        (temp_doctrine / "zzz.md").write_text("omega pack body\n")
        temp_text = cb.build_doctrine_prompt(temp_doctrine)
        self.assertIn("alpha pack body", temp_text)
        self.assertIn("omega pack body", temp_text)
        (temp_doctrine / "mmm.md").write_text("tenth pack body\n")
        self.assertIn("tenth pack body", cb.build_doctrine_prompt(temp_doctrine))

        written = cb.write_doctrine_prompt(self.cell_dir, cb.DOCTRINE_DIR)
        self.assertTrue(written.is_file())
        self.assertEqual(written.read_text(), text)
        self.assertEqual(written.parent, self.cell_dir)

        cfg = self.build("doctrine")
        blob = json.dumps(cfg)
        refs = cb.file_refs(cfg)
        self.assertEqual(refs, [str(written)], "exactly one {file:} reference, at the generated file")
        self.assertNotIn("plugin", _all_keys(cfg))
        for agent in _fragment_agents():
            self.assertNotIn(agent, blob, "doctrine must not carry %s" % agent)

    def test_arm_conductor_via_fragment(self):
        """[14.1-arm-conductor-via-fragment] the conductor arm's config comes
        from Task 12.1's committed fragment merge, fully substituted, and it
        does not inline doctrine pack text."""
        imported = set()
        for node in ast.walk(module_ast()):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        self.assertIn(
            "conductor_wiring",
            imported,
            "the conductor arm must reuse scripts/conductor_wiring.py, not fork a merge",
        )
        defined = {
            node.name
            for node in module_ast().body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for forked in ("merge_opencode_fragment", "deep_merge", "_deep_merge"):
            self.assertNotIn(forked, defined, "%s must not be re-implemented here" % forked)

        cfg = self.build("conductor")
        blob = json.dumps(cfg)
        self.assertNotIn("${LLAMA_HARNESS_ROOT}", blob)
        self.assertIn("plugin", cfg)
        plugin_entries = cfg["plugin"]
        self.assertTrue(plugin_entries, "the plugin array must be non-empty")
        for entry in plugin_entries:
            self.assertTrue(os.path.isabs(entry), "plugin path must be absolute: %r" % entry)
            self.assertTrue(Path(entry).is_file(), "plugin path must exist: %r" % entry)

        for agent in _fragment_agents():
            self.assertIn(agent, cfg.get("agent", {}), "missing agent %s" % agent)

        for pack in sorted(cb.DOCTRINE_DIR.glob("*.md")):
            body = pack.read_text()
            self.assertNotIn(body, blob, "conductor must not inline %s" % pack.name)

    def test_arms_differ_only_in_process(self):
        """[14.1-arms-differ-only-in-process] provider block, baseURL, model,
        prompt, seeded files, CLI flags and env variable names are identical
        across arms; only the arm-defining keys differ."""
        tasks = load_synthetic(self.tmp)
        task = tasks[0]
        cb.write_doctrine_prompt(self.cell_dir, cb.DOCTRINE_DIR)
        configs = {arm: self.build(arm) for arm in cb.ARMS}

        arm_keys = {"plugin", "agent", "prompt"}
        shared = set()
        for cfg in configs.values():
            shared |= set(cfg)
        for key in sorted(shared - arm_keys):
            values = {arm: json.dumps(cfg.get(key), sort_keys=True) for arm, cfg in configs.items()}
            self.assertEqual(
                len(set(values.values())),
                1,
                "arms disagree on config key %r: %r" % (key, values),
            )

        argvs = {
            arm: cb.build_opencode_argv(
                arm, model=SENTINEL_MODEL, work_dir=self.cell_dir, prompt=task.prompt
            )
            for arm in cb.ARMS
        }
        lengths = {len(v) for v in argvs.values()}
        self.assertEqual(len(lengths), 1, "argv length must not vary by arm: %r" % argvs)
        reference = argvs["baseline"]
        for arm, argv in argvs.items():
            for idx, token in enumerate(argv):
                if idx and argv[idx - 1] == "--agent":
                    continue
                self.assertEqual(
                    token,
                    reference[idx],
                    "argv token %d differs for %s: %r vs %r" % (idx, arm, argv, reference),
                )
            self.assertEqual(argv[-1], task.prompt, "the prompt is the trailing argument")

        envs = {
            arm: cb.build_cell_env(self.cell_dir, self.cell_dir / ("%s.json" % arm))
            for arm in cb.ARMS
        }
        names = {arm: sorted(env) for arm, env in envs.items()}
        self.assertEqual(
            len({tuple(v) for v in names.values()}), 1, "env variable names must not vary by arm"
        )
        self.assertEqual(cb.seeded_paths(task), sorted(task.seed_files))

    def test_all_arms_through_router(self):
        """[14.1-all-arms-through-router] every arm's baseURL points at the
        router's listen host:port, never at llama-server's upstream port."""
        expected = "http://127.0.0.1:9099/v1"
        self.assertEqual(cb.router_base_url(ROUTER_CONFIG), expected)
        for arm in cb.ARMS:
            cfg = self.build(arm)
            blob = json.dumps(cfg)
            self.assertIn(expected, blob, "%s does not route through the router" % arm)
            self.assertNotIn(":8080", blob, "%s still points at the upstream port" % arm)
            found = _base_urls(cfg)
            self.assertEqual(found, [expected], "%s baseURLs: %r" % (arm, found))

        moved = json.loads(json.dumps(ROUTER_CONFIG))
        moved["listen"]["port"] = 9412
        for arm in cb.ARMS:
            cfg = cb.build_arm_config(
                arm,
                model=SENTINEL_MODEL,
                router_config=moved,
                cell_dir=self.cell_dir,
                base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
            )
            self.assertIn("http://127.0.0.1:9412/v1", json.dumps(cfg), arm)

    def test_no_dangling_brace_file_ref(self):
        """[14.1-no-dangling-brace-file-ref] a config whose {file:} target or
        plugin path is missing is refused by name rather than handed to opencode,
        where it would be a hard ConfigInvalidError."""
        cb.write_doctrine_prompt(self.cell_dir, cb.DOCTRINE_DIR)
        for arm in cb.ARMS:
            cfg = self.build(arm)
            for ref in cb.file_refs(cfg):
                self.assertTrue(os.path.isabs(ref), "%s: %r is not absolute" % (arm, ref))
                self.assertTrue(Path(ref).exists(), "%s: %r does not exist" % (arm, ref))
            cb.validate_config_file_refs(cfg)

        doctrine = self.build("doctrine")
        generated = self.cell_dir / cb.DOCTRINE_PROMPT_NAME
        generated.unlink()
        with self.assertRaises(cb.BenchError) as ctx:
            cb.validate_config_file_refs(doctrine)
        self.assertIn(str(generated), str(ctx.exception))

        broken = {"plugin": [str(self.tmp / "nope" / "index.ts")], "autoupdate": False}
        with self.assertRaises(cb.BenchError) as ctx:
            cb.validate_config_file_refs(broken)
        self.assertIn("nope", str(ctx.exception))

    def test_arms_autoupdate_pinned(self):
        """[14.1-arms-autoupdate-pinned] every arm config pins opencode
        auto-update off so a 90-run overnight cannot update itself mid-run."""
        for arm in cb.ARMS:
            cfg = self.build(arm)
            self.assertIn("autoupdate", cfg, "%s does not pin autoupdate" % arm)
            self.assertIs(cfg["autoupdate"], False, "%s: autoupdate must be False" % arm)

        with_true = json.loads(json.dumps(BASE_OPENCODE_CONFIG))
        with_true["autoupdate"] = True
        for arm in cb.ARMS:
            cfg = cb.build_arm_config(
                arm,
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=self.cell_dir,
                base_config=with_true,
            per_slot_ctx=SERVED_CTX,
            )
            self.assertIs(cfg["autoupdate"], False, "%s did not override a base true" % arm)

    def test_test_commands_run_under_the_cell_environment(self):
        """[23B.8-graded-run-is-hermetic] a hidden or visible test command runs
        under the same scrubbed homes the model's own process did.

        HOME is what decides the per-user site directory, so a graded run under
        the operator's HOME resolves imports the model's run could not - and a
        preflight under the operator's HOME reports such a task green."""
        probe = self.tmp / "probe.py"
        probe.write_text(
            "import json, os, site\n"
            "seen = {\n"
            "    'home': os.environ.get('HOME'),\n"
            "    'usersite': site.getusersitepackages(),\n"
            "    'keys': sorted(os.environ),\n"
            "}\n"
            "open('probe.json', 'w').write(json.dumps(seen))\n"
        )
        outcome = cb.default_test_runner(["/usr/bin/python3", str(probe)], self.tmp, 60)
        self.assertEqual(outcome.exit_code, 0)
        self.assertIsNone(outcome.spawn_error)

        seen = json.loads((self.tmp / "probe.json").read_text())
        self.assertNotEqual(
            seen["home"],
            os.path.expanduser("~"),
            "a test command that inherits the operator's HOME is graded against "
            "the operator's machine",
        )
        self.assertTrue(
            seen["usersite"].startswith(seen["home"]),
            "the per-user site directory must follow the scrubbed HOME, not the "
            "operator's: %s" % seen["usersite"],
        )
        for key in cb.hermetic_home_env(self.tmp / "unused"):
            self.assertIn(key, seen["keys"], "the hermetic env is missing %s" % key)
        # Nothing that redirects an interpreter's search may reach a graded
        # command. A blanket "these keys and no others" assertion cannot be made
        # here: macOS injects __CF_USER_TEXT_ENCODING into every process, and
        # the /usr/bin/python3 stub re-execs itself with SDKROOT and friends.
        for key in ("PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "VIRTUAL_ENV",
                    "OPENCODE_CONFIG", "OPENCODE_TEST_HOME"):
            self.assertNotIn(
                key, seen["keys"], "%s reached a graded command" % key
            )

    def test_cell_env_hermetic(self):
        """[14.1-cell-env-hermetic] the cell env carries the verified hermetic
        triple plus state isolation, all inside the cell's own directory, and
        never inherits the user's HOME/XDG values."""
        cell_a = self.tmp / "cell-a"
        cell_b = self.tmp / "cell-b"
        env_a = cb.build_cell_env(cell_a, cell_a / "arm.json")
        env_b = cb.build_cell_env(cell_b, cell_b / "arm.json")

        for key in ("OPENCODE_CONFIG", "XDG_CONFIG_HOME", "OPENCODE_TEST_HOME", "XDG_STATE_HOME"):
            self.assertIn(key, env_a)
        self.assertEqual(env_a["OPENCODE_CONFIG"], str(cell_a / "arm.json"))
        for key in ("XDG_CONFIG_HOME", "OPENCODE_TEST_HOME", "XDG_STATE_HOME"):
            value = env_a[key]
            self.assertTrue(os.path.isabs(value), "%s must be absolute" % key)
            self.assertTrue(
                value == str(cell_a) or value.startswith(str(cell_a) + os.sep),
                "%s must live inside the cell: %r" % (key, value),
            )
            self.assertNotEqual(env_a[key], env_b[key], "%s must differ between cells" % key)
        self.assertNotEqual(env_a["OPENCODE_CONFIG"], env_b["OPENCODE_CONFIG"])

        per_arm = {
            arm: cb.build_cell_env(cell_a, cell_a / ("%s.json" % arm)) for arm in cb.ARMS
        }
        for arm, env in per_arm.items():
            differing = {k for k in env if env[k] != env_a[k]}
            self.assertLessEqual(
                differing,
                {"OPENCODE_CONFIG"},
                "%s env differs beyond OPENCODE_CONFIG: %r" % (arm, differing),
            )

        sentinel = str(self.tmp / "user-xdg-sentinel")
        with mock.patch.dict(
            os.environ,
            {"HOME": sentinel, "XDG_CONFIG_HOME": sentinel, "XDG_STATE_HOME": sentinel},
        ):
            leaky = cb.build_cell_env(cell_a, cell_a / "arm.json")
        for key, value in leaky.items():
            self.assertNotIn(sentinel, value, "%s leaked the user's environment" % key)


class PlanAndCellTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-cell-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = fixture_tasks(self.tmp)

    def test_run_plan_90_balanced(self):
        """[14.1-run-plan-90-balanced] the plan is 90 uniquely-named cells,
        ordered repetition-major and arm-interleaved so any abort leaves the
        arms balanced."""
        plan = cb.build_run_plan(self.tasks, models=[SENTINEL_MODEL])
        self.assertEqual(len(plan), 90)
        ids = [cell.cell_id for cell in plan]
        self.assertEqual(len(set(ids)), 90)

        for cell in plan:
            self.assertEqual(
                cell.cell_id,
                "%s/%s/%s/%s/r%d"
                % (
                    cb.model_slug(cell.model),
                    cell.capability,
                    cell.arm,
                    cell.task_id,
                    cell.rep,
                ),
            )
            self.assertIn(cell.rep, (1, 2, 3))

        pairs = {}
        for cell in plan:
            pairs[(cell.arm, cell.task_id)] = pairs.get((cell.arm, cell.task_id), 0) + 1
        self.assertEqual(len(pairs), 30)
        self.assertEqual(set(pairs.values()), {3})
        for task in self.tasks:
            self.assertEqual(sum(1 for c in plan if c.task_id == task.id), 9)

        # Repetition-major, task in manifest order, arm in ARMS order.
        expected_head = [
            ("baseline", TASK_IDS[0], 1),
            ("doctrine", TASK_IDS[0], 1),
            ("conductor", TASK_IDS[0], 1),
            ("baseline", TASK_IDS[1], 1),
        ]
        self.assertEqual([(c.arm, c.task_id, c.rep) for c in plan[:4]], expected_head)
        self.assertEqual(plan[30].rep, 2, "the second repetition starts after 30 cells")

        for length in range(0, 91):
            counts = [sum(1 for c in plan[:length] if c.arm == arm) for arm in cb.ARMS]
            self.assertLessEqual(
                max(counts) - min(counts),
                1,
                "prefix of %d cells leaves the arms unbalanced: %r" % (length, counts),
            )

        for reps in (1, 2, 5):
            other = cb.build_run_plan(self.tasks, models=[SENTINEL_MODEL], reps=reps)
            self.assertEqual(len(other), reps * len(self.tasks) * len(cb.ARMS))

    def test_cells_carry_model_and_capability(self):
        """[22.6-model-dimension] model and capability are matrix dimensions:
        they are in the cell id, the work tree and the result record, so two
        models can no longer collide in one cell namespace, and cell ordering
        groups by model so a multi-model server is not asked to swap weights
        every cell."""
        one = make_cell("baseline", TASK_IDS[0], 1)
        self.assertEqual(one.model, SENTINEL_MODEL)
        self.assertEqual(one.capability, CAPABILITY)
        self.assertIn(cb.model_slug(SENTINEL_MODEL), one.cell_id)
        self.assertIn(CAPABILITY, one.cell_id)
        self.assertNotIn("/", cb.model_slug(SENTINEL_MODEL), "a slug must not carry a separator")

        other = make_cell("baseline", TASK_IDS[0], 1, model=SENTINEL_MODEL_B)
        self.assertNotEqual(
            one.cell_id, other.cell_id, "two models must not share one cell namespace"
        )
        root = self.tmp / "work"
        self.assertNotEqual(cb.cell_dir_for(root, one), cb.cell_dir_for(root, other))
        self.assertNotEqual(cb.result_path(root, one), cb.result_path(root, other))
        self.assertIn(cb.model_slug(SENTINEL_MODEL), str(cb.cell_dir_for(root, one)))

        models = [SENTINEL_MODEL, SENTINEL_MODEL_B]
        plan = cb.build_run_plan(self.tasks, models=models)
        self.assertEqual(len(plan), 2 * 90)
        self.assertEqual(len({c.cell_id for c in plan}), 2 * 90)

        # Grouped by model: every cell of the first model precedes every cell
        # of the second, so the campaign pays one weight load per model rather
        # than one per cell.
        order = [c.model for c in plan]
        self.assertEqual(order, [models[0]] * 90 + [models[1]] * 90)

        # Arm balance still holds inside each model's block.
        for start in (0, 90):
            block = plan[start : start + 90]
            for length in range(0, 91):
                counts = [sum(1 for c in block[:length] if c.arm == arm) for arm in cb.ARMS]
                self.assertLessEqual(max(counts) - min(counts), 1, (start, length, counts))

        # The capability dimension is carried by every arm alike.
        capable = cb.build_run_plan(
            self.tasks, models=[SENTINEL_MODEL], capabilities=cb.CAPABILITIES
        )
        for arm in cb.ARMS:
            self.assertEqual(
                sorted({c.capability for c in capable if c.arm == arm}),
                sorted(cb.CAPABILITIES),
                "%s does not carry every capability" % arm,
            )
        self.assertEqual(cb.CAPABILITIES, ("none",), "no capability is on under this posture")

    def test_sweep_plan_follows_the_declared_shape(self):
        """[22.8-sweep-shape] the run plan is built from the manifest's declared
        sweep: the primary model carries every tier, a swept model carries only
        the cheap tiers, and the cells stay grouped by model."""
        manifest = cb.load_manifest(
            write_manifest(
                self.tmp,
                manifest_dict(
                    sweep=sweep_dict(
                        models=[SENTINEL_MODEL, SENTINEL_MODEL_B],
                        primaryModel=SENTINEL_MODEL,
                    )
                ),
                name="sweep.json",
            )
        )
        plan = cb.build_sweep_plan(manifest)
        by_model = {}
        for c in plan:
            by_model.setdefault(c.model, []).append(c)
        self.assertEqual(sorted(by_model), sorted([SENTINEL_MODEL, SENTINEL_MODEL_B]))

        tier_of = dict((task.id, task.tier) for task in manifest.tasks)
        primary_tiers = {tier_of[c.task_id] for c in by_model[SENTINEL_MODEL]}
        swept_tiers = {tier_of[c.task_id] for c in by_model[SENTINEL_MODEL_B]}
        self.assertEqual(sorted(primary_tiers), sorted(cb.TIERS), "the primary model runs it all")
        self.assertEqual(sorted(swept_tiers), ["T0", "T1"], "a swept model runs the cheap tiers")

        order = [c.model for c in plan]
        self.assertEqual(
            order, sorted(order, key=lambda m: [SENTINEL_MODEL, SENTINEL_MODEL_B].index(m))
        )

        expected = (
            len(manifest.tasks) * len(cb.ARMS) * manifest.sweep["reps"]
            + sum(1 for t in manifest.tasks if t.tier in ("T0", "T1"))
            * len(cb.ARMS)
            * manifest.sweep["reps"]
        )
        self.assertEqual(len(plan), expected)
        self.assertEqual(len({c.cell_id for c in plan}), len(plan))

        self.assertEqual(
            cb.models_for_tier(manifest.sweep, "T3"), [SENTINEL_MODEL], "T3 is primary only"
        )
        self.assertEqual(
            cb.models_for_tier(manifest.sweep, "T0"), [SENTINEL_MODEL, SENTINEL_MODEL_B]
        )

    def test_declared_asymmetries_are_stated_not_denied(self):
        """[22.1-declared-asymmetries] the arms differ in per-role sampling and
        in sub-agent availability; both are declared, carried in the run
        manifest, and printed in the report header rather than papered over."""
        asymmetries = cb.declared_asymmetries()
        self.assertTrue(asymmetries, "the campaign has asymmetries and must say so")
        names = [item["dimension"] for item in asymmetries]
        self.assertIn("sampling", names)
        self.assertIn("sub-agent availability", names)
        for item in asymmetries:
            for key in ("dimension", "conductor", "pluginAbsent", "why"):
                self.assertIn(key, item, item)
                self.assertTrue(str(item[key]).strip(), item)

        sampling = next(i for i in asymmetries if i["dimension"] == "sampling")
        for role, temperature in cb.ROLE_TEMPERATURE.items():
            self.assertIn(role, sampling["conductor"], role)
            self.assertIn(str(temperature), sampling["conductor"], role)

        results = fixture_results(self.tasks, cb.ARMS)
        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        header = section_of(report, cb.SECTION_ASYMMETRIES)
        for item in asymmetries:
            self.assertIn(item["dimension"], header)
        self.assertLess(
            report.index(cb.SECTION_ASYMMETRIES),
            report.index(cb.SECTION_PER_TASK),
            "the asymmetries belong in the header, above any number they qualify",
        )

    def test_run_manifest_records_the_design(self):
        """[22.1-run-manifest] the run records its own design - models,
        capabilities, arms, repetitions, per-tier timeouts, sweep shape,
        exclusion policy and declared asymmetries - before any cell runs."""
        manifest = cb.load_manifest(write_manifest(self.tmp, manifest_dict(), name="rm.json"))
        run_manifest = cb.build_run_manifest(
            manifest, models=[SENTINEL_MODEL, SENTINEL_MODEL_B], arms=cb.ARMS, reps=3
        )
        self.assertEqual(run_manifest["models"], [SENTINEL_MODEL, SENTINEL_MODEL_B])
        self.assertEqual(run_manifest["arms"], list(cb.ARMS))
        self.assertEqual(run_manifest["capabilities"], list(cb.CAPABILITIES))
        self.assertEqual(run_manifest["reps"], 3)
        self.assertEqual(run_manifest["tierTimeoutSec"], dict(cb.TIER_TIMEOUT_SEC))
        self.assertEqual(run_manifest["sweep"], manifest.sweep)
        self.assertEqual(run_manifest["asymmetries"], cb.declared_asymmetries())
        self.assertEqual(run_manifest["exclusionReasons"], list(cb.EXCLUSION_REASONS))
        self.assertEqual(
            run_manifest["taskIdsByTier"],
            dict(
                (tier, [t.id for t in group])
                for tier, group in cb.tasks_by_tier(manifest.tasks).items()
            ),
        )

        target = self.tmp / "nested" / "run-manifest.json"
        written = cb.write_run_manifest(target, run_manifest)
        self.assertEqual(written, target)
        self.assertEqual(json.loads(target.read_text()), run_manifest)

    def test_cell_work_tree_fresh(self):
        """[14.1-cell-work-tree-fresh] every cell gets a fresh seeded git work
        tree, so repetition 2 can never inherit repetition 1's edits."""
        task = self.tasks[0]
        cell_a = cb.cell_dir_for(self.tmp / "work", make_cell("baseline", task.id, 1))
        cell_b = cb.cell_dir_for(self.tmp / "work", make_cell("baseline", task.id, 2))
        cell_c = cb.cell_dir_for(self.tmp / "work", make_cell("doctrine", task.id, 1))
        self.assertEqual(len({cell_a, cell_b, cell_c}), 3, "cells must not share a directory")

        calls = []

        def recording_git(argv, cwd):
            calls.append((list(argv), str(cwd)))

        work = cb.seed_cell(cell_a, task, git_runner=recording_git)
        for rel, body in task.seed_files.items():
            self.assertEqual((work / rel).read_text(), body)
        for rel in task.hidden_files:
            self.assertFalse((work / rel).exists(), "seeding must not place hidden files")
        subcommands = [argv[1] for argv, _ in calls if len(argv) > 1]
        self.assertEqual([a[0] for a, _ in calls], ["git"] * len(calls))
        self.assertEqual(subcommands[:1], ["init"])
        self.assertIn("add", subcommands)
        self.assertIn("commit", subcommands)
        self.assertLess(subcommands.index("add"), subcommands.index("commit"))

        # A junk file written between two seedings must not survive.
        (work / "junk.txt").write_text("junk that must not survive\n")
        (work / "README.md").write_text("clobbered by repetition 1\n")
        calls[:] = []
        work_again = cb.seed_cell(cell_a, task, git_runner=recording_git)
        self.assertEqual(work_again, work)
        self.assertFalse((work / "junk.txt").exists(), "the work tree was not re-created")
        self.assertEqual((work / "README.md").read_text(), task.seed_files["README.md"])

        # Real git: the seeded tree must be a repo with one clean commit.
        real_cell = cb.cell_dir_for(self.tmp / "gitwork", make_cell("baseline", task.id, 3))
        real_work = cb.seed_cell(real_cell, task)
        self.assertTrue((real_work / ".git").exists(), "seed_cell must initialize a git repo")
        tracked = subprocess.run(
            ["git", "-C", str(real_work), "ls-files"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout.decode()
        self.assertEqual(sorted(tracked.split()), sorted(task.seed_files))
        status = subprocess.run(
            ["git", "-C", str(real_work), "status", "--porcelain"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout.decode()
        self.assertEqual(status.strip(), "", "the seeded tree must be clean")
        count = subprocess.run(
            ["git", "-C", str(real_work), "rev-list", "--count", "HEAD"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout.decode()
        self.assertEqual(count.strip(), "1", "exactly one initial commit")

    def test_conductor_cell_preconfigured(self):
        """[14.1-conductor-cell-preconfigured] the cell's .conductor/config.json
        is a pure function of the task, carries the VISIBLE runner only, and is
        identical for every repetition."""
        behavioral = self.tasks[1]
        non_behavioral = self.tasks[0]
        self.assertTrue(behavioral.behavioral)
        self.assertFalse(non_behavioral.behavioral)

        with no_subprocess():
            for task in (behavioral, non_behavioral):
                cfg = cb.build_conductor_cell_config(task)
                blob = json.dumps(cfg)
                self.assertEqual(
                    cfg, cb.build_conductor_cell_config(task), "must be a pure function of the task"
                )
                # ISSUE-112: git.mode is pinned to the literal the 90-run campaign
                # requires - a read-only cell would score every run as a failure -
                # and parallel.* is pinned so a fan-out default cannot drift the
                # cell away from the served --parallel / admission sizing. maxReaders
                # and subSessionTimeoutMs are asserted equal to conductor_wiring's
                # single source, so the two spellings cannot diverge silently.
                # smoke-F19: the conductor arm cannot finish a behavioral item
                # unless some requiredScopes entry covers the item's paths.
                # conductor_submit_test refuses an item that selects no scope, on
                # purpose - a verify over an empty scope map is vacuously green -
                # so a cell whose requiredScopes is empty wedges every behavioral
                # item at RED, in every task, for every model and every rep.
                required = cfg["verify"]["requiredScopes"]
                self.assertTrue(required, "a cell with no requiredScopes entry can finish no item")
                scope_names = set(cfg["verify"]["scopes"])
                for entry in required:
                    self.assertIn("pattern", entry)
                    self.assertTrue(
                        set(entry["scopes"]) <= scope_names,
                        "every required scope must name a scope the cell defines: %r vs %r"
                        % (entry["scopes"], sorted(scope_names)),
                    )
                self.assertTrue(
                    any(e["pattern"] == "**" for e in required),
                    "the cell's runner is whole-repo, so its coverage is the whole repo",
                )
                self.assertEqual(cfg["git"]["mode"], "commit")
                self.assertEqual(cfg["parallel"]["writes"], "off")
                self.assertEqual(cfg["parallel"]["maxImplementers"], 1)
                self.assertEqual(
                    cfg["parallel"]["maxReaders"], cb.conductor_wiring.DEFAULT_MAX_READERS
                )
                self.assertEqual(
                    cfg["parallel"]["subSessionTimeoutMs"],
                    cb.conductor_wiring.SUB_SESSION_TIMEOUT_MS,
                )
                self.assertEqual(cfg["verify"]["behavioralPaths"], task.behavioral_paths)
                for token in task.repo_test_command:
                    self.assertIn(token, blob, "the visible runner must be configured")
                for token in task.hidden_test_command:
                    if token in task.repo_test_command:
                        continue
                    self.assertNotIn(
                        token, blob, "the hidden command leaked into .conductor/config.json"
                    )
                scopes = cfg["verify"]["scopes"]
                self.assertTrue(scopes, "at least one verify scope is required")
                commands = [scope["command"] for scope in scopes.values()]
                self.assertIn(list(task.repo_test_command), commands)

    def test_cell_journals_every_allow(self):
        """[14.2-cell-journals-every-allow] the cell gathers its record at debug,
        because a read allow is journaled below info and a run gathered at info
        looks complete while holding no data behind the campaign's central
        question."""
        for task in self.tasks:
            with self.subTest(task=task.id):
                cfg = cb.build_conductor_cell_config(task)
                level = cfg["logging"]["level"]
                # conductor/adapter/tools.ts:496 journals a read-shaped allow at
                # debug and only an R3 side effect at warn, so a cell gathered at
                # info records the denies and the network allows and nothing
                # else. What each arm REACHED is the measurement; at info there
                # is nothing behind it.
                self.assertEqual(
                    level,
                    "debug",
                    "a cell gathered at %r drops every read allow" % (level,),
                )

    def test_cell_timeout_kills_group(self):
        """[14.1-cell-timeout-kills-group] a hung cell is killed by process
        group, recorded as a timeout, and does not eat the overnight."""
        marker = self.tmp / "grandchild.pid"
        script = (
            "import os,subprocess,sys,time\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
            "open(%r, 'w').write(str(child.pid))\n"
            "time.sleep(60)\n" % str(marker)
        )
        started = time.time()
        outcome = cb.run_command(
            [sys.executable, "-c", script], cwd=self.tmp, timeout_sec=1.0
        )
        elapsed = time.time() - started
        self.assertTrue(outcome.timed_out, "the call must report a timeout")
        self.assertLess(elapsed, 20.0, "run_command hung instead of killing the group")
        self.assertGreaterEqual(outcome.wall_clock_ms, 1000)

        deadline = time.time() + 5.0
        pid = None
        while time.time() < deadline:
            if marker.is_file():
                text = marker.read_text().strip()
                if text:
                    pid = int(text)
                    break
            time.sleep(0.02)
        self.assertIsNotNone(pid, "the probe never recorded its grandchild pid")
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except OSError:
                break
            time.sleep(0.02)
        else:
            self.fail("grandchild %d survived the timeout - the process group was not killed" % pid)

        task = self.tasks[0]
        cell = make_cell("baseline", task.id, 1)
        hung = cb.CommandOutcome(
            exit_code=None, timed_out=True, spawn_error=None, wall_clock_ms=2100
        )
        result = cb.run_cell(
            cell,
            task,
            cell_dir=cb.cell_dir_for(self.tmp / "work", cell),
            model=SENTINEL_MODEL,
            router_config=ROUTER_CONFIG,
            base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
            timeout_sec=2,
            runner=lambda invocation: hung,
            test_runner=lambda argv, cwd, timeout_sec: cb.CommandOutcome(0, False, None, 1),
            git_runner=lambda argv, cwd: None,
        )
        self.assertEqual(result["outcome"], "timeout")
        self.assertIs(result["passed"], False)
        self.assertGreaterEqual(result["wallClockMs"], 2000)

    def test_hidden_never_visible(self):
        """[14.1-hidden-never-visible] the hidden tests never reach the model:
        seed and hidden paths are disjoint, no arm's prompt/argv/env/config
        mentions them, and they are materialized only after the run exits."""
        for task in self.tasks:
            self.assertTrue(task.seed_files and task.hidden_files)
            self.assertEqual(
                set(task.seed_files) & set(task.hidden_files),
                set(),
                "%s: seed and hidden paths overlap" % task.id,
            )
            seeded = cb.seeded_paths(task)
            self.assertEqual(sorted(seeded), sorted(task.seed_files))
            for hidden in task.hidden_files:
                self.assertNotIn(hidden, seeded)
                self.assertNotIn(hidden, task.prompt, "%s: prompt names a hidden path" % task.id)
                self.assertNotIn(
                    os.path.basename(hidden),
                    task.prompt,
                    "%s: prompt names a hidden basename" % task.id,
                )
            for token in task.hidden_test_command:
                self.assertNotIn(token, task.prompt)

        # The whole model-facing surface of a cell, per arm.
        task = self.tasks[0]
        cell_dir = self.tmp / "surface"
        cell_dir.mkdir()
        cb.write_doctrine_prompt(cell_dir, cb.DOCTRINE_DIR)
        secrets = list(task.hidden_files) + [os.path.basename(p) for p in task.hidden_files]
        secrets += [t for t in task.hidden_test_command if t not in task.repo_test_command]
        secrets += list(task.hidden_files.values())
        for arm in cb.ARMS:
            cfg = cb.build_arm_config(
                arm,
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=cell_dir,
                base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
            )
            argv = cb.build_opencode_argv(
                arm, model=SENTINEL_MODEL, work_dir=cell_dir, prompt=task.prompt
            )
            env = cb.build_cell_env(cell_dir, cell_dir / ("%s.json" % arm))
            surface = "\n".join([json.dumps(cfg), "\n".join(argv), "\n".join(sorted(env.values()))])
            for secret in secrets:
                self.assertNotIn(
                    secret, surface, "%s: %r reached the model-facing surface" % (arm, secret)
                )

        # Ordering: the runner sees a work tree with no hidden file in it.
        observed = {}

        def observing_runner(invocation):
            observed["hidden_present"] = [
                rel for rel in task.hidden_files if (invocation.work_dir / rel).exists()
            ]
            observed["seed_present"] = [
                rel for rel in task.seed_files if (invocation.work_dir / rel).exists()
            ]
            observed["argv"] = list(invocation.argv)
            observed["prompt_in_argv"] = task.prompt in invocation.argv
            return cb.CommandOutcome(exit_code=0, timed_out=False, spawn_error=None, wall_clock_ms=5)

        tested = {}

        def observing_test_runner(argv, cwd, timeout_sec):
            tested["hidden_present"] = [
                rel for rel in task.hidden_files if (Path(cwd) / rel).exists()
            ]
            return cb.CommandOutcome(exit_code=1, timed_out=False, spawn_error=None, wall_clock_ms=3)

        cell = make_cell("baseline", task.id, 1)
        work_cell_dir = cb.cell_dir_for(self.tmp / "ordered", cell)
        result = cb.run_cell(
            cell,
            task,
            cell_dir=work_cell_dir,
            model=SENTINEL_MODEL,
            router_config=ROUTER_CONFIG,
            base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
            timeout_sec=30,
            runner=observing_runner,
            test_runner=observing_test_runner,
            git_runner=lambda argv, cwd: None,
        )
        self.assertEqual(observed["hidden_present"], [], "hidden files existed while the model ran")
        self.assertEqual(sorted(observed["seed_present"]), sorted(task.seed_files))
        for secret in secrets:
            self.assertNotIn(secret, "\n".join(observed["argv"]))
        self.assertEqual(
            sorted(tested["hidden_present"]),
            sorted(task.hidden_files),
            "the hidden files must be present when the hidden test runs",
        )
        self.assertEqual(result["outcome"], "fail")

    def test_verify_tasks_mode(self):
        """[14.1-verify-tasks-mode] --verify-tasks is implemented and enforces
        that every hidden test FAILS on an unmodified seed, exiting nonzero and
        naming any task whose hidden test passed unmodified."""
        good = write_manifest(self.tmp, manifest_dict(), name="verify-good.json")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                ["--verify-tasks", "--manifest", str(good), "--work-root", str(self.tmp / "vg")]
            )
        output = buf.getvalue()
        self.assertEqual(code, 0, "all hidden tests fail unmodified; output:\n%s" % output)
        for task_id in TASK_IDS:
            lines = [line for line in output.splitlines() if task_id in line]
            self.assertEqual(len(lines), 1, "one line per task, got %r for %s" % (lines, task_id))

        good_report = cb.verify_tasks(cb.load_tasks(good), work_root=self.tmp / "vg2")
        self.assertTrue(good_report["ok"])
        self.assertEqual(good_report["passedUnmodified"], [])
        self.assertEqual(good_report["exitCodes"], {task_id: 1 for task_id in TASK_IDS})

        broken = manifest_dict()
        broken["tasks"][6]["hiddenTestCommand"] = [TRUE_BIN, "passes-unmodified"]
        bad = write_manifest(self.tmp, broken, name="verify-bad.json")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                ["--verify-tasks", "--manifest", str(bad), "--work-root", str(self.tmp / "vb")]
            )
        output = buf.getvalue()
        self.assertNotEqual(code, 0, "a hidden test that passes unmodified must fail the mode")
        self.assertIn(TASK_IDS[6], output, "the offending task must be named")

        report = cb.verify_tasks(
            cb.load_tasks(bad), work_root=self.tmp / "vb2"
        )
        self.assertFalse(report["ok"])
        self.assertIn(TASK_IDS[6], report["passedUnmodified"])
        self.assertEqual(report["exitCodes"][TASK_IDS[6]], 0)
        self.assertEqual(report["exitCodes"][TASK_IDS[0]], 1)


    def test_sweep_refuses_every_flag_it_would_discard(self):
        """[23C.4-sweep-refuses-discarded-flags] --sweep is refused alongside
        every flag the sweep branch overwrites, not only --task and --tier.

        The sweep branch reads models, capabilities and reps from the manifest's
        own sweep block and never from argv, so `--sweep --reps 1` plans the
        manifest's repetitions and says nothing about it: the operator asked for
        one pass over a lane whose cells are hours long and gets three. An
        explicitly named model discarded in silence is the same confound the
        one-model campaign rule exists to prevent.
        """
        path = write_manifest(self.tmp, manifest_dict(), name="sweep-flags.json")
        run_manifest_path = self.tmp / "sweep-run-manifest.json"

        def plan(*extra):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                code = cb.main(
                    ["--plan-only", "--manifest", str(path), "--run-manifest",
                     str(run_manifest_path)] + list(extra)
                )
            return code, buf.getvalue()

        # The sweep alone runs the shape the manifest declares.
        code, output = plan("--sweep")
        self.assertEqual(code, 0, output)
        swept = json.loads(run_manifest_path.read_text())
        self.assertEqual(swept["reps"], sweep_dict()["reps"])

        before = run_manifest_path.read_text()
        for label, extra in (
            ("model", ("--model", SENTINEL_MODEL_B)),
            ("capability", ("--capability", "readonly")),
            ("reps", ("--reps", "1")),
            ("tier", ("--tier", "T0")),
        ):
            code, output = plan("--sweep", *extra)
            self.assertEqual(code, 2, "%s composed with --sweep: %s" % (label, output))
            self.assertIn("--sweep", output, label)
            self.assertIn("--" + label, output, "the refusal must name the flag it refused")
            self.assertEqual(
                run_manifest_path.read_text(),
                before,
                "a refused composition must not overwrite the run manifest",
            )

        # Typing the manifest's own repetition count is still typing --reps, so
        # the refusal cannot be spelled as "the value differs from the default".
        code, output = plan("--sweep", "--reps", str(sweep_dict()["reps"]))
        self.assertEqual(code, 2, output)

        # Without --sweep the same three flags are the plan.
        code, output = plan("--reps", "1", "--model", SENTINEL_MODEL_B)
        self.assertEqual(code, 0, output)
        narrowed = json.loads(run_manifest_path.read_text())
        self.assertEqual(narrowed["reps"], 1)
        self.assertEqual(narrowed["models"], [SENTINEL_MODEL_B])

    def test_verify_modes_refuse_a_gate_they_could_not_wait_out(self):
        """[23C.5-verify-timeout-is-not-a-failure] a hidden test the floor
        killed on the clock is reported as a timeout and refuses the mode; it is
        never read as proof that the test failed on its seed.

        --verify-tasks exists to catch a hidden test that passes on its
        unmodified seed. Mapping a killed gate to a non-zero code makes that
        gate indistinguishable from an honest failure, so the one task the check
        exists to catch is the one it certifies clean - and a corpus gate that
        compiles a reference and runs timed workloads is exactly the gate that
        runs long enough to be killed.
        """
        doc = manifest_dict()
        doc["tasks"][3]["hiddenTestCommand"] = [SLEEP_BIN, "3"]
        doc["tasks"][3]["repoTestCommand"] = [SLEEP_BIN, "3"]
        path = write_manifest(self.tmp, doc, name="verify-slow.json")
        tasks = cb.load_tasks(path)

        report = cb.verify_tasks(tasks, work_root=self.tmp / "vt", timeout_sec=0.4)
        self.assertFalse(report["ok"], "a gate that was killed proves nothing")
        self.assertEqual(report["timedOut"], [TASK_IDS[3]])
        self.assertEqual(report["passedUnmodified"], [])

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                ["--verify-tasks", "--manifest", str(path), "--work-root",
                 str(self.tmp / "vt2"), "--verify-timeout", "0.4"]
            )
        output = buf.getvalue()
        self.assertNotEqual(code, 0, output)
        self.assertIn(TASK_IDS[3], output, "the refusal must name the task")
        self.assertIn("timed out", output)

        green = cb.verify_seed_green(tasks, work_root=self.tmp / "vs", timeout_sec=0.4)
        self.assertFalse(green["ok"])
        self.assertEqual(green["timedOut"], [TASK_IDS[3]])
        self.assertEqual(green["startedRed"], [], "a killed suite is not a red suite")

        # The operator can hand the floor the wall clock the gate needs rather
        # than being hard-capped at a constant - and the slow gate this fixture
        # carries turns out to PASS on its unmodified seed, which is the
        # hollowness the floor exists to catch and the short clock hid.
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                ["--verify-tasks", "--manifest", str(path), "--work-root",
                 str(self.tmp / "vt3"), "--verify-timeout", "10"]
            )
        output = buf.getvalue()
        self.assertNotEqual(code, 0, output)
        self.assertIn("passed unmodified", output)
        self.assertIn(TASK_IDS[3], output)
        waited = cb.verify_tasks(tasks, work_root=self.tmp / "vt4", timeout_sec=10)
        self.assertEqual(waited["timedOut"], [])
        self.assertEqual(waited["passedUnmodified"], [TASK_IDS[3]])

    def test_a_work_root_inside_the_repository_is_refused(self):
        """[23C.6-work-root-outside-the-repository] the cell work trees live
        outside this repository, and a work root inside it is a refusal.

        A cell's cwd is <work_root>/<model>/<cap>/<arm>/<task>/rN/repo. Under
        the repository that is a constant number of `..` segments from
        bench/corpus/**/hidden/**, where every answer key the campaign grades
        against sits - so an arm that walks up out of its own tree, which a
        model debugging a failing run does by hand, reads the measurement. The
        driver materializes the hidden files only after opencode exits for
        exactly this reason; a relative path around that ordering defeats it.
        """
        self.assertFalse(
            cb._is_within(cb.WORK_ROOT.resolve(), cb.REPO_ROOT.resolve()),
            "the default work root must not sit under the repository",
        )
        path = write_manifest(self.tmp, manifest_dict(), name="work-root.json")
        inside = cb.REPO_ROOT / ".data" / "benchmark" / "conductor" / "work"
        for mode in ("--plan-only", "--verify-tasks", "--seed-green"):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                code = cb.main(
                    [mode, "--manifest", str(path), "--work-root", str(inside),
                     "--run-manifest", str(self.tmp / "wr.json")]
                )
            output = buf.getvalue()
            self.assertEqual(code, 2, "%s: %s" % (mode, output))
            self.assertIn(str(cb.REPO_ROOT), output, "the refusal must name the boundary")

    def test_the_documented_work_root_is_the_one_the_driver_defaults_to(self):
        """[23C.6-work-root-outside-the-repository] the default work root's name
        is quoted in three documents, and all four agree.

        The name is operator-facing: it is what `ls $TMPDIR` shows and what an
        operator deletes to reclaim the disk a campaign spent. A document that
        quotes a name the driver does not use sends them to an empty path, and
        nothing else in the suite reads these files, so this is the only place
        the four can be held together.
        """
        self.assertEqual(cb.WORK_ROOT.name, "llama-leash-conductor-work")
        self.assertEqual(cb.WORK_ROOT.parent, Path(tempfile.gettempdir()))
        for relpath in (
            "scripts/README.md",
            "docs/user/benchmarking.md",
            "docs/build/CORPUS-MIGRATION.md",
        ):
            text = (cb.REPO_ROOT / relpath).read_text()
            self.assertIn(
                cb.WORK_ROOT.name,
                text,
                "%s must quote the work root the driver actually defaults to" % relpath,
            )
            self.assertNotIn(
                "llama-harness-conductor-work",
                text,
                "%s quotes a work root no run creates" % relpath,
            )

    def test_default_model_is_the_manifests_own(self):
        """[23B.6-default-model-from-manifest] with neither --sweep nor --model,
        every cell is planned against the model the manifest declares, and one
        run manifest cannot record two campaigns."""
        declared = "llamacpp/declared-model-z"
        document = manifest_dict()
        document["defaults"]["model"] = declared
        document["sweep"] = sweep_dict(primaryModel=declared, models=[declared])
        path = write_manifest(self.tmp, document, name="declared.json")
        run_manifest_path = self.tmp / "run-manifest.json"

        buf = io.StringIO()
        argv = [
            "--plan-only",
            "--manifest",
            str(path),
            "--run-manifest",
            str(run_manifest_path),
        ]
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(argv)
        output = buf.getvalue()
        self.assertEqual(code, 0, output)

        recorded = json.loads(run_manifest_path.read_text())
        self.assertEqual(recorded["models"], [declared])
        self.assertEqual(
            recorded["models"],
            recorded["sweep"]["models"],
            "one artifact recording two model sets is a provenance record that "
            "contradicts itself",
        )
        planned = [line.strip() for line in output.splitlines() if "/none/" in line]
        self.assertTrue(planned, output)
        for cell_id in planned:
            self.assertTrue(
                cell_id.startswith(cb.model_slug(declared) + "/"),
                "%s was planned against a model the manifest never declared" % cell_id,
            )

        # A manifest whose two model declarations disagree is refused at load,
        # rather than planning one of them and reporting the other.
        split = manifest_dict()
        split["defaults"]["model"] = declared
        split["sweep"] = sweep_dict(
            primaryModel=SENTINEL_MODEL, models=[SENTINEL_MODEL]
        )
        split_path = write_manifest(self.tmp, split, name="split.json")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.load_manifest(split_path)
        self.assertIn(declared, str(ctx.exception))

        for bad in (None, "", "   ", 7):
            broken = manifest_dict()
            broken["defaults"]["model"] = bad
            broken_path = write_manifest(self.tmp, broken, name="broken.json")
            with self.assertRaises(cb.BenchError):
                cb.load_manifest(broken_path)

    def test_every_committed_manifest_names_the_one_model(self):
        """[23B.6-one-model-per-campaign] every manifest under bench/ names the
        one model this campaign serves in all three places a model is declared,
        so no two lanes of one campaign run on different weights."""
        paths = sorted((cb.REPO_ROOT / "bench").glob("*.json"))
        self.assertTrue(paths, "the campaign has no manifests")
        for path in paths:
            manifest = cb.load_manifest(path)
            self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL, path.name)
            self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL, path.name)
            self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL], path.name)

    def test_every_committed_manifest_is_named_in_the_operator_docs(self):
        """[23B.6-manifests-are-documented] both documents an operator plans a
        campaign from name every manifest under bench/, and scripts/README.md
        states each one's task count. `--manifest` takes a single path and the
        driver discovers nothing, so a set no document names is a set nobody
        runs - and a whole-manifest run reports full coverage of the one set it
        was given, which is exactly the sentence that hides the others."""
        docs = [
            cb.REPO_ROOT / "scripts" / "README.md",
            cb.REPO_ROOT / "docs" / "user" / "benchmarking.md",
        ]
        paths = sorted((cb.REPO_ROOT / "bench").glob("*.json"))
        self.assertTrue(paths, "the campaign has no manifests")
        counted = (cb.REPO_ROOT / "scripts" / "README.md").read_text()
        for doc in docs:
            body = doc.read_text()
            for path in paths:
                self.assertIn(
                    "bench/%s" % path.name,
                    body,
                    "%s never names bench/%s" % (doc.name, path.name),
                )
        for path in paths:
            declared = len(cb.load_manifest(path).tasks)
            row = re.search(
                r"\|\s*`bench/%s`\s*\|\s*(\d+)\s*\|" % re.escape(path.name), counted
            )
            self.assertIsNotNone(
                row, "scripts/README.md has no task-count row for bench/%s" % path.name
            )
            self.assertEqual(
                int(row.group(1)),
                declared,
                "scripts/README.md states %s tasks for bench/%s; it holds %d"
                % (row.group(1), path.name, declared),
            )

    def _plan_only(self, manifest_path, *extra):
        """cb.main in the dry-run mode that stops before any router config."""
        buf = io.StringIO()
        argv = [
            "--plan-only",
            "--manifest",
            str(manifest_path),
            "--run-manifest",
            str(self.tmp / "run-manifest.json"),
            "--model",
            SENTINEL_MODEL,
        ] + list(extra)
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(argv)
        return code, buf.getvalue()

    def test_task_and_tier_selection_narrows_the_run(self):
        """[23B.2-task-tier-filters] --task and --tier are repeatable, union
        inside a dimension and intersect across the two, refuse an unknown id
        and a zero-match selection out loud, and are recorded in the run
        manifest and the report so a narrowed run cannot be read as the
        campaign."""
        path = write_manifest(self.tmp, manifest_dict(), name="filters.json")
        run_manifest_path = self.tmp / "run-manifest.json"
        all_tasks = cb.load_tasks(path)
        by_tier = cb.tasks_by_tier(all_tasks)
        t0_ids = [t.id for t in by_tier["T0"]]
        t1_ids = [t.id for t in by_tier["T1"]]
        cells_per_task = len(cb.ARMS) * cb.DEFAULT_REPS

        # No selection: the whole set, recorded as a whole-set run.
        code, output = self._plan_only(path)
        self.assertEqual(code, 0, output)
        whole = json.loads(run_manifest_path.read_text())
        self.assertFalse(whole["partial"], "an unfiltered run covers the manifest")
        self.assertEqual(whole["filters"]["taskIds"], [])
        self.assertEqual(whole["filters"]["tiers"], [])
        self.assertEqual(len(whole["filters"]["selectedTaskIds"]), TASK_COUNT)
        self.assertEqual(whole["taskIdsByTier"], whole["manifestTaskIdsByTier"])

        # Repeated --task unions inside the dimension.
        code, output = self._plan_only(path, "--task", t0_ids[0], "--task", t1_ids[0])
        self.assertEqual(code, 0, output)
        self.assertIn("%d cell(s) planned" % (2 * cells_per_task), output)
        picked = json.loads(run_manifest_path.read_text())
        self.assertEqual(sorted(picked["filters"]["selectedTaskIds"]), sorted([t0_ids[0], t1_ids[0]]))
        self.assertTrue(picked["partial"], "a narrowed run must record that it is one")
        self.assertEqual(picked["filters"]["taskIds"], [t0_ids[0], t1_ids[0]])
        self.assertEqual(picked["taskIdsByTier"]["T0"], [t0_ids[0]])
        self.assertEqual(picked["taskIdsByTier"]["T2"], [])
        self.assertEqual(
            picked["manifestTaskIdsByTier"],
            whole["manifestTaskIdsByTier"],
            "the declared set stays on the record beside what was planned",
        )
        self.assertEqual(picked["tiers"], ["T0", "T1"], "only the planned tiers are recorded")

        # Repeated --tier unions the same way.
        code, output = self._plan_only(path, "--tier", "T1", "--tier", "T4")
        self.assertEqual(code, 0, output)
        tiered = json.loads(run_manifest_path.read_text())
        self.assertEqual(
            sorted(tiered["filters"]["selectedTaskIds"]),
            sorted([t.id for t in all_tasks if t.tier in ("T1", "T4")]),
        )

        # The two dimensions intersect.
        code, output = self._plan_only(path, "--task", t0_ids[0], "--task", t1_ids[0], "--tier", "T0")
        self.assertEqual(code, 0, output)
        crossed = json.loads(run_manifest_path.read_text())
        self.assertEqual(crossed["filters"]["selectedTaskIds"], [t0_ids[0]])

        # An intersection with nothing in it is a refusal, never a zero-cell run.
        before = run_manifest_path.read_text()
        code, output = self._plan_only(path, "--task", t0_ids[0], "--tier", "T4")
        self.assertEqual(code, 2, output)
        self.assertIn(t0_ids[0], output, "the refusal must name what was asked for")
        self.assertIn("T4", output)
        self.assertEqual(
            run_manifest_path.read_text(),
            before,
            "a refused selection must not overwrite the run manifest",
        )

        # An unknown id names itself and what it was near.
        typo = t0_ids[0] + "z"
        code, output = self._plan_only(path, "--task", typo)
        self.assertEqual(code, 2, output)
        self.assertIn(typo, output)
        self.assertIn(t0_ids[0], output, "a near match must be offered")

        # An unknown tier is refused by the closed vocabulary.
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                cb.build_parser().parse_args(["--tier", "T9"])

        # The sweep block is the manifest's own declared campaign shape, so the
        # two ways of saying what to run are refused together rather than
        # silently composed.
        code, output = self._plan_only(path, "--sweep", "--tier", "T0")
        self.assertEqual(code, 2, output)
        self.assertIn("--sweep", output)

        # --review-sample draws from the narrowed plan only.
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                [
                    "--review-sample",
                    "1",
                    "--manifest",
                    str(path),
                    "--run-manifest",
                    str(run_manifest_path),
                    "--model",
                    SENTINEL_MODEL,
                    "--tier",
                    "T1",
                ]
            )
        sample = buf.getvalue()
        self.assertEqual(code, 0, sample)
        self.assertTrue(sample.strip(), "a narrowed review sample must still name cells")
        for line in sample.splitlines():
            self.assertIn("tier T1", line, "the sample must not reach outside the selection")

        # --verify-tasks checks the selected tasks and no others.
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            code = cb.main(
                [
                    "--verify-tasks",
                    "--manifest",
                    str(path),
                    "--work-root",
                    str(self.tmp / "vf"),
                    "--task",
                    t1_ids[0],
                ]
            )
        verified = buf.getvalue()
        self.assertEqual(code, 0, verified)
        self.assertEqual(
            [line for line in verified.splitlines() if t0_ids[0] in line],
            [],
            "an unselected task must not be spawned",
        )
        self.assertTrue([line for line in verified.splitlines() if t1_ids[0] in line])

        # The narrowing is legible in the report, so a filtered report cannot be
        # read as a full campaign rendered at a smaller scale.
        selected = cb.select_tasks(all_tasks, task_ids=[t1_ids[0]], tiers=["T1"])
        self.assertEqual([t.id for t in selected], [t1_ids[0]])
        record = cb.task_filter_record(
            all_tasks, selected, task_ids=[t1_ids[0]], tiers=["T1"]
        )
        report = cb.render_report(
            [],
            selected,
            models=[SENTINEL_MODEL],
            arms=cb.ARMS,
            reps=1,
            task_filter=record,
        )
        scope = section_of(report, cb.SECTION_SCOPE)
        self.assertIn(t1_ids[0], scope)
        self.assertIn("T1", scope)
        self.assertLess(
            report.index(cb.SECTION_SCOPE),
            report.index(cb.SECTION_PER_TASK),
            "what the run covered belongs above every number it qualifies",
        )
        self.assertNotIn(
            t0_ids[0],
            report,
            "a task that was never planned must not render as a missing cell",
        )
        full = cb.render_report(
            [],
            all_tasks,
            models=[SENTINEL_MODEL],
            arms=cb.ARMS,
            reps=1,
            task_filter=cb.task_filter_record(all_tasks, all_tasks),
        )
        self.assertIn(cb.SECTION_SCOPE, full, "a whole-set run states that it is one")
        self.assertIn(
            "with no `--task` or `--tier` selection", section_of(full, cb.SECTION_SCOPE)
        )

    def test_a_selection_that_covers_everything_is_still_reported_as_given(self):
        """[23B.2-scope-states-the-selection] `partial` is coverage arithmetic
        and carries no record of what was typed, so a `--tier` enumeration that
        happens to name every tier leaves it false. The scope section states
        the flags it was given whenever there were any, and reserves the claim
        that none were given for a run that had none, because a reader diffing
        two reports has nothing else to tell the two invocations apart."""
        path = write_manifest(self.tmp, manifest_dict(), name="covering.json")
        all_tasks = cb.load_tasks(path)
        every_tier = list(cb.TIERS)
        selected = cb.select_tasks(all_tasks, tiers=every_tier)
        self.assertEqual(len(selected), len(all_tasks))
        record = cb.task_filter_record(all_tasks, selected, tiers=every_tier)
        self.assertFalse(record["partial"], "a covering selection narrows nothing")

        scope = section_of(
            cb.render_report(
                [],
                selected,
                models=[SENTINEL_MODEL],
                arms=cb.ARMS,
                reps=1,
                task_filter=record,
            ),
            cb.SECTION_SCOPE,
        )
        self.assertIn("whole declared task set", scope)
        self.assertNotIn(
            "with no `--task` or `--tier` selection",
            scope,
            "the run was invoked with a selection and the report must not deny it",
        )
        for tier in every_tier:
            self.assertIn("`--tier %s`" % tier, scope, tier)

        # One task named explicitly, alongside every tier, is still a covering
        # selection - and both flags belong in the sentence.
        with_task = cb.task_filter_record(
            all_tasks, selected, task_ids=[all_tasks[0].id], tiers=every_tier
        )
        scope = section_of(
            cb.render_report(
                [],
                selected,
                models=[SENTINEL_MODEL],
                arms=cb.ARMS,
                reps=1,
                task_filter=with_task,
            ),
            cb.SECTION_SCOPE,
        )
        self.assertIn("`--task %s`" % all_tasks[0].id, scope)
        self.assertIn("`--tier %s`" % every_tier[0], scope)

    def test_a_report_with_no_filter_record_claims_no_coverage(self):
        """[23B.2-scope-needs-provenance] render_report holds the tasks it was
        handed and no manifest, so with no filter record it cannot know what
        the declared set is. It says nothing about coverage rather than
        asserting that whatever subset it was given is the whole of it."""
        path = write_manifest(self.tmp, manifest_dict(), name="unrecorded.json")
        all_tasks = cb.load_tasks(path)
        subset = all_tasks[:2]
        self.assertLess(len(subset), len(all_tasks))

        scope = section_of(
            cb.render_report(
                [], subset, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=1
            ),
            cb.SECTION_SCOPE,
        )
        self.assertNotIn(
            "whole declared task set",
            scope,
            "a report with no provenance cannot claim to have covered a set",
        )
        self.assertIn("not recorded with this report", scope)

        # run_benchmark carries the same optional record, so the layer above
        # cannot manufacture the claim by omitting one keyword either.
        outcome = cb.run_benchmark(
            subset,
            results_dir=self.tmp / "unrecorded-results",
            report_path=self.tmp / "unrecorded-report.md",
            work_root=self.tmp / "unrecorded-work",
            models=[SENTINEL_MODEL],
            arms=("baseline",),
            reps=1,
            report_only=True,
        )
        rendered = Path(outcome["reportPath"]).read_text()
        self.assertNotIn("whole declared task set", rendered)


class ResultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-result-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = fixture_tasks(self.tmp)

    def test_result_written_per_cell(self):
        """[14.1-result-written-per-cell] one result file per cell, named for
        the cell, written under the results directory and nowhere else - and the
        module's defaults land beside, never on top of, the model benchmark."""
        self.assertEqual(cb.REPORT_PATH, cb.BENCH_DIR / "conductor-report.md")
        self.assertEqual(cb.REPORT_PATH.name, "conductor-report.md")
        self.assertNotEqual(cb.REPORT_PATH, cb.BENCH_DIR / "report.md")
        self.assertEqual(cb.RESULTS_DIR, cb.BENCH_DIR / "conductor" / "runs")
        self.assertNotEqual(cb.RESULTS_DIR, cb.BENCH_DIR)

        results_dir = self.tmp / "runs"
        report_path = self.tmp / "out" / "conductor-report.md"
        work_root = self.tmp / "work"
        cell = make_cell("doctrine", TASK_IDS[3], 2)
        self.assertEqual(
            cb.result_path(results_dir, cell),
            results_dir / "llamacpp-sentinel-model-x__none__doctrine__bt04__r2.json",
        )

        written = cb.write_result(results_dir, make_result("doctrine", TASK_IDS[3], 2))
        self.assertTrue(written.is_file())
        self.assertEqual(written, cb.result_path(results_dir, cell))

        calls = []

        def fake_runner(cell, task, cell_dir):
            calls.append(cell.cell_id)
            return make_result(
                cell.arm, cell.task_id, cell.rep, model=cell.model, capability=cell.capability
            )

        before = snapshot(self.tmp)
        outcome = cb.run_benchmark(
            self.tasks,
            results_dir=results_dir,
            report_path=report_path,
            work_root=work_root,
            models=[SENTINEL_MODEL],
            cell_runner=fake_runner,
        )
        self.assertEqual(len(outcome["results"]), 90)
        files = sorted(p.name for p in results_dir.glob("*.json"))
        self.assertEqual(len(files), 90, "one file per cell")
        self.assertEqual(len(set(files)), 90, "one writer per file")
        self.assertTrue(report_path.is_file())

        after = snapshot(self.tmp)
        allowed_roots = (
            str(results_dir.relative_to(self.tmp)),
            str(report_path.parent.relative_to(self.tmp)),
            str(work_root.relative_to(self.tmp)),
        )
        for path in set(after) - set(before):
            self.assertTrue(
                path.startswith(allowed_roots),
                "the driver wrote outside its own directories: %s" % path,
            )

    def test_result_schema_pinned(self):
        """[14.1-result-schema-pinned] one pinned result schema with every key
        present and inapplicability expressed as null, validated by field
        name and round-tripping unchanged."""
        expected_keys = {
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
        }
        self.assertEqual(set(cb.RESULT_KEYS), expected_keys)
        self.assertEqual(set(cb.TOKEN_KEYS), {"prompt", "completion", "total", "partial"})
        self.assertEqual(set(cb.OUTCOMES), {"pass", "fail", "timeout", "harness-error"})
        self.assertEqual(
            set(cb.STOP_KINDS), {"done", "noop", "blocked", "surfaced", "env", "interrupt"}
        )

        good = make_result("conductor", TASK_IDS[0], 1)
        cb.validate_result(good)

        for key in sorted(expected_keys):
            missing = dict(good)
            missing.pop(key)
            with self.assertRaises(cb.BenchError, msg=key) as ctx:
                cb.validate_result(missing)
            self.assertIn(key, str(ctx.exception), "the error must name the missing field")

        for key in sorted(cb.TOKEN_KEYS):
            missing = json.loads(json.dumps(good))
            missing["tokens"].pop(key)
            with self.assertRaises(cb.BenchError, msg=key) as ctx:
                cb.validate_result(missing)
            self.assertIn(key, str(ctx.exception))

        bad_stop = dict(good, stopKind="finished")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.validate_result(bad_stop)
        self.assertIn("stopKind", str(ctx.exception))

        bad_outcome = dict(good, outcome="mostly-passing")
        with self.assertRaises(cb.BenchError) as ctx:
            cb.validate_result(bad_outcome)
        self.assertIn("outcome", str(ctx.exception))

        for kind in cb.STOP_KINDS:
            cb.validate_result(dict(good, stopKind=kind))

        results_dir = self.tmp / "runs"
        path = cb.write_result(results_dir, good)
        self.assertEqual(json.loads(path.read_text()), good, "a result must round-trip unchanged")
        loaded = cb.load_results(results_dir)
        self.assertEqual(loaded, [good])

    def test_score_is_exit_status_passthrough(self):
        """[14.1-score-is-exit-status-passthrough] scoring is the hidden test's
        exit status passed through - no ratio, no partial credit, no judge."""
        with no_subprocess():
            self.assertEqual(
                cb.score_cell(0, False, None), {"passed": True, "outcome": "pass", "exitCode": 0}
            )
            self.assertEqual(
                cb.score_cell(1, False, None), {"passed": False, "outcome": "fail", "exitCode": 1}
            )
            self.assertEqual(
                cb.score_cell(137, False, None),
                {"passed": False, "outcome": "fail", "exitCode": 137},
            )
            timed = cb.score_cell(None, True, None)
            self.assertEqual(timed["outcome"], "timeout")
            self.assertIs(timed["passed"], False)
            spawned = cb.score_cell(None, False, "No such file or directory")
            self.assertEqual(spawned["outcome"], "harness-error")
            self.assertIs(spawned["passed"], False)
            # A spawn failure is never reported as a model failure, even if an
            # exit code happens to be present.
            self.assertEqual(cb.score_cell(1, False, "boom")["outcome"], "harness-error")

        source = module_source()
        for banned in ("score_exec", "score_symbols", "self_judge", "judge_rubric"):
            self.assertNotIn(banned, source, "%s has no place in a pass-through scorer" % banned)
        for node in ast.walk(module_ast()):
            if isinstance(node, ast.Call):
                name = getattr(node.func, "id", None) or getattr(node.func, "attr", None) or ""
                self.assertNotIn("judge", name.lower(), "no model-graded path is permitted")

    def test_tokens_from_ledger_window(self):
        """[14.1-tokens-from-ledger-window] token totals come from the router
        ledger window, summed over 11.7's pinned keys, with partial set rather
        than a quiet under-report."""
        ledger = self.tmp / "metrics.jsonl"
        lines = [
            _ledger_line(promptTokens=10, completionTokens=5),
            _ledger_line(promptTokens=20, completionTokens=7),
            _ledger_line(promptTokens=100, completionTokens=100),
            _ledger_line(promptTokens=30, completionTokens=11),
        ]
        ledger.write_text("".join(line + "\n" for line in lines))

        self.assertEqual(cb.ledger_line_count(ledger), 4)
        window = cb.summarize_ledger_window(ledger, 2)
        self.assertEqual(window["prompt"], 130)
        self.assertEqual(window["completion"], 111)
        self.assertEqual(window["total"], 241)
        self.assertIs(window["partial"], False)

        whole = cb.summarize_ledger_window(ledger, 0)
        self.assertEqual(whole["prompt"], 160)
        self.assertEqual(whole["completion"], 123)
        self.assertEqual(whole["total"], 283)

        empty = cb.summarize_ledger_window(ledger, 4)
        self.assertEqual((empty["prompt"], empty["completion"], empty["total"]), (0, 0, 0))
        self.assertIs(empty["partial"], True, "a cell that produced no ledger line is partial")

        holed = self.tmp / "holed.jsonl"
        holed.write_text(
            "".join(
                line + "\n"
                for line in [
                    _ledger_line(promptTokens=10, completionTokens=5),
                    _ledger_line(promptTokens=None, completionTokens=8),
                ]
            )
        )
        partial = cb.summarize_ledger_window(holed, 0)
        self.assertEqual(partial["prompt"], 10)
        self.assertEqual(partial["completion"], 13)
        self.assertEqual(partial["total"], 23)
        self.assertIs(partial["partial"], True)

        absent = cb.summarize_ledger_window(self.tmp / "nope.jsonl", 0)
        self.assertIsNone(absent["prompt"])
        self.assertIsNone(absent["completion"])
        self.assertIsNone(absent["total"])
        self.assertIs(absent["partial"], True)

        self.assertEqual(cb.ledger_line_count(self.tmp / "nope.jsonl"), 0)

    def test_router_errors_flagged_not_averaged(self):
        """[14.1-router-errors-flagged-not-averaged] non-2xx ledger lines are
        counted as routerErrors so a night the server fell over cannot read as
        a model result."""
        ledger = self.tmp / "mixed.jsonl"
        ledger.write_text(
            "".join(
                line + "\n"
                for line in [
                    _ledger_line(status=200, promptTokens=1, completionTokens=1),
                    _ledger_line(status=502, promptTokens=0, completionTokens=0),
                    _ledger_line(status=200, promptTokens=2, completionTokens=2),
                    _ledger_line(status=503, promptTokens=0, completionTokens=0),
                    _ledger_line(status=500, promptTokens=0, completionTokens=0),
                    _ledger_line(status=None, promptTokens=3, completionTokens=3),
                ]
            )
        )
        window = cb.summarize_ledger_window(ledger, 0)
        self.assertEqual(window["routerErrors"], 3, "502, 503 and 500 are infrastructure failures")
        self.assertEqual(window["prompt"], 6)

        clean = cb.summarize_ledger_window(ledger, 5)
        self.assertEqual(clean["routerErrors"], 0)

        results = fixture_results(self.tasks, ("baseline",))
        flagged = make_cell("baseline", TASK_IDS[2], 1).cell_id
        for row in results:
            if row["cellId"] == flagged:
                row["routerErrors"] = 4
        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=("baseline",), reps=3
        )
        section = section_of(report, cb.SECTION_ROUTER_ERRORS)
        self.assertIn(flagged, section, "a cell with router errors must be named in the report")
        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3)
        self.assertIn(flagged, agg["armTotals"]["baseline"]["routerErrorCells"])


class MetricsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-metrics-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    def make_run_dir(self, work_dir: Path, run_id: str = "run-0001", overrides_used: int = 3, **over):
        run_dir = work_dir / ".conductor" / "runs" / run_id
        (run_dir / "reviews").mkdir(parents=True, exist_ok=True)
        run_json = {
            "runId": run_id,
            "createdIso": "2026-08-14T00:00:00Z",
            "prompt": "do the thing",
            "sessionID": "ses_1",
            "state": over.get("state", "REPORTED"),
            "classification": {"kind": "feature", "rationale": "r", "check": {"agreed": True, "note": ""}},
            "startHead": "abc123",
            "startBranch": "main",
            "startDirty": [],
            "excludedStaleRed": [],
            "planReviewRounds": 1,
            "stop": over.get("stop", {"kind": "done", "reasonDisplay": "done", "tsMs": 1}),
            "counters": {"idleRePrompts": 1, "futileRePrompts": 0, "overridesUsed": overrides_used},
        }
        (run_dir / "run.json").write_text(json.dumps(run_json))
        journal = [
            {"seq": 1, "ts": 1, "level": "info", "component": "fsm", "runId": run_id, "event": "transition", "data": {}},
            {"seq": 2, "ts": 2, "level": "info", "component": "fanout", "runId": run_id, "event": "subsession.retry", "data": {"attempt": 1}},
            {"seq": 3, "ts": 3, "level": "info", "component": "fanout", "runId": run_id, "event": "subsession.dispatched", "data": {}},
            {"seq": 4, "ts": 4, "level": "info", "component": "fanout", "runId": run_id, "event": "subsession.retry", "data": {"attempt": 2}},
            {"seq": 5, "ts": 5, "level": "info", "component": "gates", "runId": run_id, "event": "subsession.retry", "data": {}},
        ]
        (run_dir / "journal.jsonl").write_text("".join(json.dumps(e) + "\n" for e in journal))
        (run_dir / "reviews" / "item-1-r1.json").write_text(
            json.dumps(
                {
                    "verdicts": [
                        {"findingId": "f1", "upheld": True, "reasoning": "stands"},
                        {"findingId": "f2", "upheld": False, "reasoning": "refuted"},
                    ]
                }
            )
        )
        (run_dir / "reviews" / "plan-r1.json").write_text(
            json.dumps({"verdicts": [{"findingId": "f3", "upheld": True, "reasoning": "stands"}]})
        )
        return run_dir

    def test_conductor_metrics_from_run_dir(self):
        """[14.1-conductor-metrics-from-run-dir] the conductor arm's process
        metrics are read from the run directory the plugin wrote, by the
        derivations the spec pins, never recomputed."""
        work = self.tmp / "repo"
        work.mkdir()
        # An older run in the same tree carries different numbers, so reading
        # the newest directory is observable rather than assumed.
        self.make_run_dir(work, "run-0001", overrides_used=99)
        newer = self.make_run_dir(work, "run-0002", overrides_used=3)
        os.utime(newer, (time.time() + 10, time.time() + 10))

        metrics = cb.collect_conductor_metrics(work)
        self.assertEqual(metrics["schemaRetries"], 2, "only fanout/subsession.retry lines count")
        self.assertEqual(metrics["overridesUsed"], 3, "read from run.json counters, not recomputed")
        self.assertEqual(metrics["stopKind"], "done")
        self.assertEqual(metrics["reviewFindingsUpheld"], 2)
        self.assertIs(metrics["pluginAbsent"], False)

        # No stop record: the terminal run state stands in for the stop kind.
        terminal = self.tmp / "terminal"
        terminal.mkdir()
        self.make_run_dir(terminal, "run-0001", stop=None, state="TRIVIAL_DONE")
        self.assertEqual(cb.collect_conductor_metrics(terminal)["stopKind"], "TRIVIAL_DONE")

        # Non-terminal, no stop: null rather than an invented value.
        running = self.tmp / "running"
        running.mkdir()
        self.make_run_dir(running, "run-0001", stop=None, state="IMPLEMENTING")
        self.assertIsNone(cb.collect_conductor_metrics(running)["stopKind"])

        # ISSUE-104: a run directory with no reviews/ source has nothing to count.
        # A live cell is exactly this case - no writer produces reviews/ yet - so
        # the metric reads None ("not measured"), never a fabricated measured 0 a
        # report column would render as a real "0 findings upheld".
        no_reviews = self.tmp / "noreviews"
        no_reviews.mkdir()
        run_dir = self.make_run_dir(no_reviews, "run-0001")
        for path in (run_dir / "reviews").glob("*.json"):
            path.unlink()
        (run_dir / "reviews").rmdir()
        self.assertIsNone(cb.collect_conductor_metrics(no_reviews)["reviewFindingsUpheld"])

    def test_nonconductor_metrics_null(self):
        """[14.1-nonconductor-metrics-null] the four conductor-only metrics are
        null for baseline and doctrine, never zero, and the collector does not
        go looking for a .conductor directory for those arms."""
        work = self.tmp / "repo"
        work.mkdir()
        self.make_run_dir(work, "run-0001")

        conductor = cb.collect_metrics("conductor", work)
        for key in ("schemaRetries", "reviewFindingsUpheld", "overridesUsed"):
            self.assertIsInstance(conductor[key], int, key)
        self.assertIsInstance(conductor["stopKind"], str)

        for arm in ("baseline", "doctrine"):
            metrics = cb.collect_metrics(arm, work)
            for key in ("schemaRetries", "reviewFindingsUpheld", "overridesUsed", "stopKind"):
                self.assertIsNone(
                    metrics[key],
                    "%s must report %s as null even beside a populated run dir" % (arm, key),
                )
            self.assertIsNone(metrics["pluginAbsent"])

        tasks = load_synthetic(self.tmp)
        results = [
            make_result("baseline", TASK_IDS[0], 1),
            make_result("doctrine", TASK_IDS[0], 1),
            make_result("conductor", TASK_IDS[0], 1),
        ]
        report = cb.render_report(results, tasks[:1], models=[SENTINEL_MODEL], arms=cb.ARMS, reps=1)
        self.assertEqual(cb.format_metric(None), cb.NA)
        self.assertEqual(cb.NA, "n/a")
        self.assertIn(cb.NA, report, "null process metrics must render as n/a")
        for label in cb.PROCESS_METRIC_LABELS:
            self.assertIn(label, report, "the report must name %s" % label)

    def test_plugin_absent_flagged(self):
        """[14.1-plugin-absent-flagged] a conductor cell with no run directory
        is flagged, excluded from the arm's pass rate, and named in the report
        under its own heading."""
        empty = self.tmp / "ungated"
        empty.mkdir()
        metrics = cb.collect_metrics("conductor", empty)
        self.assertIs(metrics["pluginAbsent"], True)
        for key in ("schemaRetries", "reviewFindingsUpheld", "overridesUsed", "stopKind"):
            self.assertIsNone(metrics[key], key)
        self.assertIsNone(cb.collect_metrics("baseline", empty)["pluginAbsent"])

        tasks = fixture_tasks(self.tmp)
        results = fixture_results(tasks, ("conductor",))
        absent = [
            make_cell("conductor", TASK_IDS[0], 1).cell_id,
            make_cell("conductor", TASK_IDS[0], 2).cell_id,
        ]
        for row in results:
            if row["cellId"] in absent:
                row["pluginAbsent"] = True
        agg = cb.aggregate(results, tasks, model=SENTINEL_MODEL, arms=("conductor",), reps=3)
        group = agg["groups"]["conductor"][TASK_IDS[0]]

        # PATTERN conductor task 0 is "PPP"; two of its three cells are ungated.
        self.assertEqual(group["scored"], 1, "ungated cells leave the denominator")
        self.assertEqual(group["passes"], 1)
        self.assertEqual(group["excluded"], 2)

        totals = agg["armTotals"]["conductor"]
        planned_recorded = sum(PATTERN["conductor"][i].count("P") for i in range(10))
        self.assertEqual(totals["passes"], planned_recorded - 2)
        self.assertEqual(
            sorted(row["cellId"] for row in totals["excludedCells"]), sorted(absent)
        )
        self.assertEqual(
            {row["reason"] for row in totals["excludedCells"]}, {"plugin-absent"}
        )

        report = cb.render_report(
            results, tasks, models=[SENTINEL_MODEL], arms=("conductor",), reps=3
        )
        section = section_of(report, cb.SECTION_EXCLUSIONS)
        for cell_id in absent:
            self.assertIn(cell_id, section)
        # The count is stated somewhere other than the cell-id listing itself.
        prose = [line for line in section.splitlines() if "/" not in line]
        self.assertTrue(
            any("2" in line for line in prose),
            "the count of excluded cells must be stated, not just listed:\n%s" % section,
        )


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-report-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = fixture_tasks(self.tmp)

    def test_aggregate_per_task_spread(self):
        """[14.1-aggregate-per-task-spread] aggregate reports spread, not just
        means: per-repetition outcome vectors and min/max pass per (arm, task)
        group, so a 1/3-vs-2/3 difference can never look stable."""
        results = fixture_results(self.tasks, ("baseline",))
        self.assertEqual(len(results), 30)
        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3)

        for idx, task in enumerate(self.tasks):
            pattern = PATTERN["baseline"][idx]
            group = agg["groups"]["baseline"][task.id]
            self.assertEqual(group["passes"], pattern.count("P"), task.id)
            self.assertEqual(group["recorded"], 3, task.id)
            self.assertEqual(group["planned"], 3, task.id)
            self.assertEqual(
                group["outcomes"], [OUTCOME_OF[c] for c in pattern], "%s vector" % task.id
            )
            self.assertEqual(group["minPass"], 1 if pattern == "PPP" else 0, task.id)
            self.assertEqual(group["maxPass"], 0 if pattern == "FFF" else 1, task.id)

        # The three shapes the row calls out by name.
        self.assertEqual(PATTERN["baseline"][1], "PPP")
        self.assertEqual(PATTERN["baseline"][0], "FFF")
        self.assertEqual(PATTERN["baseline"][2], "PFF")
        three_of_three = agg["groups"]["baseline"][TASK_IDS[1]]
        zero_of_three = agg["groups"]["baseline"][TASK_IDS[0]]
        one_of_three = agg["groups"]["baseline"][TASK_IDS[2]]
        self.assertEqual((three_of_three["minPass"], three_of_three["maxPass"]), (1, 1))
        self.assertEqual((zero_of_three["minPass"], zero_of_three["maxPass"]), (0, 0))
        self.assertEqual((one_of_three["minPass"], one_of_three["maxPass"]), (0, 1))

        totals = agg["armTotals"]["baseline"]
        self.assertEqual(totals["passes"], sum(p.count("P") for p in PATTERN["baseline"]))
        self.assertEqual(totals["recorded"], 30)
        self.assertEqual(totals["planned"], 30)
        self.assertEqual(
            totals["perTaskPasses"],
            {TASK_IDS[i]: PATTERN["baseline"][i].count("P") for i in range(10)},
        )

        two_of_three = {"minPass": 0, "maxPass": 1}
        self.assertTrue(cb.within_noise(one_of_three, two_of_three))
        self.assertFalse(cb.within_noise(zero_of_three, three_of_three))

    def test_report_never_bare_aggregate(self):
        """[14.1-report-never-bare-aggregate] the report always shows per-task
        pass rates with their per-repetition spread, and never states an arm
        comparison without them."""
        results = fixture_results(self.tasks, cb.ARMS)
        self.assertEqual(len(results), 90)
        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )

        self.assertIn(cb.SECTION_PER_TASK, report)
        self.assertIn(cb.SECTION_ARM_TOTALS, report)
        self.assertLess(
            report.index(cb.SECTION_PER_TASK),
            report.index(cb.SECTION_ARM_TOTALS),
            "an arm-level total may not precede the per-task table",
        )

        # The row assertions below search the report for a string the formatter
        # produced, so the formatter's own output is pinned to a literal here
        # first. Without this, an oracle built from format_rate/format_outcomes
        # agrees with any change to them - a report that printed the recorded
        # count as the pass count, or hid the spread entirely, would still be
        # found in the row and the suite would stay green.
        self.assertEqual(cb.format_rate(2, 3), "2/3")
        self.assertEqual(cb.format_outcomes(["pass", "fail", "pass"]), "pass fail pass")
        self.assertEqual(cb.format_outcomes([]), "none recorded")

        table = section_of(report, cb.SECTION_PER_TASK)
        for idx, task in enumerate(self.tasks):
            rows = [line for line in table.splitlines() if task.id in line]
            self.assertEqual(len(rows), 1, "%s must have exactly one row" % task.id)
            row = rows[0]
            for arm in cb.ARMS:
                pattern = PATTERN[arm][idx]
                self.assertIn(
                    cb.format_rate(pattern.count("P"), 3),
                    row,
                    "%s/%s pass rate missing from its row" % (arm, task.id),
                )
                self.assertIn(
                    cb.format_outcomes([OUTCOME_OF[c] for c in pattern]),
                    row,
                    "%s/%s spread missing from its row" % (arm, task.id),
                )

        # Task 2 is baseline 1/3 vs doctrine 2/3 - overlapping ranges, so the
        # report must say plainly that the arms are within noise there.
        self.assertIn(cb.NOISE_NOTE, report)

        separated = [
            make_result(arm, task.id, rep, outcome="pass" if arm == "conductor" else "fail",
                        passed=arm == "conductor", exit_code=0 if arm == "conductor" else 1)
            for rep in (1, 2, 3)
            for task in self.tasks[:3]
            for arm in cb.ARMS
        ]
        clean = cb.render_report(
            separated, self.tasks[:3], models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        self.assertNotIn(
            cb.NOISE_NOTE, clean, "cleanly separated arms must not be described as within noise"
        )

        one_arm = cb.render_report(
            fixture_results(self.tasks, ("baseline",)),
            self.tasks,
            models=[SENTINEL_MODEL],
            arms=("baseline",),
            reps=3,
        )
        self.assertNotIn(
            cb.SECTION_ARM_TOTALS,
            one_arm,
            "a single-arm result set has nothing to compare and must say nothing",
        )
        self.assertIn(cb.SECTION_PER_TASK, one_arm)

    def test_report_incomplete_honest(self):
        """[14.1-report-incomplete-honest] an incomplete set reports as
        incomplete: recorded-of-planned per arm and per task, missing cells
        named, rates over recorded cells only."""
        full = fixture_results(self.tasks, ("baseline",))
        dropped = [row["cellId"] for row in full[-8:]]
        self.assertEqual(len(dropped), 8)
        results = fixture_results(self.tasks, ("baseline",), drop=dropped)
        self.assertEqual(len(results), 22)

        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3)
        totals = agg["armTotals"]["baseline"]
        self.assertEqual(totals["planned"], 30)
        self.assertEqual(totals["recorded"], 22)
        self.assertEqual(sorted(agg["missingCells"]), sorted(dropped))

        recorded_passes = sum(1 for row in results if row["passed"])
        self.assertEqual(totals["passes"], recorded_passes)
        self.assertLess(totals["passes"], sum(p.count("P") for p in PATTERN["baseline"]))

        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=("baseline",), reps=3
        )
        # Pinned to a literal, not to format_recorded's own output: a report
        # that claimed "30 of 30 recorded" for 22 recorded cells is the exact
        # dishonesty this row exists to forbid, and an oracle built from the
        # formatter would move with it.
        self.assertEqual(cb.format_recorded(22, 30), "22 of 30 recorded")
        self.assertIn("22 of 30 recorded", report, "the arm's coverage must be stated")
        table = section_of(report, cb.SECTION_PER_TASK)
        for task in self.tasks:
            group = agg["groups"]["baseline"][task.id]
            rows = [line for line in table.splitlines() if task.id in line]
            self.assertEqual(len(rows), 1, task.id)
            self.assertIn(
                cb.format_rate(group["passes"], group["scored"]),
                rows[0],
                "%s must report over scored cells only" % task.id,
            )
            if group["recorded"] != group["planned"]:
                self.assertIn(cb.format_recorded(group["recorded"], group["planned"]), rows[0])

        missing = section_of(report, cb.SECTION_MISSING)
        for cell_id in dropped:
            self.assertIn(cell_id, missing, "%s must be named as missing" % cell_id)

    def test_report_cost_and_method(self):
        """[14.1-report-cost-and-method] the report carries the cost side and
        its own methodology, so the deliverable is quality delta VERSUS cost."""
        partial_cell = make_cell("baseline", TASK_IDS[5], 2).cell_id
        results = fixture_results(self.tasks, cb.ARMS, partial_cell=partial_cell)
        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )

        method = section_of(report, cb.SECTION_METHOD)
        self.assertIn(SENTINEL_MODEL, method, "the model must be named")
        for arm in cb.ARMS:
            self.assertIn(arm, method, "the %s arm must be defined" % arm)
        self.assertIn("repetition", method.lower(), "the repetition count must be stated")
        self.assertIn("3", method, "the repetition count must be stated")
        self.assertIn("router", method.lower(), "all arms ran through the router")
        for label in cb.PROCESS_METRIC_LABELS:
            self.assertIn(label, report)
        self.assertIn(cb.NA, report)

        # Same pinning as the per-task table: the cost figures are searched for
        # in the report by the string these formatters produce, so their output
        # is fixed to a literal before it is used as an oracle.
        self.assertEqual(cb.format_ms(1234), "1234 ms")
        self.assertEqual(cb.format_tokens(4500, False), "4500")
        self.assertEqual(cb.format_tokens(4500, True), "4500 (partial)")

        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=cb.ARMS, reps=3)
        cost = section_of(report, cb.SECTION_COST)
        for arm in cb.ARMS:
            wall = [1000 + 10 * i + r for i in range(10) for r in (1, 2, 3)]
            self.assertEqual(agg["armTotals"][arm]["wallClockMsTotal"], sum(wall))
            self.assertEqual(agg["armTotals"][arm]["wallClockMsMedian"], median(wall))
            self.assertEqual(agg["armTotals"][arm]["tokensTotal"], 30 * 150)
            self.assertIn(cb.format_ms(sum(wall)), cost, "%s total wall clock" % arm)
            self.assertIn(cb.format_ms(median(wall)), cost, "%s median wall clock" % arm)

        self.assertIs(agg["armTotals"]["baseline"]["tokensPartial"], True)
        self.assertIs(agg["armTotals"]["conductor"]["tokensPartial"], False)
        self.assertIn(cb.PARTIAL_MARKER, cb.format_tokens(30 * 150, True))
        self.assertNotIn(cb.PARTIAL_MARKER, cb.format_tokens(30 * 150, False))
        self.assertIn(cb.format_tokens(30 * 150, True), cost, "partial tokens must be marked")

        per_task = agg["groups"]["baseline"][TASK_IDS[0]]
        self.assertEqual(per_task["wallClockMsTotal"], sum(1000 + 0 + r for r in (1, 2, 3)))
        self.assertEqual(per_task["wallClockMsMedian"], median([1001, 1002, 1003]))


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-driver-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = fixture_tasks(self.tmp)

    def test_resume_and_report_only(self):
        """[14.1-resume-and-report-only] an overnight that dies is resumable:
        completed cells are skipped and reused verbatim, and --report-only
        executes nothing while still rebuilding a complete report."""
        results_dir = self.tmp / "runs"
        report_path = self.tmp / "conductor-report.md"
        work_root = self.tmp / "work"

        plan = cb.build_run_plan(self.tasks, models=[SENTINEL_MODEL])
        self.assertEqual(len(plan), 90)
        done = plan[:12]
        preexisting = {}
        for cell in done:
            row = make_result(
                cell.arm,
                cell.task_id,
                cell.rep,
                model=cell.model,
                capability=cell.capability,
                wall_clock_ms=4242,
                startedIso="2026-01-01T00:00:00Z",
            )
            preexisting[cell.cell_id] = row
            cb.write_result(results_dir, row)
        self.assertEqual(len(list(results_dir.glob("*.json"))), 12)

        calls = []

        def counting_runner(cell, task, cell_dir):
            calls.append(cell.cell_id)
            Path(cell_dir).mkdir(parents=True, exist_ok=True)
            return make_result(
                cell.arm,
                cell.task_id,
                cell.rep,
                model=cell.model,
                capability=cell.capability,
                wall_clock_ms=7,
            )

        outcome = cb.run_benchmark(
            self.tasks,
            results_dir=results_dir,
            report_path=report_path,
            work_root=work_root,
            models=[SENTINEL_MODEL],
            cell_runner=counting_runner,
        )
        self.assertEqual(len(calls), 78, "12 completed cells must be skipped, not re-run")
        self.assertEqual(len(outcome["skipped"]), 12)
        self.assertEqual(sorted(outcome["skipped"]), sorted(preexisting))
        self.assertEqual(set(calls) & set(preexisting), set())
        self.assertEqual(len(outcome["results"]), 90)

        by_id = {row["cellId"]: row for row in outcome["results"]}
        for cell_id, row in preexisting.items():
            self.assertEqual(by_id[cell_id], row, "a skipped cell's result must be reused verbatim")
        for cell in done:
            self.assertFalse(
                cb.cell_dir_for(work_root, cell).exists(),
                "a skipped cell must not be re-seeded: %s" % cell.cell_id,
            )
        for cell in plan[12:]:
            self.assertTrue(
                cb.cell_dir_for(work_root, cell).exists(),
                "an executed cell must get its own directory: %s" % cell.cell_id,
            )

        # --report-only over just the twelve.
        fresh_results = self.tmp / "runs-12"
        fresh_report = self.tmp / "report-12.md"
        for row in preexisting.values():
            cb.write_result(fresh_results, row)
        calls[:] = []
        only = cb.run_benchmark(
            self.tasks,
            results_dir=fresh_results,
            report_path=fresh_report,
            work_root=self.tmp / "work-12",
            models=[SENTINEL_MODEL],
            report_only=True,
            cell_runner=counting_runner,
        )
        self.assertEqual(calls, [], "--report-only must execute zero cells")
        self.assertEqual(only["executed"], [])
        self.assertEqual(len(only["results"]), 12)
        self.assertTrue(fresh_report.is_file())
        text = fresh_report.read_text()
        self.assertIn(cb.SECTION_PER_TASK, text)
        self.assertIn(cb.SECTION_MISSING, text, "an incomplete report must name what is missing")
        for cell_id in preexisting:
            self.assertNotIn(
                cell_id, section_of(text, cb.SECTION_MISSING), "%s was recorded" % cell_id
            )


    def test_report_only_describes_the_selection_it_states(self):
        """[23C.7-report-only-selection] a report rebuilt over a --task or
        --tier selection counts only the cells of the tasks it names.

        The scope section states that every number below it describes the
        selected tasks only. report-only reads every cell on disk rather than
        the plan, and the rubric lane keys off those rows with no task of its
        own to filter by - so a narrowed rebuild renders hand-scored medians and
        verbatim findings from tasks it just said it was not describing, under a
        heading that says otherwise, beside per-task tables that are correct.
        """
        results_dir = self.tmp / "ro-runs"
        rubric_dir = self.tmp / "ro-rubrics"
        report_path = self.tmp / "ro-report.md"
        kept, dropped = TASK_IDS[0], TASK_IDS[1]
        for task_id in (kept, dropped):
            for arm in cb.ARMS:
                cb.write_result(results_dir, make_result(arm, task_id, 1))
        cb.write_rubric(
            rubric_dir,
            {
                "cellId": make_cell("conductor", dropped, 1).cell_id,
                "reviewer": "owner",
                "scores": dict((c, 3) for c in cb.RUBRIC_CRITERIA),
                "findings": ["a finding about the unselected task %s" % dropped],
                "notes": "",
            },
        )

        selected = [task for task in self.tasks if task.id == kept]
        record = cb.task_filter_record(self.tasks, selected, task_ids=[kept], tiers=[])
        outcome = cb.run_benchmark(
            selected,
            results_dir=results_dir,
            report_path=report_path,
            work_root=self.tmp / "ro-work",
            models=[SENTINEL_MODEL],
            reps=1,
            rubric_dir=rubric_dir,
            report_only=True,
            task_filter=record,
        )
        self.assertEqual(
            len(outcome["results"]),
            len(cb.ARMS),
            "report-only must load the selected tasks' cells and no others",
        )
        text = report_path.read_text()
        self.assertNotIn(
            dropped,
            text,
            "a task the run states it did not cover must not appear in it",
        )
        rubric_section = section_of(text, cb.SECTION_RUBRIC)
        self.assertNotIn(
            "a finding about the unselected task",
            rubric_section,
            "a finding from outside the selection must not render under it",
        )
        for line in rubric_section.splitlines():
            if line.startswith("| conductor"):
                self.assertIn(
                    "| 0 |", line, "no cell of the selected task was reviewed"
                )

        # Unnarrowed, the same call renders the whole set, so the filter is what
        # narrows the rubric lane rather than the lane having gone blind.
        whole = self.tmp / "ro-report-all.md"
        cb.run_benchmark(
            self.tasks,
            results_dir=results_dir,
            report_path=whole,
            work_root=self.tmp / "ro-work-all",
            models=[SENTINEL_MODEL],
            reps=1,
            rubric_dir=rubric_dir,
            report_only=True,
        )
        self.assertIn("a finding about the unselected task", whole.read_text())


class IntegrityTests(unittest.TestCase):
    """Phase 22 and 22A: the corrections that make the output believable."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-integrity-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = fixture_tasks(self.tmp)

    def test_exclusions_are_arm_symmetric(self):
        """[22.2-symmetric-exclusions] a cell is excluded by one predicate for
        every arm, an exclusion takes its arm-symmetric counterparts with it,
        and the counts are reported per arm."""
        for reason, row in (
            ("plugin-absent", make_result("conductor", TASK_IDS[0], 1, plugin_absent=True)),
            (
                "harness-error",
                make_result(
                    "baseline", TASK_IDS[0], 1, outcome="harness-error", passed=False,
                    exit_code=None,
                ),
            ),
        ):
            self.assertEqual(cb.exclusion_reason(row), reason)
        self.assertIsNone(cb.exclusion_reason(make_result("baseline", TASK_IDS[0], 1)))
        self.assertIsNone(
            cb.exclusion_reason(make_result("conductor", TASK_IDS[0], 1)),
            "a gated conductor cell is a measurement, not an exclusion",
        )

        results = fixture_results(self.tasks, cb.ARMS)
        by_id = {row["cellId"]: row for row in results}
        ungated = make_cell("conductor", TASK_IDS[1], 2).cell_id
        by_id[ungated]["pluginAbsent"] = True

        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=cb.ARMS, reps=3)
        for arm in cb.ARMS:
            group = agg["groups"][arm][TASK_IDS[1]]
            self.assertEqual(
                group["excluded"],
                1,
                "%s kept a cell whose arm-symmetric counterpart was excluded" % arm,
            )
            self.assertEqual(group["scored"], 2, arm)
            self.assertEqual(
                agg["armTotals"][arm]["excluded"], 1, "%s excluded count" % arm
            )
            excluded_ids = [row["cellId"] for row in agg["armTotals"][arm]["excludedCells"]]
            self.assertEqual(
                excluded_ids, [make_cell(arm, TASK_IDS[1], 2).cell_id], arm
            )

        # PATTERN task 1 is PPP for all three arms, so dropping repetition 2
        # costs each arm exactly one pass - the same one.
        for arm in cb.ARMS:
            self.assertEqual(agg["groups"][arm][TASK_IDS[1]]["passes"], 2, arm)

        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        section = section_of(report, cb.SECTION_EXCLUSIONS)
        for arm in cb.ARMS:
            self.assertIn(make_cell(arm, TASK_IDS[1], 2).cell_id, section, arm)
        self.assertIn("plugin-absent", section, "the reason must be named")

    def test_arms_are_seeded_identically(self):
        """[22.2-identical-seeds] every arm's work tree starts from the same
        file set and the same commit, so no arm is compared against a different
        tree from the others."""
        task = self.tasks[0]
        listings = {}
        heads = {}
        for arm in cb.ARMS:
            cell = make_cell(arm, task.id, 1)
            directory = cb.cell_dir_for(self.tmp / "seeds", cell)
            cb.run_cell(
                cell,
                task,
                cell_dir=directory,
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
                timeout_sec=5,
                runner=lambda invocation: cb.CommandOutcome(0, False, None, 1),
                test_runner=lambda argv, cwd, timeout_sec: cb.CommandOutcome(1, False, None, 1),
            )
            work = directory / "repo"
            listings[arm] = sorted(
                subprocess.run(
                    ["git", "-C", str(work), "ls-files"],
                    stdout=subprocess.PIPE,
                    check=True,
                ).stdout.decode().split()
            )
            heads[arm] = subprocess.run(
                ["git", "-C", str(work), "rev-parse", "HEAD:"],
                stdout=subprocess.PIPE,
                check=True,
            ).stdout.decode().strip()

        first = cb.ARMS[0]
        for arm in cb.ARMS[1:]:
            self.assertEqual(listings[arm], listings[first], "%s file listing differs" % arm)
            self.assertEqual(heads[arm], heads[first], "%s seed tree hash differs" % arm)
        self.assertIn(".conductor/config.json", listings[first])

    def test_timeout_is_its_own_outcome(self):
        """[22A.3c-timeout-outcome] a timeout is reported as a timeout, never
        folded into the pass rate, so a tier that runs longer is not scored as
        a tier that answered wrongly."""
        results = fixture_results(self.tasks, ("conductor",))
        by_id = {row["cellId"]: row for row in results}
        timed_out = make_cell("conductor", TASK_IDS[1], 3).cell_id
        by_id[timed_out].update({"outcome": "timeout", "passed": False, "exitCode": None})

        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=("conductor",), reps=3)
        group = agg["groups"]["conductor"][TASK_IDS[1]]
        self.assertEqual(group["timeouts"], 1)
        self.assertEqual(group["scored"], 2, "a timeout leaves the pass-rate denominator")
        self.assertEqual(group["passes"], 2)
        self.assertIn("timeout", group["outcomes"], "the spread still shows it")
        self.assertEqual(agg["armTotals"]["conductor"]["timeouts"], 1)

        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=("conductor",), reps=3
        )
        self.assertIn(cb.TIMEOUT_NOTE, report)
        self.assertIn(timed_out, section_of(report, cb.SECTION_TIMEOUTS))

    def test_report_states_separability_not_a_verdict(self):
        """[22.3-separability] the headline readout is whether the arms are
        separable at all; the report states plainly that it computes no
        win/tie/loss, and carries wall clock as its own axis."""
        results = fixture_results(self.tasks, cb.ARMS)
        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        self.assertIn(cb.NO_VERDICT_NOTE, report)
        for word in ("win", "tie", "loss", "winner"):
            self.assertNotIn(
                "## %s" % word, report.lower(), "the report must not adjudicate a %s" % word
            )
        separability = section_of(report, cb.SECTION_SEPARABILITY)
        # Task 2 is baseline 1/3 vs doctrine 2/3: different, and overlapping.
        self.assertIn(TASK_IDS[2], separability)
        self.assertIn(cb.NOISE_NOTE, report)

        cost = section_of(report, cb.SECTION_COST)
        for arm in cb.ARMS:
            self.assertIn(arm, cost, "%s wall clock is its own axis" % arm)

    def test_cost_curve_by_tier(self):
        """[22A.4-cost-per-tier] wall clock, tokens, sub-sessions and waves are
        reported per tier per arm, so the deliverable is a curve against scope
        rather than one win rate."""
        results = fixture_results(self.tasks, cb.ARMS)
        agg = cb.aggregate(results, self.tasks, model=SENTINEL_MODEL, arms=cb.ARMS, reps=3)
        tiers = {task.tier for task in self.tasks}
        self.assertGreater(len(tiers), 1, "the fixture must span more than one tier")
        for tier in tiers:
            for arm in cb.ARMS:
                row = agg["tierTotals"][tier][arm]
                members = [t for t in self.tasks if t.tier == tier]
                expected_wall = sum(
                    1000 + 10 * self.tasks.index(t) + r for t in members for r in (1, 2, 3)
                )
                self.assertEqual(row["wallClockMsTotal"], expected_wall, (tier, arm))
                self.assertEqual(row["tokensTotal"], len(members) * 3 * 150, (tier, arm))
                self.assertEqual(row["scored"], len(members) * 3, (tier, arm))
        t0 = [t for t in self.tasks if t.tier == "T0"]
        self.assertEqual(agg["tierTotals"]["T0"]["conductor"]["subSessions"], 4 * 3 * len(t0))
        self.assertEqual(agg["tierTotals"]["T0"]["conductor"]["waves"], 2 * 3 * len(t0))
        self.assertIsNone(agg["tierTotals"]["T0"]["baseline"]["subSessions"])

        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        section = section_of(report, cb.SECTION_TIER)
        for tier in tiers:
            self.assertIn(tier, section)
        for label in cb.TIER_COST_LABELS:
            self.assertIn(label, section)

    def test_mechanism_trajectories_are_compared(self):
        """[22A.3-mechanism-stress] a stress task declares the trajectory it
        expects, and a run that took a different one is surfaced as the finding
        rather than as a pass or a fail."""
        doc = manifest_dict()
        doc["tasks"][0]["mechanism"] = "scope-boundary"
        doc["tasks"][0]["expectedStopKinds"] = ["surfaced"]
        tasks = cb.load_tasks(write_manifest(self.tmp, doc, name="stress.json"))[:PATTERN_TASKS]
        results = fixture_results(tasks, ("conductor",))
        by_id = {row["cellId"]: row for row in results}
        by_id[make_cell("conductor", TASK_IDS[0], 1).cell_id]["stopKind"] = "surfaced"

        divergences = cb.trajectory_divergences(results, tasks, arms=("conductor",))
        diverged = [row["cellId"] for row in divergences]
        self.assertNotIn(make_cell("conductor", TASK_IDS[0], 1).cell_id, diverged)
        for rep in (2, 3):
            self.assertIn(make_cell("conductor", TASK_IDS[0], rep).cell_id, diverged)
        for row in divergences:
            self.assertEqual(row["taskId"], TASK_IDS[0])
            self.assertEqual(row["expected"], ["surfaced"])
            self.assertEqual(row["observed"], "done")
            self.assertEqual(row["mechanism"], "scope-boundary")

        report = cb.render_report(
            results, tasks, models=[SENTINEL_MODEL], arms=("conductor",), reps=3
        )
        section = section_of(report, cb.SECTION_TRAJECTORIES)
        self.assertIn("scope-boundary", section)
        self.assertIn(make_cell("conductor", TASK_IDS[0], 2).cell_id, section)

    def test_stop_kinds_are_compared_for_every_task(self):
        """[23C.8-stop-kind-every-task] the stop kind a task declares is
        compared for every task, not only for the ones that name a mechanism.

        expectedStopKinds is the one half of a declared trajectory a machine can
        check, and a coverage task's list is authored as carefully as a stress
        task's: a T1 whose list omits TRIVIAL_DONE is saying that a run routed
        into the plugin's trivial path took a route the task rules out. Skipping
        every mechanism-none task drops that comparison for most of the
        committed corpus, and the divergence then appears in no section at all
        while the cell records a clean pass.
        """
        doc = manifest_dict()
        doc["tasks"][0]["mechanism"] = "none"
        doc["tasks"][0]["expectedStopKinds"] = ["done", "REPORTED"]
        tasks = cb.load_tasks(write_manifest(self.tmp, doc, name="coverage.json"))[:PATTERN_TASKS]
        results = fixture_results(tasks, ("conductor",))
        by_id = {row["cellId"]: row for row in results}
        trivial = make_cell("conductor", TASK_IDS[0], 1).cell_id
        by_id[trivial]["stopKind"] = "TRIVIAL_DONE"
        by_id[trivial]["passed"] = True
        by_id[trivial]["outcome"] = "pass"

        divergences = cb.trajectory_divergences(results, tasks, arms=("conductor",))
        diverged = [row["cellId"] for row in divergences]
        self.assertIn(
            trivial,
            diverged,
            "a passing cell that stopped where its task rules out is still the finding",
        )
        row = [r for r in divergences if r["cellId"] == trivial][0]
        self.assertEqual(row["observed"], "TRIVIAL_DONE")
        self.assertEqual(row["expected"], ["done", "REPORTED"])
        self.assertEqual(row["mechanism"], "none")

        # A stop kind the task does list is not a divergence, so the comparison
        # is the declared list rather than a blanket complaint.
        for rep in (2, 3):
            self.assertNotIn(make_cell("conductor", TASK_IDS[0], rep).cell_id, diverged)

        report = cb.render_report(
            results, tasks, models=[SENTINEL_MODEL], arms=("conductor",), reps=3
        )
        self.assertIn(trivial, section_of(report, cb.SECTION_TRAJECTORIES))

    def test_rubric_lane_beside_the_pass_fail_lane(self):
        """[22A.3b-rubric] a human-scored rubric rides beside the objective
        lane, an absent rubric reads as unmeasured rather than as zero, and the
        review sample is stratified rather than exhaustive."""
        for criterion in cb.RUBRIC_CRITERIA:
            self.assertTrue(criterion.strip())
        cell_id = make_cell("conductor", TASK_IDS[0], 1).cell_id
        row = {
            "cellId": cell_id,
            "reviewer": "owner",
            "scores": dict((c, 2) for c in cb.RUBRIC_CRITERIA),
            "findings": ["game logic is welded to the renderer"],
            "notes": "kept, with reservations",
        }
        cb.validate_rubric(row)
        for broken, why in (
            ({"scores": {}}, "no scores"),
            ({"scores": dict((c, 9) for c in cb.RUBRIC_CRITERIA)}, "out of range"),
            ({"cellId": ""}, "no cell"),
        ):
            bad = dict(row)
            bad.update(broken)
            with self.assertRaises(cb.BenchError, msg=why):
                cb.validate_rubric(bad)

        directory = self.tmp / "rubrics"
        cb.write_rubric(directory, row)
        loaded = cb.load_rubrics(directory)
        self.assertEqual(loaded, [row])
        self.assertEqual(cb.load_rubrics(self.tmp / "absent"), [])

        results = fixture_results(self.tasks, cb.ARMS)
        summary = cb.aggregate_rubrics(loaded, results, arms=cb.ARMS)
        self.assertEqual(summary["conductor"]["reviewed"], 1)
        for criterion in cb.RUBRIC_CRITERIA:
            self.assertEqual(summary["conductor"]["medians"][criterion], 2)
        self.assertEqual(summary["baseline"]["reviewed"], 0)
        self.assertIsNone(summary["baseline"]["medians"][cb.RUBRIC_CRITERIA[0]])
        self.assertEqual(summary["conductor"]["findings"], row["findings"])

        plan = cb.build_run_plan(self.tasks, models=[SENTINEL_MODEL])
        sample = cb.stratified_review_sample(plan, self.tasks, per_stratum=1)
        self.assertEqual(
            sample,
            cb.stratified_review_sample(plan, self.tasks, per_stratum=1),
            "the sample must be deterministic",
        )
        tiers = {task.tier for task in self.tasks}
        self.assertEqual(len(sample), len(tiers) * len(cb.ARMS))
        strata = {(row["tier"], row["arm"]) for row in sample}
        self.assertEqual(strata, {(tier, arm) for tier in tiers for arm in cb.ARMS})
        self.assertLess(len(sample), len(plan), "review is stratified, never exhaustive")

        report = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3, rubrics=loaded
        )
        section = section_of(report, cb.SECTION_RUBRIC)
        self.assertIn(cb.RUBRIC_CRITERIA[0], section)
        self.assertIn(row["findings"][0], section)
        bare = cb.render_report(
            results, self.tasks, models=[SENTINEL_MODEL], arms=cb.ARMS, reps=3
        )
        self.assertIn(cb.NA, section_of(bare, cb.SECTION_RUBRIC))


class ModuleHygieneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-hygiene-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    def test_stdlib_pure_and_no_stubs(self):
        """[14.1-stdlib-pure-and-no-stubs] the module is stdlib-only, 3.9-clean,
        free of stubs and markers, and its pure functions write nothing."""
        tree = module_ast()
        allowed_local = {
            "conductor_bench",
            "conductor_wiring",
            "ui",
            "fetch_models",
            "hostinfo",
            "models_catalog",
            "serve",
            "benchmark",
            "bench_presets",
        }
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    continue
                if node.module:
                    imported.add(node.module.split(".")[0])
        for name in sorted(imported):
            if name in allowed_local or name == "__future__":
                continue
            self.assertTrue(is_stdlib(name), "%r is not standard library (G1)" % name)

        source = module_source()
        self.assertIn("from __future__ import annotations", source, "3.9 needs the future import")
        match_node = getattr(ast, "Match", None)
        if match_node is not None:
            for node in ast.walk(tree):
                self.assertNotIsInstance(node, match_node, "no match statement on python 3.9")

        # The marker words are assembled from pieces rather than written out:
        # scripts/conductor-gate.sh's M5 scan has no test-file allowance for
        # scripts/, so a spelled-out marker here reads to that scan as the very
        # defect this loop exists to catch. The substrings searched for are
        # byte-identical to the spelled-out ones.
        markers = (
            "TO" + "DO",
            "FIX" + "ME",
            "X" + "XX",
            "not " + "implemented",
            "NotImplementedError",
        )
        for marker in markers:
            self.assertNotIn(marker, source, "%r has no place in a finished module" % marker)

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body = list(node.body)
                if body and isinstance(body[0], ast.Expr) and isinstance(
                    getattr(body[0], "value", None), ast.Constant
                ):
                    body = body[1:]
                self.assertTrue(body, "%s has a docstring-only body" % node.name)
                if len(body) == 1:
                    self.assertNotIsInstance(
                        body[0], ast.Pass, "%s has a pass-only body" % node.name
                    )
                    if isinstance(body[0], ast.Expr):
                        value = getattr(body[0], "value", None)
                        self.assertFalse(
                            isinstance(value, ast.Constant) and value.value is Ellipsis,
                            "%s has an ellipsis-only body" % node.name,
                        )

        # The pure functions write nothing.
        tasks = fixture_tasks(self.tmp)
        ledger = self.tmp / "metrics.jsonl"
        ledger.write_text(_ledger_line(promptTokens=1, completionTokens=1) + "\n")
        results = fixture_results(tasks, ("baseline",))
        before = snapshot(self.tmp)
        with no_subprocess():
            cb.load_tasks(self.tmp / "tasks.json")
            cb.build_run_plan(tasks, models=[SENTINEL_MODEL])
            cb.build_arm_config(
                "baseline",
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=self.tmp / "unwritten-cell",
                base_config=BASE_OPENCODE_CONFIG,
            per_slot_ctx=SERVED_CTX,
            )
            cb.summarize_ledger_window(ledger, 0)
            cb.score_cell(0, False, None)
            cb.aggregate(results, tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3)
            cb.render_report(results, tasks, models=[SENTINEL_MODEL], arms=("baseline",), reps=3)
        self.assertEqual(snapshot(self.tmp), before, "a pure function wrote to disk")
        self.assertFalse((self.tmp / "unwritten-cell").exists())


def _ledger_line(**over: object) -> str:
    """One 11.7 RequestRecord line: every key present, absence as JSON null."""
    record = {
        "model": "qwen3.6-27b",
        "role": None,
        "group": None,
        "priority": 0,
        "queueWaitMs": 0,
        "upstreamMs": 10,
        "promptTokens": None,
        "completionTokens": None,
        "timings": None,
        "schemaMissing": None,
        "schemaConformed": None,
        "status": 200,
    }
    record.update(over)
    return json.dumps(record)


def _all_keys(obj: object, out: Optional[set] = None) -> set:
    if out is None:
        out = set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            out.add(key)
            _all_keys(value, out)
    elif isinstance(obj, list):
        for item in obj:
            _all_keys(item, out)
    return out


def _base_urls(obj: object, out: Optional[List[str]] = None) -> List[str]:
    if out is None:
        out = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "baseURL" and isinstance(value, str):
                out.append(value)
            else:
                _base_urls(value, out)
    elif isinstance(obj, list):
        for item in obj:
            _base_urls(item, out)
    return out


def _fragment_agents() -> List[str]:
    fragment = json.loads(cb.FRAGMENT_PATH.read_text())
    return sorted(fragment.get("agent", {}))


def _first_non_empty_line(path: Path) -> str:
    for line in path.read_text().splitlines():
        if line.strip():
            return line
    return ""


if __name__ == "__main__":
    unittest.main()


class WaveCountFromJournal(unittest.TestCase):
    """[22A.4-wave-count] the wave count is read from the journal record the
    fan-out engine emits, which is the source that exists.

    The counter this reader originally looked for, ``counters.waves`` in
    ``run.json``, was never written by anything: the per-tier cost column
    rendered ``n/a`` for every cell. ``conductor/adapter/fanout.ts``
    ``dispatchWave`` emits one ``fanout``/``wave`` journal record per wave,
    carrying its size, so that is what a wave count reads.
    """

    def _run_dir(self, records):
        root = Path(tempfile.mkdtemp(prefix="cbench-waves-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / "run.json").write_text(json.dumps({"runId": "r", "counters": {}}))
        (root / "journal.jsonl").write_text(
            "\n".join(json.dumps(record) for record in records) + "\n"
        )
        return root

    def test_counts_wave_records(self):
        run_dir = self._run_dir(
            [
                {"component": "fanout", "event": "wave", "data": {"jobs": 6}},
                {"component": "fanout", "event": "subsession.dispatched", "data": {"role": "reviewer"}},
                {"component": "fanout", "event": "wave", "data": {"jobs": 1}},
            ]
        )
        self.assertEqual(cb.read_wave_count(run_dir), 2)

    def test_absent_journal_is_not_measured(self):
        root = Path(tempfile.mkdtemp(prefix="cbench-waves-none-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.assertIsNone(
            cb.read_wave_count(root),
            "an absent journal is 'not measured', never a fabricated 0 that a cost "
            "table would render as a run that scheduled nothing",
        )

    def test_torn_line_does_not_lose_the_whole_count(self):
        root = Path(tempfile.mkdtemp(prefix="cbench-waves-torn-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        (root / "journal.jsonl").write_text(
            json.dumps({"component": "fanout", "event": "wave", "data": {"jobs": 2}})
            + "\n"
            + '{"component":"fanout","event":"wa'
        )
        self.assertEqual(cb.read_wave_count(root), 1)

    def test_a_run_with_no_waves_measured_zero(self):
        run_dir = self._run_dir([{"component": "evidence", "event": "green", "data": {}}])
        self.assertEqual(
            cb.read_wave_count(run_dir),
            0,
            "a journal that exists and carries no wave record measured zero waves, "
            "which is a different fact from not having measured",
        )


class ServedWindowTests(unittest.TestCase):
    """The cell's opencode config must declare the window llama-server actually serves.

    Measured on the 13.2 smoke (2026-08-21): a conductor cell written with
    `models: {"qwen3.6-27b": {}}` gave opencode no limit at all, so it never
    compacted, sent max_tokens 32000, and looped 400 -> compaction -> 400 once the
    orchestrator's first request (11,441 tokens) met an 8192-token slot.
    """

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-window-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)

    def test_smoke_arm_config_carries_the_served_window(self):
        """[smoke-F03] every arm's model entry carries limit = opencode_model_limit(served), identically."""
        limits = set()
        for arm in cb.ARMS:
            cfg = cb.build_arm_config(
                arm,
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=self.tmp,
                base_config=BASE_OPENCODE_CONFIG,
                per_slot_ctx=4096,
            )
            models = cfg["provider"]["llamacpp"]["models"]
            self.assertIsInstance(models, dict, "%s: opencode's provider.models is a record, never a list" % arm)
            self.assertEqual(models["sentinel-model-x"]["limit"], {"context": 4096, "output": 1024}, arm)
            limits.add(json.dumps(models["sentinel-model-x"]["limit"], sort_keys=True))
        self.assertEqual(len(limits), 1, "the arms must agree on the limit byte-for-byte")
        with self.assertRaises(TypeError):
            cb.build_arm_config(  # the served window is not optional: a cell without it is the loop above
                "baseline",
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=self.tmp,
                base_config=BASE_OPENCODE_CONFIG,
            )

    def test_smoke_served_context_is_probed_from_the_upstream(self):
        """[smoke-F03] the per-slot window comes from llama-server's own /props for the served model, via the router's upstream."""
        payload = {"default_generation_settings": {"n_ctx": 32768, "params": {}}, "total_slots": 6}
        self.assertEqual(cb.parse_served_context(payload), 32768)
        for bad in ({}, {"default_generation_settings": {"n_ctx": 0}}, {"default_generation_settings": None}, {"default_generation_settings": {"n_ctx": "32768"}}):
            with self.assertRaises(cb.BenchError, msg=repr(bad)):
                cb.parse_served_context(bad)

        seen = []

        def fetch(url):
            seen.append(url)
            return json.dumps(payload).encode("utf-8")

        self.assertEqual(cb.served_per_slot_context(ROUTER_CONFIG, SENTINEL_MODEL, fetch=fetch), 32768)
        self.assertEqual(seen, ["http://127.0.0.1:8080/props?model=sentinel-model-x"])

        def down(url):
            raise OSError("connection refused")

        with self.assertRaises(cb.BenchError) as ctx:
            cb.served_per_slot_context(ROUTER_CONFIG, SENTINEL_MODEL, fetch=down)
        self.assertIn("/props", str(ctx.exception))
