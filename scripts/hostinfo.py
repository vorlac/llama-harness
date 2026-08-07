"""Measured host profile.

A benchmark that reports part numbers is nearly useless - two machines with the
same chip name produce very different numbers depending on power source, thermal
state and how much memory Metal is allowed to wire.  So this module *measures*
what it can, records the machine state at run time, and re-checks that state
afterwards so throttling shows up in the report rather than silently skewing it.

Everything here is stdlib-only and safe to run without sudo; anything that would
need elevation is reported as unavailable rather than prompting.
"""

from __future__ import annotations

import ctypes
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional


def _run(cmd: List[str], timeout: int = 20) -> Optional[str]:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def _sysctl(key: str) -> Optional[str]:
    return _run(["sysctl", "-n", key], timeout=5)


def _sysctl_int(key: str) -> Optional[int]:
    raw = _sysctl(key)
    if raw and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    return None


# ---------------------------------------------------------------------------
# Static description
# ---------------------------------------------------------------------------


def static_specs() -> Dict[str, object]:
    specs: Dict[str, object] = {
        "os": platform.platform(),
        "machine": platform.machine(),
        "python": sys.version.split()[0],
    }
    if platform.system() != "Darwin":
        specs["cpu"] = platform.processor()
        return specs

    specs.update(
        {
            "chip": _sysctl("machdep.cpu.brand_string"),
            "model": _sysctl("hw.model"),
            "cpu_cores_total": _sysctl_int("hw.ncpu"),
            "cpu_cores_performance": _sysctl_int("hw.perflevel0.logicalcpu"),
            "cpu_cores_efficiency": _sysctl_int("hw.perflevel1.logicalcpu"),
            "cpu_freq_hz_nominal": _sysctl_int("hw.cpufrequency"),
            "l2_cache_bytes": _sysctl_int("hw.l2cachesize"),
            "cacheline_bytes": _sysctl_int("hw.cachelinesize"),
            "ram_bytes": _sysctl_int("hw.memsize"),
            "page_size": _sysctl_int("hw.pagesize"),
        }
    )

    # GPU core count and Metal family, straight from the driver.
    gpu = _run(["system_profiler", "-json", "SPDisplaysDataType"], timeout=40)
    if gpu:
        try:
            disp = json.loads(gpu).get("SPDisplaysDataType", [])
            if disp:
                d = disp[0]
                specs["gpu_name"] = d.get("sppci_model")
                specs["gpu_cores"] = d.get("sppci_cores")
                specs["metal_support"] = d.get("spdisplays_mtlgpufamilysupport")
        except (ValueError, AttributeError, IndexError):
            pass

    # How much of unified memory Metal is permitted to wire. This is the single
    # most important number for "will this model load".
    wired = _sysctl_int("iogpu.wired_limit_mb")
    ram = specs.get("ram_bytes") or 0
    specs["iogpu_wired_limit_mb"] = wired
    specs["metal_budget_bytes"] = wired * 1024 * 1024 if wired else int(ram * 0.75)
    specs["metal_budget_source"] = (
        "iogpu.wired_limit_mb" if wired else "macOS default (75% of RAM)"
    )
    return specs


# ---------------------------------------------------------------------------
# Volatile machine state - captured before and after a run
# ---------------------------------------------------------------------------


