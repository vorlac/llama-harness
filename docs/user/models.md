# Models

Choosing, installing and validating local GGUF models: the curated catalog, how the harness
decides what fits in unified memory, what an install actually verifies, and how to add a model
of your own. The single tool for all of it is
[`scripts/fetch_models.py`](../../scripts/fetch_models.py).

## The catalog

The catalog is a plain Python list in [`scripts/models_catalog.py`](../../scripts/models_catalog.py).
It holds 24 models in five categories, and it is the only place model metadata lives — the
installer, the config generator and the benchmark all read from it.

| Category  | What it is for                                              |
| --------- | ----------------------------------------------------------- |
| `coding`  | Coding and agentic software engineering (primary focus)     |
| `general` | General reasoning, analysis and instruction following       |
| `writing` | Prose, documentation and long-form writing                  |
| `vision`  | Vision / multimodal — image understanding and art critique  |
| `utility` | Embeddings and rerankers (retrieval for the future harness) |

Each entry is a `Model` dataclass. The fields that matter when you are choosing:

| Field                      | Meaning                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` / `title`             | The name you type (`ornith-35b`) and the human-readable one (`Ornith 1.0 35B (MoE)`)                                                                                         |
| `repo`                     | HuggingFace repo the weights come from                                                                                                                                       |
| `params` / `license`       | Parameter count, including active params for MoE models, and the license verbatim from the model card                                                                        |
| `context` / `serve_ctx`    | Native context length, and the context the harness actually serves with — kept well below native, because KV cache is what pushes a comfortable model over the memory budget |
| `quants` / `default_quant` | Quant token to measured total size in GB, and which one `install` picks when you do not name one                                                                             |
| `notes`                    | Why this model is in the catalog and what it is good for                                                                                                                     |
| `mmproj`                   | Preferred projector precision (`F16`, `BF16`, `Q8_0`) for vision models                                                                                                      |
| `experimental`             | Exotic quant or brand-new architecture; excluded from bulk installs                                                                                                          |
| `sampling`                 | Extra `llama-server` preset keys written into the generated INI                                                                                                              |

Sizes in `quants` are **measured**, not estimated: each is the sum of every shard for that
quant, read from the HuggingFace file tree API (`/api/models/<repo>/tree/main`). They drive the
offline `list` view and the fit calculation; the real file list is resolved live at download
time, so shard names are never hard-coded.

### Where to start

| Category        | Good starting point   | Why                                                                          |
| --------------- | --------------------- | ---------------------------------------------------------------------------- |
| `coding`        | `ornith-35b`          | Strongest all-round agentic coder that fits comfortably; MIT licensed        |
| `coding` (fast) | `qwen3-coder-30b`     | 3B active params, so it is quick and leaves room for a large KV cache        |
| `general`       | `qwen3.6-27b`         | Dense current-generation reasoner; the model conductor serves for every role |
| `writing`       | `gemma-4-26b-a4b`     | Near-31B prose quality at roughly 4B-active speed                            |
| `vision`        | `qwen3-vl-30b`        | First-party Qwen vision build; best for mockups and screenshots              |
| `utility`       | `embeddinggemma-300m` | 0.3 GB, cheap enough to keep resident next to a coder                        |

The full catalog — every model, quant, license and capability set — is tabulated in
[`scripts/README.md`](../../scripts/README.md). This page does not duplicate it.

## Listing and inspecting

`list` prints the catalog with the fit verdict for *this* machine:

```text
$ scripts/fetch_models.py list
Host  64 GiB RAM  |  usable for weights: 52 GB (macOS default (75% of RAM))  |  comfortable: 42 GB
  Model sizes are decimal GB, matching HuggingFace. 64 GiB RAM = 68.7 GB.
  'comfortable' reserves 9 GB for KV cache and compute buffers.

Coding & agentic software engineering (primary focus)
  ornith-35b             Ornith 1.0 35B (MoE)              26.5 GB  fits
  ornith-9b              Ornith 1.0 9B (dense)              9.5 GB  fits     [installed]
  qwen3-coder-next       Qwen3-Coder-Next 80B-A3B          48.0 GB  tight    [installed]
  qwen3-coder-30b        Qwen3-Coder 30B-A3B Instruct      25.1 GB  fits     [installed]
