"""Unit suite for scripts/generate_euler_tasks.py - the Project Euler task set.

Every docstring opens with a row id in square brackets so coverage can be
mapped onto tests mechanically, matching scripts/test_conductor_bench.py.

Everything here runs offline and writes only under a tempfile directory. Four
tests spawn a process on purpose - the ones that run the seeded repository's
own visible suite and its gauge, because whether the seed starts green and the
gauge starts red is not a property any amount of reading the JSON can settle.
No server, no model, no network, and no Project Euler statement is read by
anything but the audit test, which builds its own.

Run with the stdlib runner the gate uses::

    /usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
"""

from __future__ import annotations

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conductor_bench as cb  # noqa: E402
import generate_euler_tasks as gen  # noqa: E402


CORPUS_RELPATH = ("bench", "corpus", "project-euler")

# The one model this repository serves, spelled out here rather than read from
# the generator. Comparing the manifest against the generator's own constant
# only proves the two agree, which they cannot help but do; comparing against
# the literal is what catches the constant itself being wrong.
CAMPAIGN_MODEL = "llamacpp/qwen3.8-27b"


def run_generator(argv: Sequence[str]) -> tuple:
    """The generator's exit code and its two streams, with nothing on the console."""
    out = io.StringIO()
    err = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = gen.main(list(argv))
    return code, out.getvalue(), err.getvalue()


def snapshot(corpus_dir: Path, manifest_path: Path) -> Dict[str, str]:
    """Every byte one run produced, keyed by path, ready to compare with ==."""
    out = dict(gen.read_output(corpus_dir))
    out["<manifest>"] = manifest_path.read_text()
    return out


