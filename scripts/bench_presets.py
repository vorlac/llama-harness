"""Benchmark presets and task suites.

Presets
-------
Rather than sweeping a cross-product of arbitrary sampling values - which mostly
produces noise - each preset is a *named configuration that answers a question*,
drawn from what the model authors publish and what the local-inference community
has converged on for Apple Silicon.  Ten presets, ten questions.

Two cost classes, and the difference matters:

* ``runtime`` keys map to llama-server/llama-cli flags that are fixed at load
  time.  Changing one forces a full model reload - ~30 s on a 30 GB model.
* ``sampling`` keys vary per request and cost nothing to change.

The runner groups runs by their runtime signature so each distinct runtime
config is loaded exactly once, then sweeps sampling within it.

Tasks
-----
One shared task per catalog category, so models within a category compete on
identical work.  Scoring tiers, strongest first:

1. ``exec``    - generated code runs against hidden tests. Objectively pass/fail.
2. ``symbols`` - generated docs are checked against symbols parsed out of the
                 source file. Objective coverage, no judge needed.
3. ``judge``   - the model grades its own output. Always reported as SELF-graded.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Preset:
    name: str
    focus: str
    """What question this preset answers - shown in the report."""

    runtime: Dict[str, str] = field(default_factory=dict)
    sampling: Dict[str, str] = field(default_factory=dict)
    use_author_sampling: bool = False
    """Take sampling from the model's own catalog entry (author's published
    recommendation) instead of the `sampling` dict."""

    @property
    def runtime_key(self) -> str:
        """Runs sharing this string can reuse one loaded model."""
        return "|".join("%s=%s" % kv for kv in sorted(self.runtime.items()))


# Baseline Metal runtime shared by most presets: offload everything, let
# llama.cpp pick the flash-attn path, f16 KV cache.
_METAL = {
    "n-gpu-layers": "999",
    "flash-attn": "auto",
    "cache-type-k": "f16",
    "cache-type-v": "f16",
    "batch-size": "2048",
    "ubatch-size": "512",
}


def _rt(**over: str) -> Dict[str, str]:
    out = dict(_METAL)
    out.update(over)
    return out


PRESETS: List[Preset] = [
    Preset(
        name="author-default",
        focus="The model author's published sampling settings on a stock Metal "
        "runtime. This is the control - every other preset is read as a "
        "delta from here.",
        runtime=_rt(),
        use_author_sampling=True,
    ),
    Preset(
        name="deterministic",
        focus="Greedy decoding (temp 0). The standard choice for code and for "
        "any run that has to be reproducible.",
        runtime=_rt(),
        sampling={"temp": "0", "top-k": "1", "seed": "1234"},
    ),
    Preset(
        name="metal-throughput",
        focus="Flash attention forced on with a large micro-batch. Targets peak "
        "prompt-processing and generation throughput on M-series GPUs.",
        runtime=_rt(**{"flash-attn": "on", "batch-size": "4096", "ubatch-size": "1024"}),
        use_author_sampling=True,
    ),
    Preset(
        name="flash-attn-off",
        focus="Identical to metal-throughput but with flash attention disabled - "
        "isolates exactly what FA is worth on this hardware.",
        runtime=_rt(**{"flash-attn": "off", "batch-size": "4096", "ubatch-size": "1024"}),
        use_author_sampling=True,
    ),
    Preset(
        name="kv-q8",
        focus="8-bit KV cache. Roughly halves cache memory; the community "
        "consensus is that quality loss is near-zero. This preset tests "
        "that claim on real output.",
        runtime=_rt(**{"cache-type-k": "q8_0", "cache-type-v": "q8_0", "flash-attn": "on"}),
        use_author_sampling=True,
    ),
    Preset(
        name="kv-q4",
        focus="4-bit KV cache - quarter the cache memory. Expected to cost real "
        "quality; quantifies whether the memory saving is worth it.",
        runtime=_rt(**{"cache-type-k": "q4_0", "cache-type-v": "q4_0", "flash-attn": "on"}),
        use_author_sampling=True,
    ),
    Preset(
        name="long-context",
        focus="4x the default context with an 8-bit KV cache, the usual recipe for large-repo work. Measures degradation as context grows.",
        runtime=_rt(
            **{
                "cache-type-k": "q8_0",
                "cache-type-v": "q8_0",
                "flash-attn": "on",
                "ctx-size": "131072",
            }
        ),
        use_author_sampling=True,
    ),
    Preset(
        name="balanced-chat",
        focus="temp 0.7 / top-p 0.8 / top-k 20 - the widely used general-purpose middle ground, and Qwen's published chat default.",
        runtime=_rt(),
        sampling={"temp": "0.7", "top-p": "0.8", "top-k": "20", "seed": "1234"},
    ),
    Preset(
        name="min-p",
        focus="min-p sampling (min-p 0.05, top-p/top-k disabled). The min-p school argues this beats top-p for coherence at equal diversity.",
        runtime=_rt(),
        sampling={
            "temp": "0.8",
            "min-p": "0.05",
            "top-p": "1.0",
            "top-k": "0",
            "seed": "1234",
        },
    ),
    Preset(
        name="high-creative",
        focus="temp 1.0 / top-p 0.95 / top-k 64 - Gemma's published default and "
        "the usual setting for prose. Expected to help writing and hurt code.",
        runtime=_rt(),
        sampling={"temp": "1.0", "top-p": "0.95", "top-k": "64", "seed": "1234"},
    ),
]

PRESETS_BY_NAME = {p.name: p for p in PRESETS}


def resolve_sampling(preset: Preset, author_sampling: Dict[str, str]) -> Dict[str, str]:
    """Final sampling flags for a preset against a specific model."""
    if preset.use_author_sampling:
        out = dict(author_sampling)
        out.setdefault("seed", "1234")
        return out
    return dict(preset.sampling)


@dataclass
class Task:
    id: str
    category: str
    scoring: str
    """One of: exec | symbols | judge | embed | audio."""

    prompt: str
    max_tokens: int = 1024
    tests: Optional[str] = None
    """Python source executed against the model's extracted code block."""

    expect_symbols: Optional[List[str]] = None
    """For `symbols` scoring: identifiers the documentation must mention."""

    judge_rubric: Optional[str] = None
    needs_image: bool = False


