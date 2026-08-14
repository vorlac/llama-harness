"""Task 12.1 — serve.py router wiring (plan:2866-2889).

Every pure function that serve.py and fetch_models.py need in order to launch
llama-router, generate its config, derive one slot count for both sides of the
concurrency contract, and merge the conductor opencode fragment lives in
``scripts/conductor_wiring.py`` so it can be exercised without serving anything.

The whole leg is offline: no server is started, no socket is opened, no process
is spawned, and nothing under ``.data/`` or ``.out/`` is written. Filesystem
writes go to ``tempfile`` directories; the two committed files this leg *reads*
are the exported RouterConfig schema and ``router/UPSTREAM_CONTRACT.md``, which
is where Task 11.1's deferred live measurement is recorded.

Run as::

    /usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
"""

from __future__ import annotations

import copy
import inspect
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent

sys.path.insert(0, str(SCRIPTS_DIR))
import conductor_wiring as cw  # noqa: E402
import fetch_models as fm  # noqa: E402
import serve  # noqa: E402

ROUTER_SCHEMA = REPO_ROOT / "router" / "tests" / "schemas" / "RouterConfig.schema.json"
UPSTREAM_CONTRACT = REPO_ROOT / "router" / "UPSTREAM_CONTRACT.md"
TEST_GATE = REPO_ROOT / "scripts" / "test-conductor.sh"

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8088
UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = 8080
MODEL_ID = "qwen3.6-27b"


def flatten(value: object, prefix: str = "") -> Dict[str, object]:
    """Every leaf of a nested document, keyed by its dotted path.

    Lists are leaves: the merge contract replaces arrays wholesale, so they are
    compared by equality rather than walked.
    """
    out: Dict[str, object] = {}
    if isinstance(value, dict):
        for key in value:
            child = "%s.%s" % (prefix, key) if prefix else str(key)
            out.update(flatten(value[key], child))
    else:
        out[prefix] = value
    return out


def differing_paths(left: Dict[str, object], right: Dict[str, object]) -> List[str]:
    flat_left = flatten(left)
    flat_right = flatten(right)
    names = set(flat_left) | set(flat_right)
    return sorted(n for n in names if flat_left.get(n, _MISSING) != flat_right.get(n, _MISSING))


class _Missing(object):
    pass


_MISSING = _Missing()


def base_opencode_config(host: str, port: int) -> Dict[str, object]:
    """The shape fetch_models.generate_opencode_config emits (fetch_models.py:1276-1301)."""
    return {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            fm.PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "llama.cpp (local router)",
                "options": {
                    "baseURL": "http://%s:%d/v1" % (host, port),
                    "apiKey": "local",
                    "timeout": 1800000,
                    "headerTimeout": 600000,
                },
                "models": {MODEL_ID: {"id": MODEL_ID, "name": "Qwen [coding]"}},
            }
        },
        "model": "%s/%s" % (fm.PROVIDER_ID, MODEL_ID),
        "small_model": "%s/%s" % (fm.PROVIDER_ID, MODEL_ID),
    }


