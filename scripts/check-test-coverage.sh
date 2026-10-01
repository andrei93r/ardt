#!/usr/bin/env bash
# Anti-drift test-coverage guard — thin wrapper so the check works under the
# name the docs use (`bash scripts/check-test-coverage.sh`). The logic lives in
# scripts/check-test-coverage.py; see its docstring for the rules.
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/check-test-coverage.py" "$@"
