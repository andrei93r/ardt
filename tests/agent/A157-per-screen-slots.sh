#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
#
# A157 A workspace's slots are per screen (§3/§5): a newcomer on a screen must
# pair with the window already on *that* screen, even when another screen is
# showing the same workspace and its window fills the other slot.
# `buildPlacementState` used to count every tracked window globally, so a window
# one screen over occupied a slot that belonged to this screen's pair; a fresh
# window then saw the workspace as full and floated (`float-over-pair`), as in
# the real capture. One workspace only, so a screen is `single` and a full
# workspace floats rather than creating another. Needs two monitors; run with
# `ADRT_MONITORS='1280x800:1280x800'`.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
screens="$(screen_count)"
if [ "$screens" -lt 2 ]; then
  skip "A157 needs two screens (this harness has $screens)"
  summary
  exit 0
fi

# One workspace only: a screen is then `single`, where a full workspace floats
# rather than creating another one (the capture's `float-over-pair`).
set_static_workspaces 1

read -r P Q DIR <<<"$(dump | python3 -c '
import json, sys
mons = json.load(sys.stdin)["monitors"]
p = next((m["index"] for m in mons if m.get("isPrimary")), mons[0]["index"])
other = next((m for m in mons if m["index"] != p), None)
if other is None:
    print(p, -1, "none"); raise SystemExit
g, pg = other["geometry"], next(m for m in mons if m["index"] == p)["geometry"]
if g["y"] >= pg["y"] + pg["height"]:
    direction = "down"
elif g["y"] + g["height"] <= pg["y"]:
    direction = "up"
elif g["x"] >= pg["x"] + pg["width"]:
    direction = "right"
else:
    direction = "left"
print(p, other["index"], direction)')"
if [ "$Q" = "-1" ]; then
  skip "A157 needs a non-primary screen"
  summary
  exit 0
fi

# W1 alone on Q, maximized (a lone window crosses the edge).
spawn_window >/dev/null
wait_count 1 15 || true
sleep 1
W1="$(list_ids | awk '{print $1}')"
move_to_monitor "$W1" "$Q" "$DIR" || true

# W2 opens on the primary P, alone there, and maximizes. The one workspace now
# holds one window per screen, so counting globally makes it look full.
before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 2 15 || true
W2="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_settled 15

# A newcomer on P: put the pointer and focus on P, then open it.
read -r PX PY <<<"$(dump | python3 -c "
import json, sys
m = next(m for m in json.load(sys.stdin)['monitors'] if m['index'] == $P)
g = m['geometry']
print(g['x'] + g['width'] // 2, g['y'] + g['height'] // 2)")"
inject_pointer "$PX" "$PY"
adrt ActivateWindow "$W2" >/dev/null
wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == $W2 else 1)" || true
sleep 1

before_ids="$(list_ids)"
spawn_window >/dev/null
wait_count 3 15 || true
W3="$(comm -13 <(echo "$before_ids" | tr ' ' '\n' | sort) <(list_ids | tr ' ' '\n' | sort) | tr -d '\n' | xargs)"
wait_settled 20

poll "the newcomer on P pairs with the window already there, not floats" "
import json, sys
d = json.load(sys.stdin)
w2 = next((w for w in d['windows'] if w['id'] == int('$W2')), None)
w3 = next((w for w in d['windows'] if w['id'] == int('$W3')), None)
if w2 is None or w3 is None:
    print('window gone', w2 is None, w3 is None); sys.exit(1)
if w3['monitor'] != $P:
    print('the newcomer opened on monitor', w3['monitor'], 'expected $P'); sys.exit(1)
if w2['monitor'] != $P:
    print('the resident left P', w2['monitor']); sys.exit(1)
if w2['workspace'] != w3['workspace']:
    print('not paired', w2['workspace'], w3['workspace']); sys.exit(1)
if w2['layer'] == 2 or w3['layer'] == 2:
    print('one of the pair floated', w2['layer'], w3['layer']); sys.exit(1)
if w2['slot'] is None or w3['slot'] is None:
    print('the pair has no slots', w2['slot'], w3['slot']); sys.exit(1)
print('P pair', w2['slot'], w3['slot'], 'workspace', w2['workspace'])
" 30

ensure_clean
summary