class GeneratorHarness(unittest.TestCase):
    """A temp repository root laid out the way the manifest's paths expect."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="euler-gen-"))
        self.addCleanup(shutil.rmtree, str(self.tmp), True)
        self.root = self.tmp / "root"
        self.corpus = self.root.joinpath(*CORPUS_RELPATH)
        self.corpus.mkdir(parents=True)
        for name in (
            gen.ANSWERS_FILENAME,
            gen.RESTATEMENTS_FILENAME,
            gen.HARD_SUBSET_FILENAME,
        ):
            shutil.copyfile(str(gen.CORPUS_DIR / name), str(self.corpus / name))
        self.manifest = self.root / "bench" / "corpus-euler.json"

    def argv(self, *extra: str) -> List[str]:
        return [
            "--corpus-dir",
            str(self.corpus),
            "--manifest",
            str(self.manifest),
        ] + list(extra)

    def generate(self, *extra: str) -> tuple:
        return run_generator(self.argv(*extra))

    def write_answers(self, answers: Dict[str, Optional[str]]) -> None:
        (self.corpus / gen.ANSWERS_FILENAME).write_text(
            json.dumps({"answers": answers})
        )

    def write_restatements(self, problems: Dict[str, Dict[str, str]]) -> None:
        (self.corpus / gen.RESTATEMENTS_FILENAME).write_text(
            json.dumps({"problems": problems})
        )


class DeterminismTests(GeneratorHarness):
    def test_two_runs_over_the_same_inputs_write_the_same_bytes(self) -> None:
        """[23B.4-euler-determinism] the generated set is a function of its inputs.

        A generator whose output moves on its own makes every regeneration a
        diff nobody can read, and hides a real change inside the churn. Two
        runs into the same directory and a third into a fresh one must all
        agree byte for byte.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        first = snapshot(self.corpus, self.manifest)
        self.assertTrue(first, "the generator wrote nothing")

        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(self.corpus, self.manifest), first)

        other = self.tmp / "other"
        other.joinpath(*CORPUS_RELPATH).mkdir(parents=True)
        other_corpus = other.joinpath(*CORPUS_RELPATH)
        for name in (
            gen.ANSWERS_FILENAME,
            gen.RESTATEMENTS_FILENAME,
            gen.HARD_SUBSET_FILENAME,
        ):
            shutil.copyfile(str(self.corpus / name), str(other_corpus / name))
        other_manifest = other / "bench" / "corpus-euler.json"
        code, _, err = run_generator(
            ["--corpus-dir", str(other_corpus), "--manifest", str(other_manifest)]
        )
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(other_corpus, other_manifest), first)

    def test_a_run_leaves_nothing_from_the_run_before_it(self) -> None:
        """[23B.4-euler-determinism] the generated trees are replaced, not merged.

        A task dropped from the set leaves a gauge directory behind under a
        merge, and that directory is a measurement for a task the manifest no
        longer names - which reads as corpus material rather than as debris.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        before = snapshot(self.corpus, self.manifest)

        strays = [
            self.corpus / gen.HIDDEN_DIRNAME / "euler-099-py" / "gauge" / "check_spec.py",
            self.corpus / gen.SEED_DIRNAME / "src" / "solvers" / "p099.py",
        ]
        for stray in strays:
            stray.parent.mkdir(parents=True, exist_ok=True)
            stray.write_text("left over\n")

        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        for stray in strays:
            self.assertFalse(stray.exists(), stray)
        self.assertEqual(snapshot(self.corpus, self.manifest), before)

    def test_check_reports_output_that_no_longer_matches_its_inputs(self) -> None:
        """[23B.4-euler-determinism] --check is the guard on the committed copy.

        The manifest and the trees under it are committed artefacts of a
        script. Without a check that they are still what the script writes,
        a hand edit to either survives review as though it were generated.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        code, out, err = self.generate("--check")
        self.assertEqual(code, 0, err)
        self.assertIn("all as committed", out)

        gauge = self.corpus / gen.HIDDEN_DIRNAME / "euler-001-py" / "gauge" / "check_spec.py"
        gauge.write_text(gauge.read_text() + "\n# edited by hand\n")
        code, _, err = self.generate("--check")
        self.assertEqual(code, 1)
        self.assertIn("check_spec.py", err)

        self.generate()
        self.manifest.write_text(self.manifest.read_text() + "\n")
        code, _, err = self.generate("--check")
        self.assertEqual(code, 1)
        self.assertIn(str(self.manifest), err)

    def test_the_committed_set_is_what_the_generator_writes(self) -> None:
        """[23B.4-euler-committed] bench/corpus-euler.json is regenerable.

        This is the row that goes red the day someone edits the manifest or a
        gauge in place instead of editing the inputs and regenerating.
        """
        code, out, err = run_generator(["--check"])
        self.assertEqual(code, 0, err)
        self.assertIn("all as committed", out)


