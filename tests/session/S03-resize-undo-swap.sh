#!/usr/bin/env bash
# Generated with AI for personal use.
# S03 Split ratio: resize, undo, and swap (API + keyboard). Pinned to Files:
# the ratio step needs a visible change and Chrome clamps the split.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 12 || true
spawn "$FILES"
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"
echo "pair: $A $B"
before_w="$(state_expr "next((w['rect']['width'] for w in d['windows'] if w['id'] == $A), 0)")"

adrt SimulateResize "$A" "$B" 0.3 >/dev/null
TEST_IDS="$(test_ids)" poll "resize applied a ~30/70 split" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"] if w["id"] in ids]
total = sum(r["width"] for r in ws)
ratios = sorted(round(r["width"] / total, 2) for r in ws)
if abs(ratios[0] - 0.3) > 0.12:
    print("ratios", ratios); sys.exit(1)
print("ratios", ratios)
' 12

adrt Undo >/dev/null
poll "undo restored the pre-resize split" "import json,sys
w = [x for x in json.load(sys.stdin)['windows'] if x['id'] == $A]
if not w:
    print('window gone'); sys.exit(1)
sys.exit(0 if abs(w[0]['rect']['width'] - $before_w) <= 20 else 1)
" 15

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
