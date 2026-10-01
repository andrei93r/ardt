#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A95 A window restored from minimized onto a full workspace floats (§6). The
# workspace keeps its pair and the restored window is not force-tiled over it.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
pair_ws="$(window_field "$A" workspace)"
wait_settled 15

# A third window takes its own workspace, is minimized (so it parks on a
# neighbour that holds windows, §4) and is then restored onto the full pair.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 20 || true
wait_settled 15
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"

adrt MinimizeWindow "$C" >/dev/null
wait_python 20 "
import json, sys
d = json.load(sys.stdin)
c = [w for w in d['windows'] if w['id'] == $C]
sys.exit(0 if c and c[0]['minimized'] and c[0]['workspace'] == $pair_ws else 1)" || true

# Restore it: the full pair has no free slot, so it floats where it is.
adrt ActivateWindow "$C" >/dev/null
wait_settled 20

poll "the restored window floats on the full workspace" '
import json, sys
d = json.load(sys.stdin)
c = [w for w in d["windows"] if w["id"] == int("'"$C"'")]
if not c:
    print("window gone"); sys.exit(1)
if c[0]["minimized"]:
    print("the window stayed minimized"); sys.exit(1)
if c[0]["workspace"] != int("'"$pair_ws"'"):
    print("on ws", c[0]["workspace"], "expected", int("'"$pair_ws"'")); sys.exit(1)
if c[0]["layer"] != 2:
    print("not floating (layer", c[0]["layer"], ")"); sys.exit(1)
a = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2 and w["workspace"] == int("'"$pair_ws"'")]
if len(a) != 2:
    print("the pair is not intact:", len(a), "tiles"); sys.exit(1)
print("restored window floats; pair intact")
' 25

ensure_clean
summary