# --- coding -----------------------------------------------------------------
# A single fixed problem every coding model competes on. Deliberately not a
# LeetCode classic: those are memorized verbatim from training data, which
# measures recall rather than coding ability. This one has awkward edge cases
# (overlaps, touching-but-not-overlapping, unsorted input, empty input) that
# require actual reasoning.

_CODING_PROMPT = """\
Write a Python function with this exact signature:

    def merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:

It merges overlapping integer ranges and returns them sorted ascending.

Requirements:
- Each input tuple is (start, end) with start <= end, inclusive on both ends.
- Ranges that overlap OR merely touch must be merged: (1, 3) and (4, 6) touch
  because 4 == 3 + 1, so they merge into (1, 6).
- Input may be unsorted and may contain duplicates.
- An empty input list returns an empty list.
- Do not mutate the input list.

Respond with ONLY one Python code block containing the function. No explanation.
"""

_CODING_TESTS = """
def test_empty():
    assert merge_ranges([]) == []

def test_single():
    assert merge_ranges([(1, 5)]) == [(1, 5)]

def test_disjoint_sorted():
    assert merge_ranges([(1, 2), (5, 6)]) == [(1, 2), (5, 6)]

def test_overlap():
    assert merge_ranges([(1, 5), (3, 8)]) == [(1, 8)]

def test_touching_merges():
    # 4 == 3 + 1, so these are adjacent and must merge
    assert merge_ranges([(1, 3), (4, 6)]) == [(1, 6)]

def test_not_touching():
    assert merge_ranges([(1, 3), (5, 6)]) == [(1, 3), (5, 6)]

def test_unsorted():
    assert merge_ranges([(5, 6), (1, 3), (2, 4)]) == [(1, 6)]

def test_duplicates():
    assert merge_ranges([(1, 3), (1, 3)]) == [(1, 3)]

def test_contained():
    assert merge_ranges([(1, 10), (3, 4)]) == [(1, 10)]

def test_chain():
    assert merge_ranges([(1, 2), (3, 4), (5, 6), (7, 8)]) == [(1, 8)]

def test_negative():
    assert merge_ranges([(-5, -3), (-4, 0)]) == [(-5, 0)]

def test_no_mutation():
    src = [(5, 6), (1, 3)]
    copy = list(src)
    merge_ranges(src)
    assert src == copy, "input list was mutated"
"""

# --- documentation ----------------------------------------------------------
# Graded objectively: the source file's public symbols are parsed with `ast`,
# and the generated documentation is checked for coverage of each one. This is
# why the docs task is more objective than open-ended prose.

_DOC_SOURCE = '''
class RateLimiter:
    """Token-bucket rate limiter."""

    def __init__(self, capacity, refill_per_sec, now=None):
        self.capacity = capacity
        self.refill_per_sec = refill_per_sec
        self._tokens = float(capacity)
        self._last = now or 0.0

    def acquire(self, tokens=1, now=None):
        self._refill(now)
        if self._tokens >= tokens:
            self._tokens -= tokens
            return True
        return False

    def remaining(self):
        return int(self._tokens)

    def _refill(self, now):
        if now is None:
            return
        delta = max(0.0, now - self._last)
        self._tokens = min(self.capacity, self._tokens + delta * self.refill_per_sec)
        self._last = now
'''

_DOC_PROMPT = """\
Write reference documentation in Markdown for this Python class.

Document every public method: its purpose, every parameter, the return value,
and any non-obvious behaviour. Note that `acquire` is a no-op refill when `now`
is None. Do not document private methods.

```python
%s```
""" % _DOC_SOURCE


