#!/usr/bin/env python3
"""The visible correctness check: build, then exact-output probes.

READ-ONLY. Its checksum is verified by tools/verify_correctness.py.

This is the check to run while working. It builds the workspace and requires
byte-identical output against the reference on the committed sample and the ten
probe workloads, which is every correctness rule the task has - tie-breaking,
k > n, duplicate-heavy data, d in {16, 32, 48, 64}. It deliberately does not
touch the 400,000-point benchmark workload and says nothing about speed, so it
answers "is the output still right" in a few seconds.

`bash test.sh` is the full gate: this check, the benchmark workload, and the
speed target from workload.conf.

    python3 tools/visible_check.py [--extra-seed N]
"""

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON = sys.executable or "python3"


def step(label, argv):
    sys.stderr.write("\n== %s ==\n" % label)
    sys.stderr.flush()
    completed = subprocess.run(argv, cwd=ROOT)
    return completed.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extra-seed", type=int, default=None,
                        help="one more probe workload with this seed")
    args = parser.parse_args()

    code = step("unpack the committed sample",
                [PYTHON, os.path.join("tools", "unpack_sample.py")])
    if code != 0:
        return code

    code = step("build", ["bash", os.path.join(ROOT, "build.sh")])
    if code != 0:
        sys.stderr.write("visible_check: build.sh failed\n")
        return code

    argv = [PYTHON, os.path.join("tools", "verify_correctness.py"), "--quick"]
    if args.extra_seed is not None:
        argv += ["--extra-seed", str(args.extra_seed)]
    return step("exact-output probes", argv)


if __name__ == "__main__":
    sys.exit(main())
