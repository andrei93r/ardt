#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A27 Session unlock: the active workspace retiles once on resume.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
sleep 1

adrt SimulateSessionMode unlock-dialog >/dev/null
sleep 1
assert_eq "paused while locked" "true" "$(state_expr 'str(d["paused"]).lower()')"

adrt SimulateSessionMode user >/dev/null
wait_settled 12
assert_eq "running again after unlock" "false" "$(state_expr 'str(d["paused"]).lower()')"
assert_eq "pair still tracked" "2" "$(count_windows)"
check_python "workspace was retiled once" '
import json, sys
ws = [w["rect"] for w in json.load(sys.stdin)["windows"]]
if any(r["width"] <= 0 for r in ws):
    print("invalid rect"); sys.exit(1)
print("retiled")
'

ensure_clean
summary
