"""Task 12.1 — serve.py router wiring (plan:2866-2889).

Every pure function that serve.py and fetch_models.py need in order to launch
llama-router, generate its config, derive one slot count for both sides of the
concurrency contract, and merge the conductor opencode fragment lives in
``scripts/conductor_wiring.py`` so it can be exercised without serving anything.

The whole leg is offline: no server is started, no socket is opened, and nothing
under ``.data/`` or ``.out/`` is written. Filesystem writes go to ``tempfile``
directories; the two committed files this leg *reads* are the exported
RouterConfig schema and ``router/UPSTREAM_CONTRACT.md``, which is where Task
11.1's deferred live measurement is recorded.

``RouterSupervisorExecution`` is the one part that spawns: it runs the real
supervisor source over a fake router binary and a fake session shell, entirely
inside a temp dir, because reading that source as a string proves nothing about
the signals it sends (C-072).

The ``p12-`` sections (fix-phase12-serve) are the other executing parts. They
DRIVE ``serve.main()`` - the ordering the seam-level cases above structurally
cannot see - and they run the supervisor over a router that exits on its own.
They spawn harmless ``time.sleep`` children in place of llama-server, and they
listen on loopback ports the OS hands them, because the three defects they cover
are only observable as a live child process and an occupied port. Nothing they
touch lives outside the per-test temp dir, no llama-server is ever started, and
no port the harness itself uses is bound.

Run as::

    /usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'
"""

from __future__ import annotations

