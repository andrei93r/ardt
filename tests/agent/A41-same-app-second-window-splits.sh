#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A41 Same-app second window splits: opening Trash next to Files' Home window
# must tile the two, not stack them maximized.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window "nautilus" >/dev/null
wait_count 1 15 || true
wait_settled 12

spawn_window "nautilus trash://" >/dev/null
wait_count 2 15 || true
wait_settled 12

check_python "the two Files windows are tiled side by side" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
ws = [w for w in d["windows"] if w["tileable"]]
if len(ws) < 2:
    print("expected two tileable windows, got", len(ws)); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("windows on different workspaces"); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized"); sys.exit(1)
for w in ws:
    if w["rect"]["width"] >= area["width"] - 1 or w["rect"]["height"] >= area["height"] - 1:
        print("window spans the whole area", w["id"], w["rect"]); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
    print("windows overlap"); sys.exit(1)
print("split", a["width"], b["width"])
'

ensure_clean
summary
