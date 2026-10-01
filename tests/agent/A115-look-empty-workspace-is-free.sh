#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A115 A workspace that only looks empty is free (§5): a workspace whose single
# window is minimized with no neighbour to take it keeps the window; a newcomer
# opens there alone among the visible windows and maximizes.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# A single-workspace screen has no neighbours, so the minimized window stays.
set_static_workspaces 1

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
ids=($(list_ids))
A="${ids[0]}"

adrt MinimizeWindow "$A" >/dev/null
wait_python 15 '
import json, sys
d = json.load(sys.stdin)
w = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
sys.exit(0 if w and w[0]["minimized"] else 1)' || true

spawn_window >/dev/null
wait_count 2 15 || true
wait_settled 12
B="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | tr -d '\n' | xargs)"

poll "the newcomer maximizes while the minimized window stays hidden" '
import json, sys
d = json.load(sys.stdin)
b = [x for x in d["windows"] if x["id"] == int("'"$B"'")]
a = [x for x in d["windows"] if x["id"] == int("'"$A"'")]
if not b or not a:
    print("window gone"); sys.exit(1)
if not b[0]["maximized"]:
    print("the newcomer did not maximize"); sys.exit(1)
if not a[0]["minimized"]:
    print("the minimized window came back"); sys.exit(1)
if a[0]["workspace"] != b[0]["workspace"]:
    print("workspaces differ"); sys.exit(1)
print("newcomer maximized on ws", b[0]["workspace"], "with a hidden window")
' 20

ensure_clean
summary