```

`[installed]` means a validated manifest exists *and* the files on disk still match it.
`(experimental)` marks entries that may need a newer llama.cpp than the pinned submodule.

`--long` adds four more lines per model, plus the notes wrapped to 72 columns: params, license
and both context numbers; the repo; the capability list (`tools, reasoning, vision`); and every
quant with its size and the default starred. `--json` emits the same data machine-readably —
budget, categories, and each model with its `fit` label and `installed` flag — which is how
`setup.sh` reads the catalog without parsing colored output.

`info` is the single-model view, with the fit verdict per quant:

```text
$ scripts/fetch_models.py info qwen3.6-27b
Qwen3.6 27B (dense)  (qwen3.6-27b)
  repo        unsloth/Qwen3.6-27B-GGUF
  category    general
  params      27B
  license     Apache-2.0
  context     262,144 native, served at 65,536

  QUANT                  SIZE   FIT
  Q4_K_M             16.82 GB  fits
  UD-Q4_K_XL         17.61 GB  fits
  Q5_K_M             19.51 GB  fits
  Q6_K               22.52 GB  fits *
  Q8_0               28.60 GB  fits
```

`info <id> --remote` additionally queries HuggingFace and prints every quant token the repo
really publishes, with real sizes. That is the check to run when a catalog entry looks wrong,
or when you are adding one.

## Will it fit?

Two numbers decide whether a model loads, and neither is the sticker capacity of the machine.

**The Metal budget.** macOS will not let the GPU wire more than `iogpu.wired_limit_mb` bytes of
unified memory. When that sysctl is 0 — the default — the driver allows roughly **75% of
physical RAM**. On a 64 GiB (68.7 GB) box that is about 52 GB for weights.

**KV cache on top.** Weights are not the whole allocation: the KV cache and compute buffers sit
beside them and grow with context length. The tool reserves `max(6 GB, 18% of the budget)` as
headroom and calls what is left *comfortable* — on the same box, 9 GB of headroom and 42 GB
comfortable. Those two numbers produce three tiers:

| Tier      | Condition                   | What it means                                                             |
| --------- | --------------------------- | ------------------------------------------------------------------------- |
| `fits`    | size ≤ comfortable          | Weights plus headroom fit inside the Metal budget                         |
| `tight`   | comfortable < size ≤ budget | Weights fit, headroom is thin — lower `ctx-size` or raise the wired limit |
| `too big` | size > budget               | Will not load                                                             |

To use more than the default 75%, raise the wired limit:
`sudo sysctl iogpu.wired_limit_mb=57344` allows 56 GiB.

`list`, `info`, `install` and `status` all re-read that sysctl and recalculate, and print which
rule applied. This is what makes the largest coder viable: `qwen3-coder-next` at `MXFP4_MOE`
(48.03 GB) reads `tight` at the default and `fits` once the limit is raised. The wired limit
**resets on reboot** — set it again, or make it a login item, if you depend on it.
`--vram-budget GB` overrides detection entirely on every subcommand that reports fit.

**Decimal GB, not GiB.** Every size in the catalog and every size the tool prints is decimal GB
(10⁹ bytes), because that is what HuggingFace reports and what you are comparing against. RAM
is quoted in GiB (2³⁰ bytes), because that is how the machine is sold. The two are 7.4% apart:
64 GiB of RAM is 68.7 GB, and the header prints both so the arithmetic is visible rather than
implied. On non-Apple hardware the budget falls back to 90% of system RAM, since discrete VRAM
is not detected.

## Installing

Install by id, and the tool downloads, validates and regenerates the configs in one pass:

```bash
scripts/fetch_models.py install ornith-35b
scripts/fetch_models.py install ornith-35b qwen3-coder-30b   # several at once
scripts/fetch_models.py install --category coding            # a whole category
scripts/fetch_models.py install --all                        # everything non-experimental
```

`--category` is repeatable and takes any of the five category ids. Both `--category` and `--all`
skip `experimental` entries — those you must name explicitly. Before anything is downloaded you
get a plan: every model, its quant, its size and its fit label, then the total, then the free
space on the volume. The install refuses to start unless free space exceeds the download by at
least 5%, and prompts for confirmation on a terminal (`-y` skips the prompt).

| Flag               | Effect                                                    |
| ------------------ | --------------------------------------------------------- |
| `--quant Q`        | Override the default quant. Single model only             |
| `--with-mmproj`    | Also fetch the vision projector, where the repo ships one |
| `-j N`             | Parallel range connections per file (default 8)           |
| `--no-hash-check`  | Skip SHA-256. Faster, and weaker                          |
| `--force`          | Refetch even if already validated                         |
| `--no-config`      | Do not touch `.data/configs/`                             |
| `--vram-budget GB` | Override the detected budget for the fit labels           |
| `-y`               | Skip the confirmation prompt                              |

**Vision needs `--with-mmproj`** (`scripts/fetch_models.py install qwen3-vl-30b --with-mmproj`).
A multimodal model installed without its projector loads as text-only, and the generated
`opencode.json` honestly reports `attachment: false` for it. The catalog's `mmproj` field names
the precision to prefer; if the repo has none the install warns and continues without vision.

**`--force` really refetches.** A corrupt file usually has the *right* size, so the resume fast
path would happily keep it. `--force` deletes the file and both resume sidecars first.

**Downloads resume at 32 MB granularity.** Each file is split into 32 MB chunks fetched by
parallel HTTP range requests and written at their offsets; completed chunk indices are flushed
to a `<file>.part.json` sidecar as they land. Interrupt an install at any point and re-running
it skips every chunk already on disk. Individual chunks retry four times with backoff before
the install fails, and servers that refuse range requests fall back to a single resumable
stream.

## What validation actually checks

Downloads are not trusted. Every install runs an ordered chain, and the first failure stops
that model and marks its manifest `validated: false`:

1. **Exact byte size** against the size the HuggingFace file tree published for that file.
2. **SHA-256** against the LFS `oid`. For LFS-tracked files the oid *is* the sha256 of the
   content, so this is the publisher's own content hash, not a size heuristic. Plain git blobs
   carry a sha1 and are never compared against a sha256 digest.
3. **GGUF magic and version**, by parsing the header directly: the file must start with `GGUF`
   and declare version 2 or 3. Only a bounded prefix is read, so a 48 GB file costs nothing
   extra to inspect.
4. **Shard-count consistency** — the `split.count` field inside the GGUF metadata must equal the
   number of files actually downloaded. This catches a "successful" install that quietly fetched
   three of four shards.

The structural checks run on the first shard; the rest are proven by their hashes. Projector
files are size-checked but are not part of the weight set. An empty file list never validates
vacuously — no recorded files is itself a failure, so a half-written install cannot report as
healthy.

### The manifest

Success writes `.data/models/<id>/.manifest.json`:

```json
{
  "manifest_version": 1,
  "model_id": "ornith-9b",
  "repo": "ornith-ai/Ornith-1.0-9B-GGUF",
  "quant": "Q4_K_M",
  "validated": true,
  "validated_at": "2026-08-07T02:08:53Z",
  "hash_checked": true,
  "total_bytes": 5629108704,
  "primary": "ornith-1.0-9b-Q4_K_M.gguf",
  "mmproj": null,
  "files": [
    { "name": "ornith-1.0-9b-Q4_K_M.gguf", "size": 5629108704, "sha256": "5720d1f6..." }
  ],
  "gguf": { "gguf_version": 3, "tensor_count": 427,
            "general.architecture": "qwen35", "qwen35.context_length": 262144 }
}
```

File records also carry the repo-relative `path` and the full digest; `gguf` also records
`kv_count`, `general.name`, `general.size_label` and `general.file_type`. A failed install
writes the same manifest with `validated: false` plus a `problems` array, keeping the file list
so `verify` and `--force` have something concrete to repair against.

**This is verification, not trust.** The hashes are the publisher's, checked locally against
bytes on disk; nothing is accepted because the download "looked fine". And `validated: true` is
never taken at face value later — every decision to skip work re-checks that each recorded file
still exists at its recorded size, because a manifest proves nothing about files that were
since deleted, moved or truncated.

## Verifying, removing, status

```bash
scripts/fetch_models.py verify                    # re-check everything installed
scripts/fetch_models.py verify ornith-35b         # one model
scripts/fetch_models.py verify --no-hash-check    # size and header checks only
scripts/fetch_models.py remove laguna-s-2.1       # delete weights, regenerate configs
scripts/fetch_models.py status                    # what is installed and configured
```

`verify` re-runs the whole chain and rewrites the `validated` flag in each manifest with what it
found, so a verify also repairs the bookkeeping; it exits non-zero if any model failed.
`remove` deletes `.data/models/<id>` and regenerates the configs unless you pass `--no-config`.
`status` is the one-screen summary — what is installed, at which quant, whether it was
hash-checked, the total on disk, whether the llama.cpp tools are current, and whether each
generated config file is present:

```text
$ scripts/fetch_models.py status
Installed models  ->  /Users/you/llama-harness/.data/models
  ornith-9b            Q4_K_M        5.63 GB  fits   hash-checked
  qwen3-coder-next     MXFP4_MOE    48.03 GB  tight  hash-checked
  qwen3-coder-30b      Q6_K         25.09 GB  fits   hash-checked
                                    78.75 GB total on disk

