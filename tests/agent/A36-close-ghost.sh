#!/usr/bin/env bash
# Generated with AI for personal use.
# Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
# and can maintain this code.
# A36 Close ghost: a tiled window fades a ghost on close, a non-tiled surface
# (dialog/menu) must not flash one.
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

ensure_clean
set_setting close-animation-duration 4000
open_pair
ids=($(list_ids))
sleep 1
close_window "${ids[0]}"
sleep 0.8

check_python "closing a tiled window fades a ghost" '
import json, sys
g = json.load(sys.stdin)["indicator"]["ghosts"]
print("ghosts", g)
sys.exit(0 if g >= 1 else 1)
'

# Let the ghost fade, then check a non-tiled dialog produces none.
set_setting close-animation-duration 150
ensure_clean
sleep 1

spawn_window "zenity --info --text=adrt-test" >/dev/null
wait_count 1 25 || true
wait_settled 20
dialog="$(list_ids | awk "{print \$1}")"
close_window "$dialog"
sleep 0.8

check_python "closing a dialog flashes no ghost" '
import json, sys
g = json.load(sys.stdin)["indicator"]["ghosts"]
print("ghosts", g)
sys.exit(0 if g == 0 else 1)
'

ensure_clean
summary