TASKS: List[Task] = [
    Task(
        id="merge-ranges",
        category="coding",
        scoring="exec",
        prompt=_CODING_PROMPT,
        tests=_CODING_TESTS,
        max_tokens=1400,
        judge_rubric="Does this implementation correctly merge overlapping AND "
        "touching ranges, handle unsorted input, and avoid mutating "
        "its argument?",
    ),
    Task(
        id="ratelimiter-docs",
        category="writing",
        scoring="symbols",
        prompt=_DOC_PROMPT,
        max_tokens=1600,
        expect_symbols=[
            "RateLimiter",
            "acquire",
            "remaining",
            "capacity",
            "refill_per_sec",
            "tokens",
            "now",
        ],
        judge_rubric="Is every public method documented with its parameters, "
        "return value, and edge-case behaviour?",
    ),
    Task(
        id="reasoning-audit",
        category="general",
        scoring="exec",
        max_tokens=1400,
        prompt="""\
The function below is meant to return the median of a list of numbers, but it
has bugs. Write a corrected version with this exact signature:

    def median(values: list[float]) -> float:

Broken version:

    def median(values):
        values.sort()
        mid = len(values) / 2
        return values[mid]

Requirements:
- Even-length input returns the mean of the two middle values.
- Must not mutate the caller's list.
- Empty input raises ValueError.

Respond with ONLY one Python code block. No explanation.
""",
        tests="""
import pytest

def test_odd():
    assert median([3, 1, 2]) == 2

def test_even():
    assert median([1, 2, 3, 4]) == 2.5

def test_single():
    assert median([7]) == 7

def test_no_mutation():
    src = [3, 1, 2]
    copy = list(src)
    median(src)
    assert src == copy, "input list was mutated"

def test_empty_raises():
    try:
        median([])
    except ValueError:
        return
    raise AssertionError("empty input should raise ValueError")

def test_negative():
    assert median([-3, -1, -2]) == -2
""",
        judge_rubric="Does this correctly compute the median for odd and even "
        "lengths, avoid mutating the input, and raise on empty?",
    ),
    Task(
        id="chart-critique",
        category="vision",
        scoring="judge",
        needs_image=True,
        max_tokens=900,
        prompt="Describe this image precisely. State the type of chart, the "
        "number of distinct bars, their relative heights from left to "
        "right, and the colours used. Then critique the composition.",
        judge_rubric="Did the description correctly identify a bar chart, the "
        "number of bars, and their relative heights?",
    ),
    Task(
        id="tts-render",
        category="audio",
        scoring="audio",
        max_tokens=800,
        prompt="The quick brown fox jumps over the lazy dog. "
        "Local inference on Apple Silicon is remarkably fast.",
        judge_rubric=None,
    ),
    Task(
        id="retrieval",
        category="utility",
        scoring="embed",
        max_tokens=0,
        prompt="",
        judge_rubric=None,
    ),
]

TASKS_BY_CATEGORY: Dict[str, Task] = {t.category: t for t in TASKS}

# Categories with no runnable task yet. Kept explicit so the report can say
# "not benchmarked because nothing can run it" rather than silently omitting.
PLACEHOLDER_CATEGORIES = {
    "music": (
        "No music/beat generation model exists in the GGUF ecosystem, and "
        "llama.cpp has no music architecture. The MusicGen GGUF repos on "
        "HuggingFace target other runtimes and are unmaintained. Speech "
        "synthesis IS supported (see the audio category, arch qwen3tts)."
    ),
    "image-generation": (
        "llama.cpp cannot generate images. FLUX.1/FLUX.2, SD3.5 and Qwen-Image "
        "all ship GGUF weights, but they run in stable-diffusion.cpp - a "
        "separate engine. Adding it as a second submodule would make this "
        "category real; until then vision models are scored on interpretation."
    ),
}


def embedding_probe_set() -> List[Dict[str, object]]:
    """Fixed retrieval set for embedding models: each query's correct answer is
    the document at the matching index. Objective recall@1, no judge."""
    return [
        {
            "query": "How do I merge two sorted lists in Python?",
            "docs": [
                "Use heapq.merge to lazily merge sorted iterables.",
                "A token bucket limits request rate over time.",
                "Metal is Apple's GPU compute API.",
                "GGUF is the llama.cpp model container format.",
            ],
            "correct": 0,
        },
        {
            "query": "What limits how many API calls I can make per second?",
            "docs": [
                "Use heapq.merge to lazily merge sorted iterables.",
                "A token bucket limits request rate over time.",
                "Metal is Apple's GPU compute API.",
                "GGUF is the llama.cpp model container format.",
            ],
            "correct": 1,
        },
        {
            "query": "Which framework runs compute shaders on an M4 GPU?",
            "docs": [
                "Use heapq.merge to lazily merge sorted iterables.",
                "A token bucket limits request rate over time.",
                "Metal is Apple's GPU compute API.",
                "GGUF is the llama.cpp model container format.",
            ],
            "correct": 2,
        },
        {
            "query": "What file format stores quantized local model weights?",
            "docs": [
                "Use heapq.merge to lazily merge sorted iterables.",
                "A token bucket limits request rate over time.",
                "Metal is Apple's GPU compute API.",
                "GGUF is the llama.cpp model container format.",
            ],
            "correct": 3,
        },
    ]
