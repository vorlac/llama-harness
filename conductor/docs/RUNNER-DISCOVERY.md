# Runner discovery probe — proving the quarantine (Task 6.2)

Measured 2026-08-12 on `darwin/arm64` (macOS, Darwin 25.6.0). Every probe below was
actually executed; all output blocks are verbatim captures (long absolute scratchpad
paths appear as-is). Exit codes were recorded by appending `; echo "exit code: $?"`
immediately after each probe command.

**Question under test:** is a test file moved OUTSIDE the repository genuinely
unreachable by each supported whole-tree verify runner, and is the in-repo
alternative (a `.conductor/` dot-directory) genuinely safe or unsafe? Three probes
per runner:

- **(a)** deliberately failing test placed at `<fixture>/.conductor/runs/x/quarantine/`,
  run the runner's whole-tree command — is it collected?
- **(b)** the same failing file moved to an out-of-repo sibling path simulating
  `<stateHome>/conductor/<key>/quarantine/` — is it collected?
- **(c)** a `git worktree` created INSIDE the fixture repo at `<fixture>/wt`, on a
  branch whose committed tests include a deliberately failing one — does the main
  tree's whole-tree command collect the worktree's copies?

Each fixture is its own git repository created in the probe scratchpad (never inside
this repo). The out-of-repo quarantine path used throughout is
`…/scratchpad/probes/state-home/conductor/<fixture>/quarantine/` — a sibling directory
outside every fixture root.

Tool versions (verbatim probe output):

```
== node --version
v26.7.0
== /usr/bin/python3 -m pytest --version
pytest 8.4.2
== go version
go version go1.26.5 darwin/arm64
== ctest --version
ctest version 4.4.2
== cmake --version
cmake version 4.4.2
== git --version
git version 2.50.1 (Apple Git-155)
```

Note: `pytest` is not on PATH in this environment; it was invoked exactly as
`/usr/bin/python3 -m pytest` (Python 3.9.6) everywhere below.

---

## 1. node --test (node v26.7.0)

### Fixture layout (`probes/node-fx`, a git repo)

```
node-fx/
  test/pass.test.js                          # passing test, normal place (committed)
  .conductor/runs/x/quarantine/fail.test.js  # probe (a): deliberately failing
  wt/                                        # probe (c): git worktree on branch wt-branch
    test/pass.test.js
    test/wt_fail.test.js                     # deliberately failing (committed on wt-branch)
```

`fail.test.js` throws `Error('QUARANTINE_PROBE_FAILURE')`; `wt_fail.test.js` throws
`Error('WT_PROBE_FAILURE')`.

### Probe (a) — failing test in `.conductor/runs/x/quarantine/`

Command (cwd = fixture root):

```
node --test
```

Raw output:

```
✔ pass: normal-place test (0.281ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 37.572583
exit code: 0
```

Sanity check that the file really fails when executed —
`node --test .conductor/runs/x/quarantine/fail.test.js` (relevant lines):

```
✖ QUARANTINE_PROBE_FAILURE deliberately failing (0.247666ms)
ℹ fail 1
  Error: QUARANTINE_PROBE_FAILURE
exit code: 1
```

**Verdict (a): NOT COLLECTED** by the whole-tree run (node's default test-file glob
does not descend into the dot-directory) — but the file is one explicit argument away
from execution, as the sanity run shows.

### Probe (b) — failing test at the out-of-repo quarantine path

File moved to `…/probes/state-home/conductor/node-fx/quarantine/fail.test.js`;
`.conductor/` removed. Command (cwd = fixture root):

```
node --test
```

Raw output:

```
✔ pass: normal-place test (0.261042ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 36.801291
exit code: 0
```

**Verdict (b): NOT COLLECTED.**

### Probe (c) — git worktree inside the fixture

Setup: `git branch wt-branch && git worktree add wt wt-branch`, then
`test/wt_fail.test.js` committed on `wt-branch` (so it exists only in `wt/`).
Command (cwd = fixture root, main tree):

```
node --test
```

Raw output:

```
✔ pass: normal-place test (0.303375ms)
✔ pass: normal-place test (0.294ms)
✖ WT_PROBE_FAILURE deliberately failing (worktree copy) (0.288625ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40.575667

✖ failing tests:

test at wt/test/wt_fail.test.js:2:1
✖ WT_PROBE_FAILURE deliberately failing (worktree copy) (0.288625ms)
  Error: WT_PROBE_FAILURE
exit code: 1
```

**Verdict (c): COLLECTED** — the main tree's `node --test` ran BOTH copies of the
passing test and executed the worktree's failing test, turning the whole-tree run red.

