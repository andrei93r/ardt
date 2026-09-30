#!/usr/bin/env bash
# Generated with AI for personal use.
# S06 Float a tile above the tiling, then close one of a pair so the remaining
# window is maximized on its own.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
spawn "$CHROME"
wait_tests 2 15 || true
read -r A _ <<<"$(test_pair_by_x)"

adrt ToggleFloat "$A" >/dev/null
poll "the window floats above the tiling" '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not w or w[0]["layer"] != 2:
    print("layer", w[0]["layer"] if w else None); sys.exit(1)
print("layer", w[0]["layer"])
' 12

floats="$(json GetFloats)"
if [ "$floats" != "{}" ]; then pass "GetFloats lists the floating app"; else fail "GetFloats is empty"; fi
adrt ToggleFloat "$A" >/dev/null
sleep 1

# --- close one of the pair: the survivor is maximized on its own ------------
read -r X _ <<<"$(test_pair_by_x)"
adrt CloseWindow "$X" >/dev/null
TEST_IDS="$(test_ids)" poll "the remaining window is maximized" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) != 1:
    print("expected one remaining test window, got", len(ws)); sys.exit(1)
if not ws[0]["maximized"]:
    print("not maximized"); sys.exit(1)
print("maximized")
' 15

summary