import contextlib
import copy
import http.server
import importlib.util
import inspect
import io
import json
import os
import re
import signal
import socket
import socketserver
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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

            # HEAD emitted `--ctx-size <ctx>` of its own; 12.1 folds that value INTO the
            # derivation (one flag, per-slot semantics) rather than appending beside it.
            head = head_server_command(self.configs, UPSTREAM_HOST, UPSTREAM_PORT, None)
            self.assertNotIn(
                "--parallel", head, "HEAD's serve.py emitted no --parallel; 12.1 adds it"
            )
            self.assertEqual(cmd, head + cw.parallel_server_args(slots, 4096))

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
            cmd,
            head_server_command(self.configs, UPSTREAM_HOST, UPSTREAM_PORT, None)
            + ["--parallel", "1", "--ctx-size", "4096"],
        )

    def test_12_1_ctx_configured_reaches_the_derivation(self) -> None:
        """[12.1-ctx-per-slot-preserved] --ctx is the per-slot window, and it is emitted ONCE.

        llama-server takes the LAST --ctx-size it is handed, so an argv carrying both the
        user's value and the derived one silently discards one of the two intents - and the
        derived one, being a constant times the slot count, makes `--ctx 4096` and
        `--ctx 131072` produce byte-identical argv.
        """
        slots = cw.DEFAULT_MAX_READERS
        self.assertGreater(slots, 1, "the duplicate only appears on the multi-slot path")

        small = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 4096, slots)
        large = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, 131072, slots)

        for cmd in (small, large):
            self.assertEqual(cmd.count("--ctx-size"), 1, cmd)
        self.assertNotEqual(small, large, "the configured context must reach the argv")

        # --ctx-size is the TOTAL context divided among the slots (C-058 F3), so the
        # configured value is the per-slot window and the emitted total is its multiple.
        self.assertEqual(small[small.index("--ctx-size") + 1], str(4096 * slots))
        self.assertEqual(large[large.index("--ctx-size") + 1], str(131072 * slots))

        # No --ctx at all keeps the recorded per-slot default.
        default = serve.build_server_command(MODEL_ID, UPSTREAM_HOST, UPSTREAM_PORT, 1, None, slots)
        self.assertEqual(default.count("--ctx-size"), 1, default)
        self.assertEqual(
            default[default.index("--ctx-size") + 1],
            str(cw.PER_SLOT_CONTEXT_TOKENS * slots),
        )

    def test_12_1_router_port_never_equals_server_port(self) -> None:
        """[12.1-router-config-shape] a router is never configured to proxy to itself.

        resolve_port only asks whether a port can be bound RIGHT NOW, and llama-server has
        not been started when the router's port is chosen, so `--port 8088` hands the same
        free port out twice unless the already-claimed one is excluded.
        """
        host = UPSTREAM_HOST
        server_port = serve.resolve_port(host, 8080, False)
        router_port = serve.resolve_router_port(host, server_port, server_port)
        self.assertNotEqual(
            router_port, server_port, "the router's listen port collided with llama-server's"
        )
        # ...and it is the seam serve.py actually uses for the router's port.
        source = (SCRIPTS_DIR / "serve.py").read_text()
        self.assertIn("router_port = resolve_router_port(host, router_port, port)", source)

        config = cw.generate_router_config(host, router_port, host, server_port, 6, root=self.tmp)
        self.assertNotEqual(
            (config["listen"]["host"], config["listen"]["port"]),
            (config["upstream"]["host"], config["upstream"]["port"]),
            "a router told to proxy to its own listen address: %r" % (config,),
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

    def test_12_1_print_env_reports_the_live_session(self) -> None:
        """[12.1-session-env-router] --print-env REPORTS; it starts nothing and writes nothing.

        Two things this pins. (1) stdout is NAME=value and nothing else - `--print-env` is
        documented "for scripting", and a prose notice on stdout ends up inside the caller's
        `eval`. (2) a session running through a live router reports LLAMA_HARNESS_ROUTER=1;
        forcing the direct answer would make the router half of this row unreachable through
        the very flag that is meant to surface it.
        """
        config_path = self.configs / "opencode.session.json"
        router_config = self.tmp / cw.ROUTER_CONFIG_RELPATH
        decision = cw.Preflight("launch", True, notice="a notice that must not reach stdout")

        out, err = cw.print_env_report(
            MODEL_ID,
            config_path,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            LISTEN_HOST,
            LISTEN_PORT,
            router_config,
            decision,
            probe=lambda host, port: True,
        )
        for line in out:
            self.assertRegex(line, r"^[A-Z][A-Z0-9_]*=", "stdout carried prose: %r" % line)
            self.assertNotIn("\x1b", line, "stdout carried an ANSI escape: %r" % line)
        env = dict(line.split("=", 1) for line in out)
        self.assertEqual(env["LLAMA_HARNESS_ROUTER"], "1")
        self.assertEqual(
            env["LLAMA_HARNESS_ROUTER_URL"], "http://%s:%d" % (LISTEN_HOST, LISTEN_PORT)
        )
        self.assertEqual(env["LLAMA_HARNESS_ROUTER_CONFIG"], str(router_config))
        self.assertEqual(env["LLAMA_HARNESS_URL"], "http://%s:%d" % (UPSTREAM_HOST, UPSTREAM_PORT))
        self.assertNotIn("LLAMA_HARNESS_SERVER_PID", env, "--print-env started no server")
        self.assertIn(decision.notice, "\n".join(err), "the notice belongs on stderr")

        # No router answering: the direct answer, still only NAME=value on stdout.
        down_out, _down_err = cw.print_env_report(
            MODEL_ID,
            config_path,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            LISTEN_HOST,
            LISTEN_PORT,
            router_config,
            decision,
            probe=lambda host, port: False,
        )
        down = dict(line.split("=", 1) for line in down_out)
        self.assertEqual(down["LLAMA_HARNESS_ROUTER"], "0")
        self.assertNotIn("LLAMA_HARNESS_ROUTER_URL", down)

        # A --no-shell preflight is a DECISION about a session serve.py is about to start.
        # --print-env starts none, so it must not manufacture that decision (and its notice,
        # "--no-shell leaves no session shell to supervise a router", would be a lie).
        source = (SCRIPTS_DIR / "serve.py").read_text()
        self.assertNotIn(
            "no_shell=args.no_shell or args.print_env",
            source,
            "--print-env must not fake a --no-shell preflight",
        )


_FAKE_ROUTER = '''#!%(python)s
import os
import signal
import sys
import time

EVENTS = os.path.join(os.getcwd(), "router-events.log")
STUBBORN = %(stubborn)r


def record(line):
    with open(EVENTS, "a") as handle:
        handle.write(line + "\\n")


def on_term(signum, frame):
    record("sigterm")
    if not STUBBORN:
        record("exited-on-sigterm")
        sys.exit(0)


signal.signal(signal.SIGTERM, on_term)
record("argv " + " ".join(sys.argv[1:]))
record("started " + str(os.getpid()))
while True:
    time.sleep(0.05)
'''


def _read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:
        return ""


def _line(path: Path, prefix: str) -> str:
    for line in _read(path).splitlines():
        if line.startswith(prefix):
            return line
    raise AssertionError("no %r line in %s: %r" % (prefix, path, _read(path)))


def _pid_alive(pid: int) -> bool:
    """The same liveness probe the supervisor uses on the session shell."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _wait_until(predicate, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


class RouterSupervisorExecution(WiringTestCase):
    """The supervisor source, EXECUTED.

    ``test_12_1_supervisor_lifecycle`` reads ``cw.ROUTER_SUPERVISOR_SOURCE`` as a
    string, so a supervisor carrying every one of those tokens in a comment while
    signalling nothing would satisfy it (C-062, C-072). These two cases run the
    real source in a real interpreter, against a fake router binary and a fake
    session shell, and assert the signals the router actually receives and the
    reap that follows. Everything - the binary, the shell, the router's event log
    and the supervisor's own ``router.log`` - lives under the per-test temp dir.
    """

    def plant_fake_router(self, root: Path, stubborn: bool) -> Path:
        target = root / "fake-llama-router"
        target.write_text(_FAKE_ROUTER % {"python": sys.executable, "stubborn": stubborn})
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return target

    def reap(self, proc) -> None:
        if proc.poll() is None:
            proc.kill()
        proc.wait()

    def stop_tree(self, supervisor, found: Dict[str, Optional[int]]) -> None:
        """End the supervisor first, then the router.

        The router is a GRANDchild. Killing it while the supervisor still lives
        would only earn it a restart, and killing the supervisor first reparents
        a router the supervisor failed to signal - which is exactly the state a
        red run leaves behind, so both halves are unconditional.
        """
        self.reap(supervisor)
        pid = found.get("router_pid")
        if pid is None:
            return
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            return
        _wait_until(lambda: not _pid_alive(pid), 5.0)

    def start_fake_shell(self):
        """A real process standing in for the session shell, so its pid is a real pid."""
        shell = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
        self.addCleanup(self.reap, shell)
        return shell

    def start_supervisor(self, stubborn: bool):
        root = self.tmp / ("supervisor-stubborn" if stubborn else "supervisor-polite")
        root.mkdir(parents=True)
        binary = self.plant_fake_router(root, stubborn)
        schema = self.plant_schema(root)
        config_path = root / cw.ROUTER_CONFIG_RELPATH
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text("{}\n")

        shell = self.start_fake_shell()
        supervisor = cw.start_router_supervisor(binary, config_path, schema, shell.pid, root)
        found: Dict[str, Optional[int]] = {"router_pid": None}
        self.addCleanup(self.stop_tree, supervisor, found)

        events = root / "router-events.log"
        self.assertTrue(
            _wait_until(lambda: "started " in _read(events), 20.0),
            "the supervisor never spawned the router binary (events: %r)" % _read(events),
        )
        router_pid = int(_line(events, "started ").split()[1])
        found["router_pid"] = router_pid
        self.assertTrue(_pid_alive(router_pid), "the fake router is not running")
        return root, shell, supervisor, events, router_pid

    def test_12_1_supervisor_signals_and_reaps(self) -> None:
        """[12.1-supervisor-signals-executed] the shell dies, the router is SIGTERMed and reaped."""
        root, shell, supervisor, events, router_pid = self.start_supervisor(stubborn=False)

        # The supervisor opens its log under its own cwd, so a wrong cwd shows up here,
        # and the router is launched with exactly the router_supervisor_argv tail.
        self.assertTrue((root / cw.ROUTER_LOG_RELPATH).is_file())
        argv_line = _line(events, "argv ")
        for piece in cw.router_supervisor_argv(
            root / "fake-llama-router", root / cw.ROUTER_CONFIG_RELPATH, self.plant_schema(root)
        )[1:]:
            self.assertIn(piece, argv_line)

        self.reap(shell)
        self.assertTrue(
            _wait_until(lambda: "sigterm" in _read(events), 20.0),
            "the router was never signalled after the session shell died: %r" % _read(events),
        )
        self.assertIn("exited-on-sigterm", _read(events))
        supervisor.wait(timeout=20)
        self.assertEqual(supervisor.returncode, 0)
        self.assertTrue(
            _wait_until(lambda: not _pid_alive(router_pid), 15.0),
            "the router outlived the session shell",
        )

    def test_12_1_readiness_fallback_stops_the_supervisor(self) -> None:
        """[12.1-readiness-fallback-direct] no supervisor is left chasing a router nobody uses.

        The supervisor is started BEFORE readiness is known (it is what brings the router
        up), so the fallback leg has to be able to take it back down. Its session shell is
        still alive here - that is the whole point of the fallback - so nothing else will.
        """
        root, shell, supervisor, events, router_pid = self.start_supervisor(stubborn=False)
        self.assertTrue(_pid_alive(shell.pid), "the session shell survives the fallback")

        fallback = cw.finalize_routing(
            cw.Preflight("launch", True),
            LISTEN_HOST,
            LISTEN_PORT,
            UPSTREAM_HOST,
            UPSTREAM_PORT,
            probe=lambda host, port: False,
        )
        self.assertFalse(fallback.router_enabled)

        cw.stop_router_supervisor(supervisor)

        self.assertTrue(
            _wait_until(lambda: supervisor.poll() is not None, 20.0),
            "the supervisor outlived the session's decision not to use the router",
        )
        self.assertTrue(
            _wait_until(lambda: not _pid_alive(router_pid), 20.0),
            "the router the supervisor started outlived it",
        )

        # And it stays down: nothing respawns behind the session's back.
        spawns = _read(events).count("started ")
        time.sleep(3.0)
        self.assertEqual(
            _read(events).count("started "), spawns, "the supervisor respawned after being stopped"
        )
        self.assertTrue(_pid_alive(shell.pid), "stopping the supervisor must not touch the shell")

    def test_12_1_supervisor_escalates_to_sigkill(self) -> None:
        """[12.1-supervisor-sigkill-executed] a router that ignores SIGTERM is killed after the grace."""
        _root, shell, supervisor, events, router_pid = self.start_supervisor(stubborn=True)

        self.reap(shell)
        began = time.monotonic()
        self.assertTrue(
            _wait_until(lambda: "sigterm" in _read(events), 20.0),
            "the router was never signalled after the session shell died: %r" % _read(events),
        )
        supervisor.wait(timeout=cw.ROUTER_TERM_GRACE_S + 30.0)
        elapsed = time.monotonic() - began
        self.assertEqual(supervisor.returncode, 0)
        # SIGKILL cannot be caught, so the router records nothing for it. What it does
        # record is that it never exited of its own accord - and it is gone regardless.
        self.assertNotIn("exited-on-sigterm", _read(events))
        self.assertTrue(
            _wait_until(lambda: not _pid_alive(router_pid), 15.0),
            "a router that ignores SIGTERM was never killed",
        )
        self.assertGreaterEqual(
            elapsed,
            cw.ROUTER_TERM_GRACE_S - 1.0,
            "SIGKILL landed before the %.1fs grace elapsed (%.1fs)"
            % (cw.ROUTER_TERM_GRACE_S, elapsed),
        )


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


# ---------------------------------------------------------------------------
# fix-phase12-serve — the eight p12- rows.
#
# Every row below is downstream of ONE structural fact the phase-12 gate's
# adjudicator named: no test in either leg executed scripts/serve.py's main().
# The seams under main() are covered above; the defects live in main()'s
# ORDERING, which no seam-level case can reach. So these drive main() itself,
# with the process spawn and the readiness check stubbed and every path pointed
# at a temp dir, and they assert on what the adjudicator measured - a child
# process still alive, a port nothing listens on, prose on stdout - rather than
# on a mock's call count.
# ---------------------------------------------------------------------------


class _ExecvReached(Exception):
    """os.execv never returns, so the stub raises this in its place (serve.py:664)."""


class _PromptCalled(Exception):
    """serve.prompt() was reached. On a tty this is where --print-env blocks."""


class _InjectedWindowFailure(Exception):
    """A failure injected into the readiness -> watchdog window at a third point."""


class _ModuleProxy(object):
    """A module reference with named attributes replaced, everything else forwarded.

    serve.main() reaches the two seams that make it undrivable - the llama-server
    spawn and the exec into bash - through its own module globals
    (``subprocess.Popen``, ``os.execv``). Rebinding ``serve.subprocess`` and
    ``serve.os`` to one of these is therefore a genuine injection point that
    needs no edit to serve.py and no test-only branch inside main() (P12-SG-1):
    production behaviour is identical whether or not anything is stubbed, because
    nothing in serve.py knows these objects can be swapped.
    """

    def __init__(self, wrapped: Any, **overrides: Any) -> None:
        self.__dict__["_wrapped"] = wrapped
        self.__dict__["_overrides"] = dict(overrides)

    def __getattr__(self, name: str) -> Any:
        overrides = self.__dict__["_overrides"]
        if name in overrides:
            return overrides[name]
        return getattr(self.__dict__["_wrapped"], name)


class _FakeStdin(object):
    """stdin that answers isatty() and fails loudly if anything actually reads it."""

    def __init__(self, tty: bool) -> None:
        self.tty = tty
        self.reads = 0

    def isatty(self) -> bool:
        return self.tty

    def _refuse(self, *args: Any, **kwargs: Any) -> Any:
        self.reads += 1
        raise AssertionError(
            "serve.main() read stdin; --print-env must never wait for input"
        )

    read = _refuse
    readline = _refuse
    fileno = _refuse


class _FakeModel(object):
    """Only the attributes serve.py reads off a catalog Model."""

    def __init__(self, model_id: str) -> None:
        self.id = model_id
        self.category = "coding"
        self.embedding = False
        self.reranker = False
        self.reasoning = False


class _Run(object):
    """One serve.main() call: what it returned or raised, and both its streams."""

    def __init__(self, result: Any, raised: Any, stdout: str, stderr: str) -> None:
        self.result = result
        self.raised = raised
        self.stdout = stdout
        self.stderr = stderr

    def __repr__(self) -> str:
        return "<main() result=%r raised=%r stdout=%r stderr=%r>" % (
            self.result,
            self.raised,
            self.stdout,
            self.stderr,
        )


# The same id the committed base config's provider.models is keyed on, so the
# session config serve.py writes is the one a real run would write.
P12_MODEL_A = MODEL_ID
P12_MODEL_B = "p12-second-model"
NAME_VALUE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def free_port(host: str = LISTEN_HOST) -> int:
    """A port the OS says is free, chosen by the OS and handed straight back."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def env_pairs(text: str) -> Dict[str, str]:
    """Only the NAME=value lines, so a value assertion never dies on prose."""
    out: Dict[str, str] = {}
    for line in text.splitlines():
        if NAME_VALUE_RE.match(line):
            name, value = line.split("=", 1)
            out[name] = value
    return out


class _HealthServer(http.server.HTTPServer):
    """HTTPServer without the reverse-DNS lookup its server_bind does by default.

    socket.getfqdn() on a loopback address is a network round trip that also
    triggers a lazy ``encodings.idna`` import, and neither belongs in an offline
    test leg that has already forked children.
    """

    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        self.server_name = LISTEN_HOST
        self.server_port = int(self.server_address[1])


class _HealthHandler(http.server.BaseHTTPRequestHandler):
    """A live router, reduced to the one thing --print-env asks it."""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler's name
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        return


class ServeMainCase(WiringTestCase):
    """serve.main(), DRIVEN — the harness the three MAJORs need.

    The adjudicator's leak.py proved this is cheap: stub the spawn and the
    readiness check, point every config path at a temp dir, and run it. The spawn
    stub launches a REAL, harmless child (``time.sleep``) rather than a mock,
    because the orphan rows are measured on that child's liveness after main()
    returns - a mock would happily report a cleanup that does not work.
    """

    def setUp(self) -> None:
        WiringTestCase.setUp(self)
        self.spawned: List[Dict[str, Any]] = []
        self.readiness: List[Tuple[str, int]] = []
        self.watchdogs: List[Tuple[int, int]] = []
        self.execs: List[Tuple[str, List[str]]] = []
        self.prompts: List[str] = []
        self.stdin = _FakeStdin(False)

        self.patch_attr(serve, "SESSION_FILE", self.configs / "serve-session.json")
        self.patch_attr(serve, "prompt", self._prompt)
        self.patch_attr(serve, "wait_until_ready", self._wait_until_ready)
        self.patch_attr(serve, "start_watchdog", self._start_watchdog)
        self.patch_attr(serve, "subprocess", _ModuleProxy(subprocess, Popen=self._popen))
        self.patch_attr(serve, "os", _ModuleProxy(os, execv=self._execv))
        self.patch_attr(sys, "stdin", self.stdin)
        self.drop_env(cw.ROUTER_BINARY_ENV)

    def patch_attr(self, target: Any, name: str, value: Any) -> None:
        previous = getattr(target, name)
        setattr(target, name, value)
        self.addCleanup(setattr, target, name, previous)

    def drop_env(self, name: str) -> None:
        if name in os.environ:
            previous = os.environ.pop(name)
            self.addCleanup(os.environ.__setitem__, name, previous)

    def _prompt(self, question: str, default: Optional[str] = None) -> str:
        self.prompts.append(question)
        raise _PromptCalled(question)

    def _wait_until_ready(self, host: str, port: int, proc: Any, timeout: int = 600) -> bool:
        self.readiness.append((host, int(port)))
        return True

    def _start_watchdog(self, shell_pid: int, server_pid: int) -> None:
        self.watchdogs.append((int(shell_pid), int(server_pid)))

    def _execv(self, path: str, argv: List[str]) -> None:
        self.execs.append((str(path), list(argv)))
        raise _ExecvReached(str(path))

    def _popen(self, cmd: List[str], **kwargs: Any) -> Any:
        """llama-server's spawn, standing in a real child that holds no model."""
        handle = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(600)"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
        self.spawned.append({"argv": list(cmd), "handle": handle})
        self.addCleanup(self.kill_child, handle)
        return handle

    def kill_child(self, handle: Any) -> None:
        try:
            if handle.poll() is None:
                handle.kill()
        except OSError:
            pass
        try:
            handle.wait(timeout=10)
        except Exception as exc:  # an already-reaped child is the wanted outcome
            del exc

    def install_models(self) -> None:
        entries = [
            (_FakeModel(P12_MODEL_A), {"total_bytes": 1, "quant": "Q4_K_M"}),
            (_FakeModel(P12_MODEL_B), {"total_bytes": 2, "quant": "Q4_K_M"}),
        ]
        self.patch_attr(fm, "installed_models", lambda: list(entries))

    def write_session(self, **values: Any) -> None:
        serve.SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        serve.SESSION_FILE.write_text(json.dumps(values, indent=2) + "\n")

    def drive_main(self, argv: List[str]) -> _Run:
        out = io.StringIO()
        err = io.StringIO()
        result: Any = None
        raised: Any = None
        with contextlib.redirect_stdout(out):
            with contextlib.redirect_stderr(err):
                try:
                    result = serve.main(list(argv))
                except BaseException as exc:  # SystemExit is one of the measured legs
                    raised = exc
        return _Run(result, raised, out.getvalue(), err.getvalue())

    def last_child(self) -> Any:
        self.assertTrue(self.spawned, "serve.main() never reached the llama-server spawn")
        return self.spawned[-1]["handle"]

    def assert_child_reaped(self, handle: Any, where: str) -> None:
        """The measurement the adjudicator made: is the llama-server child still alive?"""
        pid = int(handle.pid)
        reaped = _wait_until(lambda: handle.poll() is not None, 6.0)
        self.assertTrue(
            reaped,
            "%s: the llama-server child (pid %d) is STILL RUNNING after main() returned - "
            "a 20+GB model and its port are orphaned with nothing left owning them" % (where, pid),
        )
        self.assertFalse(
            _pid_alive(pid),
            "%s: pid %d still exists after main() returned" % (where, pid),
        )

    def occupy_port(self) -> int:
        """A listening socket on an OS-chosen loopback port, closed with the test."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((LISTEN_HOST, 0))
        sock.listen(8)
        self.addCleanup(sock.close)
        return int(sock.getsockname()[1])

    def start_router_health(self) -> int:
        """A live router: something that answers 200 on /conductor/health."""
        server = _HealthServer((LISTEN_HOST, 0), _HealthHandler)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05})
        thread.daemon = True
        self.addCleanup(thread.join, 10)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        thread.start()
        return int(server.server_address[1])

    def plant_router_under_temp_root(self) -> Path:
        """A router binary and schema under a THROWAWAY root, so preflight says launch."""
        root = self.tmp / "repo"
        root.mkdir(parents=True, exist_ok=True)
        self.plant_router_binary(root, ".out/build/clang-relwdebinfo/llama-router")
        self.plant_schema(root)
        self.patch_attr(serve, "REPO_ROOT", root)
        return root

    def start_live_session(self) -> Tuple[int, int]:
        """The state the adjudicator measured: both configured ports already in use.

        llama-server's port is held by a listener and the router's port answers
        /conductor/health, which is exactly what a serve.py session that is
        already running looks like to a second invocation.
        """
        server_port = self.occupy_port()
        router_port = self.start_router_health()
        self.install_models()
        self.plant_router_under_temp_root()
        self.write_session(
            model=P12_MODEL_A,
            host=LISTEN_HOST,
            port=server_port,
            router_port=router_port,
            models_max=1,
            max_readers=cw.DEFAULT_MAX_READERS,
        )
        return server_port, router_port


class ServeMainDriven(ServeMainCase):
    def test_p12_main_is_driven_at_all(self) -> None:
        """[p12-main-is-driven-at-all] main() is EXECUTED, past readiness, by the leg.

        The parent finding: five of phase 12's ten trace to no test ever running
        this function. Asserted on what main() leaves behind past the readiness
        check - the session opencode config, the rcfile naming the child's pid,
        the exec into bash - not on having imported serve.py and called a helper.
        """
        self.install_models()
        self.write_base_config()
        port = free_port()

        run = self.drive_main(
            [P12_MODEL_A, "--no-build-check", "--no-router", "--port", str(port)]
        )

        self.assertIsInstance(
            run.raised,
            _ExecvReached,
            "main() never reached the exec at serve.py:664: %r" % (run,),
        )
        self.assertEqual(len(self.spawned), 1, "exactly one llama-server spawn")
        argv = self.spawned[0]["argv"]
        self.assertTrue(str(argv[0]).endswith("llama-server"), argv)
        self.assertIn(str(port), argv)
        self.assertEqual(
            self.readiness,
            [(fm.DEFAULT_HOST, port)],
            "the readiness check is the gate main()'s post-readiness path is behind",
        )

        child = self.spawned[0]["handle"]
        self.assertEqual(
            self.watchdogs,
            [(os.getpid(), child.pid)],
            "start_watchdog (serve.py:663) closes the window every orphan row is about",
        )

        written = json.loads(Path(serve.SESSION_OPENCODE).read_text())
        provider = written["provider"][fm.PROVIDER_ID]
        self.assertEqual(
            provider["options"]["baseURL"], "http://%s:%d/v1" % (fm.DEFAULT_HOST, port)
        )
        self.assertEqual(written["model"], "%s/%s" % (fm.PROVIDER_ID, P12_MODEL_A))

        rc = self.configs / "session.bashrc"
        self.assertTrue(rc.is_file(), "no session rcfile was written")
        self.assertIn(str(child.pid), rc.read_text(), "the rcfile's trap names the child")
        exec_path, exec_argv = self.execs[0]
        self.assertTrue(exec_path.endswith("bash"), exec_path)
        self.assertEqual(exec_argv[1:], ["--rcfile", str(rc), "-i"])

        # The happy path leaves the model RUNNING: the orphan rows below must be
        # satisfied by reaping on failure, never by reaping always.
        self.assertIsNone(child.poll(), "a successful session must leave llama-server up")

    def test_p12_no_orphan_between_readiness_and_watchdog(self) -> None:
        """[p12-no-orphan-between-readiness-and-watchdog] both measured legs, on the child.

        Between wait_until_ready succeeding (serve.py:610) and start_watchdog
        (serve.py:663) there is no try/finally, and Task 12.1 put three raise
        sites in that window. Measured the way the adjudicator measured it: the
        llama-server child's liveness after main() returned, not a cleanup call.
        """
        self.install_models()

        # Leg (a): no base opencode config -> SystemExit out of
        # write_session_opencode_config (serve.py:231), called at serve.py:650.
        run_a = self.drive_main(
            [P12_MODEL_A, "--no-build-check", "--no-router", "--port", str(free_port())]
        )
        self.assertIsInstance(
            run_a.raised, SystemExit, "leg (a) did not raise where it was measured: %r" % (run_a,)
        )
        self.assertEqual(self.watchdogs, [], "leg (a) must fail INSIDE the window")
        self.assert_child_reaped(self.last_child(), "leg (a): missing base opencode config")

        # Leg (b): the conductor fragment is missing -> an uncaught WiringError out
        # of apply_conductor_wiring, the raise assertion 12.1-file-refs-exist added.
        self.write_base_config()
        fragmentless = self.tmp / "fragmentless-root"
        fragmentless.mkdir(parents=True, exist_ok=True)
        self.patch_attr(serve, "REPO_ROOT", fragmentless)

        run_b = self.drive_main(
            [P12_MODEL_A, "--no-build-check", "--no-router", "--port", str(free_port())]
        )
        self.assertIsInstance(
            run_b.raised,
            cw.WiringError,
            "leg (b) did not raise where it was measured: %r" % (run_b,),
        )
        self.assertEqual(self.watchdogs, [], "leg (b) must fail INSIDE the window")
        self.assertEqual(len(self.spawned), 2, "each leg spawns its own llama-server")
        self.assert_child_reaped(self.last_child(), "leg (b): missing conductor fragment")

    def test_p12_orphan_guard_covers_the_whole_window(self) -> None:
        """[p12-orphan-guard-covers-the-whole-window] a THIRD raise site is reaped too.

        A two-patch fix - one try/except around write_session_opencode_config,
        another around apply_conductor_wiring - satisfies the two measured legs
        and re-opens the leak the moment a fourth raise site appears. So the
        failure here is injected at make_rcfile (serve.py:662), the LAST step
        before start_watchdog and neither measured leg: only a guard covering the
        whole window reaps this one.
        """
        self.install_models()
        self.write_base_config()

        def exploding_rcfile(model_id: str, env: Dict[str, str], server_pid: int, log_path: Path) -> Path:
            raise _InjectedWindowFailure("injected at serve.py:662, inside the window")

        self.patch_attr(serve, "make_rcfile", exploding_rcfile)

        run = self.drive_main(
            [P12_MODEL_A, "--no-build-check", "--no-router", "--port", str(free_port())]
        )

        self.assertIsInstance(
            run.raised,
            _InjectedWindowFailure,
            "the injection did not reach the window: %r" % (run,),
        )
        self.assertEqual(self.watchdogs, [], "the injection must land before start_watchdog")
        self.assertEqual(self.execs, [], "the injection must land before the exec")
        self.assert_child_reaped(
            self.last_child(), "a third raise site in the window (serve.py:662)"
        )


class ServeMainPrintEnv(ServeMainCase):
    """--print-env, driven through main() with both configured ports already in use.

    print_env_report itself is covered above and is not the defect: main() runs
    the socket-binding, sometimes-interactive port resolution at serve.py:526 and
    :551, BEFORE the early return at :552, and info() at serve.py:72 is a bare
    print() to stdout. The measured result was four prose lines on stdout, a URL
    naming a port nothing listens on, LLAMA_HARNESS_ROUTER=0 and an empty stderr.
    """

    def test_p12_print_env_stdout_is_only_name_value(self) -> None:
        """[p12-print-env-stdout-is-only-name-value] `eval "$(serve.py --print-env)"` is safe.

        The block's own comment at serve.py:553-556 already claims this: "every
        diagnostic goes to stderr so stdout stays NAME=value". With the configured
        ports in use, stdout carried "port %d is already in use" and "  using %d
        instead" - and the caller's eval runs them, dying with `port: command not
        found` before exporting anything.
        """
        self.start_live_session()
        self.stdin.tty = False

        run = self.drive_main([P12_MODEL_A, "--print-env", "--no-build-check"])

        self.assertIsNone(run.raised, "--print-env raised: %r" % (run,))
        self.assertEqual(run.result, 0)
        for line in run.stdout.splitlines():
            if not line.strip():
                continue
            self.assertRegex(
                line,
                NAME_VALUE_RE,
                "--print-env wrote prose to stdout, so the caller's eval runs it as a "
                "command: %r (stderr was %r)" % (line, run.stderr),
            )
            self.assertNotIn("\x1b", line, "stdout carried an ANSI escape: %r" % line)
        env = env_pairs(run.stdout)
        self.assertIn("LLAMA_HARNESS_URL", env, "stdout carried no session env at all")
        self.assertIn("OPENCODE_CONFIG", env)

    def test_p12_print_env_reports_the_live_session(self) -> None:
        """[p12-print-env-reports-the-live-session] the ports the session IS on.

        The row's own promise. Taking the early return before resolve_port would
        satisfy the stdout row while still reporting numbers nothing is listening
        on; a --print-env that picks NEW free ports has failed at its one job
        (P12-SG-2). Here llama-server's port is held by a listener and the router
        port answers /conductor/health, so both live answers are checkable.
        """
        server_port, router_port = self.start_live_session()
        self.stdin.tty = False

        run = self.drive_main([P12_MODEL_A, "--print-env", "--no-build-check"])

        self.assertIsNone(run.raised, "--print-env raised: %r" % (run,))
        env = env_pairs(run.stdout)
        self.assertEqual(
            env.get("LLAMA_HARNESS_URL"),
            "http://%s:%d" % (LISTEN_HOST, server_port),
            "--print-env reported a port the session is not on; the live session is on %d "
            "(stdout %r)" % (server_port, run.stdout),
        )
        # Not an inference: the reported port answers a connection right now.
        reported = int(env["LLAMA_HARNESS_URL"].rsplit(":", 1)[1])
        connection = socket.create_connection((LISTEN_HOST, reported), timeout=5)
        connection.close()

        self.assertEqual(
            env.get("LLAMA_HARNESS_ROUTER"),
            "1",
            "a session running through a live router must report ROUTER=1 (stdout %r)"
            % run.stdout,
        )
        self.assertEqual(
            env.get("LLAMA_HARNESS_ROUTER_URL"), "http://%s:%d" % (LISTEN_HOST, router_port)
        )

    def test_p12_print_env_never_prompts(self) -> None:
        """[p12-print-env-never-prompts] the worst shape: an invisible block on a tty.

        On a tty the pre-fix path reaches prompt("Port to use instead") at
        serve.py:198 from INSIDE the caller's command substitution, so the
        operator sees no output, no error and no prompt - just a hang. Driven with
        a stdin that fails loudly if read and a prompt seam that raises if called.
        """
        self.start_live_session()
        self.stdin.tty = True

        run = self.drive_main([P12_MODEL_A, "--print-env", "--no-build-check"])

        self.assertEqual(
            self.prompts,
            [],
            "--print-env asked %r - inside `eval \"$(...)\"` that is an invisible hang"
            % (self.prompts[:1],),
        )
        self.assertEqual(self.stdin.reads, 0, "--print-env read stdin")
        self.assertIsNone(run.raised, "--print-env raised: %r" % (run,))
        self.assertEqual(run.result, 0)

    def test_p12b_print_env_without_a_model_refuses_loudly(self) -> None:
        """[p12b-print-env-without-a-model-refuses-loudly] C-087's behaviour change, pinned.

        The second door into the same defect the port resolution already closed.
        With no model in argv and none in the saved session, the pre-C-087 path
        called choose_model, which writes its whole list to STDOUT with info()
        and then blocks on "Select a model by number" - inside
        `eval "$(serve.py --print-env)"` that is the caller evaluating a model
        list and then hanging with nothing on screen. A reporting flag has one
        honest answer to "there is nothing to report": say so on stderr and exit
        non-zero. Driven on a tty, where the picker's block is at its worst, and
        with two models installed so nothing can be inferred.
        """
        self.install_models()
        self.plant_router_under_temp_root()
        self.stdin.tty = True
        port = free_port()

        for label, prepare in (
            ("no session file at all", lambda: None),
            (
                "a session that records no model",
                lambda: self.write_session(
                    host=LISTEN_HOST, port=port, router_port=free_port(), models_max=1
                ),
            ),
        ):
            prepare()
            self.prompts = []
            self.stdin.reads = 0

            run = self.drive_main(["--print-env", "--no-build-check", "--port", str(port)])

            # (1) NEVER the picker. Both of its symptoms, separately: the prompt
            #     seam was not reached, and stdin was not read.
            self.assertEqual(
                self.prompts,
                [],
                "%s: --print-env opened the interactive picker (%r) - inside "
                'eval "$(...)" that is an invisible hang' % (label, self.prompts[:1]),
            )
            self.assertEqual(self.stdin.reads, 0, "%s: --print-env read stdin" % label)

            # (2) NOTHING on stdout. choose_model's list goes there through info(),
            #     and the caller's eval would run every line of it.
            self.assertEqual(
                run.stdout,
                "",
                "%s: --print-env wrote %r to stdout with no session to report; the "
                "caller's eval runs it" % (label, run.stdout),
            )

            # (3) A non-zero exit carrying a message. SystemExit's contract: a code
            #     that is neither None nor 0 is a non-zero exit, and a STRING code is
            #     written to stderr by the interpreter before it exits 1.
            self.assertIsInstance(
                run.raised,
                SystemExit,
                "%s: --print-env did not exit; it returned %r" % (label, run.result),
            )
            code = run.raised.code
            self.assertIsInstance(
                code, str, "%s: the exit code must be the stderr message, got %r" % (label, code)
            )
            self.assertNotEqual(code, "", "%s: exited with an empty message" % label)
            self.assertNotIn(code, (None, 0), "%s: --print-env exited zero" % label)
            self.assertIn(
                "--print-env",
                code,
                "%s: the error must name the flag that refused: %r" % (label, code),
            )
            self.assertTrue(
                "model" in code.lower(),
                "%s: the error must name what it could not report: %r" % (label, code),
            )

            # (4) It reported nothing and started nothing.
            self.assertEqual(self.spawned, [], "%s: --print-env spawned a server" % label)
            self.assertEqual(self.execs, [], "%s: --print-env exec'd a shell" % label)

        # The contrast, so the refusal above is about the MISSING model and not
        # about --print-env being broken: name a model in argv and the same
        # invocation reports normally and exits 0.
        run_ok = self.drive_main(
            [P12_MODEL_A, "--print-env", "--no-build-check", "--port", str(port)]
        )
        self.assertIsNone(run_ok.raised, "--print-env with a named model raised: %r" % (run_ok,))
        self.assertEqual(run_ok.result, 0)
        self.assertEqual(
            env_pairs(run_ok.stdout).get("LLAMA_HARNESS_MODEL"),
            P12_MODEL_A,
            "the contrast leg must actually report a session: %r" % run_ok.stdout,
        )
        self.assertEqual(self.prompts, [], "the contrast leg must not prompt either")