def head_server_command(configs_dir: Path, host: str, port: int, ctx: Optional[int]) -> List[str]:
    """serve.build_server_command's argv at HEAD (serve.py:237-252), before 12.1.

    Reproduced here so the new argument can be proven to be an ADDITION rather
    than a rewrite of the invocation the harness already ships.
    """
    cmd = [
        str(fm.tool_path("llama-server")),
        "--models-preset",
        str(configs_dir / "llama-models.ini"),
        "--models-max",
        "1",
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


class WiringTestCase(unittest.TestCase):
    """Shared temp-dir plumbing: nothing here touches the real .data/ tree."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        self.configs = self.tmp / "configs"
        self.configs.mkdir(parents=True)
        (self.configs / "llama-models.ini").write_text("[%s]\n" % MODEL_ID)

        self._saved_configs_dir = fm.CONFIGS_DIR
        self._saved_session_opencode = serve.SESSION_OPENCODE
        fm.CONFIGS_DIR = self.configs
        serve.SESSION_OPENCODE = self.configs / "opencode.session.json"
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        fm.CONFIGS_DIR = self._saved_configs_dir
        serve.SESSION_OPENCODE = self._saved_session_opencode

    def write_base_config(self, host: str = UPSTREAM_HOST, port: int = UPSTREAM_PORT) -> Path:
        path = self.configs / "opencode.json"
        path.write_text(json.dumps(base_opencode_config(host, port), indent=2) + "\n")
        return path

    def session_config(self, base_url: str) -> Dict[str, object]:
        self.write_base_config()
        written = serve.write_session_opencode_config(MODEL_ID, base_url)
        return json.loads(Path(written).read_text())

    def plant_router_binary(self, root: Path, relpath: str) -> Path:
        target = root / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("#!/bin/sh\nexit 0\n")
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return target

    def plant_schema(self, root: Path) -> Path:
        target = root / cw.ROUTER_SCHEMA_RELPATH
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(ROUTER_SCHEMA.read_text() if ROUTER_SCHEMA.is_file() else "{}")
        return target

    def contract_text(self) -> str:
        if not UPSTREAM_CONTRACT.is_file():
            self.fail("missing %s — Task 11.1 Step 2's record must exist" % UPSTREAM_CONTRACT)
        return UPSTREAM_CONTRACT.read_text()

    def marker(self, text: str, name: str) -> str:
        """One ``NAME: value`` record line out of an M8 artifact."""
        found = re.search(re.escape(name) + r":[ \t]*([^\n`]+)", text)
        if not found:
            self.fail(
                "router/UPSTREAM_CONTRACT.md carries no '%s:' record line — Task 12.1's "
                "live measurement has not been recorded" % name
            )
        return found.group(1).strip()

    def marker_int(self, text: str, name: str) -> int:
        raw = self.marker(text, name)
        if not raw.lstrip("-").isdigit():
            self.fail("'%s: %s' is not an integer in router/UPSTREAM_CONTRACT.md" % (name, raw))
        return int(raw)

    def task_section(self, text: str) -> str:
        """The block Task 12.1 appends, from its heading to the end of the file."""
        found = re.search(r"^#+[ \t]+Task 12\.1\b.*$", text, re.M)
        if not found:
            self.fail(
                "router/UPSTREAM_CONTRACT.md has no '## Task 12.1' section — the live "
                "measurement (Step 2 items 5 and 6) has not been recorded"
            )
        return text[found.start() :]


class RouterConfigGeneration(WiringTestCase):
    def test_12_1_router_config_shape(self) -> None:
        """[12.1-router-config-shape] the §2.2 document, generated with no I/O."""
        slots = cw.derive_slots(cw.DEFAULT_MAX_READERS)
        config = cw.generate_router_config(
            LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, slots, root=self.tmp
        )

        self.assertEqual(config["version"], 1)
        self.assertEqual(config["listen"], {"host": LISTEN_HOST, "port": LISTEN_PORT})
        self.assertEqual(config["upstream"], {"host": UPSTREAM_HOST, "port": UPSTREAM_PORT})
        self.assertEqual(
            config["admission"],
            {"maxInflightPerModel": slots, "maxQueued": 64, "queueTimeoutMs": 600000},
        )
        self.assertEqual(config["priorities"], {"interactive": 0, "review": 1, "batch": 2})
        self.assertEqual(
            config["affinity"], {"header": "X-Conductor-Group", "contiguousDequeue": True}
        )
        self.assertEqual(
            config["schema"],
            {
                "observeHeader": "X-Conductor-Schema",
                "validateResponses": True,
                "rejectOnMissing": False,
            },
        )
        self.assertIs(config["schema"]["rejectOnMissing"], False)
        self.assertEqual(config["logging"], {"level": "info"})
        self.assertIn("ledgerPath", config["metrics"])

        # G13 (plan:648-650): one model means no swaps, so no batching block anywhere.
        self.assertNotIn("batching", flatten(config))
        for path in flatten(config):
            self.assertNotIn("batching", path.split("."))

        # A queue timeout must be able to report as itself rather than racing the
        # §2.1 sub-session watchdog.
        self.assertLess(config["admission"]["queueTimeoutMs"], cw.SUB_SESSION_TIMEOUT_MS)
        self.assertEqual(cw.SUB_SESSION_TIMEOUT_MS, 900000)

        # Pure: generating a config writes nothing.
        self.assertEqual(sorted(p.name for p in self.configs.iterdir()), ["llama-models.ini"])

    def test_12_1_router_config_schema_parity(self) -> None:
        """[12.1-router-config-schema-parity] checked against the EXPORTED schema file."""
        if not ROUTER_SCHEMA.is_file():
            self.fail(
                "missing %s — regenerate it with: node conductor/tools/export-schemas.ts "
                "router/tests/schemas" % ROUTER_SCHEMA
            )
        schema = json.loads(ROUTER_SCHEMA.read_text())
        config = cw.generate_router_config(
            LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, 4, root=self.tmp
        )
        self._assert_matches_schema(config, schema, "RouterConfig")

        # router/config.hpp:456-457 range-checks both ports before anything else.
        for port_path in (("listen", "port"), ("upstream", "port")):
            port = config[port_path[0]][port_path[1]]
            self.assertGreaterEqual(port, 1)
            self.assertLessEqual(port, 65535)

    def _assert_matches_schema(self, value: object, node: Dict[str, object], path: str) -> None:
        if "enum" in node:
            self.assertIn(value, node["enum"], "%s is not one of the schema's enum values" % path)
            return
        declared = node.get("type")
        if declared == "object":
            self.assertIsInstance(value, dict, "%s must be an object" % path)
            properties = node.get("properties") or {}
            # additionalProperties is false at every level, so equality is the
            # correct relation: a generated key the schema does not declare is
            # rejected by parseRouterConfig just as a missing one is.
            self.assertEqual(
                set(value.keys()),
                set(properties.keys()),
                "%s: generated keys and schema properties differ" % path,
            )
            for name in node.get("required") or []:
                self.assertIn(name, value, "%s.%s is required by the schema" % (path, name))
            for name in properties:
                self._assert_matches_schema(value[name], properties[name], "%s.%s" % (path, name))
            return
        if declared == "number":
            self.assertNotIsInstance(value, bool, "%s must be a number, not a bool" % path)
            self.assertIsInstance(value, (int, float), "%s must be a number" % path)
        elif declared == "string":
            self.assertIsInstance(value, str, "%s must be a string" % path)
        elif declared == "boolean":
            self.assertIsInstance(value, bool, "%s must be a boolean" % path)
        else:
            self.fail("%s: schema declares an unhandled type %r" % (path, declared))

    def test_12_1_ledger_path_absolute(self) -> None:
        """[12.1-ledger-path-absolute] an absolute ledger path plus a repo-root cwd."""
        root = Path(os.path.realpath(str(self.tmp)))
        config = cw.generate_router_config(
            LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, 4, root=root
        )
        ledger = config["metrics"]["ledgerPath"]
        self.assertTrue(os.path.isabs(ledger), "ledgerPath must be absolute, got %r" % ledger)
        self.assertTrue(ledger.endswith(".data/router/metrics.jsonl"), ledger)
        self.assertEqual(ledger, str(root / ".data" / "router" / "metrics.jsonl"))
        self.assertEqual(os.path.realpath(str(root)), str(root))

        # The supervisor launches the router at the repo root, so a hand-edited
        # relative ledgerPath resolves to the same file.
        calls: List[Dict[str, object]] = []
        binary = self.plant_router_binary(self.tmp, "llama-router")
        cw.start_router_supervisor(
            binary,
            self.tmp / cw.ROUTER_CONFIG_RELPATH,
            self.plant_schema(self.tmp),
            4242,
            root,
            spawn=_recording_spawn(calls),
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["kwargs"]["cwd"], str(root))

    def test_12_1_router_config_preserves_hand_edits(self) -> None:
        """[12.1-router-config-preserves-hand-edits] machine keys refresh, hand edits stay."""
        generated = cw.generate_router_config(
            LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, 6, root=self.tmp
        )

        # No existing file: the full §2.2 document is written.
        self.assertEqual(cw.merge_router_config(None, generated), generated)

        hand_edited = cw.generate_router_config(
            "10.0.0.9", 9999, "10.0.0.9", 9998, 1, root=Path("/somewhere/else")
        )
        hand_edited["admission"]["maxQueued"] = 8
        hand_edited["admission"]["queueTimeoutMs"] = 111111
        hand_edited["priorities"]["batch"] = 7
        hand_edited["affinity"]["contiguousDequeue"] = False
        hand_edited["schema"]["validateResponses"] = False
        hand_edited["logging"]["level"] = "debug"
        before = copy.deepcopy(hand_edited)

        merged = cw.merge_router_config(hand_edited, generated)

        self.assertEqual(merged["admission"]["maxQueued"], 8)
        self.assertEqual(merged["admission"]["queueTimeoutMs"], 111111)
        self.assertEqual(merged["priorities"]["batch"], 7)
        self.assertIs(merged["affinity"]["contiguousDequeue"], False)
        self.assertIs(merged["schema"]["validateResponses"], False)
        self.assertEqual(merged["logging"]["level"], "debug")

        self.assertEqual(merged["version"], generated["version"])
        self.assertEqual(merged["listen"], generated["listen"])
        self.assertEqual(merged["upstream"], generated["upstream"])
        self.assertEqual(
            merged["admission"]["maxInflightPerModel"],
            generated["admission"]["maxInflightPerModel"],
        )
        self.assertEqual(merged["metrics"]["ledgerPath"], generated["metrics"]["ledgerPath"])
        self.assertEqual(hand_edited, before, "merge_router_config must not mutate its input")

        # --fresh drops the hand edits, exactly as it already ignores serve-session.json.
        self.assertEqual(cw.merge_router_config(hand_edited, generated, fresh=True), generated)

        # The seven machine-derived paths are declared once, not scattered.
        self.assertEqual(
            set(cw.ROUTER_MACHINE_KEYS),
            {
                ("version",),
                ("listen", "host"),
                ("listen", "port"),
                ("upstream", "host"),
                ("upstream", "port"),
                ("admission", "maxInflightPerModel"),
                ("metrics", "ledgerPath"),
            },
        )


class ParallelDerivation(WiringTestCase):
    def test_12_1_parallel_single_source(self) -> None:
        """[12.1-parallel-single-source] one number feeds --parallel and maxInflightPerModel."""
        seen = []
        for max_readers in (1, 2, 4, 6, 8):
            slots = cw.derive_slots(max_readers)
            cmd = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 4096, slots)
            config = cw.generate_router_config(
                LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, slots, root=self.tmp
            )

            self.assertEqual(cmd.count("--parallel"), 1, cmd)
            self.assertEqual(cmd[cmd.index("--parallel") + 1], str(slots), cmd)
            self.assertEqual(config["admission"]["maxInflightPerModel"], slots)
            self.assertLessEqual(config["admission"]["maxInflightPerModel"], slots)

            head = head_server_command(self.configs, UPSTREAM_HOST, UPSTREAM_PORT, 4096)
            self.assertNotIn(
                "--parallel", head, "HEAD's serve.py emitted no --parallel; 12.1 adds it"
            )
            self.assertEqual(cmd, head + cw.parallel_server_args(slots))

            seen.append((slots, cmd[cmd.index("--parallel") + 1], config["admission"]["maxInflightPerModel"]))

        # One input moves both outputs together; neither can drift alone.
        self.assertEqual(len({s for s, _, _ in seen}), len(seen))
        for slots, argv_slots, admission_slots in seen:
            self.assertEqual(int(argv_slots), slots)
            self.assertEqual(admission_slots, slots)

    def test_12_1_parallel_degenerate_input(self) -> None:
        """[12.1-parallel-degenerate-input] the derivation is total and never emits zero."""
        for max_readers in (0, -1, -12):
            slots = cw.derive_slots(max_readers)
            self.assertEqual(slots, 1, "maxReaders %r must floor to one slot" % max_readers)
            cmd = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, None, slots)
            self.assertNotIn("0", [cmd[cmd.index("--parallel") + 1]])
            self.assertEqual(cmd[cmd.index("--parallel") + 1], "1")
            config = cw.generate_router_config(
                LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, slots, root=self.tmp
            )
            self.assertEqual(config["admission"]["maxInflightPerModel"], 1)

        for bad in (None, "6", 2.5, [6]):
            with self.assertRaises(cw.WiringError):
                cw.derive_slots(bad)

    def test_12_1_ctx_per_slot_preserved(self) -> None:
        """[12.1-ctx-per-slot-preserved] the argv pinned by the recorded per-slot measurement."""
        recorded = self.marker(self.contract_text(), "PER_SLOT_CONTEXT_ARGV")
        self.assertTrue(
            recorded.startswith("--parallel <slots>"),
            "PER_SLOT_CONTEXT_ARGV must begin '--parallel <slots>', got %r" % recorded,
        )

        slots = cw.DEFAULT_MAX_READERS
        self.assertGreater(slots, 1)
        expected = recorded.replace("<slots>", str(slots)).split()
        self.assertEqual(
            cw.parallel_server_args(slots),
            expected,
            "the derived argv must match the argv recorded in router/UPSTREAM_CONTRACT.md",
        )

        # One slot is the identity case either way: HEAD's argv plus --parallel 1.
        self.assertEqual(cw.parallel_server_args(1), ["--parallel", "1"])
        cmd = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 4096, 1)
        self.assertEqual(
            cmd, head_server_command(self.configs, UPSTREAM_HOST, UPSTREAM_PORT, 4096) + ["--parallel", "1"]
        )


class FragmentMerge(WiringTestCase):
    def test_12_1_fragment_deep_merge(self) -> None:
        """[12.1-fragment-deep-merge] conductor keys win, base keys survive, arrays replace."""
        fragment = cw.substitute_harness_root(cw.load_fragment(REPO_ROOT), REPO_ROOT)
        base = base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT)
        base["plugin"] = ["/tmp/someone-elses-plugin.ts"]
        base["agent"] = {"my-agent": {"mode": "subagent"}}
        base["provider"][fm.PROVIDER_ID]["options"]["apiKey"] = "local"

        merged = cw.merge_opencode_fragment(base, fragment)

        # Base-only keys survive at every depth.
        self.assertEqual(merged["$schema"], base["$schema"])
        self.assertEqual(merged["model"], base["model"])
        self.assertEqual(merged["small_model"], base["small_model"])
        self.assertEqual(merged["provider"][fm.PROVIDER_ID]["models"], base["provider"][fm.PROVIDER_ID]["models"])
        self.assertEqual(merged["provider"][fm.PROVIDER_ID]["options"]["apiKey"], "local")
        self.assertEqual(merged["agent"]["my-agent"], {"mode": "subagent"})

        # Arrays are replaced wholesale, never concatenated.
        self.assertEqual(merged["plugin"], fragment["plugin"])
        self.assertNotIn("/tmp/someone-elses-plugin.ts", merged["plugin"])

        agents = [
            "conductor-orchestrator",
            "conductor-implementer",
            "conductor-test-writer",
            "conductor-reviewer",
            "conductor-skeptic",
            "conductor-planner",
            "conductor-mechanical",
        ]
        for name in agents:
            self.assertIn(name, merged["agent"])
            self.assertIs(merged["agent"][name]["tools"]["task"], False, name)

        # A conflicting key resolves in conductor's favour.
        clashing = dict(base)
        clashing["agent"] = {"conductor-reviewer": {"mode": "primary"}}
        self.assertEqual(
            cw.merge_opencode_fragment(clashing, fragment)["agent"]["conductor-reviewer"]["mode"],
            fragment["agent"]["conductor-reviewer"]["mode"],
        )

    def test_12_1_merge_idempotent_nonmutating(self) -> None:
        """[12.1-merge-idempotent-nonmutating] merging twice equals merging once."""
        fragment = cw.substitute_harness_root(cw.load_fragment(REPO_ROOT), REPO_ROOT)
        base = base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT)
        base_before = copy.deepcopy(base)
        fragment_before = copy.deepcopy(fragment)

        once = cw.merge_opencode_fragment(base, fragment)
        twice = cw.merge_opencode_fragment(once, fragment)

        # Serialized without sorting, so key order is part of the comparison.
        self.assertEqual(json.dumps(once, indent=2), json.dumps(twice, indent=2))
        self.assertEqual(base, base_before, "merge must not mutate the base config")
        self.assertEqual(fragment, fragment_before, "merge must not mutate the fragment")
        self.assertIsNot(once, base)
        self.assertIsNot(once["provider"], base["provider"])

    def test_12_1_harness_root_subst(self) -> None:
        """[12.1-harness-root-subst] no ${LLAMA_HARNESS_ROOT} token survives generation."""
        root = REPO_ROOT
        self.assertEqual(os.path.realpath(str(root)), str(root))
        self.assertEqual(str(cw.REPO_ROOT), str(root))

        merged = cw.apply_conductor_wiring(
            base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT),
            cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT),
            root=root,
        )
        serialized = json.dumps(merged)
        self.assertNotIn(cw.HARNESS_ROOT_TOKEN, serialized)
        self.assertNotIn("LLAMA_HARNESS_ROOT", serialized)
        self.assertEqual(merged["plugin"], [str(root / "conductor" / "plugin" / "index.ts")])
        self.assertEqual(
            merged["agent"]["conductor-orchestrator"]["prompt"],
            "{file:%s}" % (root / "conductor" / "doctrine" / "core.md"),
        )

        # Substitution reaches any depth and any string, not just the two known ones.
        nested = {"a": {"b": [cw.HARNESS_ROOT_TOKEN + "/x", {"c": cw.HARNESS_ROOT_TOKEN}]}}
        self.assertEqual(
            cw.substitute_harness_root(nested, root),
            {"a": {"b": [str(root) + "/x", {"c": str(root)}]}},
        )

    def test_12_1_file_refs_exist(self) -> None:
        """[12.1-file-refs-exist] a dangling {file:...} is named, not shipped."""
        root = REPO_ROOT
        merged = cw.apply_conductor_wiring(
            base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT),
            cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT),
            root=root,
        )
        # The happy path: both real targets resolve.
        cw.verify_file_references(merged, root=root)
        self.assertTrue((root / "conductor" / "plugin" / "index.ts").is_file())
        self.assertTrue((root / "conductor" / "doctrine" / "core.md").is_file())

        broken = copy.deepcopy(cw.load_fragment(root))
        broken["agent"]["conductor-orchestrator"]["prompt"] = (
            "{file:%s/conductor/doctrine/absent-pack.md}" % cw.HARNESS_ROOT_TOKEN
        )
        with self.assertRaises(cw.WiringError) as caught:
            cw.apply_conductor_wiring(
                base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT),
                cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT),
                root=root,
                fragment=broken,
            )
        self.assertIn(
            str(root / "conductor" / "doctrine" / "absent-pack.md"),
            str(caught.exception),
        )

    def test_12_1_autoupdate_off(self) -> None:
        """[12.1-autoupdate-off] C-012: the generated config pins opencode auto-update off."""
        merged = cw.apply_conductor_wiring(
            base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT),
            cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT),
            root=REPO_ROOT,
        )
        self.assertIn("autoupdate", merged)
        self.assertIs(merged["autoupdate"], False)

        opted_in = base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT)
        opted_in["autoupdate"] = True
        overridden = cw.apply_conductor_wiring(
            opted_in, cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT), root=REPO_ROOT
        )
        self.assertIs(overridden["autoupdate"], False)


class SessionConfig(WiringTestCase):
    def test_12_1_baseurl_router(self) -> None:
        """[12.1-baseurl-router] router mode points the provider at the router origin."""
        slots = cw.derive_slots(cw.DEFAULT_MAX_READERS)
        router_config = cw.generate_router_config(
            LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT, slots, root=self.tmp
        )
        base_url = cw.openai_base_url(LISTEN_HOST, LISTEN_PORT)
        config = self.session_config(base_url)

        options = config["provider"][fm.PROVIDER_ID]["options"]
        self.assertEqual(options["baseURL"], "http://%s:%d/v1" % (LISTEN_HOST, LISTEN_PORT))
        self.assertIn(str(router_config["listen"]["port"]), options["baseURL"])
        self.assertEqual(
            int(options["baseURL"].rsplit(":", 1)[1].split("/")[0]),
            router_config["listen"]["port"],
        )

        untouched = base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT)["provider"][fm.PROVIDER_ID]["options"]
        for key in ("apiKey", "timeout", "headerTimeout"):
            self.assertEqual(options[key], untouched[key], key)

    def test_12_1_baseurl_no_router_direct(self) -> None:
        """[12.1-baseurl-no-router-direct] --no-router differs by the baseURL and nothing else."""
        routed = self.session_config(cw.openai_base_url(LISTEN_HOST, LISTEN_PORT))
        direct = self.session_config(cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT))

        self.assertEqual(
            direct["provider"][fm.PROVIDER_ID]["options"]["baseURL"],
            "http://%s:%d/v1" % (UPSTREAM_HOST, UPSTREAM_PORT),
        )
        self.assertEqual(
            differing_paths(routed, direct),
            ["provider.%s.options.baseURL" % fm.PROVIDER_ID],
        )
        for config in (routed, direct):
            self.assertEqual(len(config["agent"]), 7)
            self.assertIs(config["autoupdate"], False)
            self.assertEqual(config["model"], "%s/%s" % (fm.PROVIDER_ID, MODEL_ID))

    def test_12_1_session_config_single_writer(self) -> None:
        """[12.1-session-config-single-writer] write_session_opencode_config stays the only writer."""
        config = self.session_config(cw.openai_base_url(LISTEN_HOST, LISTEN_PORT))
        self.assertTrue((self.configs / "opencode.session.json").is_file())
        self.assertEqual(config["model"], "%s/%s" % (fm.PROVIDER_ID, MODEL_ID))
        self.assertEqual(config["small_model"], "%s/%s" % (fm.PROVIDER_ID, MODEL_ID))
        self.assertIn("plugin", config)

        # The served id is only defaulted when the provider actually advertises it.
        base = base_opencode_config(UPSTREAM_HOST, UPSTREAM_PORT)
        base["provider"][fm.PROVIDER_ID]["models"] = {}
        base["model"] = "%s/other" % fm.PROVIDER_ID
        (self.configs / "opencode.json").write_text(json.dumps(base, indent=2) + "\n")
        written = serve.write_session_opencode_config(
            MODEL_ID, cw.openai_base_url(LISTEN_HOST, LISTEN_PORT)
        )
        self.assertEqual(json.loads(Path(written).read_text())["model"], "%s/other" % fm.PROVIDER_ID)

        # The absent-base remedy is retained verbatim.
        (self.configs / "opencode.json").unlink()
        with self.assertRaises(SystemExit) as caught:
            serve.write_session_opencode_config(MODEL_ID, cw.openai_base_url(LISTEN_HOST, LISTEN_PORT))
        self.assertIn("scripts/fetch_models.py config", str(caught.exception))

        writers = [
            path.name
            for path in sorted(SCRIPTS_DIR.glob("*.py"))
            if path.name != Path(__file__).name and "opencode.session.json" in path.read_text()
        ]
        self.assertEqual(writers, ["serve.py"], "only serve.py may name the session config")

    def test_12_1_fetch_models_config_fragment_aware(self) -> None:
        """[12.1-fetch-models-config-fragment-aware] the base config carries the wiring too."""
        generated = fm.generate_opencode_config([], UPSTREAM_HOST, UPSTREAM_PORT, None)
        fragment = cw.substitute_harness_root(cw.load_fragment(REPO_ROOT), REPO_ROOT)

        self.assertEqual(generated["plugin"], fragment["plugin"])
        self.assertEqual(generated["agent"], fragment["agent"])
        self.assertIs(generated["autoupdate"], False)

        # The base config is written before any router port is resolved, so it
        # stays pointed straight at llama-server.
        self.assertEqual(
            generated["provider"][fm.PROVIDER_ID]["options"]["baseURL"],
            "http://%s:%d/v1" % (UPSTREAM_HOST, UPSTREAM_PORT),
        )

        # One implementation, not a second copy of the merge inside fetch_models.
        self.assertIn("conductor_wiring", inspect.getsource(fm))

        # A session-time merge over the fragment-aware base is a no-op.
        again = cw.apply_conductor_wiring(
            generated, cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT), root=REPO_ROOT
        )
        self.assertEqual(json.dumps(again, indent=2), json.dumps(generated, indent=2))


def _recording_spawn(calls: List[Dict[str, object]]):
    class _Handle(object):
        pid = 4321

    def spawn(argv, **kwargs):
        calls.append({"argv": list(argv), "kwargs": dict(kwargs)})
        return _Handle()

    return spawn


class RouterLaunchDecision(WiringTestCase):
    def test_12_1_router_default_matrix(self) -> None:
        """[12.1-router-default-matrix] flag x binary, over a pinned search order."""
        empty_root = self.tmp / "empty"
        empty_root.mkdir()
        env: Dict[str, str] = {"PATH": str(empty_root)}
        schema = self.plant_schema(self.tmp)

        self.assertIsNone(cw.find_router_binary(empty_root, env))

        # absent + not found -> direct with a notice; --router + not found -> refuse.
        absent = cw.router_preflight(None, None, schema, searched=cw.router_search_paths(empty_root, env))
        self.assertEqual(absent.action, "direct")
        self.assertFalse(absent.router_enabled)
        self.assertTrue(absent.notice)

        refused = cw.router_preflight(
            True, None, schema, searched=cw.router_search_paths(empty_root, env)
        )
        self.assertEqual(refused.action, "refuse")
        self.assertIn(".out/build/clang-relwdebinfo/llama-router", refused.error)

        # --no-router is direct whether or not a binary exists.
        found_root = self.tmp / "found"
        binary = self.plant_router_binary(found_root, ".out/build/clang-relwdebinfo/llama-router")
        self.assertEqual(cw.find_router_binary(found_root, env), binary)
        self.assertEqual(cw.router_preflight(False, binary, schema).action, "direct")
        self.assertEqual(cw.router_preflight(None, binary, schema).action, "launch")
        self.assertEqual(cw.router_preflight(True, binary, schema).action, "launch")

        # The search order is pinned, most-preferred first.
        self.assertEqual(
            list(cw.ROUTER_BINARY_RELPATHS),
            [
                ".out/build/clang-relwdebinfo/llama-router",
                ".out/build/clang-release/llama-router",
                ".out/build/clang-debug/llama-router",
                ".data/tools/llama-router",
            ],
        )
        later = self.tmp / "later"
        self.plant_router_binary(later, ".data/tools/llama-router")
        preferred = self.plant_router_binary(later, ".out/build/clang-release/llama-router")
        self.assertEqual(cw.find_router_binary(later, env), preferred)

        # $LLAMA_ROUTER wins, but only when it names an existing executable file.
        override = self.plant_router_binary(self.tmp / "override", "custom-router")
        self.assertEqual(
            cw.find_router_binary(later, {"PATH": str(empty_root), cw.ROUTER_BINARY_ENV: str(override)}),
            override,
        )
        self.assertEqual(
            cw.find_router_binary(
                later, {"PATH": str(empty_root), cw.ROUTER_BINARY_ENV: str(self.tmp / "nope")}
            ),
            preferred,
        )

        # fetch_models.find_tool cannot serve this role: its env branch is
        # llama-server only and its own-tools branch never looks in .out/build.
        self.assertIn('name == "llama-server"', inspect.getsource(fm.find_tool))

    def test_12_1_router_preflight_schema(self) -> None:
        """[12.1-router-preflight-schema] C-041 makes --schema required with no search path."""
        root = self.tmp / "root"
        binary = self.plant_router_binary(root, ".out/build/clang-relwdebinfo/llama-router")
        missing = root / cw.ROUTER_SCHEMA_RELPATH
        self.assertFalse(missing.is_file())

        auto = cw.router_preflight(None, binary, missing)
        self.assertEqual(auto.action, "direct")
        self.assertFalse(auto.router_enabled)
        self.assertIn("schema", auto.notice.lower())

        explicit = cw.router_preflight(True, binary, missing)
        self.assertEqual(explicit.action, "refuse")
        self.assertIn("node conductor/tools/export-schemas.ts router/tests/schemas", explicit.error)

        present = self.plant_schema(root)
        launch = cw.router_preflight(True, binary, present)
        self.assertEqual(launch.action, "launch")
        self.assertTrue(launch.router_enabled)
        self.assertEqual(Path(launch.schema), present.resolve())
        self.assertTrue(os.path.isabs(str(launch.schema)))
        self.assertEqual(cw.ROUTER_SCHEMA_RELPATH, "router/tests/schemas/RouterConfig.schema.json")

    def test_12_1_backoff_policy(self) -> None:
        """[12.1-backoff-policy] capped exponential restart delays, reset by a healthy run."""
        self.assertEqual(cw.BACKOFF_BASE_MS, 500)
        self.assertEqual(cw.BACKOFF_FACTOR, 2)
        self.assertEqual(cw.BACKOFF_CAP_MS, 30000)
        self.assertEqual(cw.HEALTHY_RUN_SECONDS, 60)

        delays = []
        crashes = 0
        for uptime in (1.0, 1.0, 1.0, 120.0):
            delay, crashes = cw.backoff_next(crashes, uptime)
            delays.append(delay)
        self.assertEqual(delays, [500, 1000, 2000, 500])
        self.assertEqual(crashes, 1)

        self.assertEqual(
            [cw.restart_delay_ms(n) for n in range(1, 8)],
            [500, 1000, 2000, 4000, 8000, 16000, 30000],
        )
        for n in (7, 8, 64, 10000):
            self.assertLessEqual(cw.restart_delay_ms(n), cw.BACKOFF_CAP_MS)
        self.assertEqual(cw.restart_delay_ms(10000), cw.BACKOFF_CAP_MS)

    def test_12_1_exit_code_policy(self) -> None:
        """[12.1-exit-code-policy] C-041's exit codes decide restart, not a blind loop."""
        self.assertEqual(set(cw.FATAL_EXIT_CODES), {2, 3, 4})

        clean = cw.router_restart_decision(0, "")
        self.assertFalse(clean.restart)
        self.assertFalse(clean.fatal)

        stderrs = {
            2: "unknown flag --confg\nusage: llama-router --config <path> --schema <path>",
            3: "ConfigError: admission.maxInflightPerModel out of range",
            4: "failed to bind 127.0.0.1:8088",
        }
        for code, text in stderrs.items():
            verdict = cw.router_restart_decision(code, text)
            self.assertFalse(verdict.restart, "exit %d must not be retried" % code)
            self.assertTrue(verdict.fatal, "exit %d is fatal" % code)
            self.assertIn(text, verdict.message, "exit %d must surface stderr verbatim" % code)

        for code in (1, 5, 137):
            verdict = cw.router_restart_decision(code, "crash")
            self.assertTrue(verdict.restart, "exit %d is restartable" % code)
            self.assertFalse(verdict.fatal)

        signalled = cw.router_restart_decision(-9, "")
        self.assertTrue(signalled.restart)
        self.assertFalse(signalled.fatal)

    def test_12_1_supervisor_lifecycle(self) -> None:
        """[12.1-supervisor-lifecycle] a detached supervisor that dies with the session shell."""
        root = self.tmp / "root"
        binary = self.plant_router_binary(root, ".out/build/clang-relwdebinfo/llama-router")
        schema = self.plant_schema(root)
        config_path = root / cw.ROUTER_CONFIG_RELPATH

        self.assertEqual(
            cw.router_supervisor_argv(binary, config_path, schema),
            [str(binary), "--config", str(config_path), "--schema", str(schema)],
        )

        calls: List[Dict[str, object]] = []
        cw.start_router_supervisor(
            binary, config_path, schema, 9876, root, spawn=_recording_spawn(calls)
        )
        self.assertEqual(len(calls), 1, "exactly one supervisor is spawned")
        argv = calls[0]["argv"]
        kwargs = calls[0]["kwargs"]
        self.assertEqual(argv[0], sys.executable)
        self.assertEqual(argv[1], "-c")
        self.assertEqual(argv[2], cw.ROUTER_SUPERVISOR_SOURCE)
        self.assertIn("9876", argv)
        for piece in cw.router_supervisor_argv(binary, config_path, schema):
            self.assertIn(piece, argv)

        # Mirrors start_watchdog (serve.py:359-376) rather than inventing a lifecycle.
        self.assertIs(kwargs["start_new_session"], True)
        self.assertEqual(kwargs["cwd"], str(root))
        for stream in ("stdout", "stderr", "stdin"):
            self.assertEqual(kwargs[stream], subprocess.DEVNULL, stream)

        source = cw.ROUTER_SUPERVISOR_SOURCE
        self.assertIn("os.kill(shell_pid, 0)", source)
        self.assertIn("SIGTERM", source)
        self.assertIn("SIGKILL", source)
        self.assertLess(
            source.index("SIGTERM"), source.index("SIGKILL"), "terminate before killing"
        )
        self.assertGreaterEqual(cw.ROUTER_TERM_GRACE_S, 5.0)

        # --no-shell has no surviving python and no shell pid (serve.py:485-488).
        no_shell_auto = cw.router_preflight(None, binary, schema, no_shell=True)
        self.assertEqual(no_shell_auto.action, "direct")
        self.assertFalse(no_shell_auto.router_enabled)
        no_shell_explicit = cw.router_preflight(True, binary, schema, no_shell=True)
        self.assertEqual(no_shell_explicit.action, "refuse")
        self.assertIn("--no-shell", no_shell_explicit.error)
        self.assertIn("--router", no_shell_explicit.error)

    def test_12_1_readiness_fallback_direct(self) -> None:
        """[12.1-readiness-fallback-direct] a session is never handed a dead router."""
        root = self.tmp / "root"
        binary = self.plant_router_binary(root, ".out/build/clang-relwdebinfo/llama-router")
        schema = self.plant_schema(root)
        decision = cw.router_preflight(None, binary, schema)
        self.assertEqual(decision.action, "launch")

        router_url = cw.openai_base_url(LISTEN_HOST, LISTEN_PORT)
        direct_url = cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT)
        args = (decision, LISTEN_HOST, LISTEN_PORT, UPSTREAM_HOST, UPSTREAM_PORT)

        healthy = cw.finalize_routing(*args, probe=lambda host, port: True)
        self.assertTrue(healthy.router_enabled)
        self.assertEqual(healthy.base_url, router_url)

        never = cw.finalize_routing(*args, probe=lambda host, port: False)
        self.assertFalse(never.router_enabled)
        self.assertEqual(never.base_url, direct_url)
        self.assertTrue(never.notice)

        def refused(host, port):
            raise OSError(61, "Connection refused")

        crashed = cw.finalize_routing(*args, probe=refused)
        self.assertFalse(crashed.router_enabled)
        self.assertEqual(crashed.base_url, direct_url)
        self.assertTrue(crashed.notice)

        # A decision that never reached launch is direct without probing at all.
        probed: List[object] = []

        def counting(host, port):
            probed.append((host, port))
            return True

        off = cw.finalize_routing(
            cw.router_preflight(False, binary, schema),
            LISTEN_HOST,
            LISTEN_PORT,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            probe=counting,
        )
        self.assertFalse(off.router_enabled)
        self.assertEqual(off.base_url, direct_url)
        self.assertEqual(probed, [])
        self.assertEqual(cw.ROUTER_HEALTH_PATH, "/conductor/health")

    def test_12_1_session_env_router(self) -> None:
        """[12.1-session-env-router] env is the channel the plugin can actually read."""
        config_path = self.configs / "opencode.session.json"
        router_config = self.tmp / cw.ROUTER_CONFIG_RELPATH

        routed = cw.session_env(
            MODEL_ID,
            config_path,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            1234,
            cw.Routing(True, cw.openai_base_url(LISTEN_HOST, LISTEN_PORT), None),
            router_config_path=router_config,
        )
        self.assertEqual(routed["OPENCODE_CONFIG"], str(config_path))
        self.assertEqual(routed["LLAMA_HARNESS_MODEL"], MODEL_ID)
        self.assertEqual(routed["LLAMA_HARNESS_URL"], "http://%s:%d" % (UPSTREAM_HOST, UPSTREAM_PORT))
        self.assertEqual(routed["LLAMA_HARNESS_SERVER_PID"], "1234")
        self.assertEqual(routed["LLAMA_HARNESS_ROUTER"], "1")
        self.assertEqual(
            routed["LLAMA_HARNESS_ROUTER_URL"], "http://%s:%d" % (LISTEN_HOST, LISTEN_PORT)
        )
        self.assertEqual(routed["LLAMA_HARNESS_ROUTER_CONFIG"], str(router_config))
        self.assertTrue(os.path.isabs(routed["LLAMA_HARNESS_ROUTER_CONFIG"]))

        direct = cw.session_env(
            MODEL_ID,
            config_path,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            1234,
            cw.Routing(False, cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT), None),
            router_config_path=router_config,
        )
        self.assertEqual(direct["LLAMA_HARNESS_ROUTER"], "0")
        self.assertNotIn("LLAMA_HARNESS_ROUTER_URL", direct)
        self.assertNotIn("LLAMA_HARNESS_ROUTER_CONFIG", direct)

        # Both renderers cover exactly the same variables, so the rcfile and
        # --print-env can never disagree about what the session exports.
        for env in (routed, direct):
            block = cw.rcfile_export_block(env)
            lines = cw.print_env_lines(env)
            self.assertEqual(
                sorted(re.findall(r"^export ([A-Z_]+)=", block, re.M)), sorted(env.keys())
            )
            self.assertEqual(sorted(line.split("=", 1)[0] for line in lines), sorted(env.keys()))
            for name, value in env.items():
                self.assertIn("export %s=" % name, block)
                self.assertIn("%s=%s" % (name, value), lines)


