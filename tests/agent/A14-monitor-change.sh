#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A14 Monitor change: an injected screens-changed signal retiles.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair

assert_true "InjectSignal returns true" "$(adrt InjectSignal screens-changed '' | python3 "$PARSE")"
wait_settled 12
assert_eq "windows still tracked after the monitor change" "2" "$(count_windows)"
check_python "tiles remain inside their monitor's work area" '
import json, sys
d = json.load(sys.stdin)
areas = {m["index"]: (m.get("workArea") or m["geometry"]) for m in d["monitors"]}
for w in d["windows"]:
    r, a = w["rect"], areas.get(w["monitor"])
    if a is None or r["x"] < a["x"] - 2 or r["y"] < a["y"] - 2 or r["x"] + r["width"] > a["x"] + a["width"] + 2 or r["y"] + r["height"] > a["y"] + a["height"] + 2:
        print("out of bounds", r, a); sys.exit(1)
print("monitors accounted for")
'

ensure_clean
summary
