#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A34 App that opens maximized: it tiles with the existing window instead of
# being exiled to its own workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 25 || true
wait_settled 12

# Nautilus (Files) opens maximized by default.
spawn_window "nautilus" >/dev/null
wait_count 2 15 || true
wait_settled 12

check_python "the maximized app was tiled with its sibling" '
import json, sys
d = json.load(sys.stdin)
area = d["monitors"][0].get("workArea") or d["monitors"][0]["geometry"]
ws = [w for w in d["windows"] if w["tileable"]]
if len(ws) < 2:
    print("expected two tileable windows, got", len(ws)); sys.exit(1)
if len({w["workspace"] for w in ws}) != 1:
    print("windows are on different workspaces", {w["workspace"] for w in ws}); sys.exit(1)
if any(w["maximized"] for w in ws):
    print("a window is still maximized"); sys.exit(1)
for w in ws:
    if w["rect"]["width"] >= area["width"] - 1:
        print("window fills the monitor instead of tiling", w["id"], w["rect"]); sys.exit(1)
a, b = ws[0]["rect"], ws[1]["rect"]
if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
    print("windows overlap"); sys.exit(1)
print("paired", len(ws))
'

ensure_clean
summary
