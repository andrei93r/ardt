#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A8 Pair swap: swap-pair toggles the flag and re-tiles the two windows.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))

before_lo="$(window_field "${ids[0]}" rect | python3 -c 'import sys,ast; print(ast.literal_eval(sys.stdin.read().strip())["x"])')"
adrt SwapPair "${ids[0]}" "${ids[1]}" >/dev/null
wait_settled 12
after_lo="$(window_field "${ids[0]}" rect | python3 -c 'import sys,ast; print(ast.literal_eval(sys.stdin.read().strip())["x"])')"

if [ "$before_lo" != "$after_lo" ]; then pass "sides swapped"; else fail "sides did not swap"; fi
check_python "swap flag recorded" '
import json, sys
if not json.load(sys.stdin)["swapPairs"]:
    print("no swap pair"); sys.exit(1)
print("recorded")
'

ensure_clean
summary
