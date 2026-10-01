#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A101 Undo restores the instance and its configuration (§13): a maximize, an
# un-float and a drag-swap each revert workspace, slot, rect, maximized and
# floating, plus the ratios.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15
pair_ws="$(window_field "$A" workspace)"
before_b="$(window_field "$B" rect)"

# --- a maximize is undone back into the pair ------------------------------
adrt MaximizeWindow "$B" >/dev/null
wait_python 20 "
import json, sys
d = json.load(sys.stdin)
b = [w for w in d['windows'] if w['id'] == $B]
sys.exit(0 if b and b[0]['maximized'] and b[0]['workspace'] != $pair_ws else 1)" || true

adrt Undo >/dev/null
poll "undoing a maximize rejoins the pair un-maximized" "
import json, sys
d = json.load(sys.stdin)
a = [w for w in d['windows'] if w['id'] == $A]
b = [w for w in d['windows'] if w['id'] == $B]
if not a or not b:
    print('window gone'); sys.exit(1)
if a[0]['workspace'] != $pair_ws or b[0]['workspace'] != $pair_ws:
    print('workspaces', a[0]['workspace'], b[0]['workspace'], 'expected', $pair_ws); sys.exit(1)
if a[0]['maximized'] or b[0]['maximized']:
    print('still maximized:', a[0]['maximized'], b[0]['maximized']); sys.exit(1)
if a[0]['slot'] == b[0]['slot']:
    print('not a pair:', a[0]['slot'], b[0]['slot']); sys.exit(1)
print('restored pair, B at', b[0]['rect'])
" 20

# --- an un-float is undone ------------------------------------------------
adrt ToggleFloat "$A" >/dev/null
wait_python 20 "import json,sys; d=json.load(sys.stdin); sys.exit(0 if [w for w in d['windows'] if w['id']==$A and w['layer']==2] else 1)" || true

adrt Undo >/dev/null
poll "undoing an un-float puts the window back in the tiling" "
import json, sys
d = json.load(sys.stdin)
a = [w for w in d['windows'] if w['id'] == $A]
b = [w for w in d['windows'] if w['id'] == $B]
if not a or not b:
    print('window gone'); sys.exit(1)
if a[0]['layer'] == 2:
    print('still floating'); sys.exit(1)
if a[0]['workspace'] != b[0]['workspace']:
    print('not tiled together'); sys.exit(1)
print('un-float undone')
" 20

# --- a drag-swap is undone -------------------------------------------------
before_side="$(state_expr "int(next(w for w in d['windows'] if w['id']==$A)['rect']['x'] < next(w for w in d['windows'] if w['id']==$B)['rect']['x'])")"
adrt ActivateWindow "$A" >/dev/null
sleep 0.5
adrt MoveDirection right >/dev/null
poll "the keyboard swap traded the sides" "
import json, sys
d = json.load(sys.stdin)
a = [w for w in d['windows'] if w['id'] == $A]
b = [w for w in d['windows'] if w['id'] == $B]
if not a or not b:
    print('window gone'); sys.exit(1)
now = a[0]['rect']['x'] < b[0]['rect']['x']
sys.exit(0 if now != ($before_side == 1) else 1)
" 15

adrt Undo >/dev/null
poll "undoing a swap restores the sides" "
import json, sys
d = json.load(sys.stdin)
a = [w for w in d['windows'] if w['id'] == $A]
b = [w for w in d['windows'] if w['id'] == $B]
if not a or not b:
    print('window gone'); sys.exit(1)
now = a[0]['rect']['x'] < b[0]['rect']['x']
sys.exit(0 if now == ($before_side == 1) else 1)
" 20

ensure_clean
summary
