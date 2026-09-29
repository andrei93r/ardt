#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A2 Third window: it moves to a workspace immediately to the right, and the
# view follows it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
pair_ws="$(dump | python3 -c 'import json,sys; print(json.load(sys.stdin)["windows"][0]["workspace"])')"
spawn_window >/dev/null
wait_count 3 15 || true
wait_settled 12

assert_eq "three windows are tracked" "3" "$(count_windows)"
check_python "the third window is on its own workspace, one to the right, and focused" '
import json, sys
d = json.load(sys.stdin)
pair_ws = int("'"$pair_ws"'")
third = [w for w in d["windows"] if w["workspace"] != pair_ws]
if not third:
    print("no third window on a separate workspace"); sys.exit(1)
target = third[0]["workspace"]
if target != pair_ws + 1:
    print("third window on ws", target, "expected", pair_ws + 1); sys.exit(1)
if d["activeWorkspace"] != target:
    print("view did not follow: active", d["activeWorkspace"], "third ws", target); sys.exit(1)
print("third window on ws", target, "active", d["activeWorkspace"])
'

ensure_clean
summary
