#!/usr/bin/env bash
# A2 Third window: the third window moves to a new workspace, the pair is unchanged.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
spawn_window >/dev/null
wait_count 3 20 || true

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
