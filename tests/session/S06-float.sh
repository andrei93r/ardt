#!/usr/bin/env bash
# Generated with AI for personal use.
# S06 Float toggle on the live session.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1
read -r A _ <<<"$(test_pair_by_x)"

adrt ToggleFloat "$A" >/dev/null
sleep 1
TEST_IDS="$(test_ids)" check_python "the window floats above the tiling" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w or w[0]["layer"] != 2:
    print("layer", w[0]["layer"] if w else None); sys.exit(1)
print("layer", w[0]["layer"])
'
floats="$(json GetFloats)"
if [ "$floats" != "{}" ]; then pass "GetFloats lists the floating app"; else fail "GetFloats is empty"; fi

adrt ToggleFloat "$A" >/dev/null
sleep 1
summary
