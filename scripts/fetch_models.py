#!/usr/bin/env python3
"""Download, assemble and validate local GGUF models, then wire them into opencode.

This script is dependency-free: standard library only, Python 3.9+.  There is
nothing to pip install and no virtualenv to activate.

What it does
------------
1. Resolves a catalog entry (repo + quant) against the live HuggingFace file
   tree, so shard layouts and file names are never hard-coded.
2. Downloads every shard with resumable, multi-connection range requests into
   ``.data/models/<model-id>/``.
3. Validates each file: exact byte size, SHA-256 against the LFS oid published
   by HuggingFace, GGUF magic/version, and shard-count consistency read out of
   the GGUF metadata itself.
4. Regenerates ``.data/configs/`` so opencode can talk to every installed model
   through a single llama.cpp router server.

Everything generated lives under the single gitignored ``.data/`` folder::

    .data/
      models/<model-id>/   weights + .manifest.json
      configs/             opencode.json, llama-models.ini, benchmark.json
      scripts/             generated python (serve.py)
      tools/               llama-* binaries built from the pinned submodule
      benchmark/           benchmark results

Quick start
-----------
    scripts/fetch_models.py list                  # what is available, and what fits
    scripts/fetch_models.py install ornith-35b    # download + validate + reconfigure
    scripts/fetch_models.py serve                 # start the llama.cpp router
    OPENCODE_CONFIG=$PWD/.data/configs/opencode.json opencode

Serving model
-------------
All installed models are served by ONE ``llama-server`` process running in
router mode.  It reads ``.data/configs/llama-models.ini``, exposes every model at
``/v1/models``, and loads/unloads weights on demand as requests arrive.  Because
``--models-max`` defaults to 1 here, switching models in the opencode TUI
transparently swaps which weights are resident - important when a single model
can occupy 30 GB+ of a 64 GB machine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import conductor_wiring as cw  # noqa: E402
import models_catalog as catalog  # noqa: E402
import ui  # noqa: E402
from models_catalog import CATEGORIES, Model  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
# Everything this script generates lives under one gitignored top-level folder,
# so the whole working set can be inspected - or deleted - in one place.
DATA_DIR = REPO_ROOT / ".data"
MODELS_DIR = DATA_DIR / "models"
CONFIGS_DIR = DATA_DIR / "configs"
TOOLS_DIR = DATA_DIR / "tools"
SCRIPTS_DIR = DATA_DIR / "scripts"
BENCH_DIR = DATA_DIR / "benchmark"

LLAMA_SRC = REPO_ROOT / "extern" / "llama-cpp"
BUILD_DIR = DATA_DIR / "build"
BUILD_STAMP = TOOLS_DIR / ".build-stamp.json"

# Every binary the harness or the benchmark needs, all built from the pinned
# submodule so tool and library versions can never drift apart.
BUILD_TARGETS = [
    "llama-server",  # the router opencode talks to
    "llama-bench",  # throughput / latency matrix
    "llama-perplexity",  # objective quality vs quantization
    "llama-cli",  # one-shot generation for task suites
    "llama-mtmd-cli",  # multimodal (vision) generation
    "llama-tts",  # audio generation
    "llama-batched-bench",
    "llama-tokenize",  # exact token accounting
    "llama-quantize",
]

CMAKE_FLAGS = [
    "-DCMAKE_BUILD_TYPE=Release",
    "-DGGML_METAL=ON",
    "-DLLAMA_BUILD_SERVER=ON",
    "-DLLAMA_BUILD_TESTS=OFF",
    "-DLLAMA_BUILD_EXAMPLES=OFF",
    "-DLLAMA_CURL=OFF",
]

HF_ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

USER_AGENT = "llama-harness-fetch-models/1.0"
MANIFEST_NAME = ".manifest.json"
MANIFEST_VERSION = 1

DEFAULT_PORT = 8080
DEFAULT_HOST = "127.0.0.1"
PROVIDER_ID = "llamacpp"

CHUNK_SIZE = 32 * 1024 * 1024  # range-request granularity
GB = 1_000_000_000

# Files that must never be mistaken for a quant of the main model.
_EXCLUDE_RE = re.compile(r"(^|/)(mmproj|mtp)[-_.]|(^|/)mtp/", re.IGNORECASE)
_SHARD_RE = re.compile(r"-(\d{5})-of-(\d{5})\.gguf$", re.IGNORECASE)


_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str, text: str) -> str:
    return "\033[%sm%s\033[0m" % (code, text) if _COLOR else text


def bold(t: str) -> str:
    return _c("1", t)


def dim(t: str) -> str:
    return _c("2", t)


def green(t: str) -> str:
    return _c("32", t)


def yellow(t: str) -> str:
    return _c("33", t)


def red(t: str) -> str:
    return _c("31", t)


def cyan(t: str) -> str:
    return _c("36", t)


def info(msg: str = "", wrap: bool = False, hang: Optional[int] = None) -> None:
    """One console line, truncated to the terminal width by default.

    Keeps one record per line when the window is narrow, which is far easier to
    scan than a reflowed block, and re-reads the width so a resize takes effect
    on the next line rather than the next run.

    With `wrap`, continuation lines are indented to the column where this line's
    text began so a wrapped item still reads as one item; `hang` overrides that
    column for "label: value" lines that should continue under the value.
    """
    if not wrap:
        print(ui.fit(msg), flush=True)
        return

    for line in ui.wrap_lines(msg, hang=hang):
        print(line, flush=True)


def warn(msg: str) -> None:
    print(ui.fit(yellow("warning: ") + msg), file=sys.stderr, flush=True)


def die(msg: str) -> "None":
    raise SystemExit(red("error: ") + msg)


def human(n_bytes: float) -> str:
    return "%.2f GB" % (n_bytes / GB)


@dataclass
class HostBudget:
    total_ram_gb: float
    vram_budget_gb: float
    source: str

    @property
    def headroom_gb(self) -> float:
        """Reserve for KV cache, compute buffers and the rest of the OS."""
        return max(6.0, self.vram_budget_gb * 0.18)

    @property
    def comfortable_gb(self) -> float:
        return self.vram_budget_gb - self.headroom_gb


def _sysctl(key: str) -> Optional[str]:
    try:
        out = subprocess.run(["sysctl", "-n", key], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None

    return out.stdout.strip() if out.returncode == 0 else None


def detect_budget(override_gb: Optional[float] = None) -> HostBudget:
    """Work out how much of the machine an inference process can actually use."""
    total_gb = 0.0
    if platform.system() == "Darwin":
        raw = _sysctl("hw.memsize")
        if raw and raw.isdigit():
            total_gb = int(raw) / GB
    else:
        try:
            with open("/proc/meminfo") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        total_gb = int(line.split()[1]) * 1024 / GB
                        break
        except OSError:
            pass

    if override_gb is not None:
        return HostBudget(total_gb, override_gb, "--vram-budget override")

    if platform.system() == "Darwin":
        # Metal will not wire more than iogpu.wired_limit_mb; when that sysctl is
        # 0 the driver falls back to roughly 75% of physical memory.
        raw = _sysctl("iogpu.wired_limit_mb")
        if raw and raw.isdigit() and int(raw) > 0:
            return HostBudget(total_gb, int(raw) * 1024 * 1024 / GB, "iogpu.wired_limit_mb")

        return HostBudget(total_gb, total_gb * 0.75, "macOS default (75% of RAM)")

    # Non-Apple: assume discrete VRAM is unknown, be conservative.
    return HostBudget(total_gb, total_gb * 0.9, "90% of system RAM")


def fit_label(size_gb: float, budget: HostBudget) -> Tuple[str, str]:
    """Return (symbol, colorized label) describing whether a quant fits."""
    if size_gb <= budget.comfortable_gb:
        return "ok", green("fits")

    if size_gb <= budget.vram_budget_gb:
        return "tight", yellow("tight")

    return "no", red("too big")


def _request(url: str, headers: Optional[Dict[str, str]] = None) -> urllib.request.Request:
    hdrs = {"User-Agent": USER_AGENT}
    if HF_TOKEN:
        hdrs["Authorization"] = "Bearer " + HF_TOKEN

    if headers:
        hdrs.update(headers)

    return urllib.request.Request(url, headers=hdrs)


def hf_get_json(path: str, retries: int = 3) -> object:
    url = "%s/api/%s" % (HF_ENDPOINT, path)
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(_request(url), timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                die(
                    "HuggingFace returned %d for %s.\n"
                    "This repo is gated or private. Accept its terms on the model "
                    "page and export HF_TOKEN=<your token>." % (exc.code, url)
                )

            if exc.code == 404:
                die("repo not found on HuggingFace: %s" % url)

            last = exc
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
            last = exc

        if attempt < retries - 1:
            time.sleep(2**attempt)

    die("could not reach HuggingFace (%s): %s" % (url, last))


@dataclass
class RemoteFile:
    path: str
    size: int
    sha256: Optional[str]

    @property
    def name(self) -> str:
        return self.path.rsplit("/", 1)[-1]


def list_repo_files(repo: str) -> List[RemoteFile]:
    """Every .gguf in a repo, with its size and (for LFS files) its sha256."""
    entries = hf_get_json("models/%s/tree/main?recursive=1&expand=1" % repo)
    if not isinstance(entries, list):
        die("unexpected tree response for %s" % repo)
    files: List[RemoteFile] = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("type") == "directory":
            continue

        path = entry.get("path", "")
        if not path.lower().endswith(".gguf"):
            continue

        lfs = entry.get("lfs") or {}
        # For LFS-tracked files the oid IS the sha256 of the content; plain git
        # blobs use a sha1 that we must not compare against a sha256 digest.
        files.append(
            RemoteFile(
                path,
                int(lfs.get("size") or entry.get("size") or 0),
                lfs.get("oid"),
            )
        )
    return files


def _stem_without_shard(path: str) -> str:
    """Collapse `.../Model-Q6_K-00002-of-00003.gguf` to `.../Model-Q6_K`.

    The shard regex is anchored on `.gguf`, so it must run against the full path
    before the extension is stripped - otherwise every shard becomes its own
    group and only one of them gets downloaded.
    """
    stem = _SHARD_RE.sub("", path)
    if stem.lower().endswith(".gguf"):
        stem = stem[:-5]

    return stem


def match_quant(files: Sequence[RemoteFile], quant: str) -> List[RemoteFile]:
    """Select the one coherent file group for `quant`.

    Handles the four layouts described in models_catalog, and picks a single
    winner when a repo publishes both a monolithic file and a sharded copy of
    the same quant (Qwen does this).
    """
    quant_lc = quant.lower()
    # Key on (stem, expected shard count).  Some repos - Qwen's own conversions,
    # for instance - publish a monolithic file *and* a sharded copy of the same
    # quant, which share a stem.  Keying on the shard count keeps them apart so
    # we do not download both and report double the real size.
    groups: Dict[Tuple[str, int], List[RemoteFile]] = {}
    for f in files:
        if _EXCLUDE_RE.search(f.path):
            continue

        stem = _stem_without_shard(f.path)
        parts = stem.split("/")
        # A path component either *is* the quant, or ends with "-<quant>".
        hit = any(p.lower() == quant_lc or p.lower().endswith("-" + quant_lc) for p in parts)
        if not hit:
            continue

        shard = _SHARD_RE.search(f.path)
        groups.setdefault((stem, int(shard.group(2)) if shard else 0), []).append(f)

    if not groups:
        return []

    # Drop sharded groups that are missing shards, unless that leaves nothing.
    complete = {key: fs for key, fs in groups.items() if key[1] == 0 or len(fs) == key[1]}
    groups = complete or groups

    # Prefer the monolithic file, then the shallowest path, then the shortest name.
    best = min(groups.items(), key=lambda kv: (len(kv[1]), kv[0][0].count("/"), len(kv[0][0])))
    return sorted(best[1], key=lambda f: f.path)


def match_mmproj(files: Sequence[RemoteFile], precision: str) -> Optional[RemoteFile]:
    candidates = [f for f in files if "mmproj" in f.path.lower()]
    if not candidates:
        return None

    for f in candidates:
        if precision.lower() in f.path.lower():
            return f

    return min(candidates, key=lambda f: f.size)


def available_quants(files: Sequence[RemoteFile]) -> Dict[str, int]:
    """Group every non-mmproj gguf by its trailing quant token, for `info`."""
    out: Dict[str, int] = {}
    for f in files:
        if _EXCLUDE_RE.search(f.path):
            continue

        stem = _stem_without_shard(f.path).split("/")[-1]
        token = stem.rsplit("-", 1)[-1] if "-" in stem else stem
        out[token] = out.get(token, 0) + f.size

    return out


class Progress:
    """Single-line aggregate progress across all concurrent downloads."""

    def __init__(self, total: int, label: str):
        self.total = total
        self.done = 0
        self.label = label
        self.lock = threading.Lock()
        self.start = time.time()
        self._last = 0.0

    def advance(self, n: int) -> None:
        with self.lock:
            self.done += n
            now = time.time()
            if now - self._last < 0.2 and self.done < self.total:
                return

            self._last = now
            self._render()

    def _render(self) -> None:
        if not sys.stdout.isatty():
            return

        frac = (self.done / self.total) if self.total else 1.0
        elapsed = max(time.time() - self.start, 1e-6)
        rate = self.done / elapsed
        eta = (self.total - self.done) / rate if rate > 0 else 0
        # Leave room for the counters; shrink the bar on narrow terminals.
        width = max(8, min(28, ui.term_width() - 62))
        filled = int(width * frac)
        bar = "#" * filled + "-" * (width - filled)
        sys.stdout.write(
            "\r  %-22s [%s] %5.1f%%  %6.1f/%.1f GB  %5.1f MB/s  ETA %s   "
            % (
                self.label[:22],
                bar,
                frac * 100,
                self.done / GB,
                self.total / GB,
                rate / 1e6,
                time.strftime("%M:%S", time.gmtime(eta)) if rate > 0 else "--:--",
            )
        )

        sys.stdout.flush()

    def finish(self) -> None:
        if sys.stdout.isatty():
            self._render()
            sys.stdout.write("\n")
            sys.stdout.flush()


if hasattr(os, "pwrite"):
    _pwrite = os.pwrite  # type: ignore[attr-defined]
else:  # Windows has no pwrite; serialize seek+write instead.
    _SEEK_LOCK = threading.Lock()

    def _pwrite(fd: int, data: bytes, offset: int) -> int:  # type: ignore[misc]
        with _SEEK_LOCK:
            os.lseek(fd, offset, os.SEEK_SET)
            return os.write(fd, data)


def _download_range(url: str, start: int, end: int, fd: int, progress: Progress) -> None:
    """Fetch [start, end] inclusive and write it at the right offset."""
    req = _request(url, {"Range": "bytes=%d-%d" % (start, end)})
    with urllib.request.urlopen(req, timeout=120) as resp:
        offset = start
        while True:
            block = resp.read(1024 * 1024)
            if not block:
                break

            _pwrite(fd, block, offset)
            offset += len(block)
            progress.advance(len(block))
    if offset != end + 1:
        raise IOError(
            "short read: got %d bytes, expected %d" % (offset - start, end - start + 1)
        )


def _download_stream(url: str, dest: Path, progress: Progress, resume_from: int) -> None:
    """Fallback path for servers that will not honour Range requests."""
    headers = {"Range": "bytes=%d-" % resume_from} if resume_from else {}
    req = _request(url, headers)
    mode = "ab" if resume_from else "wb"
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, mode) as fh:
        while True:
            block = resp.read(4 * 1024 * 1024)
            if not block:
                break

            fh.write(block)
            progress.advance(len(block))


def download_file(
    repo: str,
    remote: RemoteFile,
    dest: Path,
    connections: int,
    progress: Progress,
) -> None:
    """Resumable download of one file, using `connections` parallel ranges."""
    url = "%s/%s/resolve/main/%s" % (
        HF_ENDPOINT,
        repo,
        urllib.parse.quote(remote.path),
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    state_path = dest.with_name(dest.name + ".part.json")
    if dest.exists() and dest.stat().st_size == remote.size:
        progress.advance(remote.size)
        return

    total = remote.size
    if total <= 0:  # size unknown: single stream, no resume bookkeeping
        _download_stream(url, part, progress, 0)
        part.replace(dest)
        return

    n_chunks = max(1, (total + CHUNK_SIZE - 1) // CHUNK_SIZE)

    done_chunks = set()
    if part.exists() and state_path.exists():
        try:
            state = json.loads(state_path.read_text())
            if state.get("size") == total and state.get("chunk_size") == CHUNK_SIZE:
                done_chunks = set(state.get("done", []))
        except (OSError, ValueError):
            done_chunks = set()

    if not part.exists() or part.stat().st_size != total:
        with open(part, "wb") as fh:  # preallocate sparse
            fh.truncate(total)
        if part.stat().st_size != total:
            done_chunks = set()

    progress.advance(len(done_chunks) * CHUNK_SIZE)
    todo = [i for i in range(n_chunks) if i not in done_chunks]
    if not todo:
        part.replace(dest)
        state_path.unlink(missing_ok=True)
        return

    state_lock = threading.Lock()

    def _flush() -> None:
        tmp = state_path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {
                    "size": total,
                    "chunk_size": CHUNK_SIZE,
                    "done": sorted(done_chunks),
                }
            )
        )
        tmp.replace(state_path)

    fd = os.open(str(part), os.O_RDWR | getattr(os, "O_BINARY", 0))
    try:

        def worker(idx: int) -> None:
            start = idx * CHUNK_SIZE
            end = min(start + CHUNK_SIZE, total) - 1
            last_exc: Optional[Exception] = None
            for attempt in range(4):
                try:
                    _download_range(url, start, end, fd, progress)
                    with state_lock:
                        done_chunks.add(idx)
                        _flush()

                    return
                except (urllib.error.URLError, OSError, IOError) as exc:
                    last_exc = exc
                    if attempt < 3:
                        # Roll back this chunk's progress before retrying.
                        progress.advance(-(end - start + 1))
                        time.sleep(2**attempt)

            raise IOError("chunk %d of %s failed: %s" % (idx, remote.name, last_exc))

        with ThreadPoolExecutor(max_workers=max(1, connections)) as pool:
            futures = [pool.submit(worker, i) for i in todo]
            for fut in as_completed(futures):
                fut.result()
    finally:
        os.close(fd)

    if part.stat().st_size != total:
        die("size mismatch after download for %s" % remote.name)

    part.replace(dest)
    state_path.unlink(missing_ok=True)


# GGUF validation

GGUF_MAGIC = b"GGUF"
(
    _T_UINT8,
    _T_INT8,
    _T_UINT16,
    _T_INT16,
    _T_UINT32,
    _T_INT32,
    _T_FLOAT32,
    _T_BOOL,
    _T_STRING,
    _T_ARRAY,
    _T_UINT64,
    _T_INT64,
    _T_FLOAT64,
) = range(13)

_FIXED = {
    _T_UINT8: 1,
    _T_INT8: 1,
    _T_UINT16: 2,
    _T_INT16: 2,
    _T_UINT32: 4,
    _T_INT32: 4,
    _T_FLOAT32: 4,
    _T_BOOL: 1,
    _T_UINT64: 8,
    _T_INT64: 8,
    _T_FLOAT64: 8,
}
_STRUCT = {
    _T_UINT8: "<B",
    _T_INT8: "<b",
    _T_UINT16: "<H",
    _T_INT16: "<h",
    _T_UINT32: "<I",
    _T_INT32: "<i",
    _T_FLOAT32: "<f",
    _T_BOOL: "<?",
    _T_UINT64: "<Q",
    _T_INT64: "<q",
    _T_FLOAT64: "<d",
}

# Metadata worth surfacing; everything
# else is skipped without materializing it.
_WANTED = (
    "general.architecture",
    "general.name",
    "general.file_type",
    "split.count",
    "split.no",
    "general.size_label",
)


class _Cursor:
    def __init__(self, buf: bytes):
        self.buf = buf
        self.pos = 0

    def take(self, n: int) -> bytes:
        if self.pos + n > len(self.buf):
            raise EOFError
        out = self.buf[self.pos : self.pos + n]
        self.pos += n
        return out

    def skip(self, n: int) -> None:
        if self.pos + n > len(self.buf):
            raise EOFError
        self.pos += n

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def u64(self) -> int:
        return struct.unpack("<Q", self.take(8))[0]

    def string(self) -> str:
        return self.take(self.u64()).decode("utf-8", "replace")


def _skip_value(cur: _Cursor, vtype: int) -> None:
    if vtype in _FIXED:
        cur.skip(_FIXED[vtype])
    elif vtype == _T_STRING:
        cur.skip(cur.u64())
    elif vtype == _T_ARRAY:
        etype = cur.u32()
        count = cur.u64()

        if etype in _FIXED:
            cur.skip(_FIXED[etype] * count)
        elif etype == _T_STRING:
            for _ in range(count):  # tokenizer vocabs land here
                cur.skip(cur.u64())
        else:
            raise ValueError("unsupported array element type %d" % etype)
    else:
        raise ValueError("unsupported value type %d" % vtype)


def _read_value(cur: _Cursor, vtype: int) -> object:
    if vtype in _STRUCT:
        return struct.unpack(_STRUCT[vtype], cur.take(_FIXED[vtype]))[0]
    if vtype == _T_STRING:
        return cur.string()

    _skip_value(cur, vtype)
    return None


def read_gguf_header(path: Path, probe_bytes: int = 96 * 1024 * 1024) -> Dict[str, object]:
    """Parse the GGUF header far enough to prove the file is a real GGUF.

    Reads a bounded prefix rather than the whole (possibly 48 GB) file.  A
    truncated read is not an error - we return whatever was decoded, and the
    caller still has the sha256 as the authoritative integrity check.
    """
    with open(path, "rb") as fh:
        buf = fh.read(probe_bytes)

    if len(buf) < 24 or buf[:4] != GGUF_MAGIC:
        raise ValueError("not a GGUF file (bad magic)")

    cur = _Cursor(buf)
    cur.skip(4)
    version = cur.u32()
    if version not in (2, 3):
        raise ValueError("unsupported GGUF version %d" % version)

    tensor_count = cur.u64()
    kv_count = cur.u64()

    meta: Dict[str, object] = {
        "gguf_version": version,
        "tensor_count": tensor_count,
        "kv_count": kv_count,
    }

    try:
        for _ in range(kv_count):
            key = cur.string()
            vtype = cur.u32()
            if key in _WANTED or key.endswith(".context_length"):
                value = _read_value(cur, vtype)
                if value is not None:
                    meta[key] = value
            else:
                _skip_value(cur, vtype)
    except (EOFError, ValueError, struct.error):
        meta["metadata_truncated"] = True
    return meta


def sha256_file(path: Path, progress: Optional[Progress] = None) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(8 * 1024 * 1024)
            if not block:
                break

            digest.update(block)
            if progress:
                progress.advance(len(block))

    return digest.hexdigest()


@dataclass
class ValidationResult:
    ok: bool
    problems: List[str]
    meta: Dict[str, object]


def validate_files(
    model_dir: Path,
    entries: Sequence[Dict[str, object]],
    check_hash: bool,
    label: str,
) -> ValidationResult:
    problems: List[str] = []
    meta: Dict[str, object] = {}

    if not entries:
        # Never let an empty file list validate vacuously - that would report a
        # broken or half-written install as healthy.
        return ValidationResult(False, ["no files recorded for this model"], meta)

    total = sum(int(e["size"]) for e in entries) if check_hash else 0
    progress = Progress(total, "verify %s" % label) if check_hash and total else None

    for entry in entries:
        name = str(entry["name"])
        path = model_dir / name
        if not path.exists():
            problems.append("missing file: %s" % name)
            continue

        actual = path.stat().st_size
        if actual != int(entry["size"]):
            problems.append(
                "size mismatch for %s: have %d, expected %s" % (name, actual, entry["size"])
            )
            continue

        expected_sha = entry.get("sha256")
        if check_hash and expected_sha:
            got = sha256_file(path, progress)
            if got != expected_sha:
                problems.append("sha256 mismatch for %s" % name)

    if progress:
        progress.finish()

    # Structural check on the first shard only; the rest are proven by sha256.
    primary = model_dir / str(entries[0]["name"]) if entries else None
    if primary and primary.exists() and not problems:
        try:
            meta = read_gguf_header(primary)
        except (ValueError, OSError) as exc:
            problems.append("GGUF header invalid in %s: %s" % (primary.name, exc))
        else:
            declared = meta.get("split.count")
            if isinstance(declared, int) and declared and declared != len(entries):
                problems.append(
                    "shard count mismatch: GGUF declares %d shards, downloaded %d"
                    % (declared, len(entries))
                )

    return ValidationResult(not problems, problems, meta)


def manifest_path(model_id: str) -> Path:
    return MODELS_DIR / model_id / MANIFEST_NAME


def read_manifest(model_id: str) -> Optional[Dict[str, object]]:
    path = manifest_path(model_id)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None

    return data if isinstance(data, dict) else None


def manifest_intact(model_id: str, man: Dict[str, object]) -> bool:
    """Cheap on-disk check that the manifest still describes reality.

    A manifest saying `validated: true` proves nothing if the files were since
    deleted, moved or truncated, so every skip-work decision goes through here.
    """
    model_dir = MODELS_DIR / model_id
    files = man.get("files") or []
    if not files:
        return False

    for entry in files:
        path = model_dir / str(entry.get("name", ""))
        try:
            if path.stat().st_size != int(entry.get("size", -1)):
                return False
        except OSError:
            return False

    return True


def installed_models() -> List[Tuple[Model, Dict[str, object]]]:
    out = []
    for model in catalog.CATALOG:
        man = read_manifest(model.id)
        if man and man.get("validated") and manifest_intact(model.id, man):
            out.append((model, man))

    return out


def install_model(
    model: Model,
    quant: Optional[str],
    connections: int,
    check_hash: bool,
    with_mmproj: bool,
    force: bool,
) -> bool:
    quant = quant or model.default_quant
    if quant not in model.quants:
        die(
            "unknown quant %r for %s. Available: %s"
            % (quant, model.id, ", ".join(sorted(model.quants)))
        )

    model_dir = MODELS_DIR / model.id
    existing = read_manifest(model.id)
    if (
        existing
        and existing.get("quant") == quant
        and existing.get("validated")
        and manifest_intact(model.id, existing)
        and not force
    ):
        info("  %s %s already installed and validated (%s)" % (green("+"), model.id, quant))
        return True

    info("%s %s  %s" % (bold("==>"), bold(model.title), dim("(%s / %s)" % (model.id, quant))))
    info("    repo: %s" % model.repo)

    files = list_repo_files(model.repo)
    if not files:
        die("no .gguf files found in %s" % model.repo)

    selected = match_quant(files, quant)
    if not selected:
        tokens = ", ".join(sorted(available_quants(files)))
        die(
            "quant %r not present in %s.\n  Quant tokens found in the repo: %s"
            % (quant, model.repo, tokens)
        )

    if with_mmproj and model.mmproj:
        proj = match_mmproj(files, model.mmproj)
        if proj:
            selected = list(selected) + [proj]
        else:
            warn("no mmproj found in %s; continuing without vision" % model.repo)

    total = sum(f.size for f in selected)
    info("    %d file(s), %s to download" % (len(selected), human(total)))

    model_dir.mkdir(parents=True, exist_ok=True)
    if force:
        # A corrupt file usually has the *right* size, so the resume fast-path
        # would happily keep it. --force must actually refetch the bytes.
        for remote in selected:
            for stale in (
                model_dir / remote.name,
                model_dir / (remote.name + ".part"),
                model_dir / (remote.name + ".part.json"),
            ):
                try:
                    stale.unlink()
                except OSError:
                    pass

    progress = Progress(total, model.id)
    # Shards are downloaded one at a time, each saturating `connections` ranges,
    # so the aggregate connection count stays bounded.
    for remote in selected:
        download_file(model.repo, remote, model_dir / remote.name, connections, progress)
    progress.finish()

    entries = [
        {"name": f.name, "path": f.path, "size": f.size, "sha256": f.sha256} for f in selected
    ]
    weights = [e for e in entries if "mmproj" not in str(e["name"]).lower()]
    result = validate_files(model_dir, weights, check_hash, model.id)

    if not result.ok:
        for problem in result.problems:
            print("    %s %s" % (red("x"), problem), file=sys.stderr)
        # Keep the full file list even on failure, so `verify` and `--force`
        # have something concrete to re-check and repair against.
        write_json(
            manifest_path(model.id),
            {
                "manifest_version": MANIFEST_VERSION,
                "model_id": model.id,
                "title": model.title,
                "repo": model.repo,
                "quant": quant,
                "validated": False,
                "problems": result.problems,
                "total_bytes": total,
                "primary": weights[0]["name"],
                "files": entries,
            },
        )
        info("    %s run `install %s --force` to refetch" % (dim("hint:"), model.id))
        return False

    arch = result.meta.get("general.architecture", "?")
    info(
        "    %s validated - %s arch, %s tensors, GGUF v%s"
        % (
            green("ok"),
            arch,
            result.meta.get("tensor_count", "?"),
            result.meta.get("gguf_version", "?"),
        )
    )

    mmproj_entry = next((e for e in entries if "mmproj" in str(e["name"]).lower()), None)
    write_json(
        manifest_path(model.id),
        {
            "manifest_version": MANIFEST_VERSION,
            "model_id": model.id,
            "title": model.title,
            "repo": model.repo,
            "quant": quant,
            "validated": True,
            "validated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "hash_checked": bool(check_hash),
            "total_bytes": total,
            "primary": weights[0]["name"],
            "mmproj": mmproj_entry["name"] if mmproj_entry else None,
            "files": entries,
            "gguf": result.meta,
        },
    )
    return True


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def submodule_sha() -> Optional[str]:
    """The exact llama.cpp commit currently checked out in extern/llama-cpp."""
    try:
        out = subprocess.run(
            ["git", "-C", str(LLAMA_SRC), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None if out.returncode == 0 else None


def read_stamp() -> Dict[str, object]:
    try:
        data = json.loads(BUILD_STAMP.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def tool_path(name: str) -> Path:
    return TOOLS_DIR / name


def find_tool(name: str) -> Optional[Path]:
    """Locate a llama.cpp binary, preferring our own submodule build."""
    own = tool_path(name)
    if own.is_file() and os.access(own, os.X_OK):
        return own

    env = os.environ.get("LLAMA_SERVER") if name == "llama-server" else None
    if env and Path(env).is_file():
        return Path(env)

    found = shutil.which(name)
    return Path(found) if found else None


def tools_state() -> Tuple[bool, str]:
    """(up_to_date, human readable reason)."""
    sha = submodule_sha()
    if sha is None:
        return False, "extern/llama-cpp is not a git checkout (submodule not initialized?)"

    stamp = read_stamp()
    missing = [t for t in BUILD_TARGETS if not tool_path(t).is_file()]
    if missing:
        return False, "not built yet (%d/%d binaries missing)" % (
            len(missing),
            len(BUILD_TARGETS),
        )

    if stamp.get("sha") != sha:
        return False, "submodule moved to %s (built from %s)" % (
            sha[:12],
            str(stamp.get("sha") or "?")[:12],
        )

    if stamp.get("cmake_flags") != CMAKE_FLAGS:
        return False, "cmake flags changed since last build"

    return True, "up to date with submodule %s" % sha[:12]


def build_tools(force: bool = False, jobs: Optional[int] = None) -> None:
    """Configure and build every llama-* binary into .data/tools/.

    Kept in lockstep with the submodule: the stamp records the commit the
    binaries came from, and any drift triggers a rebuild.
    """
    up_to_date, reason = tools_state()
    if up_to_date and not force:
        info("  %s tools %s" % (green("+"), reason))
        return

    if not (LLAMA_SRC / "CMakeLists.txt").is_file():
        die(
            "extern/llama-cpp is empty. Initialize the submodule first:\n"
            "  git submodule update --init --recursive extern/llama-cpp"
        )

    for tool in ("cmake", "ninja"):
        if not shutil.which(tool):
            die("%s not found on PATH - needed to build llama.cpp" % tool)

    info("%s building llama.cpp tools - %s" % (bold("==>"), reason))
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    TOOLS_DIR.mkdir(parents=True, exist_ok=True)

    configure = [
        "cmake",
        "-B",
        str(BUILD_DIR),
        "-S",
        str(LLAMA_SRC),
        "-G",
        "Ninja",
    ] + CMAKE_FLAGS

    run = subprocess.run(configure, capture_output=True, text=True)
    if run.returncode != 0:
        sys.stderr.write(run.stdout[-4000:] + run.stderr[-4000:])
        die("cmake configure failed")

    cmd = ["cmake", "--build", str(BUILD_DIR), "-j", str(jobs or os.cpu_count() or 8)]
    for target in BUILD_TARGETS:
        cmd += ["--target", target]

    info("    %s" % dim("building %d targets..." % len(BUILD_TARGETS)))
    run = subprocess.run(cmd, capture_output=True, text=True)
    if run.returncode != 0:
        sys.stderr.write(run.stdout[-6000:] + run.stderr[-6000:])
        die("build failed")

    built = []
    for target in BUILD_TARGETS:
        src = BUILD_DIR / "bin" / target
        if not src.is_file():
            warn("target %s did not produce a binary" % target)
            continue

        shutil.copy2(src, tool_path(target))
        built.append(target)

    # Metal needs its shader library beside the binaries when not embedded.
    for extra in BUILD_DIR.glob("bin/*.metallib"):
        shutil.copy2(extra, TOOLS_DIR / extra.name)

    for extra in BUILD_DIR.glob("bin/*.dylib"):
        shutil.copy2(extra, TOOLS_DIR / extra.name)

    write_json(
        BUILD_STAMP,
        {
            "sha": submodule_sha(),
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "cmake_flags": CMAKE_FLAGS,
            "targets": built,
            "host": platform.platform(),
        },
    )

    info("    %s built %d binaries into %s" % (green("ok"), len(built), TOOLS_DIR))


def ensure_tools(auto: bool = True) -> None:
    """Called before anything that needs a binary. Rebuilds on submodule drift."""
    up_to_date, reason = tools_state()
    if up_to_date:
        return

    if not auto:
        warn("llama.cpp tools are stale: %s" % reason)
        return

    build_tools()


def generate_preset_ini(
    entries: Sequence[Tuple[Model, Dict[str, object]]],
    ctx_override: Optional[int],
) -> str:
    """llama.cpp router preset. Section name == the model id opencode will use."""
    lines = [
        "; Generated by scripts/fetch_models.py - do not edit by hand.",
        "; Consumed by: llama-server --models-preset .data/configs/llama-models.ini",
        "; Keys are llama-server long options with the leading dashes removed.",
        "",
        "[*]",
        "n-gpu-layers = 999",
        "flash-attn = auto",
        "jinja = true",
        "",
    ]
    for model, man in entries:
        model_dir = MODELS_DIR / model.id
        lines.append("[%s]" % model.id)
        lines.append("model = %s" % (model_dir / str(man["primary"])))
        if man.get("mmproj"):
            lines.append("mmproj = %s" % (model_dir / str(man["mmproj"])))

        lines.append("ctx-size = %d" % (ctx_override or model.serve_ctx))
        lines.append("tags = %s" % model.category)
        for key, value in sorted(model.sampling.items()):
            lines.append("%s = %s" % (key, value))

        lines.append("")

    return "\n".join(lines)


def generate_opencode_config(
    entries: Sequence[Tuple[Model, Dict[str, object]]],
    host: str,
    port: int,
    ctx_override: Optional[int],
) -> Dict[str, object]:
    models: Dict[str, object] = {}
    for model, man in entries:
        if model.embedding or model.reranker:
            # Not chat models; they are served but must not be selectable as an
            # opencode agent model.
            continue

        ctx = ctx_override or model.serve_ctx
        # Advertise image input only when a projector was actually downloaded -
        # a vision-capable model installed without --with-mmproj cannot see.
        has_vision = bool(man.get("mmproj"))
        modalities = ["text", "image"] if has_vision else ["text"]
        models[model.id] = {
            "id": model.id,
            "name": "%s [%s]" % (model.title, model.category),
            "family": model.category,
            "tool_call": model.tool_call,
            "reasoning": model.reasoning,
            "attachment": has_vision,
            "temperature": True,
            "modalities": {"input": modalities, "output": ["text"]},
            "limit": {"context": ctx, "output": max(4096, ctx // 4)},
            "cost": {"input": 0, "output": 0},
        }

    chat_models = [m for m, _ in entries if not (m.embedding or m.reranker)]
    coding = [m for m in chat_models if m.category == "coding"]
    default = (coding or chat_models)[0].id if chat_models else None
    # Prefer the smallest installed model for cheap background work like titles.
    small = min(chat_models, key=lambda m: m.default_size_gb).id if chat_models else None

    config: Dict[str, object] = {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "llama.cpp (local router)",
                "options": {
                    "baseURL": "http://%s:%d/v1" % (host, port),
                    "apiKey": "local",
                    # A cold model swap can take a while on a 30 GB+ file.
                    "timeout": 1_800_000,
                    "headerTimeout": 600_000,
                },
                "models": models,
            }
        },
    }

    if default:
        config["model"] = "%s/%s" % (PROVIDER_ID, default)

    if small:
        config["small_model"] = "%s/%s" % (PROVIDER_ID, small)

    # The base config carries the conductor wiring too, so regenerating it
    # mid-session cannot strip the plugin and agents out from under a live
    # session. Its baseURL stays direct: no router port exists at this point,
    # and the router rewrite is a session-time decision (serve.py).
    return cw.apply_conductor_wiring(
        config, cw.openai_base_url(host, port), root=REPO_ROOT
    )


def generate_launch_sh() -> str:
    """A tiny bash wrapper so a session is one command from anywhere."""
    return """#!/usr/bin/env bash

