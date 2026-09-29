#!/usr/bin/env bash
# A6 Focus follows: the border sits at the focused window's rect.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 2

assert_true "border is visible after focusing a tile" "$(border_visible)"
check_python "border rect matches the focused window" '
import json, sys
d = json.load(sys.stdin)
focused = [w for w in d["windows"] if w["id"] == int("'"${ids[0]}"'")]
if not focused:
    print("focused window missing"); sys.exit(1)
r = focused[0]["rect"]
b = d["border"]["rect"]
if b is None or abs(b["x"] - r["x"]) > 2 or abs(b["y"] - r["y"]) > 2:
    print("border", b, "rect", r); sys.exit(1)
print("border tracks focus")
'

ensure_clean
summary
