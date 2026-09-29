#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A2 Third window: the third window moves to a new workspace, the pair is unchanged.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
spawn_window >/dev/null
wait_count 3 30 || true
wait_python 25 '
import json, sys
if len({w["workspace"] for w in json.load(sys.stdin)["windows"]}) < 2:
    sys.exit(1)' || true

assert_eq "three windows are tracked" "3" "$(count_windows)"
check_python "the third window sits on its own workspace" '
import json, sys
d = json.load(sys.stdin)
per = {}
for w in d["windows"]:
    per.setdefault(w["workspace"], []).append(w["id"])
if len(per) < 2:
    print("all windows on one workspace"); sys.exit(1)
print("workspaces", sorted(per))
'

ensure_clean
summary