class AbsentStatementTests(GeneratorHarness):
    def test_generation_never_reads_a_statement(self) -> None:
        """[23B.4-euler-absent-statement] the set is complete without problems/.

        Project Euler statements are fetched and gitignored in the source
        corpus, so a clone has none of them. If generation depended on one,
        the committed manifest could not be reproduced anywhere but the
        machine that fetched, and the prompts could not be complete on their
        own. The output must therefore be the same bytes whether the fetched
        statements are on the machine or not, and every prompt must carry its
        own question.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        without = snapshot(self.corpus, self.manifest)

        statements = self.tmp / "problems"
        statements.mkdir()
        for number in (1, 3, 25):
            statements.joinpath(gen.STATEMENT_PATTERN % number).write_text(
                "# Project Euler Problem %d\n\nStatement body.\n" % number
            )
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(self.corpus, self.manifest), without)

        manifest = json.loads(self.manifest.read_text())
        restatements = gen.load_restatements(self.corpus / gen.RESTATEMENTS_FILENAME)
        for task in manifest["tasks"]:
            number = int(task["id"].split("-")[1])
            self.assertIn(restatements[number]["question"], task["prompt"], task["id"])

    def test_the_audit_names_an_absent_statement_and_does_not_fail_on_it(self) -> None:
        """[23B.4-euler-absent-statement] absence is reported, not treated as damage.

        The audit compares each restatement against the statement it replaces.
        On a machine that fetched nothing there is nothing to compare, and
        that is the normal case rather than an error - so the absent files are
        named and the run succeeds. --require-statements is how the machine
        that did fetch asks for the whole set to be covered.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)

        empty = self.tmp / "no-problems"
        empty.mkdir()
        code, out, err = self.generate("--audit-statements", str(empty))
        self.assertEqual(code, 0, err)
        self.assertIn("problem 1:", out)
        self.assertIn("0 of 20 compared", out)

        code, out, err = self.generate(
            "--audit-statements", str(empty), "--require-statements"
        )
        self.assertEqual(code, 2)
        self.assertIn("20 are absent", err)

        code, _, err = self.generate("--require-statements")
        self.assertEqual(code, 2)
        self.assertIn("--audit-statements", err)

    def test_the_audit_writes_nothing(self) -> None:
        """[23C.10-euler-audit-is-read-only] --audit-statements reads the
        statements and leaves every generated byte where it found it.

        The module docstring, the argparse help and the corpus README each say
        the audit writes nothing, and all three print the invocation without
        --check. An operator reaches for it precisely when they suspect a
        generated file was hand-edited - and a run that replaces the trees
        wholesale destroys the edit and the evidence that it existed, then
        prints a clean audit over what it just rewrote.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        before = snapshot(self.corpus, self.manifest)

        sentinel = self.corpus / gen.HIDDEN_DIRNAME / "euler-001-py" / "gauge" / "check_spec.py"
        sentinel.write_text(sentinel.read_text() + "\n# hand edit\n")
        edited = snapshot(self.corpus, self.manifest)
        self.assertNotEqual(edited, before, "the fixture must start out edited")

        empty = self.tmp / "no-problems-read-only"
        empty.mkdir()
        code, out, err = self.generate("--audit-statements", str(empty))
        self.assertEqual(code, 0, err)
        self.assertIn("0 of 20 compared", out)
        self.assertNotIn("wrote", out, "a mode that writes nothing says nothing about writing")
        self.assertEqual(
            snapshot(self.corpus, self.manifest),
            edited,
            "the audit rewrote the trees it was asked to read",
        )

        # The audit composes with --check, and that pair reports the drift
        # rather than repairing it.
        code, out, err = self.generate("--audit-statements", str(empty), "--check")
        self.assertEqual(code, 1, out)
        self.assertIn("check_spec.py", err)
        self.assertEqual(snapshot(self.corpus, self.manifest), edited)

        # Writing is what a plain run is for, and it still is.
        code, out, err = self.generate()
        self.assertEqual(code, 0, err)
        self.assertIn("wrote", out)
        self.assertEqual(snapshot(self.corpus, self.manifest), before)

    def test_check_steps_over_what_a_tool_leaves_in_the_trees(self) -> None:
        """[23C.11-euler-check-ignores-artifacts] --check reads the generated
        source and steps over the bytecode an interpreter drops beside it.

        The seed's own .gitignore names __pycache__ and *.pyc, and the
        repository ignores both everywhere, so running the seeded suite or the
        gauge in place leaves files `git status` never reports. Reading them
        made the gate row die with an unhandled UnicodeDecodeError naming
        read_output rather than the file, which points at no cause an operator
        can act on.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)

        cache = self.corpus / gen.SEED_DIRNAME / "src" / "__pycache__"
        cache.mkdir(parents=True)
        (cache / "registry.cpython-39.pyc").write_bytes(b"\xf3\x0d\x0d\x0a\x00\x01")
        (self.corpus / gen.SEED_DIRNAME / ".DS_Store").write_bytes(b"\x00\x00\x00\x01Bud1\xff")

        code, out, err = self.generate("--check")
        self.assertEqual(code, 0, "%s%s" % (out, err))
        self.assertIn("all as committed", out)

    def test_the_audit_refuses_a_restatement_that_copies_the_statement(self) -> None:
        """[23B.4-euler-absent-statement] the audit is what keeps the prose ours.

        The whole reason a side-car exists is that the committed prompts must
        be this repository's words rather than Project Euler's. A guard that
        cannot tell a copy from a restatement would let the first careless
        paste through, so this pins that it can.
        """
        restatements = json.loads(
            (self.corpus / gen.RESTATEMENTS_FILENAME).read_text()
        )
        statement_body = (
            "Find the sum of all of the multiples of three or of five that are "
            "below one thousand, counting each such multiple exactly once."
        )
        restatements["problems"]["1"]["question"] = statement_body
        (self.corpus / gen.RESTATEMENTS_FILENAME).write_text(json.dumps(restatements))
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)

        statements = self.tmp / "copied"
        statements.mkdir()
        statements.joinpath(gen.STATEMENT_PATTERN % 1).write_text(
            "# Project Euler Problem 1\n\n" + statement_body + "\n"
        )
        code, _, err = self.generate("--audit-statements", str(statements))
        self.assertEqual(code, 2)
        self.assertIn("problem 1", err)
        self.assertIn("word run", err)

    def test_the_shared_run_measure_counts_consecutive_words(self) -> None:
        """[23B.4-euler-absent-statement] the ceiling bites at exactly its value.

        The audit's whole verdict rests on one number, so the number is
        measured here rather than trusted: punctuation and case do not break a
        run, a gap does, and a restatement sharing one word fewer than the
        ceiling is accepted while one sharing the ceiling is not.
        """
        self.assertEqual(gen.longest_shared_run("alpha beta gamma", "delta epsilon"), 0)
        self.assertEqual(
            gen.longest_shared_run("Alpha, beta; GAMMA!", "the alpha beta gamma end"), 3
        )
        self.assertEqual(
            gen.longest_shared_run("alpha beta gamma", "alpha zeta beta gamma"), 2
        )

        words = ["w%d" % index for index in range(gen.MAX_SHARED_WORDS)]
        restatements = json.loads(
            (self.corpus / gen.RESTATEMENTS_FILENAME).read_text()
        )
        statements = self.tmp / "boundary"
        statements.mkdir()
        statements.joinpath(gen.STATEMENT_PATTERN % 1).write_text(" ".join(words))

        for length, expected_code in ((gen.MAX_SHARED_WORDS - 1, 0), (gen.MAX_SHARED_WORDS, 2)):
            restatements["problems"]["1"]["question"] = " ".join(words[:length])
            (self.corpus / gen.RESTATEMENTS_FILENAME).write_text(json.dumps(restatements))
            self.generate()
            code, _, err = self.generate("--audit-statements", str(statements))
            self.assertEqual(code, expected_code, err)