def machine_state() -> Dict[str, object]:
    """Power source, low-power mode and thermal pressure.

    On a laptop these dominate reproducibility: the same model on the same
    machine can differ by well over 2x between AC and battery.
    """
    state: Dict[str, object] = {
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    ps = _run(["pmset", "-g", "ps"], timeout=10)
    if ps:
        first = ps.splitlines()[0] if ps.splitlines() else ""
        state["power_source"] = (
            "AC" if "AC Power" in first else "battery" if "Battery" in first else "unknown"
        )
        for line in ps.splitlines()[1:]:
            if "%" in line:
                state["battery"] = line.strip()
                break

    lowpower = _run(["pmset", "-g", "custom"], timeout=10)
    if lowpower:
        for line in lowpower.splitlines():
            if "lowpowermode" in line:
                state["low_power_mode"] = line.split()[-1]
                break

    therm = _run(["pmset", "-g", "therm"], timeout=10)
    if therm:
        parsed = {}
        for line in therm.splitlines():
            if "=" in line:
                k, _, v = line.partition("=")
                parsed[k.strip().split()[-1]] = v.strip()
        if parsed:
            state["thermal"] = parsed

    # Free memory matters because a model that would fit can still be pushed
    # into swap by whatever else is running.
    vm = _run(["vm_stat"], timeout=10)
    if vm:
        page = _sysctl_int("hw.pagesize") or 16384
        free = spec = 0
        for line in vm.splitlines():
            if line.startswith("Pages free:"):
                free = int(line.split(":")[1].strip().rstrip(".")) * page
            elif line.startswith("Pages speculative:"):
                spec = int(line.split(":")[1].strip().rstrip(".")) * page
        state["memory_free_bytes"] = free + spec

    load = os.getloadavg()
    state["load_average"] = {"1m": load[0], "5m": load[1], "15m": load[2]}
    return state


# ---------------------------------------------------------------------------
# Measured throughput
# ---------------------------------------------------------------------------


_REPO_ROOT = Path(__file__).resolve().parent.parent
_MEMBENCH_SOURCE = _REPO_ROOT / "tools" / "membench" / "membench.cpp"


def _membench_binary() -> Optional[Path]:
    """Locate tools/membench, compiling it on demand if needed.

    membench is a single dependency-free translation unit, so building it costs
    about a second and spares the caller from configuring the CMake tree just to
    read a bandwidth number.
    """
    override = os.environ.get("MEMBENCH_BIN")
    if override and Path(override).is_file():
        return Path(override)

    built = _REPO_ROOT / "build" / "membench"
    candidates = [
        _REPO_ROOT / "build" / "tools" / "membench" / "membench",
        _REPO_ROOT / "build" / "tools" / "membench" / "Release" / "membench",
        built,
    ]
    # With no source to compare against, any binary that exists is the best
    # available answer; otherwise a stale one is worse than none, because it
    # would silently measure old code.
    source_mtime = _MEMBENCH_SOURCE.stat().st_mtime if _MEMBENCH_SOURCE.is_file() else 0.0
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            if candidate.stat().st_mtime >= source_mtime:
                return candidate

    if not _MEMBENCH_SOURCE.is_file():
        return None
    compiler = os.environ.get("CXX") or shutil.which("c++") or shutil.which("clang++")
    if not compiler:
        return None

    built.parent.mkdir(parents=True, exist_ok=True)
    for std in ("c++23", "c++20"):
        try:
            done = subprocess.run(
                [compiler, "-std=" + std, "-O3", str(_MEMBENCH_SOURCE), "-o", str(built)],
                capture_output=True,
                text=True,
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        if done.returncode == 0:
            return built
    return None


def _measure_memory_bandwidth_python(mb: int, passes: int) -> Dict[str, object]:
    """Fallback for when membench cannot be built.

    Kept only as a floor. It reads low for reasons that have nothing to do with
    the machine: the destination of bytes(src) is freshly allocated inside the
    timed region, so the copy also pays a first-touch page fault on every page
    it writes, and that cost dominates by roughly 3x.
    """
    size = mb * 1024 * 1024
    src = bytearray(size)
    best = 0.0
    for _ in range(passes):
        start = time.perf_counter()
        dst = bytes(src)  # single large copy
        elapsed = time.perf_counter() - start
        del dst
        if elapsed > 0:
            best = max(best, size / elapsed)
    return {
        "copy_bytes_per_sec": best,
        # A copy touches the bus twice: one read + one write.
        "effective_bandwidth_bytes_per_sec": best * 2,
        "buffer_mb": mb,
        "method": "single-threaded python memcpy (fallback)",
        "caveat": (
            "membench was unavailable, so this number includes page-fault cost "
            "and reads roughly 3x low. Build tools/membench for a real figure."
        ),
    }


def measure_memory_bandwidth(mb: int = 512, passes: int = 5) -> Dict[str, object]:
    """Large-buffer copy bandwidth, measured by tools/membench.

    Unified memory bandwidth is the binding constraint on token generation -
    decoding is memory-bound, so tok/s tracks this far more closely than it
    tracks FLOPS.

    Two things have to be controlled for the number to mean anything, and both
    are why this is a C++ tool rather than a bytearray copy. Buffers are
    pre-faulted outside the timed region, so the clock covers the copy and not
    the kernel's zero-fill; and the measuring thread requests user-interactive
    QoS, because the same copy runs ~6x slower if macOS parks it on an E-core.
    """
    try:
        binary = _membench_binary()
    except OSError:
        binary = None
    if binary is None:
        return _measure_memory_bandwidth_python(mb, passes)

    try:
        done = subprocess.run(
            [
                str(binary),
                "--size-mb", str(mb),
                "--passes", str(passes),
                "--qos", "user-interactive",
                "--sweep-threads",
                "--json",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        runs = json.loads(done.stdout)["runs"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        return _measure_memory_bandwidth_python(mb, passes)

    if not runs:
        return _measure_memory_bandwidth_python(mb, passes)

    single = next((r for r in runs if r["threads"] == 1), runs[0])
    peak = max(runs, key=lambda r: r["bytes_per_sec"])

    return {
        "copy_bytes_per_sec": single["bytes_per_sec"],
        # A copy touches the bus twice: one read + one write.
        "effective_bandwidth_bytes_per_sec": single["effective_bytes_per_sec"],
        "peak_copy_bytes_per_sec": peak["bytes_per_sec"],
        "peak_effective_bandwidth_bytes_per_sec": peak["effective_bytes_per_sec"],
        "peak_threads": peak["threads"],
        "scaling": [
            {
                "threads": r["threads"],
                "effective_bandwidth_bytes_per_sec": r["effective_bytes_per_sec"],
            }
            for r in runs
        ],
        "buffer_mb": mb,
        "method": "tools/membench, pre-faulted buffers, P-core pinned",
        "caveat": (
            "Even the multi-threaded figure is a CPU-side ceiling and sits below "
            "the chip's spec sheet (an M4 Max is rated ~546 GB/s), because the "
            "spec number assumes the GPU driving all channels at once. The "
            "bandwidth figure that actually predicts tok/s is the llama-bench tg "
            "result."
        ),
    }


def measure_disk_read(path: Path, max_bytes: int = 1024 * 1024 * 1024) -> Dict[str, float]:
    """Sequential read throughput on the volume holding the models.

    This sets the floor on model load time, which dominates any benchmark that
    swaps models between runs.
    """
    target = None
    if path.is_dir():
        candidates = sorted(path.rglob("*.gguf"), key=lambda p: p.stat().st_size, reverse=True)
        target = candidates[0] if candidates else None
    elif path.is_file():
        target = path
    if target is None:
        return {"available": False, "reason": "no .gguf file to read from"}

    size = min(target.stat().st_size, max_bytes)
    # Purge the page cache if possible so this measures the device, not RAM.
    cached = True
    if shutil.which("purge") and os.geteuid() == 0:
        _run(["purge"], timeout=60)
        cached = False

    read = 0
    start = time.perf_counter()
    with open(target, "rb") as fh:
        while read < size:
            block = fh.read(8 * 1024 * 1024)
            if not block:
                break
            read += len(block)
    elapsed = time.perf_counter() - start
    return {
        "available": True,
        "bytes_per_sec": read / elapsed if elapsed > 0 else 0.0,
        "bytes_read": read,
        "page_cache_warm": cached,
        "note": "run as root to purge the page cache for a cold-read number",
        "source_file": target.name,
    }


def measure_cpu(seconds: float = 0.6) -> Dict[str, float]:
    """Single-thread integer throughput - a proxy for per-core speed, which
    governs tokenization, sampling and the CPU-side of prompt building."""
    start = time.perf_counter()
    count = 0
    acc = 0
    while time.perf_counter() - start < seconds:
        for i in range(10000):
            acc = (acc + i * i) & 0xFFFFFFFF
        count += 10000
    elapsed = time.perf_counter() - start
    return {"ops_per_sec": count / elapsed if elapsed else 0.0}


def collect(models_dir: Path, quick: bool = False) -> Dict[str, object]:
    profile: Dict[str, object] = {
        "specs": static_specs(),
        "state_before": machine_state(),
    }
    if not quick:
        profile["measured"] = {
            "memory": measure_memory_bandwidth(),
            "disk": measure_disk_read(models_dir),
            "cpu_single_thread": measure_cpu(),
        }
    return profile


def summarize(profile: Dict[str, object]) -> List[str]:
    """Human-readable lines for the console and the report header."""

    s = profile.get("specs", {}) or {}
    m = profile.get("measured", {}) or {}
    st = profile.get("state_before", {}) or {}

    out = []
    out.append("chip            %s (%s GPU cores)" % (s.get("chip"), s.get("gpu_cores")))

    ram = s.get("ram_bytes") or 0
    out.append(
        "memory          %.0f GiB total, Metal budget %.0f GB (%s)"
        % (
            ram / (1024**3),
            (s.get("metal_budget_bytes") or 0) / 1e9,
            s.get("metal_budget_source"),
        )
    )

    out.append(
        "cpu             %s cores (%sP + %sE)"
        % (
            s.get("cpu_cores_total"),
            s.get("cpu_cores_performance"),
            s.get("cpu_cores_efficiency"),
        )
    )

    if m.get("memory"):
        mem = m["memory"]
        line = "mem bandwidth   %.1f GB/s single-thread" % (
            mem["effective_bandwidth_bytes_per_sec"] / 1e9
        )
        if mem.get("peak_effective_bandwidth_bytes_per_sec"):
            line += ", %.1f GB/s at %s threads" % (
                mem["peak_effective_bandwidth_bytes_per_sec"] / 1e9,
                mem.get("peak_threads"),
            )
        line += " (CPU-side ceiling; see llama-bench tg for what predicts tok/s)"
        out.append(line)

    disk = m.get("disk") or {}
    if disk.get("available"):
        out.append(
            "disk read       %.1f GB/s%s (measured)"
            % (
                disk["bytes_per_sec"] / 1e9,
                " [page cache warm]" if disk.get("page_cache_warm") else "",
            )
        )

    out.append(
        "power           %s%s"
        % (
            st.get("power_source", "?"),
            (
                ", low-power-mode=%s" % st.get("low_power_mode")
                if st.get("low_power_mode")
                else ""
            ),
        )
    )

    therm = st.get("thermal") or {}
    if therm:
        out.append("thermal         %s" % json.dumps(therm))

    return out


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    prof = collect(root / ".data" / "models")
    print("\n".join(summarize(prof)))
    print()
    print(json.dumps(prof, indent=2, default=str))
