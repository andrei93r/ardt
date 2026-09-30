#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A6 Focus follows: the border sits at the focused window's rect.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null

# The border can blip while a retile is animating, so wait for the settled
# state rather than sampling once.
if wait_python 20 '
import json, sys
d = json.load(sys.stdin)
focused = [w for w in d["windows"] if w["id"] == int("'"${ids[0]}"'")]
if not focused:
    sys.exit(1)
r = focused[0]["rect"]
b = d["border"]
sys.exit(0 if b["visible"] and b["rect"] is not None
         and abs(b["rect"]["x"] - r["x"]) <= 2 and abs(b["rect"]["y"] - r["y"]) <= 2
         and abs(b["rect"]["width"] - r["width"]) <= 2 else 1)'; then
  pass "the border tracks the focused window"
else
  check_python "the border tracks the focused window" '
import json, sys
d = json.load(sys.stdin)
print("border", d["border"], "suppressed", d["indicator"]["suppressed"]); sys.exit(1)
'
fi

ensure_clean
summary