---

## 2. pytest 8.4.2 (via `/usr/bin/python3 -m pytest`)

### Fixture layout (`probes/py-fx`, a git repo)

```
py-fx/
  tests/test_pass.py                                      # passing test (committed)
  .conductor/runs/x/quarantine/test_quarantine_fail.py    # probe (a): deliberately failing
  wt/                                                     # probe (c): worktree on wt-branch
    tests/test_pass.py
    tests/test_wt_fail.py                                 # deliberately failing (committed on wt-branch)
```

The failing tests are `assert False, "QUARANTINE_PROBE_FAILURE"` and
`assert False, "WT_PROBE_FAILURE"` respectively.

### Probe (a) — failing test in `.conductor/runs/x/quarantine/`

Command (cwd = fixture root):

```
/usr/bin/python3 -m pytest
```

Raw output:

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
rootdir: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx
collected 1 item

tests/test_pass.py .                                                     [100%]

============================== 1 passed in 0.00s ===============================
exit code: 0
```

Sanity check —
`/usr/bin/python3 -m pytest .conductor/runs/x/quarantine/test_quarantine_fail.py`
(relevant lines):

```
FAILED .conductor/runs/x/quarantine/test_quarantine_fail.py::test_quarantine_probe_failure
============================== 1 failed in 0.01s ===============================
exit code: 1
```

**Verdict (a): NOT COLLECTED** by the whole-tree run (pytest 8.4.2's default
`norecursedirs` skipped the dot-directory in this measurement) — yet the sanity run
shows an explicit path collects and fails it.

### Probe (b) — failing test at the out-of-repo quarantine path

File moved to `…/probes/state-home/conductor/py-fx/quarantine/test_quarantine_fail.py`;
`.conductor/` removed. Command (cwd = fixture root):

```
/usr/bin/python3 -m pytest
```

Raw output:

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
rootdir: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx
collected 1 item

tests/test_pass.py .                                                     [100%]

============================== 1 passed in 0.00s ===============================
exit code: 0
```

**Verdict (b): NOT COLLECTED.**

### Probe (c) — git worktree inside the fixture

Setup: `git branch wt-branch && git worktree add wt wt-branch`, then
`tests/test_wt_fail.py` committed on `wt-branch`. Command (cwd = fixture root):

```
/usr/bin/python3 -m pytest
```

Raw output:

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
rootdir: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx
collected 2 items / 1 error

==================================== ERRORS ====================================
____________________ ERROR collecting wt/tests/test_pass.py ____________________
import file mismatch:
imported module 'test_pass' has this __file__ attribute:
  /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx/tests/test_pass.py
which is not the same as the test file we want to collect:
  /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx/wt/tests/test_pass.py
HINT: remove __pycache__ / .pyc files and/or use a unique basename for your test file modules
=========================== short test summary info ============================
ERROR wt/tests/test_pass.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
=============================== 1 error in 0.04s ===============================
exit code: 2
```

pytest recursed into the worktree, and the duplicate basename (`test_pass.py` exists
in both trees) **interrupted the entire session** before a single test ran.
Supplementary measurement — with the colliding `wt/tests/test_pass.py` deleted from
the worktree's working tree (leaving only the uniquely named failing test), same
command:

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
rootdir: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/py-fx
collected 2 items

tests/test_pass.py .                                                     [ 50%]
wt/tests/test_wt_fail.py F                                               [100%]

=================================== FAILURES ===================================
____________________________ test_wt_probe_failure _____________________________

    def test_wt_probe_failure():
>       assert False, "WT_PROBE_FAILURE"
E       AssertionError: WT_PROBE_FAILURE
E       assert False

wt/tests/test_wt_fail.py:2: AssertionError
=========================== short test summary info ============================
FAILED wt/tests/test_wt_fail.py::test_wt_probe_failure - AssertionError: WT_P...
========================= 1 failed, 1 passed in 0.01s ==========================
exit code: 1
```

**Verdict (c): COLLECTED** — pytest collects the worktree's copies; with the realistic
duplicate-basename layout it goes further and aborts the whole session (exit 2), and
with unique basenames it executes the worktree's failing test (exit 1). Either way the
main tree's verify is corrupted by an in-repo worktree.

---

## 3. go test ./... (go1.26.5)

### Fixture layout (`probes/go-fx`, a git repo, single module)

