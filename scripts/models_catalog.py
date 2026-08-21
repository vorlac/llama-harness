"""Curated catalog of local GGUF models that fit a 64 GB unified-memory machine.

Every size in this file was measured against the HuggingFace file tree API
(``/api/models/<repo>/tree/main``) rather than estimated.  Sizes are the sum of
all shards for that quant and are refreshed live at download time, so the values
here are only used for the offline ``list`` view and the fit calculation.

Adding a model
--------------
Append a :class:`Model` to :data:`CATALOG`.  ``quants`` maps a quant token to its
measured size in GB.  The quant token is matched against the repo's file tree at
download time using :func:`fetch.match_quant`, which understands every layout
seen in the wild:

* ``Model-UD-Q4_K_XL.gguf``                       (root-level single file)
* ``Model-Q6_K-00001-of-00003.gguf``              (root-level shards)
* ``Q6_K/Model-Q6_K-00001-of-00003.gguf``         (quant-named directory)
* ``Model-Q6_K/Model-Q6_K-00001-of-00003.gguf``   (full-name directory)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# Categories, in the order they are displayed.  The description doubles as the
# section blurb in `list` output and in scripts/README.md.
CATEGORIES = [
    ("coding", "Coding & agentic software engineering (primary focus)"),
    ("general", "General reasoning, analysis & instruction following"),
    ("writing", "Prose, documentation & long-form writing"),
    ("vision", "Vision / multimodal - image understanding & art critique"),
    ("utility", "Embeddings & rerankers (retrieval for the future harness)"),
]


@dataclass
class Model:
    """One downloadable model configuration."""

    id: str
    repo: str
    title: str
    category: str
    params: str
    license: str
    context: int
    """Native context length in tokens, per the model card."""

    quants: Dict[str, float]
    """Quant token -> measured total size in GB (10^9 bytes)."""

    default_quant: str
    notes: str

    serve_ctx: int = 32768
    """Context to actually serve with.  Kept well below `context` because KV
    cache is what pushes a comfortable model over the VRAM budget."""

    tool_call: bool = True
    reasoning: bool = False
    vision: bool = False
    embedding: bool = False
    reranker: bool = False

    mmproj: Optional[str] = None
    """Preferred mmproj precision token (``F16``/``BF16``/``Q8_0``) when the repo
    ships a multimodal projector.  Only downloaded with ``--with-mmproj``."""

    experimental: bool = False
    """Exotic quant formats or brand-new architectures that may need a newer
    llama.cpp than the pinned submodule.  Excluded from bulk installs."""

    sampling: Dict[str, str] = field(default_factory=dict)
    """Extra llama-server preset keys (de-dashed CLI option -> value)."""

    @property
    def default_size_gb(self) -> float:
        return self.quants[self.default_quant]

    def size_gb(self, quant: Optional[str] = None) -> float:
        return self.quants[quant or self.default_quant]


# Qwen team's published recommendation for
# the Coder line: greedy-ish, no repetition
# penalty (it damages code).
_QWEN_CODER = {
    "temp": "0.7",
    "top-p": "0.8",
    "top-k": "20",
    "repeat-penalty": "1.05",
}

# Qwen thinking/instruct line.
_QWEN_CHAT = {
    "temp": "0.7",
    "top-p": "0.8",
    "top-k": "20",
    "min-p": "0.0",
}

# Qwen3.8 serves with thinking mode enabled, which its
# card pairs with a hotter, wider profile than the
# instruct settings above.
_QWEN_THINKING = {
    "temp": "1.0",
    "top-p": "0.95",
    "top-k": "20",
    "min-p": "0.0",
}

# Gemma line.
_GEMMA = {
    "temp": "1.0",
    "top-p": "0.95",
    "top-k": "64",
}


CATALOG: List[Model] = [
    # ======================================================================
    # CODING - the primary focus.
    # ======================================================================
    Model(
        id="ornith-35b",
        repo="unsloth/Ornith-1.0-35B-GGUF",
        title="Ornith 1.0 35B (MoE)",
        category="coding",
        params="35B MoE",
        license="MIT",
        context=262144,
        quants={
            "UD-Q4_K_XL": 22.32,
            "UD-Q5_K_M": 26.46,
            "UD-Q6_K_XL": 31.84,
            "Q8_0": 36.90,
            "MXFP4_MOE": 21.67,
        },
        default_quant="UD-Q5_K_M",
        serve_ctx=65536,
        reasoning=True,
        vision=True,
        mmproj="F16",
        notes=(
            "Self-improving agentic coder from Deep Reinforce; SOTA among open "
            "models on Terminal-Bench 2.1 / SWE-Bench for its size. MIT licensed. "
            "Best all-round pick for agentic coding on this box."
        ),
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="ornith-35b-official",
        repo="ornith-ai/Ornith-1.0-35B-GGUF",
        title="Ornith 1.0 35B (first-party GGUF)",
        category="coding",
        params="35B MoE",
        license="MIT",
        context=262144,
        quants={
            "Q4_K_M": 21.17,
            "Q5_K_M": 24.73,
            "Q6_K": 28.51,
            "Q8_0": 36.90,
        },
        default_quant="Q5_K_M",
        serve_ctx=65536,
        reasoning=True,
        notes="First-party conversions of the same weights - plain quants, no imatrix.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="ornith-9b",
        repo="ornith-ai/Ornith-1.0-9B-GGUF",
        title="Ornith 1.0 9B (dense)",
        category="coding",
        params="9B",
        license="MIT",
        context=262144,
        quants={
            "Q4_K_M": 5.63,
            "Q5_K_M": 6.47,
            "Q6_K": 7.36,
            "Q8_0": 9.53,
        },
        default_quant="Q8_0",
        serve_ctx=65536,
        reasoning=True,
        notes="Small sibling of Ornith-35B. Fast enough for tight edit/test loops; "
        "also a good speculative-decoding draft model.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="qwen3-coder-next",
        repo="unsloth/Qwen3-Coder-Next-GGUF",
        title="Qwen3-Coder-Next 80B-A3B",
        category="coding",
        params="80B MoE / 3B active",
        license="Apache-2.0",
        context=262144,
        quants={
            "MXFP4_MOE": 48.03,
            "Q4_K_M": 48.53,
            "Q5_K_M": 56.85,
            "Q6_K": 65.61,
        },
        default_quant="MXFP4_MOE",
        serve_ctx=32768,
        notes=(
            "Only 3B active params so it runs fast, but all 80B must be resident. "
            "TIGHT on 64 GB: raise the Metal wired limit first (see README). "
            "Purpose-built for CLI/IDE coding agents; 256K native context."
        ),
        sampling=_QWEN_CODER,
    ),
    Model(
        id="qwen3-coder-30b",
        repo="unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF",
        title="Qwen3-Coder 30B-A3B Instruct",
        category="coding",
        params="30B MoE / 3B active",
        license="Apache-2.0",
        context=262144,
        quants={
            "UD-Q4_K_XL": 17.67,
            "Q5_K_M": 21.73,
            "Q6_K": 25.09,
            "UD-Q6_K_XL": 26.34,
            "Q8_0": 32.48,
        },
        default_quant="Q6_K",
        serve_ctx=65536,
        notes="The proven local-coding workhorse. Very fast (3B active) and leaves "
        "plenty of headroom for a large KV cache.",
        sampling=_QWEN_CODER,
    ),
    Model(
        id="kat-coder-v2.5",
        repo="bartowski/Kwaipilot_KAT-Coder-V2.5-Dev-GGUF",
        title="KAT-Coder V2.5 Dev",
        category="coding",
        params="~32B",
        license="Custom (Kwaipilot)",
        context=131072,
        quants={
            "Q4_K_M": 21.39,
            "Q5_K_M": 25.02,
            "Q6_K": 30.05,
            "Q8_0": 36.91,
        },
        default_quant="Q6_K",
        serve_ctx=65536,
        notes="Kwaipilot's agentic coder, tuned for real repo-scale edits. "
        "Strong alternative opinion to the Qwen line for adversarial review.",
    ),
    Model(
        id="devstral-small-2",
        repo="unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF",
        title="Devstral Small 2 24B",
        category="coding",
        params="24B",
        license="Apache-2.0",
        context=131072,
        quants={
            "Q4_K_M": 14.33,
            "UD-Q4_K_XL": 14.51,
            "Q5_K_M": 16.76,
            "Q6_K": 19.35,
            "Q8_0": 25.06,
        },
        default_quant="Q8_0",
        serve_ctx=65536,
        vision=True,
        mmproj="F16",
        notes="Mistral's agentic coding model, built for tool-calling harnesses. "
        "Dense 24B - fits at Q8_0 with room to spare.",
        sampling={"temp": "0.15", "top-p": "1.0"},
    ),
    Model(
        id="qwen2.5-coder-32b",
        repo="Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
        title="Qwen2.5-Coder 32B Instruct",
        category="coding",
        params="32B",
        license="Apache-2.0",
        context=131072,
        quants={
            "q4_k_m": 19.85,
            "q5_k_m": 23.26,
            "q6_k": 26.89,
            "q8_0": 34.82,
        },
        default_quant="q6_k",
        serve_ctx=65536,
        notes="Older but extremely well-understood dense coder with excellent "
        "fill-in-the-middle support. Useful as a stable quality baseline.",
        sampling=_QWEN_CODER,
    ),
    Model(
        id="gpt-oss-20b",
        repo="unsloth/gpt-oss-20b-GGUF",
        title="gpt-oss 20B",
        category="coding",
        params="21B MoE / 3.6B active",
        license="Apache-2.0",
        context=131072,
        quants={
            "Q4_K_M": 11.62,
            "Q5_K_M": 11.72,
            "Q6_K": 12.04,
            "Q8_0": 12.11,
        },
        default_quant="Q8_0",
        serve_ctx=65536,
        reasoning=True,
        notes="Natively MXFP4, so every quant lands near 12 GB - just take Q8_0. "
        "Reasoning model with adjustable effort; very fast on Metal.",
        sampling={"temp": "1.0", "top-p": "1.0", "top-k": "0"},
    ),
    Model(
        id="laguna-s-2.1",
        repo="unsloth/Laguna-S-2.1-GGUF",
        title="Laguna-S 2.1 (poolside)",
        category="coding",
        params="Large MoE",
        license="Custom (poolside)",
        context=131072,
        quants={
            "UD-Q2_K_XL": 39.68,
            "UD-IQ3_XXS": 44.28,
            "UD-IQ3_S": 48.43,
        },
        default_quant="UD-IQ3_XXS",
        serve_ctx=16384,
        experimental=True,
        notes=(
            "poolside's coding model. Only sub-4-bit quants fit in 64 GB (Q4 is "
            "54 GB+), so quality is materially degraded vs. the models above. "
            "Included for experimentation - not a daily driver here."
        ),
    ),
    # ======================================================================
    # GENERAL REASONING
    # ======================================================================
    Model(
        id="qwen3.8-27b",
        repo="unsloth/Qwen3.8-27B-GGUF",
        title="Qwen3.8 27B (dense)",
        category="general",
        params="27B",
        license="Apache-2.0",
        context=262144,
        quants={
            "UD-Q4_K_M": 16.46,
            "UD-Q4_K_XL": 17.56,
            "UD-Q5_K_M": 19.77,
            "UD-Q6_K": 21.98,
            "UD-Q6_K_XL": 25.30,
            "Q8_0": 29.05,
            "UD-Q8_K_XL": 31.46,
        },
        default_quant="UD-Q6_K",
        serve_ctx=65536,
        reasoning=True,
        vision=True,
        mmproj="F16",
        notes=(
            "Qwen3.8 dense flagship: hybrid Gated DeltaNet attention, thinking "
            "mode enabled by default and tunable per call, native image and video "
            "input. The one model of its generation that fits this box - the "
            "other 3.8 release is 2.4T parameters. Every quant listed clears the "
            "Metal budget, so choose on quality rather than on fit."
        ),
        sampling=_QWEN_THINKING,
    ),
    Model(
        id="qwen3.6-27b",
        repo="unsloth/Qwen3.6-27B-GGUF",
        title="Qwen3.6 27B (dense)",
        category="general",
        params="27B",
        license="Apache-2.0",
        context=262144,
        quants={
            "Q4_K_M": 16.82,
            "UD-Q4_K_XL": 17.61,
            "Q5_K_M": 19.51,
            "Q6_K": 22.52,
            "Q8_0": 28.60,
        },
        default_quant="Q6_K",
        serve_ctx=65536,
        reasoning=True,
        vision=True,
        mmproj="F16",
        notes="Qwen3.6 dense model. Strong general reasoning plus vision. A good "
        "adversarial reviewer to pair against a coding model.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="qwen3.6-35b-a3b",
        repo="unsloth/Qwen3.6-35B-A3B-GGUF",
        title="Qwen3.6 35B-A3B (MoE)",
        category="general",
        params="35B MoE / 3B active",
        license="Apache-2.0",
        context=262144,
        quants={
            "UD-Q4_K_XL": 22.36,
            "UD-Q5_K_M": 26.46,
            "UD-Q6_K": 29.31,
            "Q8_0": 36.90,
        },
        default_quant="UD-Q5_K_M",
        serve_ctx=65536,
        reasoning=True,
        vision=True,
        mmproj="F16",
        notes="MoE sibling of Qwen3.6-27B - much faster generation for a small "
        "quality trade. Best speed/quality balance in the general category.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="qwen3.5-35b-a3b",
        repo="unsloth/Qwen3.5-35B-A3B-GGUF",
        title="Qwen3.5 35B-A3B (MoE)",
        category="general",
        params="35B MoE / 3B active",
        license="Apache-2.0",
        context=262144,
        quants={
            "UD-Q4_K_XL": 22.24,
            "Q5_K_M": 26.25,
            "Q6_K": 28.85,
            "Q8_0": 36.90,
        },
        default_quant="Q6_K",
        serve_ctx=65536,
        reasoning=True,
        vision=True,
        mmproj="F16",
        notes="Previous Qwen generation. Keep alongside 3.6 when you want a "
        "second, genuinely independent opinion rather than a sibling checkpoint.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="olmo-3.1-32b-think",
        repo="bartowski/allenai_Olmo-3.1-32B-Think-GGUF",
        title="Olmo 3.1 32B Think",
        category="general",
        params="32B",
        license="Apache-2.0",
        context=65536,
        quants={
            "Q4_K_M": 19.48,
            "Q5_K_M": 22.86,
            "Q6_K": 26.45,
            "Q8_0": 34.25,
        },
        default_quant="Q6_K",
        serve_ctx=32768,
        reasoning=True,
        notes="AI2's fully-open reasoning model - open weights, data and training "
        "code. The one model here whose provenance is completely auditable.",
    ),
    # ======================================================================
    # WRITING & DOCUMENTATION
    #
    # These are general models chosen for prose quality, not "creative writing"
    # finetunes.  The finetune scene for writing is dominated by unaudited
    # community merges, which is a poor fit for a reproducible setup.
    # ======================================================================
    Model(
        id="gemma-4-31b",
        repo="unsloth/gemma-4-31B-it-GGUF",
        title="Gemma 4 31B Instruct",
        category="writing",
        params="31B",
        license="Gemma Terms of Use",
        context=131072,
        quants={
            "Q4_K_M": 18.32,
            "UD-Q4_K_XL": 18.82,
            "Q5_K_M": 21.66,
            "Q6_K": 25.20,
            "Q8_0": 32.64,
        },
        default_quant="Q8_0",
        serve_ctx=32768,
        vision=True,
        mmproj="F16",
        notes="The Gemma line is the strongest local option for natural prose - "
        "docs, READMEs, commit messages, design write-ups. Also multimodal.",
        sampling=_GEMMA,
    ),
    Model(
        id="gemma-4-26b-a4b",
        repo="unsloth/gemma-4-26B-A4B-it-GGUF",
        title="Gemma 4 26B-A4B (MoE)",
        category="writing",
        params="26B MoE / 4B active",
        license="Gemma Terms of Use",
        context=131072,
        quants={
            "MXFP4_MOE": 16.55,
            "UD-Q4_K_XL": 17.01,
            "UD-Q5_K_M": 21.15,
            "UD-Q6_K": 23.17,
            "Q8_0": 26.86,
        },
        default_quant="Q8_0",
        serve_ctx=65536,
        vision=True,
        mmproj="F16",
        notes="MoE Gemma - near-31B prose quality at roughly 4B-active speed. "
        "The best pick if you want writing help without waiting.",
        sampling=_GEMMA,
    ),
    Model(
        id="gemma-4-12b",
        repo="unsloth/gemma-4-12b-it-GGUF",
        title="Gemma 4 12B Instruct",
        category="writing",
        params="12B",
        license="Gemma Terms of Use",
        context=131072,
        quants={
            "Q4_K_M": 7.12,
            "Q5_K_M": 8.41,
            "Q6_K": 9.79,
            "Q8_0": 12.67,
        },
        default_quant="Q8_0",
        serve_ctx=65536,
        vision=True,
        mmproj="F16",
        notes="Lightweight writer. Small enough to keep resident next to a coding "
        "model when --models-max is raised above 1.",
        sampling=_GEMMA,
    ),
    # ======================================================================
    # VISION / MULTIMODAL
    # ======================================================================
    Model(
        id="qwen3-vl-30b",
        repo="Qwen/Qwen3-VL-30B-A3B-Instruct-GGUF",
        title="Qwen3-VL 30B-A3B Instruct",
        category="vision",
        params="30B MoE / 3B active",
        license="Apache-2.0",
        context=262144,
        quants={
            "Q4_K_M": 18.56,
            "Q8_0": 32.48,
        },
        default_quant="Q8_0",
        serve_ctx=32768,
        vision=True,
        mmproj="F16",
        notes="First-party Qwen vision-language build. Best local option for "
        "critiquing images, reading design mockups, and UI screenshots.",
        sampling=_QWEN_CHAT,
    ),
    Model(
        id="nemotron-3-nano-omni",
        repo="lmstudio-community/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-GGUF",
        title="Nemotron 3 Nano Omni 30B-A3B",
        category="vision",
        params="30B MoE / 3B active",
        license="NVIDIA Open Model License",
        context=131072,
        quants={
            "Q4_K_M": 24.52,
            "Q6_K": 33.51,
            "Q8_0": 33.59,
        },
        default_quant="Q6_K",
        serve_ctx=32768,
        reasoning=True,
        vision=True,
        mmproj="BF16",
        notes="NVIDIA's omni-modal reasoning model (image + audio input). "
        "Widest input-modality coverage of anything that fits here.",
    ),
    Model(
        id="ternary-bonsai-27b",
        repo="prism-ml/Ternary-Bonsai-27B-gguf",
        title="Ternary Bonsai 27B",
        category="vision",
        params="27B (ternary weights)",
        license="Check model card",
        context=131072,
        quants={
            "Q2_0": 7.17,
            "PQ2_0": 7.17,
            "Q2_g64": 7.59,
        },
        default_quant="Q2_0",
        serve_ctx=32768,
        vision=True,
        mmproj="Q8_0",
        experimental=True,
        notes=(
            "Natively ternary-trained - a 27B multimodal model in 7.2 GB, which is "
            "not the same thing as a 27B crushed down to 2 bits. Uses non-standard "
            "quant types (Q2_0/PQ2_0) that need a recent llama.cpp; verify support "
            "before relying on it."
        ),
    ),
    # ======================================================================
    # UTILITY - embeddings & reranking, for the retrieval side of the harness.
    # ======================================================================
    Model(
        id="qwen3-embedding-8b",
        repo="Qwen/Qwen3-Embedding-8B-GGUF",
        title="Qwen3 Embedding 8B",
        category="utility",
        params="8B",
        license="Apache-2.0",
        context=32768,
        quants={
            "Q4_K_M": 4.68,
            "Q5_K_M": 5.42,
            "Q6_K": 6.21,
            "Q8_0": 8.05,
            "f16": 15.14,
        },
        default_quant="Q8_0",
        serve_ctx=32768,
        tool_call=False,
        embedding=True,
        notes="Top-tier open embedding model. Use for repo-wide semantic search.",
        sampling={"embeddings": "true", "pooling": "last"},
    ),
    Model(
        id="qwen3-embedding-0.6b",
        repo="Qwen/Qwen3-Embedding-0.6B-GGUF",
        title="Qwen3 Embedding 0.6B",
        category="utility",
        params="0.6B",
        license="Apache-2.0",
        context=32768,
        quants={
            "Q8_0": 0.64,
            "f16": 1.20,
        },
        default_quant="f16",
        serve_ctx=32768,
        tool_call=False,
        embedding=True,
        notes="Cheap enough to keep permanently resident alongside a coder.",
        sampling={"embeddings": "true", "pooling": "last"},
    ),
    Model(
        id="embeddinggemma-300m",
        repo="ggml-org/embeddinggemma-300M-GGUF",
        title="EmbeddingGemma 300M",
        category="utility",
        params="300M",
        license="Gemma Terms of Use",
        context=2048,
        quants={
            "Q8_0": 0.33,
        },
        default_quant="Q8_0",
        serve_ctx=2048,
        tool_call=False,
        embedding=True,
        notes="Tiny, fast retrieval embeddings. Good default for a local index.",
        sampling={"embeddings": "true", "pooling": "mean"},
    ),
    Model(
        id="qwen3-reranker-0.6b",
        repo="ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF",
        title="Qwen3 Reranker 0.6B",
        category="utility",
        params="0.6B",
        license="Apache-2.0",
        context=32768,
        quants={
            "q8_0": 0.64,
        },
        default_quant="q8_0",
        serve_ctx=32768,
        tool_call=False,
        reranker=True,
        notes="Cross-encoder reranker - pair with an embedding model to sharpen "
        "retrieval before feeding context to a coder.",
        sampling={"reranking": "true"},
    ),
]

BY_ID = {m.id: m for m in CATALOG}


def get(model_id: str) -> Model:
    try:
        return BY_ID[model_id]
    except KeyError:
        raise SystemExit(
            "unknown model %r\nRun `fetch_models.py list` to see all %d models."
            % (model_id, len(CATALOG))
        )


def in_category(category: str) -> List[Model]:
    return [m for m in CATALOG if m.category == category]
