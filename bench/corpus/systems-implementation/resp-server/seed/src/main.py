# The command line: `bash run.sh [--port N]`, per SPEC.md section 2.1.

import sys

from server import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