```
go-fx/
  go.mod                                       # module probe.example/gofx (committed)
  pass_test.go                                 # package gofx, TestPass (committed)
  .conductor/runs/x/quarantine/fail_test.go    # probe (a): package quarantine, t.Fatal
  wt/                                          # probe (c): worktree on wt-branch
    go.mod                                     # committed ⇒ checked out into the worktree
    pass_test.go
    wt_fail_test.go                            # t.Fatal("WT_PROBE_FAILURE") (committed on wt-branch)
```

### Probe (a) — failing test in `.conductor/runs/x/quarantine/`

Command (cwd = fixture root):

```
go test ./...
```

Raw output:

```
ok  	probe.example/gofx	1.217s
exit code: 0
```

`go list ./...` with the file present:

```
probe.example/gofx
exit code: 0
```

Sanity check — the dot-directory is still inside the module and an explicit path
reaches it: `go test ./.conductor/runs/x/quarantine/`:

```
--- FAIL: TestQuarantineProbeFailure (0.00s)
    fail_test.go:6: QUARANTINE_PROBE_FAILURE
FAIL
FAIL	probe.example/gofx/.conductor/runs/x/quarantine	0.233s
FAIL
exit code: 1
```

**Verdict (a): NOT COLLECTED** by `./...` (the pattern skipped the directory beginning
with `.` in this measurement) — but the measured sanity run shows the file still
compiles and fails as part of the module when named explicitly.

### Probe (b) — failing test at the out-of-repo quarantine path

File moved to `…/probes/state-home/conductor/go-fx/quarantine/fail_test.go`;
`.conductor/` removed. Command (cwd = fixture root):

```
go test ./...
```

Raw output:

```
ok  	probe.example/gofx	(cached)
exit code: 0
```

**Verdict (b): NOT COLLECTED.**

### Probe (c) — git worktree inside the fixture

Setup: `git branch wt-branch && git worktree add wt wt-branch`, then
`wt_fail_test.go` committed on `wt-branch`. Because `go.mod` is committed at the repo
root, the worktree checkout necessarily contains `wt/go.mod`. Command (cwd = fixture
root, main tree):

```
go test ./...
```

Raw output:

```
ok  	probe.example/gofx	(cached)
exit code: 0
```

`go list ./...` with the worktree present:

```
probe.example/gofx
exit code: 0
```

**Verdict (c): NOT COLLECTED** — `wt/` contains its own `go.mod` (inherent to a
worktree of a module repo), and the measured `./...` expansion never entered it: one
package, exit 0, worktree failing test not run.

---

## 4. ctest 4.4.2 (cmake 4.4.2)

ctest discovery is registration-based: the test list comes from
`CTestTestfile.cmake` generated in the build directory at configure time from
`enable_testing()` + `add_test()` calls, not from scanning the source tree for test
files. The probes below MEASURE that rather than assuming it.

### Fixture layout (`probes/cmake-fx`, a git repo)

```
cmake-fx/
  CMakeLists.txt                            # project(ctestfx NONE); enable_testing();
                                            #   add_test(NAME pass COMMAND /bin/sh -c "exit 0")
  .gitignore                                # build/
  build/                                    # configured with: cmake -S . -B build
  .conductor/runs/x/quarantine/fail_test.sh # probe (a): executable, echoes
                                            #   QUARANTINE_PROBE_FAILURE and exits 1
  wt/                                       # probe (c): worktree on wt-branch
    CMakeLists.txt                          # adds: add_test(NAME wt_fail COMMAND
                                            #   /bin/sh -c "echo WT_PROBE_FAILURE; exit 1")
```

### Probe (a) — failing test script in `.conductor/runs/x/quarantine/`

The failing script was placed BEFORE configuring, then the tree was configured and
run. Commands (FX = fixture root):

```
cmake -S "$FX" -B "$FX/build"
ctest --test-dir "$FX/build" -N
ctest --test-dir "$FX/build"
```

Raw output (configure, then `-N` discovery list, then the run):

```
-- Configuring done (0.0s)
-- Generating done (0.0s)
-- Build files have been written to: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
exit code: 0
```

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
  Test #1: pass

Total Tests: 1
exit code: 0
```

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
    Start 1: pass
1/1 Test #1: pass .............................   Passed    0.00 sec

100% tests passed out of 1

Total Test time (real) =   0.00 sec
exit code: 0
```

Sanity check — the script itself fails when executed:
`"$FX/.conductor/runs/x/quarantine/fail_test.sh"`:

```
QUARANTINE_PROBE_FAILURE
exit code: 1
```

**Verdict (a): NOT COLLECTED** — configuring with the file present still registered
exactly one test; presence of a test-shaped file registers nothing.

### Probe (b) — failing script at the out-of-repo quarantine path