class ManifestTests(GeneratorHarness):
    def test_a_generated_task_loads_through_the_driver(self) -> None:
        """[23B.4-euler-loads] the generated manifest is one conductor_bench accepts.

        The generator and the driver are two programs agreeing on a JSON
        shape. Asserting the shape here rather than only in the driver would
        pin what this file believes the driver wants; loading it through
        load_manifest pins what the driver actually enforces, seedDir walk and
        all.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)

        manifest = cb.load_manifest(self.manifest, root=self.root)
        self.assertEqual(len(manifest.tasks), 20)
        self.assertEqual(gen.MODEL, CAMPAIGN_MODEL)
        self.assertEqual(manifest.defaults["model"], CAMPAIGN_MODEL)
        self.assertEqual(manifest.sweep["models"], [CAMPAIGN_MODEL])
        self.assertEqual(manifest.sweep["primaryModel"], CAMPAIGN_MODEL)
        self.assertEqual(cb.check_commands_spawnable(manifest.tasks), [])

        by_tier = cb.tasks_by_tier(manifest.tasks)
        self.assertEqual(len(by_tier[gen.TIER]), len(manifest.tasks))

        for task in manifest.tasks:
            self.assertEqual(task.language, "python", task.id)
            self.assertEqual(task.difficulty, "multi-file", task.id)
            self.assertTrue(task.behavioral, task.id)
            self.assertEqual(
                sorted(set(task.seed_files) & set(task.hidden_files)), [], task.id
            )
            self.assertEqual(sorted(task.hidden_files), ["gauge/check_spec.py", "gauge/run.py"])
            self.assertIn("src/solvers/__init__.py", task.seed_files)
            module = gen.solver_name(int(task.id.split("-")[1]))
            self.assertNotIn("src/solvers/%s.py" % module, task.seed_files, task.id)
            self.assertIn("gauge/check_spec.py", task.hidden_files)

        # Every task draws the same seed, which is the whole reason one seed
        # tree on disk is honest rather than a saving.
        seeds = set(json.dumps(task.seed_files, sort_keys=True) for task in manifest.tasks)
        self.assertEqual(len(seeds), 1)

    def test_the_answer_reaches_the_gauge_and_nothing_else(self) -> None:
        """[23B.4-euler-no-leak] no seeded file and no prompt states an answer.

        An answer visible in the work tree makes every arm score the task, and
        an answer in the prompt makes it a copying exercise. The failure is
        silent in both directions, so it is asserted rather than reviewed.
        """
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        manifest = cb.load_manifest(self.manifest, root=self.root)
        answers = gen.load_answers(self.corpus / gen.ANSWERS_FILENAME)

        for task in manifest.tasks:
            number = int(task.id.split("-")[1])
            written = str(answers[number])
            self.assertNotIn(written, task.prompt, task.id)
            for relpath in sorted(task.seed_files):
                self.assertNotIn(written, task.seed_files[relpath], "%s %s" % (task.id, relpath))
            self.assertIn(written, task.hidden_files["gauge/check_spec.py"], task.id)
            # No seeded file names any other task's answer either, which is
            # what the two worked solvers being outside Project Euler buys.
            for other in sorted(answers.values()):
                for relpath in sorted(task.seed_files):
                    self.assertNotIn(
                        str(other), task.seed_files[relpath], "%s %s" % (task.id, relpath)
                    )

    def test_only_a_verified_and_stated_problem_becomes_a_task(self) -> None:
        """[23B.4-euler-refusals] the answer key and the side-car cannot drift apart.

        A null answer is unverified, and the source corpus is explicit that a
        guessed reference answer silently marks correct work as failure. A
        verified answer nobody wrote a question for is the other half of the
        same drift: the set would quietly shrink and the manifest would still
        look complete.
        """
        self.write_answers({"euler-001": "233168", "euler-002": None})
        self.write_restatements(
            {
                "1": {"title": "One", "question": "Total the numbers."},
                "2": {"title": "Two", "question": "Total them again."},
            }
        )
        code, _, err = self.generate()
        self.assertEqual(code, 2)
        self.assertIn("problem 2", err)

        self.write_restatements({"1": {"title": "One", "question": "Total the numbers."}})
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        self.assertEqual(len(json.loads(self.manifest.read_text())["tasks"]), 1)

        self.write_answers({"euler-001": "233168", "euler-003": "6857"})
        code, _, err = self.generate()
        self.assertEqual(code, 2)
        self.assertIn("problem 3", err)

        self.write_answers({"euler-001": "two hundred"})
        code, _, err = self.generate()
        self.assertEqual(code, 2)
        self.assertIn("decimal digits", err)

        self.write_answers({"euler-001": "233168"})
        self.write_restatements(
            {"1": {"title": "One", "question": "Total them.", "omitted": "and also not"}}
        )
        code, _, err = self.generate()
        self.assertEqual(code, 2)
        self.assertIn("exactly one", err)

    def test_an_omitted_problem_is_reported_with_its_reason(self) -> None:
        """[23B.4-euler-refusals] a problem left out says why, on the console.

        Six answerable problems get no task because the material they operate
        on is Project Euler's. Silence about that would read as a set that
        covers everything it could.
        """
        code, out, err = self.generate()
        self.assertEqual(code, 0, err)
        restatements = gen.load_restatements(self.corpus / gen.RESTATEMENTS_FILENAME)
        omitted = sorted(n for n, entry in restatements.items() if "omitted" in entry)
        self.assertEqual(omitted, [8, 11, 13, 18, 22, 67])
        ids = set(task["id"] for task in json.loads(self.manifest.read_text())["tasks"])
        for number in omitted:
            self.assertIn("skipped problem %d: " % number, out)
            self.assertIn(restatements[number]["omitted"], out)
            self.assertNotIn(gen.task_id(number), ids)


class SeededTreeTests(GeneratorHarness):
    """The four rows that spawn a process, because reading the JSON cannot settle them."""

    def one_task(self, number: int) -> cb.Task:
        code, _, err = self.generate()
        self.assertEqual(code, 0, err)
        manifest = cb.load_manifest(self.manifest, root=self.root)
        for task in manifest.tasks:
            if task.id == gen.task_id(number):
                return task
        raise AssertionError("no task for problem %d" % number)

    def gauge_exit(
        self,
        task: cb.Task,
        solver: Optional[str],
        extra: Optional[Dict[str, str]] = None,
    ) -> int:
        """Materialize the seed, optionally add a solver, and run the gauge.

        ``extra`` writes further files into the work tree first, which is how a
        module parked beside the target - or a data file it reads - is put
        where a recalling model would put it.
        """
        work = Path(tempfile.mkdtemp(dir=str(self.tmp)))
        cb.materialize_files(work, task.seed_files)
        cb.materialize_files(work, task.hidden_files)
        if extra:
            cb.materialize_files(work, extra)
        if solver is not None:
            name = "p%03d" % int(task.id.split("-")[1])
            work.joinpath("src", "solvers", "%s.py" % name).write_text(solver)
            init = work / "src" / "solvers" / "__init__.py"
            init.write_text(
                init.read_text().replace(
                    "count_divisors", "%s, count_divisors" % name
                )
            )
        outcome = cb.default_test_runner(list(task.hidden_test_command), work, 120.0)
        return outcome.exit_code if outcome.exit_code is not None else -1

    def test_the_seed_starts_green_and_the_gauge_starts_red(self) -> None:
        """[23B.4-euler-discriminates] the seeded repository is green, the gauge is not.

        A gauge that already passes on the seed scores every arm and inflates
        the whole tier. A seed that starts red makes a red visible test
        ambiguous between the task's damage and the arm's.
        """
        task = self.one_task(1)
        green = cb.verify_seed_green([task], self.tmp / "green")
        self.assertTrue(green["ok"], green)
        red = cb.verify_tasks([task], self.tmp / "red")
        self.assertTrue(red["ok"], red)

    def test_a_solver_that_does_the_work_passes_the_gauge(self) -> None:
        """[23B.4-euler-discriminates] the gauge is reachable.

        A gauge nothing can pass floors every arm at zero and reports that as
        a finding about the arms. This is the row that says the task can be
        completed at all.
        """
        task = self.one_task(1)
        self.assertEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n\n"
                "def solve():\n"
                "    return sum(n for n in range(1000) if n % 3 == 0 or n % 5 == 0)\n\n\n"
                'register("p001", solve)\n',
            ),
            0,
        )

    def test_a_solver_that_writes_the_answer_down_fails_the_gauge(self) -> None:
        """[23B.4-euler-discriminates] the computed-not-written check is live.

        Every problem in this set is among the most reproduced in existence,
        so recalling the answer is the cheapest way to appear to solve one.
        The prompt states that a module carrying the answer as a literal
        scores nothing; this is the assertion that the statement is true.
        """
        task = self.one_task(1)
        self.assertNotEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n\n"
                "def solve():\n"
                "    return 233168\n\n\n"
                'register("p001", solve)\n',
            ),
            0,
        )
        self.assertNotEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n\n"
                "def solve():\n"
                '    return int("233168")\n\n\n'
                'register("p001", solve)\n',
            ),
            0,
        )


    def test_a_recalled_answer_fails_the_gauge_however_it_is_spelled(self) -> None:
        """[23C.9-euler-recall] the computed-not-written check reads what the
        source comes to, not only what it spells.

        Every problem in this set is among the most reproduced in existence, so
        recalling the answer is the cheapest way to appear to solve one, and a
        check that compares literals one token at a time is one addition away
        from being defeated. The prompt says a module that writes the answer
        down as a literal or reads it from anywhere scores nothing; these are
        the shapes that sentence has to cover for it to be true.
        """
        task = self.one_task(1)
        head = "from src.registry import register\n\n\ndef solve():\n"
        tail = '\n\n\nregister("p001", solve)\n'
        for label, body in (
            ("split-sum", "    return 233000 + 168"),
            ("split-product", "    return 4 * 58292"),
            ("digit-concatenation", "    return int(\"2331\" + \"68\")"),
            ("named-parts", "    high = 233000\n    low = 168\n    return high + low"),
            ("folded-through-a-call", "    return int(str(233000 + 168))"),
        ):
            self.assertNotEqual(
                self.gauge_exit(task, head + body + tail),
                0,
                "%s: the gauge scored a recalled answer" % label,
            )

        # Parked in a module of its own and imported, which the check misses
        # entirely if it reads only the target's file.
        self.assertNotEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n"
                "from src.tables import TOTAL\n\n\n"
                "def solve():\n    return TOTAL\n\n\n"
                'register("p001", solve)\n',
                extra={"src/tables.py": "TOTAL = 233168\n"},
            ),
            0,
            "an answer parked in a helper module is still the answer written down",
        )

        # Read from a file rather than written down, which is the other half of
        # the sentence the prompt states.
        self.assertNotEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n\n"
                "def solve():\n"
                '    with open("answer.txt") as handle:\n'
                "        return int(handle.read())\n\n\n"
                'register("p001", solve)\n',
                extra={"answer.txt": "233168\n"},
            ),
            0,
            "a module that reads the answer scores nothing even when it is right",
        )

        # The work itself still passes, so none of the above is a check that
        # refuses arithmetic.
        self.assertEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n\n"
                "def solve():\n"
                "    return sum(n for n in range(1000) if n % 3 == 0 or n % 5 == 0)\n\n\n"
                'register("p001", solve)\n',
            ),
            0,
        )

    def test_a_worked_constant_that_is_not_the_answer_still_passes(self) -> None:
        """[23C.9-euler-recall] the recall check refuses the answer, not
        constants.

        A solver states bounds, moduli and small tables, and folding every
        constant expression in the module means folding those too. A check that
        refused any large literal would fail the solvers this set exists to
        measure, so the comparison is against one value.
        """
        task = self.one_task(1)
        self.assertEqual(
            self.gauge_exit(
                task,
                "from src.registry import register\n\n"
                "LIMIT = 1000\n"
                "FACTORS = (3, 5)\n"
                "NEAR = 233167 + 2\n\n\n"
                "def solve():\n"
                "    total = 0\n"
                "    for n in range(LIMIT):\n"
                "        if any(n % f == 0 for f in FACTORS):\n"
                "            total += n\n"
                "    return total\n\n\n"
                'register("p001", solve)\n',
            ),
            0,
        )


if __name__ == "__main__":
    unittest.main()
