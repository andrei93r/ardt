#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A97 An overview drop onto a maximized single splits it into a pair (§6): the
# dropped window takes a slot, the maximized window un-maximizes beside it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"
pair_ws="$(window_field "$A" workspace)"
wait_settled 12

# A second window on the empty workspace to the right, maximized there.
adrt ActivateWorkspace 1 >/dev/null
sleep 1
spawn_window >/dev/null
wait_count 2 20 || true
wait_settled 15
C="$(list_ids | tr ' ' '\n' | grep -v "^$A$" | tr -d '\n' | xargs)"
wait_python 20 "
import json, sys
d = json.load(sys.stdin)
c = [w for w in d['windows'] if w['id'] == $C]
sys.exit(0 if c and c[0]['workspace'] != $pair_ws else 1)" || true

# Drop it onto the maximized single.
adrt MoveToWorkspace "$C" "$pair_ws" >/dev/null
wait_settled 20

poll "the drop split the maximized single into a pair" '
import json, sys
d = json.load(sys.stdin)
here = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2 and w["workspace"] == int("'"$pair_ws"'")]
if len(here) != 2:
    print("workspace holds", len(here), "tiles"); sys.exit(1)
a, b = here[0]["rect"], here[1]["rect"]
if a["x"] < b["x"] + b["width"] - 2 and b["x"] < a["x"] + a["width"] - 2 \
   and a["y"] < b["y"] + b["height"] - 2 and b["y"] < a["y"] + a["height"] - 2:
    print("still stacked:", a, b); sys.exit(1)
if all(w["maximized"] for w in here):
    print("both still maximized"); sys.exit(1)
print("split into a pair:", [w["id"] for w in here])
' 25

ensure_clean
summary
