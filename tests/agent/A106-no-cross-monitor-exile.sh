#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A106 No cross-monitor exile: on a secondary monitor (single-workspace-capable
# with workspaces-only-on-primary on) a pair forms in place and overflow floats;
# no window is moved to another workspace.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
monitors="$(state_expr 'len(d["monitors"])')"
if [ "${monitors:-1}" -lt 2 ]; then
  skip "A106 needs two monitors to exercise cross-monitor routing"
  summary
  exit 0
fi

move_to_second() {
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
move_to_second "$A"

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 2 15 || true
B="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
move_to_second "$B"
wait_settled 12

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
C="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
move_to_second "$C"
wait_settled 12

poll "the secondary holds the pair and the overflow floats, all on one workspace" '
import json, sys
d = json.load(sys.stdin)
a, b, c = int("'"$A"'"), int("'"$B"'"), int("'"$C"'")
here = [w for w in d["windows"] if w["id"] in (a, b, c)]
if len(here) != 3:
    print("window lost", len(here)); sys.exit(1)
if any(w["monitor"] != 1 for w in here):
    print("a window left the secondary monitor", [(w["id"], w["monitor"]) for w in here]); sys.exit(1)
if len({(w["workspace"]) for w in here}) != 1:
    print("windows on different workspaces", [(w["id"], w["workspace"]) for w in here]); sys.exit(1)
tiles = [w for w in here if w["layer"] != 2 and not w["minimized"]]
floats = [w for w in here if w["layer"] == 2]
if len(tiles) != 2 or len(floats) != 1:
    print("tiles", len(tiles), "floats", len(floats)); sys.exit(1)
print("secondary: pair + float, one workspace", here[0]["workspace"])
' 20

ensure_clean
summary
