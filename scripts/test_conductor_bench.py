"""Unit suite for scripts/conductor_bench.py - the Task 14.1 three-arm driver.

One test per row of docs/build/specs/task-14.1.assertions.json; every docstring
opens with the row id in square brackets so the assertion-coverage check can map
rows onto tests mechanically.

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
import shutil
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

TASK_IDS = ["bt%02d" % n for n in range(1, 11)]

SENTINEL_MODEL = "llamacpp/sentinel-model-x"

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


def manifest_dict(count: int = 10, **over: object) -> Dict[str, object]:
    doc = {
        "version": 1,
        "selectionCriteria": {
            "languageMix": "ts, python and cpp each appear at least once",
            "difficultySpread": "one-function through small-multi-file",
            "nonBehavioral": "at least two docs/comment tasks",
        },
        "defaults": {"model": cb.DEFAULT_MODEL, "runTimeoutSec": 1800},
        "tasks": [task_dict(i) for i in range(count)],
    }
    doc.update(over)
    return doc


def write_manifest(root: Path, doc: Dict[str, object], name: str = "tasks.json") -> Path:
    path = root / name
    path.write_text(json.dumps(doc, indent=2))
    return path


def load_synthetic(root: Path, doc: Optional[Dict[str, object]] = None) -> List[object]:
    return cb.load_tasks(write_manifest(root, doc if doc is not None else manifest_dict()))


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
                cell = cb.Cell(arm, task.id, rep)
                if cell.cell_id in drop:
                    continue
                mark = PATTERN[arm][t_idx][rep - 1]
                partial = cell.cell_id == partial_cell
                out.append(
                    make_result(
                        arm,
                        task.id,
                        rep,
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
        "cellId": cb.Cell(arm, task_id, rep).cell_id,
        "arm": arm,
        "taskId": task_id,
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
        self.assertIn("runTimeoutSec", manifest.defaults)

        tasks = cb.load_tasks(path)
        self.assertEqual(len(tasks), cb.EXPECTED_TASK_COUNT)
        self.assertEqual(cb.EXPECTED_TASK_COUNT, 10)
        self.assertEqual([t.id for t in tasks], TASK_IDS, "manifest order must be preserved")
        self.assertEqual(len({t.id for t in tasks}), 10)

        first = tasks[0]
        self.assertIn(first.language, cb.LANGUAGES)
        self.assertIn(first.difficulty, cb.DIFFICULTIES)
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

        for count in (9, 11):
            short = manifest_dict(count=min(count, 10))
            if count == 11:
                short["tasks"].append(task_dict(9, id="bt11"))
            else:
                short["tasks"] = short["tasks"][:9]
            short_path = write_manifest(self.tmp, short, name="bad-count-%d.json" % count)
            with self.assertRaises(cb.BenchError):
                cb.load_tasks(short_path)

    def _mutate(self, idx: int, drop: Optional[str] = None, **over: object):
        doc = manifest_dict()
        if drop is not None:
            doc["tasks"][idx].pop(drop)
        doc["tasks"][idx].update(over)
        return doc

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
        self.assertEqual(len(tasks), 10)

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
        plan = cb.build_run_plan(tasks)
        self.assertEqual({cell.arm for cell in plan}, set(cb.ARMS))

    def test_arms_same_model_g13(self):
        """[14.1-arms-same-model-g13] the model identifier is one parameter that
        reaches all three arms, and no arm carries a model literal."""
        self.assertEqual(cb.DEFAULT_MODEL, "llamacpp/qwen3.6-27b")
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
            )
            self.assertIs(cfg["autoupdate"], False, "%s did not override a base true" % arm)

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
        self.tasks = load_synthetic(self.tmp)

    def test_run_plan_90_balanced(self):
        """[14.1-run-plan-90-balanced] the plan is 90 uniquely-named cells,
        ordered repetition-major and arm-interleaved so any abort leaves the
        arms balanced."""
        plan = cb.build_run_plan(self.tasks)
        self.assertEqual(len(plan), 90)
        ids = [cell.cell_id for cell in plan]
        self.assertEqual(len(set(ids)), 90)

        for cell in plan:
            self.assertEqual(cell.cell_id, "%s/%s/r%d" % (cell.arm, cell.task_id, cell.rep))
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
            other = cb.build_run_plan(self.tasks, reps=reps)
            self.assertEqual(len(other), reps * len(self.tasks) * len(cb.ARMS))

    def test_cell_work_tree_fresh(self):
        """[14.1-cell-work-tree-fresh] every cell gets a fresh seeded git work
        tree, so repetition 2 can never inherit repetition 1's edits."""
        task = self.tasks[0]
        cell_a = cb.cell_dir_for(self.tmp / "work", cb.Cell("baseline", task.id, 1))
        cell_b = cb.cell_dir_for(self.tmp / "work", cb.Cell("baseline", task.id, 2))
        cell_c = cb.cell_dir_for(self.tmp / "work", cb.Cell("doctrine", task.id, 1))
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
        real_cell = cb.cell_dir_for(self.tmp / "gitwork", cb.Cell("baseline", task.id, 3))
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
                self.assertIn(cfg["git"]["mode"], ("read-only", "commit", "commit-and-push"))
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
        cell = cb.Cell("baseline", task.id, 1)
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

        cell = cb.Cell("baseline", task.id, 1)
        work_cell_dir = cb.cell_dir_for(self.tmp / "ordered", cell)
        result = cb.run_cell(
            cell,
            task,
            cell_dir=work_cell_dir,
            model=SENTINEL_MODEL,
            router_config=ROUTER_CONFIG,
            base_config=BASE_OPENCODE_CONFIG,
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


class ResultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cbench-result-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.tasks = load_synthetic(self.tmp)

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
        cell = cb.Cell("doctrine", TASK_IDS[3], 2)
        self.assertEqual(
            cb.result_path(results_dir, cell), results_dir / "doctrine__bt04__r2.json"
        )

        written = cb.write_result(results_dir, make_result("doctrine", TASK_IDS[3], 2))
        self.assertTrue(written.is_file())
        self.assertEqual(written, cb.result_path(results_dir, cell))

        calls = []

        def fake_runner(cell, task, cell_dir):
            calls.append(cell.cell_id)
            return make_result(cell.arm, cell.task_id, cell.rep)

        before = snapshot(self.tmp)
        outcome = cb.run_benchmark(
            self.tasks,
            results_dir=results_dir,
            report_path=report_path,
            work_root=work_root,
            model=SENTINEL_MODEL,
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
        flagged = cb.Cell("baseline", TASK_IDS[2], 1).cell_id
        for row in results:
            if row["cellId"] == flagged:
                row["routerErrors"] = 4
        report = cb.render_report(
            results, self.tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3
        )
        section = section_of(report, cb.SECTION_ROUTER_ERRORS)
        self.assertIn(flagged, section, "a cell with router errors must be named in the report")
        agg = cb.aggregate(results, self.tasks, arms=("baseline",), reps=3)
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

        # A run directory with no reviews/ recorded none - zero, not null.
        no_reviews = self.tmp / "noreviews"
        no_reviews.mkdir()
        run_dir = self.make_run_dir(no_reviews, "run-0001")
        for path in (run_dir / "reviews").glob("*.json"):
            path.unlink()
        (run_dir / "reviews").rmdir()
        self.assertEqual(cb.collect_conductor_metrics(no_reviews)["reviewFindingsUpheld"], 0)

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
        report = cb.render_report(results, tasks[:1], model=SENTINEL_MODEL, arms=cb.ARMS, reps=1)
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

        tasks = load_synthetic(self.tmp)
        results = fixture_results(tasks, ("conductor",))
        absent = [
            cb.Cell("conductor", TASK_IDS[0], 1).cell_id,
            cb.Cell("conductor", TASK_IDS[0], 2).cell_id,
        ]
        for row in results:
            if row["cellId"] in absent:
                row["pluginAbsent"] = True
        agg = cb.aggregate(results, tasks, arms=("conductor",), reps=3)
        group = agg["groups"]["conductor"][TASK_IDS[0]]

        # PATTERN conductor task 0 is "PPP"; two of its three cells are ungated.
        self.assertEqual(group["recorded"], 1, "ungated cells leave the denominator")
        self.assertEqual(group["passes"], 1)
        self.assertEqual(group["excluded"], 2)

        totals = agg["armTotals"]["conductor"]
        planned_recorded = sum(PATTERN["conductor"][i].count("P") for i in range(10))
        self.assertEqual(totals["passes"], planned_recorded - 2)
        self.assertEqual(sorted(totals["excludedPluginAbsent"]), sorted(absent))

        report = cb.render_report(
            results, tasks, model=SENTINEL_MODEL, arms=("conductor",), reps=3
        )
        section = section_of(report, cb.SECTION_PLUGIN_ABSENT)
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
        self.tasks = load_synthetic(self.tmp)

    def test_aggregate_per_task_spread(self):
        """[14.1-aggregate-per-task-spread] aggregate reports spread, not just
        means: per-repetition outcome vectors and min/max pass per (arm, task)
        group, so a 1/3-vs-2/3 difference can never look stable."""
        results = fixture_results(self.tasks, ("baseline",))
        self.assertEqual(len(results), 30)
        agg = cb.aggregate(results, self.tasks, arms=("baseline",), reps=3)

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
        report = cb.render_report(results, self.tasks, model=SENTINEL_MODEL, arms=cb.ARMS, reps=3)

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
            separated, self.tasks[:3], model=SENTINEL_MODEL, arms=cb.ARMS, reps=3
        )
        self.assertNotIn(
            cb.NOISE_NOTE, clean, "cleanly separated arms must not be described as within noise"
        )

        one_arm = cb.render_report(
            fixture_results(self.tasks, ("baseline",)),
            self.tasks,
            model=SENTINEL_MODEL,
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

        agg = cb.aggregate(results, self.tasks, arms=("baseline",), reps=3)
        totals = agg["armTotals"]["baseline"]
        self.assertEqual(totals["planned"], 30)
        self.assertEqual(totals["recorded"], 22)
        self.assertEqual(sorted(agg["missingCells"]), sorted(dropped))

        recorded_passes = sum(1 for row in results if row["passed"])
        self.assertEqual(totals["passes"], recorded_passes)
        self.assertLess(totals["passes"], sum(p.count("P") for p in PATTERN["baseline"]))

        report = cb.render_report(
            results, self.tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3
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
                cb.format_rate(group["passes"], group["recorded"]),
                rows[0],
                "%s must report over recorded cells only" % task.id,
            )
            if group["recorded"] != group["planned"]:
                self.assertIn(cb.format_recorded(group["recorded"], group["planned"]), rows[0])

        missing = section_of(report, cb.SECTION_MISSING)
        for cell_id in dropped:
            self.assertIn(cell_id, missing, "%s must be named as missing" % cell_id)

    def test_report_cost_and_method(self):
        """[14.1-report-cost-and-method] the report carries the cost side and
        its own methodology, so the deliverable is quality delta VERSUS cost."""
        partial_cell = cb.Cell("baseline", TASK_IDS[5], 2).cell_id
        results = fixture_results(self.tasks, cb.ARMS, partial_cell=partial_cell)
        report = cb.render_report(results, self.tasks, model=SENTINEL_MODEL, arms=cb.ARMS, reps=3)

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

        agg = cb.aggregate(results, self.tasks, arms=cb.ARMS, reps=3)
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
        self.tasks = load_synthetic(self.tmp)

    def test_resume_and_report_only(self):
        """[14.1-resume-and-report-only] an overnight that dies is resumable:
        completed cells are skipped and reused verbatim, and --report-only
        executes nothing while still rebuilding a complete report."""
        results_dir = self.tmp / "runs"
        report_path = self.tmp / "conductor-report.md"
        work_root = self.tmp / "work"

        plan = cb.build_run_plan(self.tasks)
        self.assertEqual(len(plan), 90)
        done = plan[:12]
        preexisting = {}
        for cell in done:
            row = make_result(
                cell.arm, cell.task_id, cell.rep, wall_clock_ms=4242, startedIso="2026-01-01T00:00:00Z"
            )
            preexisting[cell.cell_id] = row
            cb.write_result(results_dir, row)
        self.assertEqual(len(list(results_dir.glob("*.json"))), 12)

        calls = []

        def counting_runner(cell, task, cell_dir):
            calls.append(cell.cell_id)
            Path(cell_dir).mkdir(parents=True, exist_ok=True)
            return make_result(cell.arm, cell.task_id, cell.rep, wall_clock_ms=7)

        outcome = cb.run_benchmark(
            self.tasks,
            results_dir=results_dir,
            report_path=report_path,
            work_root=work_root,
            model=SENTINEL_MODEL,
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
            model=SENTINEL_MODEL,
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
        tasks = load_synthetic(self.tmp)
        ledger = self.tmp / "metrics.jsonl"
        ledger.write_text(_ledger_line(promptTokens=1, completionTokens=1) + "\n")
        results = fixture_results(tasks, ("baseline",))
        before = snapshot(self.tmp)
        with no_subprocess():
            cb.load_tasks(self.tmp / "tasks.json")
            cb.build_run_plan(tasks)
            cb.build_arm_config(
                "baseline",
                model=SENTINEL_MODEL,
                router_config=ROUTER_CONFIG,
                cell_dir=self.tmp / "unwritten-cell",
                base_config=BASE_OPENCODE_CONFIG,
            )
            cb.summarize_ledger_window(ledger, 0)
            cb.score_cell(0, False, None)
            cb.aggregate(results, tasks, arms=("baseline",), reps=3)
            cb.render_report(results, tasks, model=SENTINEL_MODEL, arms=("baseline",), reps=3)
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
