#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A107 A cross-screen move follows the target's rules (§6): a free slot wins, on
# the side the window came from; a full target swaps on a perimeter crossing or
# floats. Needs two monitors.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A107 needs two monitors to exercise a cross-screen move"
  summary
  exit 0
fi

send_right() {
  local id="$1"
  adrt ActivateWindow "$id" >/dev/null
  sleep 0.5
  adrt MoveDirection right >/dev/null
  wait_python 15 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$id and w['monitor']==1] else 1)" || true
}

spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"
send_right "$A"

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 2 15 || true
B="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
send_right "$B"
wait_settled 15

poll "the second arrival took the free slot on the target screen" '
import json, sys
d = json.load(sys.stdin)
a = [w for w in d["windows"] if w["id"] == int("'"$A"'")]
b = [w for w in d["windows"] if w["id"] == int("'"$B"'")]
if not a or not b:
    print("window gone"); sys.exit(1)
if any(w[0]["monitor"] != 1 for w in (a, b)):
    print("a window left the target screen"); sys.exit(1)
if a[0]["workspace"] != b[0]["workspace"]:
    print("not on one workspace"); sys.exit(1)
tiles = [w for w in (a[0], b[0]) if w["layer"] != 2]
if len(tiles) != 2:
    print("the target did not form a pair"); sys.exit(1)
print("target pair on monitor 1")
' 25

# A third arrival finds the target full: it floats or swaps, never evicts.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
adrt ActivateWindow "$A" >/dev/null
sleep 0.5
adrt MoveDirection right >/dev/null
send_right "$C"
wait_settled 20

poll "the full target did not evict anyone and kept the newcomer" '
import json, sys
d = json.load(sys.stdin)
ids = [int("'"$A"'"), int("'"$B"'"), int("'"$C"'")]
here = [w for w in d["windows"] if w["id"] in ids]
if len(here) != 3:
    print("window lost", len(here)); sys.exit(1)
if len([w for w in here if w["workspace"] == here[0]["workspace"]]) < 2:
    print("the pair did not survive"); sys.exit(1)
print("three windows kept, nobody evicted")
' 25

ensure_clean
summary
