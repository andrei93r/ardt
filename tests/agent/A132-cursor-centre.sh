#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A132 Cursor to centre through the keybinding (§17): Super+C moves the pointer
# to the middle of the focused window. The nested Shell has a virtual pointer
# that `global.get_pointer()` reports, so the move is observable; a Shell with
# no public warp mechanism skips with a reason instead of failing.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A132 cursor-centre: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi
if ! probe_supports cursor.seatWarp && ! probe_supports cursor.displayWarp; then
  skip "A132 cursor-centre: this Shell exposes no public pointer-warp mechanism"
  exit 0
fi

focused_is() {
  wait_python "${2:-10}" "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == int('$1') else 1)"
}

ensure_clean
set_setting cursor-follows-focus false
open_pair
ids=($(list_ids))
first="${ids[0]}"

adrt ActivateWindow "$first" >/dev/null
focused_is "$first" || true
sleep 0.5

# Super+C must be the first *injected* input: in the nested headless Shell a
# pointer event before the first virtual key chord stops later key delivery
# (docs/platform-notes.md). The pointer therefore starts at boot (0,0) and
# this single chord has to move it; the warp is issued twice to defeat the
# separate first-synthetic-motion axis quirk.
inject_hotkey 65515 99   # Super+C

poll "Super+C puts the pointer in the middle of the focused window" "
import json, sys
d = json.load(sys.stdin)
w = next((x for x in d['windows'] if x['id'] == $first), None)
p = d.get('pointer') or {}
if not w or 'x' not in p:
    sys.exit(1)
cx = w['rect']['x'] + w['rect']['width'] / 2
cy = w['rect']['y'] + w['rect']['height'] / 2
if abs(p['x'] - cx) > 3 or abs(p['y'] - cy) > 3:
    print('pointer', p, 'centre', (cx, cy))
    sys.exit(1)
sys.exit(0)
" 15

ensure_clean
summary