_EXITING_ROUTER = '''#!%(python)s
import os
import sys
import time

EVENTS = os.path.join(os.getcwd(), "router-events.log")
with open(EVENTS, "a") as handle:
    handle.write("started %%.6f %%d\\n" %% (time.time(), os.getpid()))
sys.stderr.write(%(message)r)
sys.stderr.flush()
sys.exit(%(code)d)
'''

MUTANT_DELAY_MS = 2500
MUTANT_FATAL_CODE = 1


def starts_of(events: Path) -> List[float]:
    """The timestamp of every launch the fake router recorded."""
    out: List[float] = []
    for line in _read(events).splitlines():
        if line.startswith("started "):
            out.append(float(line.split()[1]))
    return out


def inject_after_def(source: str, name: str, statement: str) -> Optional[str]:
    """Put ``statement`` first in ``name``'s body, whatever its signature says."""
    marker = "\ndef %s(" % name
    at = source.find(marker)
    if at == -1:
        return None
    end = source.find(":\n", at)
    if end == -1:
        return None
    return source[: end + 2] + statement + source[end + 2 :]


class RouterRestartPolicyExecution(WiringTestCase):
    """The supervisor's RESTART branch, executed against a router that exits itself.

    All three executed supervisor cases above kill the session shell first, so
    the router never exits while the shell lives and the restart branch has never
    run. Everything here - the fake router, the session shell, the supervisor's
    own router.log - lives under the per-test temp dir, and the fake router is a
    python script that exits with a chosen code, so no real router is involved.
    """

    def reap(self, proc: Any) -> None:
        if proc.poll() is None:
            proc.kill()
        proc.wait()

    def plant_exiting_router(self, root: Path, code: int, message: str) -> Path:
        target = root / "fake-llama-router"
        target.write_text(
            _EXITING_ROUTER % {"python": sys.executable, "code": code, "message": message}
        )
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
        return target

    def shut_down(self, shell: Any, supervisor: Any) -> None:
        """The shell first: the supervisor is meant to end with it, and then reaps."""
        self.reap(shell)
        _wait_until(lambda: supervisor.poll() is not None, 15.0)
        self.reap(supervisor)

    def launch(self, module: Any, name: str, code: int, message: str) -> Tuple[Path, Path, Any, Any]:
        root = self.tmp / name
        root.mkdir(parents=True, exist_ok=True)
        binary = self.plant_exiting_router(root, code, message)
        schema = self.plant_schema(root)
        config_path = root / cw.ROUTER_CONFIG_RELPATH
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text("{}\n")

        shell = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
        supervisor = module.start_router_supervisor(binary, config_path, schema, shell.pid, root)
        self.addCleanup(self.shut_down, shell, supervisor)

        events = root / "router-events.log"
        self.assertTrue(
            _wait_until(lambda: "started " in _read(events), 20.0),
            "the supervisor never spawned the router binary under %s" % root,
        )
        return root, events, supervisor, shell

    def load_mutant(self) -> Any:
        """scripts/conductor_wiring.py with its PURE policy functions mutated.

        The copy keeps the scripts/<file> layout so anything the supervisor
        derives from ``__file__`` resolves inside the temp tree rather than back
        into the real module. Whether the shipped supervisor imports the policy
        or is generated from it (P12-SG-3), one edit to these functions has to
        move it; a hand-kept second copy cannot follow.
        """
        source = (SCRIPTS_DIR / "conductor_wiring.py").read_text()
        mutated = inject_after_def(
            source, "restart_delay_ms", "    return %d\n" % MUTANT_DELAY_MS
        )
        self.assertIsNotNone(
            mutated, "restart_delay_ms is not defined in scripts/conductor_wiring.py"
        )
        mutated = inject_after_def(
            mutated,
            "router_restart_decision",
            "    if int(exit_code) == %d:\n"
            "        return RestartVerdict(False, True, 'mutant policy: fatal')\n"
            % MUTANT_FATAL_CODE,
        )
        self.assertIsNotNone(
            mutated,
            "router_restart_decision(exit_code, ...) is not defined in "
            "scripts/conductor_wiring.py; the mutation harness needs its parameter name",
        )

        path = self.tmp / "mutant" / "scripts" / "conductor_wiring.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(mutated)
        spec = importlib.util.spec_from_file_location("conductor_wiring_p12_mutant", str(path))
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        self.addCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(module)

        # The mutation harness itself, checked before anything is concluded from it.
        self.assertEqual(module.restart_delay_ms(1), MUTANT_DELAY_MS)
        self.assertFalse(module.router_restart_decision(MUTANT_FATAL_CODE, "").restart)
        return module

    def test_p12_supervisor_restart_branch_is_executed(self) -> None:
        """[p12-supervisor-restart-branch-is-executed] both directions, executed.

        A retryable exit restarts after the backoff; a C-041 exit 3 does not
        restart, ends the supervisor with the session shell still alive, and
        leaves both the router's own stderr line naming the broken field AND the
        policy's reason for giving up in the log the operator reads.
        """
        self.assertTrue(
            cw.router_restart_decision(1, "").restart, "exit 1 is retryable under C-041"
        )
        _root, events, supervisor, shell = self.launch(
            cw, "restart-retryable", 1, "llama-router: upstream connection reset\n"
        )
        self.assertTrue(
            _wait_until(lambda: len(starts_of(events)) >= 2, 25.0),
            "the supervisor never restarted a retryable exit 1 while the session shell "
            "was alive: %r" % _read(events),
        )
        starts = starts_of(events)
        self.assertGreaterEqual(
            starts[1] - starts[0],
            cw.BACKOFF_BASE_MS / 1000.0 - 0.1,
            "the restart came back in %.2fs, faster than the %dms the policy's first "
            "backoff is" % (starts[1] - starts[0], cw.BACKOFF_BASE_MS),
        )
        self.assertTrue(_pid_alive(shell.pid), "the session shell outlives the restart")
        self.assertIsNone(supervisor.poll(), "the supervisor keeps supervising after a restart")

        fatal = cw.router_restart_decision(3, "")
        self.assertFalse(fatal.restart, "exit 3 is C-041's ConfigError")
        self.assertTrue(fatal.fatal)
        broken = "ConfigError: admission.maxInflightPerModel must be >= 1\n"
        root3, events3, supervisor3, shell3 = self.launch(cw, "restart-fatal", 3, broken)
        self.assertFalse(
            _wait_until(lambda: len(starts_of(events3)) >= 2, 6.0),
            "a C-041 exit 3 was RESTARTED - the spin that buries the one line naming the "
            "broken field: %r" % _read(events3),
        )
        self.assertTrue(
            _wait_until(lambda: supervisor3.poll() is not None, 20.0),
            "the supervisor never gave up on a fatal exit, with the shell still alive",
        )
        self.assertTrue(_pid_alive(shell3.pid), "it stopped on its own, not with the shell")

        log = _read(root3 / cw.ROUTER_LOG_RELPATH)
        self.assertIn(
            broken.strip(), log, "the router's own line naming the broken field is not visible"
        )
        self.assertIn(
            cw.FATAL_EXIT_REASONS[3],
            log,
            "the supervisor's record of giving up carries only the exit number; the "
            "policy's reason for it never reaches the operator, because the decision was "
            "not the policy's (MAJOR 2). log was: %r" % log,
        )

    def test_p12_supervisor_uses_the_policy_functions(self) -> None:
        """[p12-supervisor-uses-the-policy-functions] one edit moves the shipped supervisor.

        ROUTER_SUPERVISOR_SOURCE carries its own `delay_ms` and `if code == 0 or
        code in FATAL:` while router_restart_decision, backoff_next and
        restart_delay_ms have no callers at all. Reading the source for tokens
        cannot tell a single-sourced supervisor from a duplicate, so this mutates
        the PURE FUNCTIONS in a throwaway copy of the module and runs THAT copy's
        supervisor: the restart it makes and the delay it waits must follow the
        mutation. The three mutations the adjudicator measured - `if True:`,
        `if code == 0:` and `delay_ms -> return 0` - each break one of the two
        legs below.
        """
        module = self.load_mutant()

        # (1) The delay: the mutated restart_delay_ms is what the supervisor waits.
        _root, events, _supervisor, _shell = self.launch(
            module, "mutant-delay", 5, "transient\n"
        )
        self.assertTrue(
            _wait_until(lambda: len(starts_of(events)) >= 2, 30.0),
            "the supervisor never restarted a retryable exit 5: %r" % _read(events),
        )
        starts = starts_of(events)
        self.assertGreaterEqual(
            starts[1] - starts[0],
            MUTANT_DELAY_MS / 1000.0 - 0.3,
            "the supervisor waited %.2fs after an edit that makes restart_delay_ms() "
            "return %dms - its backoff is a second copy of the policy, so the two can "
            "drift with nothing to catch it" % (starts[1] - starts[0], MUTANT_DELAY_MS),
        )

        # (2) The decision: the mutated router_restart_decision is what it obeys.
        self.assertTrue(
            cw.router_restart_decision(MUTANT_FATAL_CODE, "").restart,
            "exit %d is retryable under the SHIPPED policy; only the mutant calls it fatal"
            % MUTANT_FATAL_CODE,
        )
        _root2, events2, supervisor2, shell2 = self.launch(
            module, "mutant-decision", MUTANT_FATAL_CODE, "mutant\n"
        )
        self.assertFalse(
            _wait_until(lambda: len(starts_of(events2)) >= 2, 6.0),
            "the supervisor restarted an exit the mutated router_restart_decision() calls "
            "FATAL - its restart test is a second copy of the policy (MAJOR 2): %r"
            % _read(events2),
        )
        self.assertTrue(
            _wait_until(lambda: supervisor2.poll() is not None, 20.0),
            "the supervisor never gave up on what the policy now calls fatal",
        )
        self.assertTrue(_pid_alive(shell2.pid), "it stopped on its own, not with the shell")
