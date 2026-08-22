"""Command line entry point.

    python3 -m feedservice.cli --scenario default --live

Installs the demo upstreams, builds one report and prints it as JSON. Used by
run.sh and by anyone poking at the service by hand.
"""

from __future__ import annotations

import argparse
import json
import sys

from .app import Application
from .config import demo_config
from .demo_upstreams import SCENARIOS
from .testing import install_upstreams


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="feedservice",
                                     description=__doc__.splitlines()[0])
    parser.add_argument("--scenario", default="default", choices=sorted(SCENARIOS),
                        help="which fake upstream world to run against")
    parser.add_argument("--live", action="store_true",
                        help="also read the live price stream")
    parser.add_argument("--health", action="store_true",
                        help="print upstream health instead of a report")
    parser.add_argument("--stats", action="store_true",
                        help="print counters to stderr when done")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    install_upstreams(args.scenario)
    with Application(demo_config()) as app:
        if args.health:
            payload = app.health()
        else:
            payload = app.dashboard(live=args.live)
        json.dump(payload, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        if args.stats:
            json.dump(app.stats(), sys.stderr, indent=2, sort_keys=True)
            sys.stderr.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