class GateAndLiveRecord(WiringTestCase):
    def test_12_1_python_test_leg(self) -> None:
        """[12.1-python-test-leg] the gate gains a python leg after the schema export."""
        if not TEST_GATE.is_file():
            self.fail("missing %s" % TEST_GATE)
        gate = TEST_GATE.read_text()

        leg = gate.find("/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'")
        self.assertNotEqual(
            leg, -1, "scripts/test-conductor.sh has no /usr/bin/python3 unittest discover leg"
        )
        export = gate.find("node conductor/tools/export-schemas.ts router/tests/schemas")
        gate_pass = gate.find("GATE PASS")
        self.assertNotEqual(export, -1)
        self.assertNotEqual(gate_pass, -1)
        self.assertLess(export, leg, "the python leg must run after the schema export")
        self.assertLess(leg, gate_pass, "the python leg must run before GATE PASS")

        tail = gate[leg:gate_pass]
        self.assertIn("GATE FAIL", tail, "a python failure must fail the gate")
        self.assertIn("exit 1", tail)

        # python 3.9.6 is the pinned interpreter, so the module keeps the
        # deferred-annotation style the rest of scripts/ uses.
        source = inspect.getsource(cw)
        self.assertIn("from __future__ import annotations", source)
        self.assertIsNone(re.search(r"^\s*match\s+.+:\s*$", source, re.M), "no match statements")

    def test_12_1_live_slot_count(self) -> None:
        """[12.1-live-slot-count] Step 2 item 6, the measured concurrent slot count."""
        text = self.contract_text()
        section = self.task_section(text)

        baseline = self.marker_int(text, "BASELINE_SLOT_COUNT_AUTO")
        effective = self.marker_int(text, "EFFECTIVE_SLOT_COUNT")
        self.assertGreaterEqual(baseline, 1, "the auto-mode baseline is read, never assumed")
        self.assertGreaterEqual(effective, 1)

        for n in ("N=1", "N=2", "N=4", "N=8"):
            self.assertIn(n, section, "the concurrency probe must record %s" % n)

        # The measured ceiling constrains the wiring's own default; if the probe
        # came in under it, the default is lowered rather than the number ignored.
        self.assertLessEqual(
            cw.DEFAULT_MAX_READERS,
            effective,
            "DEFAULT_MAX_READERS (%d) exceeds the measured slot count (%d)"
            % (cw.DEFAULT_MAX_READERS, effective),
        )
        self.assertEqual(
            cw.derive_slots(cw.DEFAULT_MAX_READERS),
            cw.generate_router_config(
                LISTEN_HOST,
                LISTEN_PORT,
                UPSTREAM_HOST,
                UPSTREAM_PORT,
                cw.derive_slots(cw.DEFAULT_MAX_READERS),
                root=self.tmp,
            )["admission"]["maxInflightPerModel"],
        )

    def test_12_1_live_ctx_per_slot(self) -> None:
        """[12.1-live-ctx-per-slot] three startups decide whether --parallel splits context."""
        text = self.contract_text()
        section = self.task_section(text)

        without = self.marker_int(text, "CTX_PER_SLOT_NO_PARALLEL")
        with_parallel = self.marker_int(text, "CTX_PER_SLOT_WITH_PARALLEL")
        pinned = self.marker_int(text, "CTX_PER_SLOT_PINNED_ARGV")
        for name, value in (
            ("CTX_PER_SLOT_NO_PARALLEL", without),
            ("CTX_PER_SLOT_WITH_PARALLEL", with_parallel),
            ("CTX_PER_SLOT_PINNED_ARGV", pinned),
        ):
            self.assertGreater(value, 0, "%s must be a positive token count" % name)

        self.assertEqual(
            pinned,
            without,
            "the pinned argv must serve the same per-slot context as the auto baseline "
            "(observed %d vs %d)" % (pinned, without),
        )

        argv = self.marker(text, "PER_SLOT_CONTEXT_ARGV")
        self.assertIn("<slots>", argv)
        self.assertEqual(
            cw.parallel_server_args(cw.DEFAULT_MAX_READERS),
            argv.replace("<slots>", str(cw.DEFAULT_MAX_READERS)).split(),
        )
        # M8: three verbatim startups, raw output, not a paraphrase of --help.
        self.assertGreaterEqual(section.count("--parallel"), 2)
        self.assertGreaterEqual(len(re.findall(r"^\$ ", section, re.M)), 3)

    def test_12_1_live_autoload(self) -> None:
        """[12.1-live-autoload] Step 2 item 5, the measured non-resident load latency."""
        text = self.contract_text()
        section = self.task_section(text)
        value = self.marker(text, "AUTOLOAD_LATENCY_MS")

        if value == "BLOCKED":
            self.assertGreaterEqual(
                len(re.findall(r"^\$ ", section, re.M)),
                1,
                "a BLOCKED autoload probe must still record the commands attempted",
            )
            self.assertIn("pending", self.marker(text, "WIRE_CONTRACT_VERIFIED"))
            return

        self.assertTrue(value.isdigit(), "AUTOLOAD_LATENCY_MS must be an integer or BLOCKED")
        self.assertGreater(int(value), 0)
        self.assertIn("--models-max", section)

    def test_12_1_live_stamp_and_m8(self) -> None:
        """[12.1-live-stamp-and-m8] the stamp lands only when all six items are covered."""
        text = self.contract_text()
        section = self.task_section(text)

        blocked: List[str] = []
        for item in range(1, 7):
            record = self.marker(text, "STEP2_ITEM_%d" % item)
            parts = record.split()
            self.assertGreaterEqual(
                len(parts), 2, "STEP2_ITEM_%d must name the task and its evidence" % item
            )
            if "BLOCKED" in record:
                blocked.append(record)
                continue
            evidence = REPO_ROOT / parts[-1]
            self.assertTrue(
                evidence.exists(), "STEP2_ITEM_%d cites a missing path: %s" % (item, parts[-1])
            )

        stamp = self.marker(text, "WIRE_CONTRACT_VERIFIED")
        if blocked:
            self.assertIn("pending", stamp, "a BLOCKED item keeps the stamp pending: %r" % blocked)
        else:
            self.assertNotIn("pending", stamp, "six covered items means a real stamp")
            self.assertRegex(stamp, r"\d{4}-\d{2}-\d{2}")
            self.assertIn("12.1", stamp, "the stamp names which task observed which item")

        # M8 discipline: verbatim commands, raw blocks, an observed cwd.
        self.assertGreaterEqual(section.count("```"), 6, "raw output must be fenced, not narrated")
        self.assertGreaterEqual(len(re.findall(r"^\$ ", section, re.M)), 3)

        # The cwd is part of the record, so the section must name the absolute
        # directory the commands were observed from. It is the historical cwd of
        # the measurement, not the cwd of whatever checkout is running this test:
        # asserting str(REPO_ROOT) here would pass only in the clone the artifact
        # happened to be written in and fail in any fresh worktree.
        observed_cwd = re.search(r"run from[ \t]+`([^`\n]+)`", section, re.I)
        self.assertIsNotNone(
            observed_cwd,
            "every command records the cwd it ran from: the section must say "
            "'run from `<absolute path>`'",
        )
        recorded = observed_cwd.group(1) if observed_cwd else ""
        self.assertTrue(
            Path(recorded).is_absolute(),
            "the recorded cwd must be an absolute path, not %r" % recorded,
        )

    def test_12_1_g5_equivalence(self) -> None:
        """[12.1-g5-equivalence] the two arms differ only where §4.4 permits."""
        slots = cw.derive_slots(cw.DEFAULT_MAX_READERS)
        router_config = self.tmp / cw.ROUTER_CONFIG_RELPATH

        routed_session = self.session_config(cw.openai_base_url(LISTEN_HOST, LISTEN_PORT))
        direct_session = self.session_config(cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT))
        self.assertEqual(
            differing_paths(routed_session, direct_session),
            ["provider.%s.options.baseURL" % fm.PROVIDER_ID],
        )

        # The upstream server is started identically in both arms, or the
        # comparison is confounded before it begins.
        routed_cmd = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 4096, slots)
        direct_cmd = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 4096, slots)
        self.assertEqual(routed_cmd, direct_cmd)
        self.assertIn("--parallel", direct_cmd)

        routed_env = cw.session_env(
            MODEL_ID,
            self.configs / "opencode.session.json",
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            1234,
            cw.Routing(True, cw.openai_base_url(LISTEN_HOST, LISTEN_PORT), None),
            router_config_path=router_config,
        )
        direct_env = cw.session_env(
            MODEL_ID,
            self.configs / "opencode.session.json",
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            1234,
            cw.Routing(False, cw.openai_base_url(UPSTREAM_HOST, UPSTREAM_PORT), None),
            router_config_path=router_config,
        )
        self.assertEqual(
            sorted(differing_paths(routed_env, direct_env)),
            [
                "LLAMA_HARNESS_ROUTER",
                "LLAMA_HARNESS_ROUTER_CONFIG",
                "LLAMA_HARNESS_ROUTER_URL",
            ],
        )
        self.assertEqual(routed_env["LLAMA_HARNESS_URL"], direct_env["LLAMA_HARNESS_URL"])


if __name__ == "__main__":
    unittest.main()
