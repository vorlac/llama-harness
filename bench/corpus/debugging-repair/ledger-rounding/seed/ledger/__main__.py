"""Allow ``python3 -m ledger`` to run the report."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
