#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A10 Nudge split: the keyboard nudge changes and saves the ratio.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt SimulateResize "${ids[0]}" "${ids[1]}" 0.5 >/dev/null
wait_settled 25
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1
adrt NudgeSplit right 10 >/dev/null
wait_settled 25

check_python "ratio moved away from 0.5 and was saved" '
import json, sys
d = json.load(sys.stdin)
ratios = list(d["ratios"].values())
if not ratios:
    print("no ratio saved"); sys.exit(1)
if abs(ratios[-1] - 0.5) < 0.01:
    print("ratio unchanged"); sys.exit(1)
print("ratio", round(ratios[-1], 3))
'

ensure_clean
summary
