#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A24 Keybinding float through injected input: Super+F floats the focused half
# of a pair (layer 2), leaving the other window filling the screen.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if ! probe_supports injection; then
  skip "A24 keybinding float: needs ADRT_INJECT=1 (the nested harness sets it)"
  exit 0
fi

ensure_clean
open_pair
ids=($(list_ids))
adrt ActivateWindow "${ids[0]}" >/dev/null
# Under a loaded suite a blind settle can inject before the activate landed and
# the wrong half floats; wait for the activation to be observed instead.
if wait_python 10 "import json,sys; sys.exit(0 if json.load(sys.stdin).get('focused') == ${ids[0]} else 1)"; then
  inject_hotkey 65515 102   # Super+F
  poll "the float keybinding floated the focused window" "
import json, sys
d = json.load(sys.stdin)
w = [w for w in d['windows'] if w['id'] == ${ids[0]}]
sys.exit(0 if w and w[0]['layer'] == 2 else 1)
" 10
else
  fail "the focused window never became ${ids[0]}: float keybinding not exercised"
fi

ensure_clean
summary
