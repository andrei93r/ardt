#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A7 Inner-edge drag: both windows resize and the ratio is saved.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.3 >/dev/null
sleep 2

check_python "split moved to roughly 30/70" '
import json, sys
d = json.load(sys.stdin)
ws = [w["rect"] for w in d["windows"]]
total = sum(r["width"] for r in ws)
ratios = sorted(r["width"] / total for r in ws)
if abs(ratios[0] - 0.3) > 0.1:
    print("ratios", [round(x, 2) for x in ratios]); sys.exit(1)
print("ratios", [round(x, 2) for x in ratios])
'
check_python "ratio persisted" '
import json, sys
if not json.load(sys.stdin)["ratios"]:
    print("no saved ratio"); sys.exit(1)
print("saved")
'

ensure_clean
summary