# Generated by scripts/fetch_models.py - do not edit by hand.
# Convenience wrapper: starts an interactive model session.
#
#   .data/scripts/launch.sh              pick a model, land in a ready shell
#   .data/scripts/launch.sh ornith-35b   skip the picker
#   .data/scripts/launch.sh --fresh      ignore saved settings
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$REPO_ROOT/scripts/serve.py" "$@"
"""


def build_benchmark_config(
    entries: Sequence[Tuple[Model, Dict[str, object]]],
) -> Dict[str, object]:
    """Emit .data/configs/benchmark.json describing exactly what is installed.

    JSON rather than TOML because the system python here is 3.9, which has no
    tomllib - and requiring a newer interpreter would break the zero-setup
    promise. Comment keys carry the documentation instead.
    """
    import bench_presets as bp

    models = []
    for model, man in entries:
        task = bp.TASKS_BY_CATEGORY.get(model.category)
        models.append(
            {
                "id": model.id,
                "enabled": True,
                "category": model.category,
                "quant": man.get("quant"),
                "task": task.id if task else None,
                "presets": [p.name for p in bp.PRESETS],
                "author_sampling": model.sampling,
                "serve_ctx": model.serve_ctx,
                "vision": bool(man.get("mmproj")),
            }
        )

    return {
        "_readme": [
            "Generated by scripts/fetch_models.py; consumed by scripts/benchmark.py.",
            "Safe to hand-edit - re-running `fetch_models.py config` refreshes the",
            "model list but preserves nothing, so keep custom edits in a copy and",
            "pass it with `benchmark.py --config <path>`.",
            "Set enabled=false to skip a model. Trim 'presets' to shorten a run.",
        ],
        "version": 1,
        "run": {
            "_comment": "repetitions smooths thermal noise; warmup is discarded.",
            "repetitions": 3,
            "warmup": 1,
            "timeout_seconds": 900,
            "keep_outputs": True,
            "_max_tokens_reasoning_comment": (
                "Reasoning models emit reasoning_content before any answer "
                "tokens. With a normal budget they spend it all thinking, "
                "return an empty answer, and score 0% for the wrong reason. "
                "Applied to catalog entries with reasoning=true."
            ),
            "max_tokens_reasoning": 8000,
            "self_judge": {
                "_comment": (
                    "The model grades its OWN output. This is NOT an independent "
                    "quality measure - it is reported separately and always "
                    "labelled SELF-GRADED. Its real value is calibration: "
                    "comparing the self-score against the objective test result "
                    "shows how well a model judges its own work."
                ),
                "enabled": True,
            },
            "perplexity": {
                "_comment": "Objective quality vs quantization, via llama-perplexity.",
                "enabled": True,
                "chunks": 24,
            },
            "eviction": {
                "_comment": (
                    "delete_after_each lets you benchmark more models than fit on "
                    "disk; each is re-downloaded when its turn comes."
                ),
                "download_missing": False,
                "delete_after_each": False,
            },
        },
        "presets": [
            {
                "name": p.name,
                "focus": p.focus,
                "runtime": p.runtime,
                "sampling": ("<author-recommended>" if p.use_author_sampling else p.sampling),
            }
            for p in bp.PRESETS
        ],
        "models": models,
        "placeholder_categories": bp.PLACEHOLDER_CATEGORIES,
    }


def regenerate_configs(
    host: str,
    port: int,
    models_max: int,
    ctx_override: Optional[int],
) -> None:
    entries = installed_models()
    CONFIGS_DIR.mkdir(parents=True, exist_ok=True)

    ini_path = CONFIGS_DIR / "llama-models.ini"
    ini_path.write_text(generate_preset_ini(entries, ctx_override))

    oc_path = CONFIGS_DIR / "opencode.json"
    write_json(oc_path, generate_opencode_config(entries, host, port, ctx_override))

    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    launch = SCRIPTS_DIR / "launch.sh"
    launch.write_text(generate_launch_sh())
    launch.chmod(0o755)

    bench_cfg = CONFIGS_DIR / "benchmark.json"
    write_json(bench_cfg, build_benchmark_config(entries))

    info("")
    try:
        shown = CONFIGS_DIR.relative_to(REPO_ROOT)
    except ValueError:
        shown = CONFIGS_DIR

    info(
        "%s regenerated %s" % (bold("==>"), shown),
    )
    info("    %-24s %d model(s)" % ("llama-models.ini", len(entries)))
    info(
        "    %-24s %d selectable in opencode"
        % ("opencode.json", sum(1 for m, _ in entries if not (m.embedding or m.reranker)))
    )

    info("    %-24s convenience wrapper" % "scripts/launch.sh")
    info("    %-24s %d model(s)" % ("benchmark.json", len(entries)))
    if not entries:
        warn("no validated models installed yet - the configs are empty stubs")
        return

    info("")
    info("  Start a session:    %s" % cyan("scripts/serve.py"))
    info(
        "  Point opencode at:  %s"
        % cyan("OPENCODE_CONFIG=$PWD/.data/configs/opencode.json opencode")
    )


def resolve_selection(args: argparse.Namespace) -> List[Model]:
    """Turn positional ids plus --category/--all into a concrete model list."""
    picked: List[Model] = []
    seen = set()

    def add(model: Model) -> None:
        if model.id not in seen:
            seen.add(model.id)
            picked.append(model)

    for name in getattr(args, "models", None) or []:
        add(catalog.get(name))

    for cat in getattr(args, "category", None) or []:
        matches = catalog.in_category(cat)
        if not matches:
            die("unknown category %r. Valid: %s" % (cat, ", ".join(c for c, _ in CATEGORIES)))

        for model in matches:
            if not model.experimental:
                add(model)
    if getattr(args, "all", False):
        for model in catalog.CATALOG:
            if not model.experimental:
                add(model)

    return picked


def cmd_list(args: argparse.Namespace) -> int:
    budget = detect_budget(args.vram_budget)
    if args.json:
        # Machine-readable form for setup.sh, so the installer never has to
        # parse coloured console output.
        installed = {m.id for m, _ in installed_models()}
        print(
            json.dumps(
                {
                    "budget": {
                        "total_ram_gb": budget.total_ram_gb,
                        "vram_budget_gb": budget.vram_budget_gb,
                        "comfortable_gb": budget.comfortable_gb,
                        "source": budget.source,
                    },
                    "categories": [{"id": c, "description": d} for c, d in CATEGORIES],
                    "models": [
                        {
                            "id": m.id,
                            "title": m.title,
                            "category": m.category,
                            "params": m.params,
                            "license": m.license,
                            "quant": m.default_quant,
                            "size_gb": m.default_size_gb,
                            "fit": fit_label(m.default_size_gb, budget)[0],
                            "experimental": m.experimental,
                            "vision": m.vision,
                            "installed": m.id in installed,
                            "notes": m.notes,
                        }
                        for m in catalog.CATALOG
                    ],
                },
                indent=2,
            )
        )

        return 0

    info(
        "%s  %.0f GiB RAM  |  usable for weights: %.0f GB (%s)  |  comfortable: %.0f GB"
        % (
            bold("Host"),
            budget.total_ram_gb * GB / (1024**3),
            budget.vram_budget_gb,
            budget.source,
            budget.comfortable_gb,
        )
    )

    info(dim("  Model sizes are decimal GB, matching HuggingFace. 64 GiB RAM = 68.7 GB."))

    info(
        dim(
            "  'comfortable' reserves %.0f GB for KV cache and compute buffers."
            % budget.headroom_gb
        )
    )

    info("")

    installed_ids = {m.id for m, _ in installed_models()}
    for cat_id, cat_desc in CATEGORIES:
        models = catalog.in_category(cat_id)
        if not models:
            continue

        info(bold(cat_desc))
        for model in models:
            size = model.default_size_gb
            _, label = fit_label(size, budget)
            mark = green(" [installed]") if model.id in installed_ids else ""
            flag = yellow(" (experimental)") if model.experimental else ""
            # Pad BEFORE colouring: %-22s counts the ANSI escapes cyan() adds,
            # which silently shifts every subsequent column.
            # The title is the only elastic column, so it absorbs the width
            # change and size/fit - the two things you actually scan for -
            # stay visible even on a narrow terminal.
            title_width = max(12, ui.term_width() - 58)
            info(
                "  %s %s %7.1f GB  %-8s%s%s"
                % (
                    cyan("%-22s" % model.id),
                    ui.fit("%-*s" % (title_width, model.title), title_width),
                    size,
                    label,
                    mark,
                    flag,
                )
            )

            if args.long:
                info(
                    "      %s | %s | ctx %s | serve @ %s"
                    % (
                        model.params,
                        model.license,
                        f"{model.context:,}",
                        f"{model.serve_ctx:,}",
                    )
                )

                info("      %s" % model.repo)

                caps = []
                if model.tool_call:
                    caps.append("tools")
                if model.reasoning:
                    caps.append("reasoning")
                if model.vision:
                    caps.append("vision")
                if model.embedding:
                    caps.append("embeddings")
                if model.reranker:
                    caps.append("rerank")

                info("      caps: %s" % (", ".join(caps) or "text"))
                quants = "  ".join(
                    "%s%s=%.1fGB" % ("*" if q == model.default_quant else "", q, s)
                    for q, s in sorted(model.quants.items(), key=lambda kv: kv[1])
                )

                info("      quants (* = default): %s" % quants)
                for line in _wrap(model.notes, 72):
                    info("      %s" % dim(line))

                info("")

        info("")

    if not args.long:
        info(dim("Run with --long for repos, licenses, capabilities and every quant."))

    info(
        "Install:  %s"
        % cyan("scripts/fetch_models.py install <id> [<id>...] [--quant Q] [--with-mmproj]")
    )

    return 0


def _wrap(text: str, width: int) -> List[str]:
    words, lines, cur = text.split(), [], ""
    for word in words:
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur)
            cur = word
        else:
            cur = (cur + " " + word).strip()

    if cur:
        lines.append(cur)

    return lines


def cmd_info(args: argparse.Namespace) -> int:
    model = catalog.get(args.model)
    budget = detect_budget(args.vram_budget)
    info("%s  %s" % (bold(model.title), dim("(%s)" % model.id)))
    info("  repo        %s" % model.repo)
    info("  category    %s" % model.category)
    info("  params      %s" % model.params)
    info("  license     %s" % model.license)
    info(
        "  context     %s native, served at %s"
        % (f"{model.context:,}", f"{model.serve_ctx:,}")
    )
    info("  notes       %s" % "\n              ".join(_wrap(model.notes, 66)))
    info("")

    info("  %-16s %10s   %s" % ("QUANT", "SIZE", "FIT"))
    for quant, size in sorted(model.quants.items(), key=lambda kv: kv[1]):
        _, label = fit_label(size, budget)
        star = " *" if quant == model.default_quant else "  "
        info("  %-16s %7.2f GB  %s%s" % (quant, size, label, star))

    info("")
    info(dim("  * = default. Sizes are the measured sum of all shards."))

    if args.remote:
        info("")
        info("  Live file listing from HuggingFace:")

        for token, size in sorted(
            available_quants(list_repo_files(model.repo)).items(),
            key=lambda kv: kv[1],
        ):
            info("    %-24s %7.2f GB" % (token, size / GB))

    return 0


def cmd_install(args: argparse.Namespace) -> int:
    models = resolve_selection(args)
    if not models:
        die("nothing selected. Pass model ids, --category NAME, or --all.")

    budget = detect_budget(args.vram_budget)
    if args.quant and len(models) > 1:
        die("--quant only makes sense with a single model")

    planned = []
    for model in models:
        quant = args.quant or model.default_quant
        if quant not in model.quants:
            die(
                "unknown quant %r for %s.\n  Available: %s"
                % (quant, model.id, ", ".join(sorted(model.quants)))
            )

        planned.append((model, quant, model.quants[quant]))

    total = sum(size for _, _, size in planned)
    info(bold("Plan"))
    id_width = max((len(m.id) for m, _, _ in planned), default=0)
    quant_width = max((len(q) for _, q, _ in planned), default=0)
    for model, quant, size in planned:
        _, label = fit_label(size, budget)
        info(
            "  %s  %s  %7.1f GB  %s"
            % (ui.pad(model.id, id_width), ui.pad(quant, quant_width), size, label)
        )

    info(
        "  %s  %s  %7.1f GB total download"
        % (" " * id_width, " " * quant_width, total)
    )
    free = shutil.disk_usage(REPO_ROOT).free / GB
    info("  disk free: %.0f GB" % free)
    if free < total * 1.05:
        die("not enough free disk space (%.0f GB free, %.0f GB needed)" % (free, total))

    info("")
    if not args.yes and sys.stdin.isatty():
        try:
            if input("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
                return 1
        except EOFError:
            return 1

    failed = []
    for model, quant, _ in planned:
        try:
            ok = install_model(
                model,
                quant,
                args.connections,
                not args.no_hash_check,
                args.with_mmproj,
                args.force,
            )
        except KeyboardInterrupt:
            info("")
            warn("interrupted - partial downloads are resumable, just re-run install")
            return 130

        if not ok:
            failed.append(model.id)

        info("")

    if not args.no_config:
        regenerate_configs(args.host, args.port, args.models_max, args.serve_ctx)

    if failed:
        warn("validation failed for: %s" % ", ".join(failed))
        return 1

    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    targets = resolve_selection(args) or [m for m, _ in installed_models()]
    if not targets:
        info("nothing installed yet")
        return 0

    bad = []
    for model in targets:
        man = read_manifest(model.id)
        if not man:
            warn("%s: not installed" % model.id)
            continue

        entries = [
            e for e in man.get("files", []) if "mmproj" not in str(e.get("name", "")).lower()
        ]

        result = validate_files(
            MODELS_DIR / model.id,
            entries,
            not args.no_hash_check,
            model.id,
        )

        if result.ok:
            info("  %s %-22s %s" % (green("ok"), model.id, dim(str(man.get("quant")))))
        else:
            bad.append(model.id)
            info("  %s %-22s" % (red("FAIL"), model.id))
            for problem in result.problems:
                info("       %s" % problem)

        man["validated"] = result.ok
        write_json(manifest_path(model.id), man)

    return 1 if bad else 0


def cmd_remove(args: argparse.Namespace) -> int:
    models = resolve_selection(args)
    if not models:
        die("pass at least one model id")

    for model in models:
        path = MODELS_DIR / model.id
        if not path.exists():
            warn("%s: not installed" % model.id)
            continue

        size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        shutil.rmtree(path)
        info("removed %s (%s)" % (model.id, human(size)))

    if not args.no_config:
        regenerate_configs(args.host, args.port, args.models_max, args.serve_ctx)

    return 0


def cmd_status(args: argparse.Namespace) -> int:
    budget = detect_budget(args.vram_budget)
    entries = installed_models()
    if not entries:
        info(
            "No models installed. Try: %s" % cyan("scripts/fetch_models.py install ornith-35b")
        )
        return 0

    info(bold("Installed models  ->  %s") % MODELS_DIR)
    total = 0
    # Size the columns to the data rather than to a guess. A fixed %-22s both
    # wastes space on short ids and silently loses the alignment on long ones,
    # and it cannot pad a coloured value correctly in the first place - the
    # escape bytes count toward printf's width. ui.pad measures visible columns.
    id_width = max((len(m.id) for m, _ in entries), default=0)
    quant_width = max((len(str(man.get("quant", ""))) for _, man in entries), default=0)
    label_width = max(
        (len(fit_label(int(man.get("total_bytes", 0)) / GB, budget)[1]) for _, man in entries),
        default=0,
    )

    for model, man in entries:
        size = int(man.get("total_bytes", 0))
        total += size
        _, label = fit_label(size / GB, budget)

        info(
            "  %s  %s  %7.2f GB  %s  %s"
            % (
                ui.pad(cyan(model.id), id_width),
                ui.pad(str(man.get("quant")), quant_width),
                size / GB,
                ui.pad(label, label_width),
                dim("hash-checked" if man.get("hash_checked") else "size-checked only"),
            )
        )

    info(
        "  %s  %s  %7.2f GB total on disk"
        % (" " * id_width, " " * quant_width, total / GB)
    )

    info("")
    up_to_date, reason = tools_state()
    info("llama.cpp tools: %s" % (green(reason) if up_to_date else yellow(reason)))

    if not up_to_date:
        info(dim("  build them with: scripts/fetch_models.py build"))

    for name in ("opencode.json", "llama-models.ini", "benchmark.json"):
        path = CONFIGS_DIR / name
        info("%-18s %s" % (name + ":", green("present") if path.exists() else red("missing")))

    sp = SCRIPTS_DIR / "launch.sh"
    info("%-18s %s" % ("launch.sh:", green("present") if sp.exists() else red("missing")))
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    build_tools(force=args.force, jobs=args.jobs)
    if args.check:
        up_to_date, reason = tools_state()
        info("  %s" % (green(reason) if up_to_date else yellow(reason)))

    return 0


def cmd_config(args: argparse.Namespace) -> int:
    regenerate_configs(args.host, args.port, args.models_max, args.serve_ctx)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    ensure_tools()
    if not (CONFIGS_DIR / "llama-models.ini").exists():
        regenerate_configs(args.host, args.port, args.models_max, args.serve_ctx)

    if not installed_models():
        die("no validated models installed")

    # scripts/serve.py owns the interactive picker, session config and shell.
    serve = REPO_ROOT / "scripts" / "serve.py"
    argv = [sys.executable, str(serve)]
    if args.host != DEFAULT_HOST:
        argv += ["--host", args.host]

    if args.port != DEFAULT_PORT:
        argv += ["--port", str(args.port)]

    os.execv(sys.executable, argv)
    return 0  # unreachable


def build_parser() -> argparse.ArgumentParser:
    epilog = (
        "examples:\n"
        "  %(prog)s list --long                     full catalog with quants and notes\n"
        "  %(prog)s info qwen3-coder-next --remote  live quant listing from HuggingFace\n"
        "  %(prog)s install ornith-35b              install one model (default quant)\n"
        "  %(prog)s install gemma-4-31b --with-mmproj\n"
        "  %(prog)s install --category coding       every non-experimental coder\n"
        "  %(prog)s install qwen3-coder-30b --quant Q8_0\n"
        "  %(prog)s verify                          re-check every installed model\n"
        "  %(prog)s config --port 9000              regenerate .data/configs only\n"
        "  %(prog)s serve                           run the llama.cpp router\n"
        "\n"
        "environment:\n"
        "  HF_TOKEN        token for gated repos\n"
        "  HF_ENDPOINT     mirror instead of https://huggingface.co\n"
        "  LLAMA_SERVER    explicit path to the llama-server binary\n"
    )

    parser = argparse.ArgumentParser(
        prog="fetch_models.py",
        description=__doc__.split("\n\n")[0],
        epilog=epilog,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--vram-budget",
            type=float,
            metavar="GB",
            help="override detected usable VRAM in GB",
        )

    def add_config_opts(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--host",
            default=DEFAULT_HOST,
            help="server bind host",
        )
        p.add_argument(
            "--port",
            type=int,
            default=DEFAULT_PORT,
            help="server port",
        )
        p.add_argument(
            "--models-max",
            type=int,
            default=1,
            metavar="N",
            help="models resident at once (default 1; raise only if they "
            "genuinely fit side by side)",
        )
        p.add_argument(
            "--serve-ctx",
            type=int,
            metavar="N",
            help="override served context for every model",
        )

    def add_selection(p: argparse.ArgumentParser) -> None:
        p.add_argument("models", nargs="*", metavar="MODEL", help="model ids from `list`")
        p.add_argument(
            "--category",
            action="append",
            metavar="NAME",
            choices=[c for c, _ in CATEGORIES],
            help="select a whole category (repeatable)",
        )
        p.add_argument(
            "--all",
            action="store_true",
            help="select every non-experimental model",
        )

    p_list = sub.add_parser(
        "list",
        help="show the catalog and what fits this machine",
    )
    p_list.add_argument(
        "--long",
        action="store_true",
        help="full detail per model",
    )
    p_list.add_argument(
        "--json",
        action="store_true",
        help="machine-readable catalog (used by setup.sh)",
    )

    add_common(p_list)
    p_list.set_defaults(func=cmd_list)
    p_info = sub.add_parser(
        "info",
        help="detail for one model",
    )

    p_info.add_argument("model")
    p_info.add_argument(
        "--remote",
        action="store_true",
        help="also query HuggingFace for the live file listing",
    )

    add_common(p_info)
    p_info.set_defaults(func=cmd_info)
    p_inst = sub.add_parser(
        "install",
        help="download, validate and reconfigure",
    )

    add_selection(p_inst)
    p_inst.add_argument(
        "--quant",
        help="override the default quant (single model only)",
    )
    p_inst.add_argument(
        "--with-mmproj",
        action="store_true",
        help="also fetch the vision projector where available",
    )
    p_inst.add_argument(
        "-j",
        "--connections",
        type=int,
        default=8,
        metavar="N",
        help="parallel range connections per file (default 8)",
    )
    p_inst.add_argument(
        "--no-hash-check",
        action="store_true",
        help="skip sha256 verification (faster, weaker)",
    )
    p_inst.add_argument(
        "--force",
        action="store_true",
        help="redownload even if validated",
    )
    p_inst.add_argument(
        "--no-config",
        action="store_true",
        help="do not touch .data/configs/",
    )
    p_inst.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="skip the confirmation",
    )

    add_common(p_inst)
    add_config_opts(p_inst)
    p_inst.set_defaults(func=cmd_install)
    p_ver = sub.add_parser(
        "verify",
        help="re-validate installed models",
    )

    add_selection(p_ver)
    p_ver.add_argument(
        "--no-hash-check",
        action="store_true",
        help="size/header checks only",
    )

    add_common(p_ver)
    p_ver.set_defaults(func=cmd_verify)
    p_rm = sub.add_parser(
        "remove",
        help="delete installed models",
    )

    add_selection(p_rm)
    p_rm.add_argument(
        "--no-config",
        action="store_true",
    )

    add_common(p_rm)
    add_config_opts(p_rm)
    p_rm.set_defaults(func=cmd_remove)
    p_st = sub.add_parser(
        "status",
        help="what is installed and configured",
    )

    add_common(p_st)
    p_st.set_defaults(func=cmd_status)
    p_cfg = sub.add_parser(
        "config",
        help="regenerate .data/configs/ from what is installed",
    )

    add_config_opts(p_cfg)
    add_common(p_cfg)
    p_cfg.set_defaults(func=cmd_config)
    p_bld = sub.add_parser(
        "build",
        help="build llama-* tools from the submodule into .data/tools/",
    )
    p_bld.add_argument(
        "--force",
        action="store_true",
        help="rebuild even if current",
    )
    p_bld.add_argument(
        "-j",
        "--jobs",
        type=int,
        help="parallel build jobs",
    )
    p_bld.add_argument(
        "--check",
        action="store_true",
        help="report state afterwards",
    )

    add_common(p_bld)
    p_bld.set_defaults(func=cmd_build)
    p_srv = sub.add_parser(
        "serve",
        help="launch the llama.cpp router server",
    )

    add_config_opts(p_srv)
    add_common(p_srv)
    p_srv.set_defaults(func=cmd_serve)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    for name, default in (
        ("vram_budget", None),
        ("host", DEFAULT_HOST),
        ("port", DEFAULT_PORT),
        ("models_max", 1),
        ("serve_ctx", None),
    ):
        if not hasattr(args, name):
            setattr(args, name, default)

    try:
        return args.func(args)
    except KeyboardInterrupt:
        info("")
        return 130


if __name__ == "__main__":
    sys.exit(main())
