#!/usr/bin/env bash
# Generated with AI for personal use.
# S05 Swap on the live session (API + keyboard).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

# Chrome can replace its own window when several are opened, so pin the
# position-sensitive swap scenario to Files for both windows.
spawn "$FILES"
wait_tests 1 12 || true
spawn "$FILES"
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"
echo "pair: $A $B"

adrt SwapPair "$A" "$B" >/dev/null
TEST_IDS="$(test_ids)" poll "the pair swapped sides" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"] if w["id"] in ids}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window gone", sorted(by)); sys.exit(1)
if not (by[a] > by[b]):
    print(by); sys.exit(1)
print(by)
' 25

# Keyboard swap: focus and move toward the sibling.
adrt ActivateWindow "$A" >/dev/null
sleep 1
adrt MoveToward left >/dev/null
TEST_IDS="$(test_ids)" poll "keyboard move toward the sibling swaps back" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"] if w["id"] in ids}
a, b = int("'"$A"'"), int("'"$B"'")
if a not in by or b not in by:
    print("window gone", sorted(by)); sys.exit(1)
if not (by[a] < by[b]):
    print(by); sys.exit(1)
print(by)
' 25

summary