llama.cpp tools: up to date with submodule 8e7f22b67ef4
opencode.json:     present
llama-models.ini:  present
benchmark.json:    present
launch.sh:         present
```

## Configuration regeneration

Every `install` and `remove` regenerates the configs. You can also do it alone, which is how you
change the port or the served context without touching a byte of weights:

```bash
scripts/fetch_models.py config
scripts/fetch_models.py config --port 9000 --serve-ctx 32768
```

| File                             | Contents                                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.data/configs/llama-models.ini` | The `llama-server` router preset: one section per model id, with its `model` path, optional `mmproj`, `ctx-size`, category `tags` and the catalog's sampling keys                                                    |
| `.data/configs/opencode.json`    | The opencode provider block pointing at `http://<host>:<port>/v1`, with one entry per chat model — context limits, tool-call and reasoning flags, and `attachment` set only when a projector was actually downloaded |
| `.data/configs/benchmark.json`   | The benchmark plan: exactly the installed models, their tasks and the ten presets                                                                                                                                    |
| `.data/scripts/launch.sh`        | A one-line wrapper around `scripts/serve.py`                                                                                                                                                                         |

Only models with a validated manifest whose files are still intact are written out. Embedding
and reranker models appear in the INI — the router serves them — but deliberately not in
`opencode.json`, because they are not chat models and must not be selectable as an agent model.

