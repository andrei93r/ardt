#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A105 Per-screen split axis (§1, §6): the pair axis follows the screen, not the
# session and not the array position. A landscape screen splits side by side; a
# portrait screen stacks top/bottom; and a vertical workspace layout
# (`layout_rows === -1`) makes even a landscape screen stack. Run it with a mixed
# matrix, e.g. `ADRT_MONITORS=1920x1080:1080x1920`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
# Ignore minimum sizes so the axis itself is what is tested: a small portrait
# screen can otherwise (correctly) fall back to a side-by-side split.
set_setting min-size-policy ignore

read -r NMON LAND PORT <<<"$(dump | python3 -c '
import json, sys
mons = json.load(sys.stdin)["monitors"]
land = [m for m in mons if m["geometry"]["width"] >= m["geometry"]["height"]]
port = [m for m in mons if m["geometry"]["height"] > m["geometry"]["width"]]
print(len(mons), (land[0]["index"] if land else -1), (port[0]["index"] if port else -1))')"

if [ "$NMON" -ne 2 ] || [ "$LAND" = "-1" ] || [ "$PORT" = "-1" ]; then
  skip "A105 needs exactly one landscape and one portrait monitor (run with ADRT_MONITORS=1920x1080:1080x1920)"
  ensure_clean
  summary
  exit 0
fi

primary_index="$(state_expr 'next(m["index"] for m in d["monitors"] if m.get("isPrimary"))')"
if [ "$primary_index" = "$LAND" ]; then
  primary_axis=horizontal
  other="$PORT"
  other_axis=vertical
else
  primary_axis=vertical
  other="$LAND"
  other_axis=horizontal
fi

# The direction from the primary toward the other-orientation screen, by
# geometry (the harness lays the virtual monitors left to right).
read -r primary_x other_x <<<"$(dump | python3 -c '
import json, sys
d = json.load(sys.stdin)
p = next(m for m in d["monitors"] if m.get("isPrimary"))
o = next(m for m in d["monitors"] if m["index"] == int("'"$other"'"))
print(p["geometry"]["x"], o["geometry"]["x"])')"
if [ "$other_x" -ge "$primary_x" ]; then DIR=right; else DIR=left; fi

# Phase 1: a pair on the primary screen splits along the primary's own axis.
open_pair
wait_settled 15
poll "the pair on the primary screen splits along its own axis ($primary_axis)" "
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d['windows'] if w['tileable'] and not w['minimized'] and w['layer'] != 2]
if len(tiles) != 2:
    print('expected two tiles, got', len(tiles)); sys.exit(1)
if any(w.get('axis') != '$primary_axis' for w in tiles):
    print('axis', [(w['id'], w.get('axis')) for w in tiles], 'expected', '$primary_axis'); sys.exit(1)
a, b = sorted(tiles, key=lambda w: (w['rect']['x'], w['rect']['y']))
if '$primary_axis' == 'horizontal':
    if abs(a['rect']['y'] - b['rect']['y']) > 2 or a['rect']['x'] + a['rect']['width'] > b['rect']['x'] + 2:
        print('not side by side', a['rect'], b['rect']); sys.exit(1)
else:
    if abs(a['rect']['x'] - b['rect']['x']) > 2 or a['rect']['y'] + a['rect']['height'] > b['rect']['y'] + 2:
        print('not stacked', a['rect'], b['rect']); sys.exit(1)
sys.exit(0)" 25

# Phase 2: send two lone windows to the other-orientation screen one at a time
# (a lone window crosses the edge; a pair would swap instead), and assert the
# target's axis.
ensure_clean
set_setting min-size-policy ignore
send_to_other() {
  local id="$1"
  adrt ActivateWindow "$id" >/dev/null
  sleep 0.5
  adrt MoveDirection "$DIR" >/dev/null
  wait_python 20 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$id and w['monitor']==$other] else 1)" || true
}
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
A="$(list_ids)"
send_to_other "$A"
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 2 15 || true
B="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
send_to_other "$B"
wait_settled 15

poll "the pair on the other screen splits along that screen's axis ($other_axis)" "
import json, sys
d = json.load(sys.stdin)
tiles = [w for w in d['windows'] if w['tileable'] and not w['minimized'] and w['layer'] != 2 and w['monitor'] == $other]
if len(tiles) != 2:
    print('expected two tiles on monitor', $other, 'got', len(tiles)); sys.exit(1)
if any(w.get('axis') != '$other_axis' for w in tiles):
    print('axis', [(w['id'], w.get('axis')) for w in tiles], 'expected', '$other_axis'); sys.exit(1)
a, b = sorted(tiles, key=lambda w: (w['rect']['x'], w['rect']['y']))
if '$other_axis' == 'horizontal':
    if abs(a['rect']['y'] - b['rect']['y']) > 2 or a['rect']['x'] + a['rect']['width'] > b['rect']['x'] + 2:
        print('not side by side', a['rect'], b['rect']); sys.exit(1)
else:
    if abs(a['rect']['x'] - b['rect']['x']) > 2 or a['rect']['y'] + a['rect']['height'] > b['rect']['y'] + 2:
        print('not stacked', a['rect'], b['rect']); sys.exit(1)
sys.exit(0)" 25

# Phase 3: a vertical workspace layout stacks even a landscape pair (§1, §6).
ensure_clean
set_setting min-size-policy ignore
adrt SimulateWorkspaceOrientation true >/dev/null 2>&1 || true
open_pair
wait_settled 15
poll "layout_rows=-1 stacks the pair on the landscape screen" '
import json, sys
d = json.load(sys.stdin)
if d.get("workspaceLayoutRows") != -1:
    print("layout rows", d.get("workspaceLayoutRows")); sys.exit(1)
tiles = [w for w in d["windows"] if w["tileable"] and not w["minimized"] and w["layer"] != 2]
if len(tiles) != 2:
    print("expected two tiles, got", len(tiles)); sys.exit(1)
if any(w.get("axis") != "vertical" for w in tiles):
    print("axis", [(w["id"], w.get("axis")) for w in tiles]); sys.exit(1)
a, b = sorted(tiles, key=lambda w: w["rect"]["y"])
if abs(a["rect"]["x"] - b["rect"]["x"]) > 2 or a["rect"]["y"] + a["rect"]["height"] > b["rect"]["y"] + 2:
    print("not stacked", a["rect"], b["rect"]); sys.exit(1)
sys.exit(0)' 25

adrt SimulateWorkspaceOrientation false >/dev/null 2>&1 || true
ensure_clean
summary