Script moved to `…/probes/state-home/conductor/cmake-fx/quarantine/fail_test.sh`;
`.conductor/` removed; tree reconfigured (`cmake -S "$FX" -B "$FX/build"`), then:

```
ctest --test-dir "$FX/build"
```

Raw output:

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
    Start 1: pass
1/1 Test #1: pass .............................   Passed    0.00 sec

100% tests passed out of 1

Total Test time (real) =   0.00 sec
exit code: 0
```

**Verdict (b): NOT COLLECTED.**

### Probe (c) — git worktree inside the fixture

Setup: `git branch wt-branch && git worktree add wt wt-branch`, then `wt/CMakeLists.txt`
amended on `wt-branch` to also register `wt_fail`. The MAIN tree was reconfigured with
the worktree present, then listed and run:

```
cmake -S "$FX" -B "$FX/build"
ctest --test-dir "$FX/build" -N
ctest --test-dir "$FX/build"
```

Raw output (`-N`, then the run):

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
  Test #1: pass

Total Tests: 1
exit code: 0
```

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-fx/build
    Start 1: pass
1/1 Test #1: pass .............................   Passed    0.00 sec

100% tests passed out of 1

Total Test time (real) =   0.00 sec
exit code: 0
```

Sanity check that the worktree branch genuinely registers the failing test when the
WORKTREE ITSELF is configured (`cmake -S "$FX/wt" -B <separate-build>` then
`ctest --test-dir <separate-build> -N`):

```
Test project /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/02ee96d7-054d-4c9d-a7ac-c4dddd205471/scratchpad/probes/cmake-wt-build
  Test #1: pass
  Test #2: wt_fail

Total Tests: 2
exit code: 0
```

**Verdict (c): NOT COLLECTED** — the main build directory's registration is untouched
by the worktree (its `CMakeLists.txt` is never read unless someone configures the
worktree as its own source tree, as the sanity run demonstrates).

---

## Summary

| Runner (version) | (a) in-repo `.conductor/` dot-dir | (b) out-of-repo quarantine path | (c) worktree inside repo |
| --- | --- | --- | --- |
| `node --test` (v26.7.0) | NOT COLLECTED | NOT COLLECTED | **COLLECTED** (executed, run went red) |
| `/usr/bin/python3 -m pytest` (8.4.2) | NOT COLLECTED | NOT COLLECTED | **COLLECTED** (session interrupted on duplicate basenames, exit 2; executes the worktree's failing test once basenames are unique) |
| `go test ./...` (go1.26.5) | NOT COLLECTED by `./...` (still inside the module — explicit path executes it) | NOT COLLECTED | NOT COLLECTED (worktree's committed `go.mod` makes it a nested module) |
| `ctest` (4.4.2) | NOT COLLECTED (registration-based discovery) | NOT COLLECTED | NOT COLLECTED (build-dir registration ignores the worktree's `CMakeLists.txt`) |

The out-of-repo location was the only placement no runner reached in ANY probe: 4/4
runners, zero collections, by construction outside every glob, module, rootdir, and
registration boundary.

## Citations for HONEST-LIMITS

- **`node --test` collects worktree copies.** A `git worktree` inside the repo made
  the main tree's whole-tree `node --test` execute the worktree's tests (duplicate
  passes plus the worktree's failing test; exit 1). Measured in §1 probe (c).
- **pytest collects worktree copies — and can abort the whole session.** pytest 8.4.2
  recursed into `wt/`, hit an `import file mismatch` on the duplicated basename, and
  interrupted collection entirely (exit 2); with unique basenames it executed the
  worktree's failing test (exit 1). Measured in §2 probe (c). An in-repo worktree
  therefore corrupts a pytest verify in both directions: phantom reds and total
  collection failure.
- **No runner collected the in-repo `.conductor/` dot-directory in these
  measurements — but the dot-dir is one explicit argument from execution.** Measured:
  `node --test .conductor/…/fail.test.js` ran and failed it;
  `/usr/bin/python3 -m pytest .conductor/…/test_quarantine_fail.py` collected and
  failed it; `go test ./.conductor/runs/x/quarantine/` compiled and failed it (the
  dot-dir remains inside the go module). Any targeted `itemTest` template, config
  override, or tool that expands explicit paths reaches quarantined files the moment
  they live in-repo; whole-tree non-collection here is a property of each runner's
  current default glob/pattern rules, not a guarantee. The out-of-repo location
  (§4.2) is normative because it is outside every one of those mechanisms by
  construction — the quarantine must not be "simplified" back inside `.conductor/`.
