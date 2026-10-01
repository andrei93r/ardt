#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A94 An overview drop onto a full pair floats the dropped window there (§6):
# nobody is evicted, the pair keeps its sides and the origin workspace is reaped.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
pair_ws="$(window_field "$A" workspace)"
wait_settled 15

# The third window gets its own workspace to the right.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
third_ws="$(window_field "$C" workspace)"
echo "pair on ws$pair_ws, third $C on ws$third_ws"

# Overview drop onto the workspace that already holds the full pair.
adrt MarkWorkspaceCached "$C" "$pair_ws" >/dev/null
adrt MoveToWorkspace "$C" "$pair_ws" >/dev/null
wait_settled 20

poll "the dropped window floats on the full pair" '
import json, sys
d = json.load(sys.stdin)
c = [w for w in d["windows"] if w["id"] == int("'"$C"'")]
if not c:
    print("dropped window gone"); sys.exit(1)
if c[0]["workspace"] != int("'"$pair_ws"'"):
    print("on ws", c[0]["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if c[0]["layer"] != 2:
    print("not floating (layer", c[0]["layer"], ")"); sys.exit(1)
print("dropped window floats:", c[0]["rect"])
' 25

poll "the pair kept its sides and the origin was reaped" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("the pair is gone"); sys.exit(1)
if a[0]["workspace"] != int("'"$pair_ws"'") or b[0]["workspace"] != int("'"$pair_ws"'"):
    print("pair workspace changed"); sys.exit(1)
if a[0]["slot"] == b[0]["slot"]:
    print("pair shares a slot:", a[0]["slot"]); sys.exit(1)
left = [w for w in d["windows"] if w["workspace"] == int("'"$third_ws"'")]
if left:
    print("origin workspace not reaped:", left); sys.exit(1)
print("pair intact, origin reaped")
' 20

ensure_clean
summary