`--models-max N` sets how many models stay resident at once. The default is 1, which is what
makes switching models in the opencode picker a transparent swap rather than an out-of-memory
error; raise it only for combinations that genuinely fit side by side, such as a 12 GB coder
plus a 0.3 GB embedder. The value that actually reaches `llama-server` is the one `serve.py`
passes (`scripts/serve.py --models-max 2`), remembered in `.data/configs/serve-session.json`.

## Adding your own model

Append a `Model` to `CATALOG` in [`scripts/models_catalog.py`](../../scripts/models_catalog.py).
Required fields are `id`, `repo`, `title`, `category`, `params`, `license`, `context`, `quants`,
`default_quant` and `notes`; everything else has a default.

```python
Model(
    id="my-model-13b",
    repo="someone/My-Model-13B-GGUF",
    title="My Model 13B",
    category="coding",
    params="13B",
    license="Apache-2.0",
    context=131072,
    quants={"Q4_K_M": 8.12, "Q6_K": 10.94, "Q8_0": 14.16},
    default_quant="Q6_K",
    serve_ctx=65536,   # optional, defaults to 32768
    notes="Why this model is worth having.",
),
```

To measure the sizes rather than guess them, add the entry with placeholder numbers and run
`scripts/fetch_models.py info my-model-13b --remote`. It prints every quant token the repo
publishes with the summed size of its shards — copy those numbers into `quants`. You never
hard-code file names: the quant token is matched against the repo tree at download time, and
the matcher understands the four layouts seen in the wild (root-level single file, root-level
shards, a quant-named directory, and a full-name directory). When a repo publishes both a
monolithic file and a sharded copy of the same quant, the monolithic one wins.

Then run `scripts/fetch_models.py list --long` to confirm the entry renders and lands in the
right fit tier. Set `experimental=True` if the quant format or architecture may need a newer
llama.cpp than the pinned submodule — that keeps it out of `--all` and `--category` installs.
Set `vision=True` plus `mmproj="F16"` if the repo ships a projector, and use `sampling={...}`
to carry the model author's recommended settings into the generated INI.

## Gated repositories

Some repos require accepting terms before they can be read. HuggingFace answers those with 401
or 403, and the tool stops with the fix rather than a stack trace:

```text
error: HuggingFace returned 403 for https://huggingface.co/api/models/<repo>/tree/main...
This repo is gated or private. Accept its terms on the model page and export
HF_TOKEN=<your token>.
```

Accept the terms on the model page with the same account, create a read token, then
`export HF_TOKEN=<token>` and re-run the install.

| Variable       | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `HF_TOKEN`     | Token for gated or private repos. `HUGGING_FACE_HUB_TOKEN` is also accepted |
| `HF_ENDPOINT`  | Use a mirror instead of `https://huggingface.co`                            |
| `LLAMA_SERVER` | Explicit path to a `llama-server` binary                                    |

The token is sent as a bearer header on both the tree API call and every range request, so one
export covers metadata and download alike. A 404 is reported separately — that is a wrong repo
name, not a permissions problem.

## See also

- [Serving](serving.md) — the router, model swapping, and landing in a ready shell
- [Installation](installation.md) — first-time setup and the pinned llama.cpp submodule
- [Benchmarking](benchmarking.md) — presets, tasks and the three scoring tiers
- [Troubleshooting](troubleshooting.md) — when an install or a load goes wrong
- [`scripts/README.md`](../../scripts/README.md) — the full catalog and the deep reference
