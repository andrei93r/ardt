#!/usr/bin/env bash
# Generated with AI for personal use.
# S02 Pair tiling on the live session (only the windows we spawn).
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
session_begin

spawn
wait_tests 1 12 || true
spawn
wait_tests 2 15 || true
sleep 1

TEST_IDS="$(test_ids)" poll "the two spawned windows tile side by side" '
import os, json, sys
ids = set(int(x) for x in os.environ["TEST_IDS"].split())
d = json.load(sys.stdin)
area = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}
ws = [w for w in d["windows"] if w["id"] in ids]
if len(ws) < 2:
    print("only", len(ws), "test windows"); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("test windows on different workspaces"); sys.exit(1)
for w in ws:
    a = area[w["monitor"]]; r = w["rect"]
    if r["x"] < a["x"] - 1 or r["y"] < a["y"] - 1 or r["x"] + r["width"] > a["x"] + a["width"] + 1 or r["y"] + r["height"] > a["y"] + a["height"] + 1:
        print("out of area", r, a); sys.exit(1)
a1, b1 = ws[0]["rect"], ws[1]["rect"]
if a1["x"] < b1["x"] + b1["width"] and b1["x"] < a1["x"] + a1["width"] and a1["y"] < b1["y"] + b1["height"] and b1["y"] < a1["y"] + a1["height"]:
    print("overlap"); sys.exit(1)
print("tiled", [w["rect"] for w in ws])
' 20

summary
