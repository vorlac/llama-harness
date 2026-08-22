#!/usr/bin/env python3
"""Decode the committed sample workload from its base64 carriers.

READ-ONLY. Its checksum is verified by tools/verify_correctness.py.

sample/base.bin and sample/queries.bin are raw float32 matrices. The workspace
is seeded from a text file map, so the two matrices travel as base64 text and
are decoded here into the binary files the rest of the task expects. Decoding
is idempotent and content-addressed: a carrier is decoded only when the target
is missing or its sha256 does not match the digest tools/checksums.txt records
for it, so repeated builds do no work and a corrupted target is replaced.

    python3 tools/unpack_sample.py [--check]

  --check   report what is missing or stale and exit non-zero, decode nothing
"""

import argparse
import base64
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKSUMS = os.path.join(ROOT, "tools", "checksums.txt")

# target -> base64 carrier, both relative to the workspace root.
CARRIERS = {
    os.path.join("sample", "base.bin"): os.path.join("sample", "base.bin.b64"),
    os.path.join("sample", "queries.bin"): os.path.join("sample", "queries.bin.b64"),
}


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_digests():
    """The digest tools/checksums.txt records for each carrier target."""
    out = {}
    with open(CHECKSUMS, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            digest, rel = line.split(None, 1)
            out[rel.strip().replace("/", os.sep)] = digest
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="report staleness and exit non-zero, decode nothing")
    args = parser.parse_args()

    digests = expected_digests()
    stale = []
    for target, carrier in sorted(CARRIERS.items()):
        target_path = os.path.join(ROOT, target)
        if os.path.exists(target_path) and sha256_file(target_path) == digests.get(target):
            continue
        stale.append((target, carrier))

    if args.check:
        for target, _carrier in stale:
            sys.stderr.write("stale or missing: %s\n" % target)
        return 1 if stale else 0

    for target, carrier in stale:
        carrier_path = os.path.join(ROOT, carrier)
        if not os.path.exists(carrier_path):
            sys.stderr.write("unpack_sample.py: missing carrier %s\n" % carrier)
            return 1
        with open(carrier_path, encoding="ascii") as handle:
            raw = base64.b64decode(handle.read())
        target_path = os.path.join(ROOT, target)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as handle:
            handle.write(raw)
        actual = sha256_file(target_path)
        wanted = digests.get(target)
        if wanted is not None and actual != wanted:
            sys.stderr.write(
                "unpack_sample.py: %s decoded to %s, but tools/checksums.txt "
                "records %s\n" % (target, actual, wanted))
            return 1
        sys.stderr.write("unpacked %s (%d bytes)\n" % (target, len(raw)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
