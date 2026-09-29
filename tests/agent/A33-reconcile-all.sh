#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A33 Reconcile all: a window moved out of place anywhere is corrected, and every
# tileable window on every screen/workspace ends up inside its work area and
# non-overlapping.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
# Put a third window on its own workspace too.
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

# Shove the first window somewhere illegal without a drag gesture.
adrt MoveWindow "${ids[0]}" 200 200 500 400 >/dev/null
wait_settled 12

check_python "every tileable window is inside its work area, non-overlapping" '
import json, sys
from collections import defaultdict
d = json.load(sys.stdin)
area = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}
ws = [w for w in d["windows"] if w["tileable"]]
if not ws:
    print("no tileable windows"); sys.exit(1)
for w in ws:
    a = area[w["monitor"]]; r = w["rect"]
    if r["x"] < a["x"] - 1 or r["y"] < a["y"] - 1 or r["x"] + r["width"] > a["x"] + a["width"] + 1 or r["y"] + r["height"] > a["y"] + a["height"] + 1:
        print("out of area", w["id"], r, a); sys.exit(1)
groups = defaultdict(list)
for w in ws:
    groups[(w["workspace"], w["monitor"])].append(w)
for key, items in groups.items():
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a2, b2 = items[i]["rect"], items[j]["rect"]
            if a2["x"] < b2["x"] + b2["width"] and b2["x"] < a2["x"] + a2["width"] and a2["y"] < b2["y"] + b2["height"] and b2["y"] < a2["y"] + a2["height"]:
                print("overlap", key, items[i]["id"], items[j]["id"]); sys.exit(1)
print("coherent", len(ws), "windows on", len(groups), "workspaces")
'

ensure_clean
summary
