#!/usr/bin/env bash
# A14 Monitor change: an injected screens-changed signal retiles.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair

assert_true "InjectSignal returns true" "$(adrt InjectSignal screens-changed '' | python3 "$PARSE")"
sleep 2
assert_eq "windows still tracked after the monitor change" "2" "$(count_windows)"
check_python "tiles remain inside the monitor" '
import json, sys
for w in json.load(sys.stdin)["windows"]:
    r = w["rect"]
    if r["x"] < 0 or r["y"] < 0 or r["x"] + r["width"] > 1281 or r["y"] + r["height"] > 801:
        print("out of bounds", r); sys.exit(1)
print("monitors accounted for")
'

ensure_clean
summary
