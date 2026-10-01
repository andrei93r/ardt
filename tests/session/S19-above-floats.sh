#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# S19 An always-on-top window floats on the live session (§16): a video PiP or a
# widget asks to sit above the tiling, so adrt never tiles it and never clears the
# flag — the window next to it fills the screen.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn "$FILES"
wait_tests 1 15 || true
spawn "$CALC"
wait_tests 2 20 || true
ids=($(test_ids))
first="${ids[0]}"
second="${ids[1]}"

adrt SimulateAbove "$second" >/dev/null

TEST_IDS="$(test_ids)" TARGET="$second" poll "the flagged window floats and keeps its flag" '
import os, json, sys
target = int(os.environ["TARGET"])
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == target]
if not w:
    print("window gone"); sys.exit(1)
if w[0]["layer"] != 2:
    print("layer", w[0]["layer"]); sys.exit(1)
if w[0]["above"] is not True:
    print("the always-on-top flag was cleared"); sys.exit(1)
print("floating with its flag intact")
' 20

TEST_IDS="$(test_ids)" TARGET="$first" poll "the window left behind fills the screen" '
import os, json, sys
target = int(os.environ["TARGET"])
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == target and x["tileable"] and not x["minimized"]]
if not w:
    print("the other window is not tiled"); sys.exit(1)
area = (d["monitors"][w[0]["monitor"]].get("workArea") or d["monitors"][w[0]["monitor"]]["geometry"])
r = w[0]["rect"]
if r["width"] < area["width"] - 2 or r["height"] < area["height"] - 2:
    print("not filling the work area", r, area); sys.exit(1)
print("fills the work area")
' 20

ensure_clean
summary
