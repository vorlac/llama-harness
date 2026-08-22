"""`python3 -m etl` -- see `run.sh`, which is the scored entry point."""

import sys

from .cli import run

if __name__ == "__main__":
    sys.exit(run())
