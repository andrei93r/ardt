#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A3 Lone maximize: closing one of a pair maximizes the remaining window.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
close_window "${ids[0]}"
wait_count 1 15 || true
sleep 2

assert_eq "one window remains" "1" "$(count_windows)"
check_python "the remaining window is maximized" '
import json, sys
d = json.load(sys.stdin)
ws = d["windows"]
if len(ws) != 1 or not ws[0]["maximized"]:
    print("not maximized", ws); sys.exit(1)
print("maximized")
'

ensure_clean
summary
