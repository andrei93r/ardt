#!/usr/bin/env bash
# Generated with AI for personal use.
# S13 Unmaximize onto a full pair on the live session: floats on top, centred,
# without covering the pair.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 2
read -r A B <<<"$(test_pair_by_x)"
pair_ws="$(window_workspace "$A")"
echo "pair $A $B on ws$pair_ws"

adrt MaximizeWindow "$B" >/dev/null
sleep 3

adrt ActivateWorkspace "$pair_ws" >/dev/null
sleep 1
spawn
wait_tests 3 15 || true
sleep 2

adrt UnmaximizeWindow "$B" >/dev/null

TEST_IDS="$(test_ids)" poll "the returned window floats on top without hiding the pair" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not b:
    print("window gone"); sys.exit(1)
w = b[0]
if w["layer"] != 2:
    print("not floating (layer", w["layer"], ")"); sys.exit(1)
r = w["rect"]
if r["width"] >= area["width"] - 1 or r["height"] >= area["height"] - 1:
    print("floating window spans the full monitor", r); sys.exit(1)
others = [x for x in d["windows"] if x["id"] in ids and x["id"] != int("'"$B"'")]
fully = [o for o in others if r["x"] <= o["rect"]["x"] and r["y"] <= o["rect"]["y"] and r["x"] + r["width"] >= o["rect"]["x"] + o["rect"]["width"] and r["y"] + r["height"] >= o["rect"]["y"] + o["rect"]["height"]]
if others and len(fully) >= len(others):
    print("every tiled window is fully covered"); sys.exit(1)
print("floating", r, "over", len(others), "windows")
' 20

summary
