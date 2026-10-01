#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A119 The float key leaves the window exactly in place (§6): floating is not a
# move — the window keeps the rect it had, while the sibling fills the screen.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
open_pair
ids=($(list_ids))
A="${ids[0]}"
B="${ids[1]}"
wait_settled 15

before="$(state_expr "json.dumps(next(w for w in d['windows'] if w['id']==$A)['rect'])")"

adrt ToggleFloat "$A" >/dev/null
wait_settled 15

poll "the floated window keeps its exact rect" "
import json, sys
d = json.load(sys.stdin)
w = [x for x in d['windows'] if x['id'] == $A]
if not w:
    print('window gone'); sys.exit(1)
r = w[0]['rect']
want = json.loads('''$before''')
if abs(r['x'] - want['x']) > 2 or abs(r['y'] - want['y']) > 2 or abs(r['width'] - want['width']) > 2 or abs(r['height'] - want['height']) > 2:
    print('moved on float:', r, 'was', want); sys.exit(1)
print('stayed at', r)
" 15

poll "the floated window sits above the tiling" "
import json, sys
d = json.load(sys.stdin)
w = [x for x in d['windows'] if x['id'] == $A]
sys.exit(0 if w and w[0]['layer'] == 2 and w[0]['tileable'] is False else 1)
" 12

poll "the sibling fills the screen behind it" "
import json, sys
d = json.load(sys.stdin)
area = d['monitors'][0].get('workArea') or d['monitors'][0]['geometry']
w = [x for x in d['windows'] if x['id'] == $B]
if not w:
    print('sibling gone'); sys.exit(1)
r = w[0]['rect']
sys.exit(0 if r['width'] >= area['width'] - 3 and r['height'] >= area['height'] - 3 else 1)
" 15

ensure_clean
summary
