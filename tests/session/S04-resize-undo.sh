#!/usr/bin/env bash
# Generated with AI for personal use.
# S04 Resize + undo on the live session.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1
read -r A B <<<"$(test_pair_by_x)"
echo "pair: $A $B"

adrt SimulateResize "$A" "$B" 0.3 >/dev/null
sleep 1.5
TEST_IDS="$(test_ids)" check_python "resize applied a ~30/70 split" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"] if w["id"] in ids]
total = sum(r["width"] for r in ws)
ratios = sorted(round(r["width"] / total, 2) for r in ws)
if abs(ratios[0] - 0.3) > 0.12:
    print("ratios", ratios); sys.exit(1)
print("ratios", ratios)
'

adrt Undo >/dev/null
sleep 1.5
TEST_IDS="$(test_ids)" check_python "undo restored the even split" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"] if w["id"] in ids]
total = sum(r["width"] for r in ws)
ratios = sorted(round(r["width"] / total, 2) for r in ws)
if abs(ratios[0] - 0.5) > 0.08:
    print("ratios", ratios); sys.exit(1)
print("ratios", ratios)
'

summary
