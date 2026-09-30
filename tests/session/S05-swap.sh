#!/usr/bin/env bash
# Generated with AI for personal use.
# S05 Swap on the live session (API + keyboard).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
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
if not (by[int("'"$A"'")] > by[int("'"$B"'")]):
    print(by); sys.exit(1)
print(by)
' 15

# Keyboard swap: focus and move toward the sibling.
adrt ActivateWindow "$A" >/dev/null
sleep 1
adrt MoveToward left >/dev/null
TEST_IDS="$(test_ids)" poll "keyboard move toward the sibling swaps back" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
by = {w["id"]: w["rect"]["x"] for w in d["windows"] if w["id"] in ids}
if not (by[int("'"$A"'")] < by[int("'"$B"'")]):
    print(by); sys.exit(1)
print(by)
' 15

summary
